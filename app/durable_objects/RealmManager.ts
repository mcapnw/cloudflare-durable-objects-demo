import { GameRoomDurableObject } from './GameRoom'
import { Player, PlayerRole } from './game-logic/types'

export class RealmManager {
    // Realm State - Extracted from GameRoom
    waitingPlayers: Map<string, { id: string, name: string, ready: boolean, joinedAt: number }> = new Map()
    isRealm: boolean = false
    realmExpiresAt: number = 0
    activeRealms: Map<string, number> = new Map() // Track active realm IDs with expiry timestamps (only used in global room)
    playerRealmMap: Map<string, { realmId: string, expiresAt: number }> = new Map() // Track which players are in which realms (only used in global room)
    assignedRoles: Map<string, PlayerRole> = new Map() // Track roles assigned by lobby

    constructor(private gameRoom: GameRoomDurableObject) { }



    initialized: boolean = false

    async ensureInitialized(room: string | null) {
        if (this.initialized) return
        this.initialized = true

        if (room && room !== 'global-room') {
            this.isRealm = true

            // Try to load realm config from storage (in case worker restarted)
            try {
                const config = await this.gameRoom.state.storage.get<{ expiresAt: number, roles: { playerId: string, role: PlayerRole }[] }>('realm_config')
                if (config) {
                    console.log('[REALM-DO] Loaded realm config from storage:', config)
                    this.realmExpiresAt = config.expiresAt
                    for (const r of config.roles) {
                        this.assignedRoles.set(r.playerId, r.role)
                    }
                }
            } catch (e) {
                console.error('[REALM-DO] Failed to load realm config:', e)
            }

            // If realmExpiresAt is still 0, the realm was never properly initialized
            if (this.realmExpiresAt === 0) {
                console.warn('[REALM-DO] Realm has no config - likely expired or invalid')
                // Leave realmExpiresAt as 0 to signal invalid state
            }
            await this.loadActiveRealmsCount()
        } else {
            // Load persistent state for global room
            try {
                const realms = await this.gameRoom.state.storage.get<[string, number][]>('active_realms')
                if (realms) {
                    this.activeRealms = new Map(realms)
                    // Clean up expired realms
                    const now = Date.now()
                    let changed = false
                    for (const [realmId, expiresAt] of this.activeRealms.entries()) {
                        if (now > expiresAt) {
                            this.activeRealms.delete(realmId)
                            changed = true
                        }
                    }
                    if (realms.length !== this.activeRealms.size) {
                        await this.saveActiveRealms()
                    }
                }
            } catch (e) { console.error('Failed to load active realms:', e) }

            try {
                const mapping = await this.gameRoom.state.storage.get<[string, { realmId: string, expiresAt: number }][]>('player_realms')
                if (mapping) {
                    this.playerRealmMap = new Map(mapping)
                    // Clean up expired mappings
                    const now = Date.now()
                    for (const [playerId, data] of this.playerRealmMap.entries()) {
                        if (now > data.expiresAt) {
                            this.playerRealmMap.delete(playerId)
                        }
                    }
                    if (mapping.length !== this.playerRealmMap.size) {
                        await this.savePlayerRealms()
                    }
                }
            } catch (e) { console.error('Failed to load player realms:', e) }
        }
    }

    init(room: string | null) {
        this.ensureInitialized(room).catch(e => console.error('Failed to initialize RealmManager:', e))
    }

    async loadActiveRealmsCount() {
        try {
            // Fetch from Global Room DO (not local storage which is isolated)
            const globalId = this.gameRoom.env.GAMEROOM_NAMESPACE.idFromName('global-room')
            const globalStub = this.gameRoom.env.GAMEROOM_NAMESPACE.get(globalId)
            const response = await globalStub.fetch('http://internal/internal/stats')
            const stats = await response.json() as { activeRealmCount: number }

            this.activeRealms.clear()
            for (let i = 0; i < stats.activeRealmCount; i++) {
                this.activeRealms.set(`placeholder_${i}`, 0) // Dummy entries to match count
            }
        } catch (e) {
            console.error('Failed to load active realms count from global room:', e)
        }
    }

    async saveActiveRealms() {
        await this.gameRoom.state.storage.put('active_realms', Array.from(this.activeRealms.entries()))
            .catch(e => console.error('Failed to update active realms:', e))
    }

    async savePlayerRealms() {
        await this.gameRoom.state.storage.put('player_realms', Array.from(this.playerRealmMap.entries()))
            .catch(e => console.error('Failed to update player realms:', e))
    }

    update(now: number, players: Player[]): boolean {
        // Returns true if game loop should stop (realm expired)
        if (this.isRealm) {
            if (now > this.realmExpiresAt) {
                this.gameRoom.broadcast({ type: 'realm_expired' })
                this.gameRoom.playerManager.players.clear()
                this.gameRoom.stopGameLoop()
                return true
            }

            // Periodically refresh active realm count
            if (Math.random() < 0.1) {
                this.loadActiveRealmsCount()
            }
            return false
        }

        // Global Room Logic
        // Auto-kick from lobby
        let lobbyChanged = false
        for (const [pid, p] of this.waitingPlayers.entries()) {
            if (!p.ready && (now - p.joinedAt > 120000)) {
                this.waitingPlayers.delete(pid)
                lobbyChanged = true
            }
        }

        // Clean up expired realms
        let realmsChanged = false
        for (const [realmId, expiresAt] of this.activeRealms.entries()) {
            if (now > expiresAt + 5000) { // Add buffer to ensure it finished
                this.activeRealms.delete(realmId)
                realmsChanged = true

                // Cleanup player mappings for this realm
                for (const [pid, info] of this.playerRealmMap.entries()) {
                    if (info.realmId === realmId) {
                        this.playerRealmMap.delete(pid)
                    }
                }
            }
        }
        if (realmsChanged) {
            this.saveActiveRealms()
            this.savePlayerRealms()
        }

        if (lobbyChanged) {
            this.broadcastLobbyUpdate()
        }

        return false
    }

    joinLobby(player: Player) {
        const name = (player.username && player.username.trim() !== '') ? player.username : player.firstName
        this.waitingPlayers.set(player.id, { id: player.id, name: name, ready: false, joinedAt: Date.now() })
        this.broadcastLobbyUpdate()
    }

    leaveLobby(playerId: string) {
        if (this.waitingPlayers.has(playerId)) {
            this.waitingPlayers.delete(playerId)
            this.broadcastLobbyUpdate()
        }
    }

    handleReady(playerId: string) {
        if (this.waitingPlayers.has(playerId)) {
            const entry = this.waitingPlayers.get(playerId)!
            entry.ready = !entry.ready
            this.waitingPlayers.set(playerId, entry)

            const allPlayers = Array.from(this.waitingPlayers.values())
            this.broadcastLobbyUpdate()

            // Check start condition
            const readyCount = allPlayers.filter(p => p.ready).length
            // Require at least 1 player to start
            if (allPlayers.length >= 1 && readyCount === allPlayers.length) {
                this.startRealm(allPlayers)
            }
        }
    }

    startRealm(players: { id: string }[]) {
        const newRealmId = crypto.randomUUID()
        const realmExpiresAt = Date.now() + 60000 // 1 minute

        // Role Assignment
        const shuffled = [...players].sort(() => 0.5 - Math.random())
        const roles: PlayerRole[] = []

        // Logic: 1 player = 1 Fisher. 2 players = 1 Fisher, 1 Cooker. 
        // 3+ players: 2 Fishers, rest Cookers.
        if (players.length === 1) {
            roles.push('Fisher')
        } else if (players.length === 2) {
            roles.push('Fisher', 'Cooker')
        } else {
            roles.push('Fisher', 'Fisher')
            while (roles.length < players.length) roles.push('Cooker')
        }

        // Apply roles to PlayerManager
        shuffled.forEach((p, i) => {
            const player = this.gameRoom.playerManager.players.get(p.id)
            if (player) {
                player.role = roles[i]
                player.heldItem = null // Reset item
                player.isFrozen = false
            }
        })

        this.activeRealms.set(newRealmId, realmExpiresAt)
        this.saveActiveRealms()

        // PUSH configuration to the Key Durable Object Instance
        // This ensures the new instance knows its expiry and roles immediately
        const realmStubId = this.gameRoom.env.GAMEROOM_NAMESPACE.idFromName(newRealmId)
        const realmStub = this.gameRoom.env.GAMEROOM_NAMESPACE.get(realmStubId)

        const roleData = shuffled.map((p, i) => ({ playerId: p.id, role: roles[i] }))
        // Fire and forget - or await? Ideally await to ensure it's ready before clients connect
        // But clients take time to switch anyway.
        realmStub.fetch('http://internal/internal/init-realm', {
            method: 'POST',
            body: JSON.stringify({
                expiresAt: realmExpiresAt,
                roles: roleData
            })
        }).catch(e => console.error('Failed to init realm instance:', e))


        for (const wp of players) {
            this.playerRealmMap.set(wp.id, { realmId: newRealmId, expiresAt: realmExpiresAt })
        }
        this.savePlayerRealms()

        // Notify waiting players
        for (const wp of players) {
            const sockets = this.gameRoom.state.getWebSockets(wp.id)
            for (const s of sockets) {
                s.send(JSON.stringify({ type: 'start_realm', realmId: newRealmId }))
            }
        }

        this.waitingPlayers.clear()
        this.broadcastLobbyUpdate()
    }

    broadcastLobbyUpdate() {
        this.gameRoom.broadcast({
            type: 'realm_lobby_update',
            players: Array.from(this.waitingPlayers.values())
        })
    }

    endRealm() {
        // Manually end the realm (triggered by player action)
        if (!this.isRealm) return

        console.log('[REALM] Manually ending realm')

        // Get list of players before clearing
        const playerIds = Array.from(this.gameRoom.playerManager.players.keys())

        // Broadcast to all players
        this.gameRoom.broadcast({ type: 'realm_expired' })

        // Clear player mappings in global room
        const globalId = this.gameRoom.env.GAMEROOM_NAMESPACE.idFromName('global-room')
        const globalStub = this.gameRoom.env.GAMEROOM_NAMESPACE.get(globalId)

        // Notify global room to clear these players from realm mapping
        globalStub.fetch('http://internal/internal/clear-realm-players', {
            method: 'POST',
            body: JSON.stringify({ playerIds })
        }).catch(e => console.error('Failed to clear realm players:', e))

        // Clear local state
        this.gameRoom.playerManager.players.clear()
        this.gameRoom.stopGameLoop()
    }
}
