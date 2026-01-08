import { GameRoomDurableObject } from './GameRoom'
import { Player } from './game-logic/types'

export class RealmManager {
    // Realm State - Extracted from GameRoom
    waitingPlayers: Map<string, { id: string, name: string, ready: boolean, joinedAt: number }> = new Map()
    isRealm: boolean = false
    realmExpiresAt: number = 0
    activeRealms: Map<string, number> = new Map() // Track active realm IDs with expiry timestamps (only used in global room)
    playerRealmMap: Map<string, { realmId: string, expiresAt: number }> = new Map() // Track which players are in which realms (only used in global room)

    constructor(private gameRoom: GameRoomDurableObject) { }

    init(room: string | null) {
        if (room && room !== 'global-room') {
            this.isRealm = true
            if (this.realmExpiresAt === 0) {
                this.realmExpiresAt = Date.now() + 30000 // 30 seconds
            }
            this.loadActiveRealmsCount()
        } else {
            // Load persistent state for global room
            this.gameRoom.state.storage.get<[string, number][]>('active_realms').then(realms => {
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
                        this.saveActiveRealms()
                    }
                }
            }).catch(e => console.error('Failed to load active realms:', e))

            this.gameRoom.state.storage.get<[string, { realmId: string, expiresAt: number }][]>('player_realms').then(mapping => {
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
                        this.savePlayerRealms()
                    }
                }
            }).catch(e => console.error('Failed to load player realms:', e))
        }
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
                this.gameRoom.players.clear()
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
            if (now > expiresAt) {
                this.activeRealms.delete(realmId)
                realmsChanged = true
            }
        }
        if (realmsChanged) {
            this.saveActiveRealms()
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
            if (allPlayers.length >= 1 && readyCount === allPlayers.length) {
                this.startRealm(allPlayers)
            }
        }
    }

    startRealm(players: { id: string }[]) {
        const newRealmId = crypto.randomUUID()
        const realmExpiresAt = Date.now() + 30000 // 30 seconds

        this.activeRealms.set(newRealmId, realmExpiresAt)
        this.saveActiveRealms()

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
}
