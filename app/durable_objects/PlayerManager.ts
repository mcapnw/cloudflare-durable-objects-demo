import { GameRoomDurableObject } from './GameRoom'
import { Player } from './game-logic/types'

export class PlayerManager {
    players: Map<string, Player> = new Map() // Central source of truth for all players
    playerLastShoot: Map<string, number> = new Map() // Rate limiting for shoot action
    playerSessionData: Map<string, {
        sessionStart: number
        coinsStart: number
        plantsPlanted: number
        plantsWatered: number
        plantsHarvested: number
        dragonKills: number
        deaths: number
        shotsFired: number
        itemsPurchased: number
        realmJoins: number
    }> = new Map()

    constructor(private gameRoom: GameRoomDurableObject) { }

    getPlayers(): Player[] {
        return Array.from(this.players.values())
    }

    getPlayerData(ws: WebSocket): Player | null {
        try {
            const tags = this.gameRoom.state.getTags(ws)
            const playerId = tags[0]
            if (playerId && this.players.has(playerId)) {
                return this.players.get(playerId)!
            }

            const data = (ws as any).deserializeAttachment?.() as Player | null ?? (ws as any).attachment as Player | null
            if (data) return data
            if (playerId) return { id: playerId, firstName: 'Player', username: null, x: 0, z: 0, rotation: 0, gender: 'male', faceIndex: 0, isDead: false, deathTime: 0, weapon: null }
            return null
        } catch (e) { console.error('Error in getPlayerData:', e); return null }
    }

    setPlayerData(ws: WebSocket, data: Player) {
        try { (ws as any).serializeAttachment?.(data) } catch { (ws as any).attachment = data }
    }

    async handleConnection(request: Request, url: URL): Promise<Response> {
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 })
        }

        const usernameParam = url.searchParams.get('username') || null
        const firstNameParam = url.searchParams.get('firstName') || url.searchParams.get('name') || 'Player'
        const id = url.searchParams.get('id') || crypto.randomUUID()
        const faceIndex = parseInt(url.searchParams.get('faceIndex') || '0', 10)
        const genderParam = url.searchParams.get('gender')
        const gender: 'male' | 'female' = (genderParam === 'female') ? 'female' : 'male'
        const room = url.searchParams.get('room')

        const { 0: client, 1: server } = new WebSocketPair()

        // Fetch weapon from DB
        let dbWeapon: string | null = null
        let dbFound = false
        try {
            const userRow = await this.gameRoom.env.DB.prepare('SELECT weapon FROM Users WHERE id = ?')
                .bind(id)
                .first<{ weapon: string | null }>()
            if (userRow !== null && userRow !== undefined) {
                dbWeapon = userRow.weapon
                dbFound = true
            }
        } catch (e) {
            console.error('Failed to fetch weapon from DB:', e)
        }

        // Load saved location
        let savedLoc: any = null
        try {
            savedLoc = await this.gameRoom.state.storage.get(`player_loc_${id}`)
        } catch (e) {
            console.error('Failed to load player location', e)
        }

        const playerData: Player = {
            id,
            firstName: firstNameParam,
            username: usernameParam,
            x: savedLoc?.x ?? 0,
            z: savedLoc?.z ?? 0,
            rotation: savedLoc?.rotation ?? 0,
            gender: gender,
            faceIndex: faceIndex,
            isDead: false,
            deathTime: 0,
            weapon: dbFound ? dbWeapon : (savedLoc?.weapon || null),
            role: this.gameRoom.realmManager.assignedRoles.get(id) || 'None',
            heldItem: null,
            isFrozen: false
        }

        // Check if player is already in memory (e.g. fast reconnect/refresh)
        // If so, use their current in-memory location instead of stored (potentially stale) location
        if (this.players.has(id)) {
            const existing = this.players.get(id)!
            console.log('[PlayerManager] Player already in memory, preserving location:', id)
            playerData.x = existing.x
            playerData.z = existing.z
            playerData.rotation = existing.rotation
            // If they are in memory, they are "alive" in the room, so keep them dead/alive state?
            // Usually we want to respawn them if they refresh?
            // But for location, we definitely want to keep it.
        }

        // Realm Init Logic - BEFORE welcome message - MUST await to ensure playerRealmMap is loaded
        await this.gameRoom.realmManager.ensureInitialized(room || 'global-room')

        // Check if this realm is valid (has config and hasn't expired)
        const isRealm = (room && room !== 'global-room')
        if (isRealm) {
            const now = Date.now()
            const realmExpired = this.gameRoom.realmManager.realmExpiresAt === 0 || now > this.gameRoom.realmManager.realmExpiresAt
            const playerHasRole = this.gameRoom.realmManager.assignedRoles.has(id)

            if (realmExpired || !playerHasRole) {
                console.warn('[PlayerManager] Rejecting connection to invalid/expired realm:', {
                    room,
                    realmExpired,
                    playerHasRole,
                    expiresAt: this.gameRoom.realmManager.realmExpiresAt
                })

                // Clear the stale player realm mapping from global room
                const globalId = this.gameRoom.env.GAMEROOM_NAMESPACE.idFromName('global-room')
                const globalStub = this.gameRoom.env.GAMEROOM_NAMESPACE.get(globalId)
                globalStub.fetch(`http://internal/internal/clear-player-realm?playerId=${id}`).catch(err => {
                    console.error('[PlayerManager] Failed to clear player realm mapping:', err)
                })

                // Send error message and close connection
                server.send(JSON.stringify({
                    type: 'error',
                    code: 'REALM_INVALID',
                    message: 'This realm has expired or is no longer valid'
                }))
                server.close(1000, 'Realm invalid')
                return new Response(null, { status: 101, webSocket: client })
            }
        }

        // Randomize player spawn location in realm ONLY if no saved position exists AND not in memory
        if (room && room !== 'global-room' && !savedLoc && !this.players.has(id)) {
            const spawnRadius = 20 // Spawn within 20 units
            const MIN_SPAWN_DISTANCE = 2 // Minimum distance from other players
            let spawnX = 0, spawnZ = 0
            let attempts = 0
            const maxAttempts = 20

            // Try to find a spawn location that's not too close to other players
            do {
                const randomAngle = Math.random() * Math.PI * 2
                const randomDistance = Math.random() * spawnRadius
                spawnX = Math.cos(randomAngle) * randomDistance
                spawnZ = Math.sin(randomAngle) * randomDistance

                // Check if this location is far enough from all other players
                let tooClose = false
                for (const [existingId, existingPlayer] of this.players) {
                    if (existingId === id) continue
                    const dx = spawnX - existingPlayer.x
                    const dz = spawnZ - existingPlayer.z
                    const distance = Math.sqrt(dx * dx + dz * dz)
                    if (distance < MIN_SPAWN_DISTANCE) {
                        tooClose = true
                        break
                    }
                }

                if (!tooClose) break
                attempts++
            } while (attempts < maxAttempts)

            playerData.x = spawnX
            playerData.z = spawnZ
            playerData.rotation = Math.random() * Math.PI * 2
        }

        this.players.set(id, playerData)
        this.setPlayerData(server, playerData)

        // Initialize session tracking
        let coinsStart = 0
        try {
            const coinsRow = await this.gameRoom.env.DB.prepare('SELECT coins FROM Users WHERE id = ?')
                .bind(id)
                .first<{ coins: number }>()
            if (coinsRow) {
                coinsStart = coinsRow.coins
            }
        } catch (e) {
            console.error('[PlayerManager] Failed to fetch coins for session tracking:', e)
        }

        this.playerSessionData.set(id, {
            sessionStart: Date.now(),
            coinsStart,
            plantsPlanted: 0,
            plantsWatered: 0,
            plantsHarvested: 0,
            dragonKills: 0,
            deaths: 0,
            shotsFired: 0,
            itemsPurchased: 0,
            realmJoins: 0
        })

        const dragon = this.gameRoom.dragonManager.dragon
        const dragonDamage = dragon.damageMap.get(id)
        if (dragonDamage) {
            dragonDamage.name = (playerData.username && playerData.username.trim() !== '') ? playerData.username : playerData.firstName
            dragon.damageMap.set(id, dragonDamage)
        }

        this.gameRoom.state.acceptWebSocket(server, [id])

        // Check for active realm session
        let activeRealmId: string | null = null
        if (!room || room === 'global-room') {
            // CRITICAL: Load fresh player realm data from storage to get latest state
            // This ensures we catch realm connections that were tracked after initialization
            try {
                const mapping = await this.gameRoom.state.storage.get<[string, { realmId: string, expiresAt: number }][]>('player_realms')
                if (mapping) {
                    this.gameRoom.realmManager.playerRealmMap = new Map(mapping)
                }
            } catch (e) {
                console.error('[PlayerManager] Failed to reload player realms from storage:', e)
            }

            const realmData = this.gameRoom.realmManager.playerRealmMap.get(id)
            if (realmData && Date.now() < realmData.expiresAt) {
                activeRealmId = realmData.realmId
                console.log('[PlayerManager] Found active realm for player:', id, 'realm:', activeRealmId)
            }
        }

        // isRealm already declared earlier in this function

        server.send(JSON.stringify({
            type: 'welcome',
            ...playerData,
            activeRealm: activeRealmId,
            dragon: isRealm ? null : {
                x: this.gameRoom.dragonManager.dragon.x,
                z: this.gameRoom.dragonManager.dragon.z,
                rotation: this.gameRoom.dragonManager.dragon.rotation,
                health: this.gameRoom.dragonManager.dragon.health,
                isDead: this.gameRoom.dragonManager.dragon.isDead,
                damageList: Array.from(this.gameRoom.dragonManager.dragon.damageMap.values())
            },
            farmPlots: this.gameRoom.farmManager.farmPlots
        }))

        this.gameRoom.broadcast({ type: 'join', ...playerData }, id)

        // Track player realm connection in global room
        if (isRealm) {
            console.log('[REALM] Player connected to realm, tracking in global room:', { playerId: id, realmId: room })
            // Notify global room to track this player in this realm
            const globalId = this.gameRoom.env.GAMEROOM_NAMESPACE.idFromName('global-room')
            const globalStub = this.gameRoom.env.GAMEROOM_NAMESPACE.get(globalId)
            const realmExpiresAt = this.gameRoom.realmManager.realmExpiresAt
            console.log('[REALM] Realm expires at:', new Date(realmExpiresAt).toISOString())
            // Fire-and-forget update to global room
            globalStub.fetch(`http://internal/internal/track-player-realm?playerId=${id}&realmId=${room}&expiresAt=${realmExpiresAt}`).catch(err => {
                console.error('[REALM] Failed to track player realm:', err)
            })
        }

        // Send realm-specific messages
        if (isRealm) {
            // Send time immediately
            server.send(JSON.stringify({
                type: 'realm_init',
                expiresAt: this.gameRoom.realmManager.realmExpiresAt
            }))
        } else {
            // Send waiting list to new player in global room
            if (this.gameRoom.realmManager.waitingPlayers.size > 0) {
                server.send(JSON.stringify({
                    type: 'realm_lobby_update',
                    players: Array.from(this.gameRoom.realmManager.waitingPlayers.values())
                }))
            }
        }

        const players = this.getPlayers()
        server.send(JSON.stringify({ type: 'init', players }))

        if (this.gameRoom.gameLoopInterval === null) {
            this.gameRoom.startGameLoop()
        }

        return new Response(null, {
            status: 101,
            webSocket: client,
        })
    }

    async handleLeave(ws: WebSocket) {
        const tags = this.gameRoom.state.getTags(ws); const playerId = tags[0]
        if (playerId) {
            const allSockets = this.gameRoom.state.getWebSockets(playerId)
            const otherSockets = allSockets.filter(s => s !== ws)
            if (otherSockets.length === 0) {
                const playerData = this.players.get(playerId)
                if (playerData) {
                    await this.gameRoom.state.storage.put(`player_loc_${playerId}`, {
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender,
                        faceIndex: playerData.faceIndex,
                        weapon: playerData.weapon
                    })

                    // Save session analytics to D1
                    const sessionData = this.playerSessionData.get(playerId)
                    if (sessionData) {
                        const sessionEnd = Date.now()
                        const durationSeconds = Math.floor((sessionEnd - sessionData.sessionStart) / 1000)

                        // Get current coins to calculate earnings
                        let coinsEnd = sessionData.coinsStart
                        try {
                            const coinsRow = await this.gameRoom.env.DB.prepare('SELECT coins FROM Users WHERE id = ?')
                                .bind(playerId)
                                .first<{ coins: number }>()
                            if (coinsRow) {
                                coinsEnd = coinsRow.coins
                            }
                        } catch (e) {
                            console.error('[PlayerManager] Failed to fetch final coins for session:', e)
                        }

                        const coinsEarned = coinsEnd - sessionData.coinsStart

                        try {
                            await this.gameRoom.env.DB.prepare(`
                                INSERT INTO PlayerSessions (
                                    user_id, session_start, session_end, duration_seconds,
                                    coins_start, coins_end, coins_earned,
                                    plants_planted, plants_watered, plants_harvested,
                                    dragon_kills, deaths, shots_fired,
                                    items_purchased, realm_joins
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).bind(
                                playerId,
                                sessionData.sessionStart,
                                sessionEnd,
                                durationSeconds,
                                sessionData.coinsStart,
                                coinsEnd,
                                coinsEarned,
                                sessionData.plantsPlanted,
                                sessionData.plantsWatered,
                                sessionData.plantsHarvested,
                                sessionData.dragonKills,
                                sessionData.deaths,
                                sessionData.shotsFired,
                                sessionData.itemsPurchased,
                                sessionData.realmJoins
                            ).run()
                            console.log('[PlayerManager] Saved session analytics for player:', playerId)
                        } catch (e) {
                            console.error('[PlayerManager] Failed to save session analytics:', e)
                        }

                        this.playerSessionData.delete(playerId)
                    }

                    this.players.delete(playerId)

                    // If in Realm and only 1 player remains, make them Fisher
                    if (this.gameRoom.realmManager.isRealm && this.players.size === 1) {
                        const remaining = this.players.values().next().value
                        if (remaining && remaining.role !== 'Fisher') {
                            remaining.role = 'Fisher'
                            remaining.heldItem = null
                        }
                    }
                }
                this.gameRoom.broadcast({ type: 'leave', id: playerId })

                // Cleanup waiting room if they disconnect
                this.gameRoom.realmManager.leaveLobby(playerId)
            }
            ws.close()
        }
        if (this.players.size === 0) this.gameRoom.stopGameLoop()
    }

    markPlayerDead(playerId: string) {
        const sockets = this.gameRoom.state.getWebSockets()
        for (const ws of sockets) {
            const tags = this.gameRoom.state.getTags(ws)
            if (tags[0] === playerId) {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    playerData.isDead = true; playerData.deathTime = Date.now(); this.setPlayerData(ws, playerData)
                    if (this.gameRoom.dragonManager.dragon.targetId === playerId) this.gameRoom.dragonManager.dragon.targetId = null
                    this.gameRoom.dragonManager.dragon.attackers.delete(playerId)
                    setTimeout(() => this.respawnPlayer(playerId), 10000)
                    this.gameRoom.env.DB.prepare('UPDATE Users SET deaths = deaths + 1 WHERE id = ?').bind(playerId).run().catch(e => console.error('Failed to update deaths:', e))

                    // Track death in session analytics
                    const sessionData = this.playerSessionData.get(playerId)
                    if (sessionData) {
                        sessionData.deaths++
                    }
                }
                break
            }
        }
    }

    respawnPlayer(playerId: string) {
        if (this.gameRoom.gameLoopInterval === null) this.gameRoom.startGameLoop()
        const sockets = this.gameRoom.state.getWebSockets()
        for (const ws of sockets) {
            const tags = this.gameRoom.state.getTags(ws)
            if (tags[0] === playerId) {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    // Find a spawn location that's not too close to other players
                    const MIN_SPAWN_DISTANCE = 2
                    let spawnX = 0, spawnZ = 0
                    let attempts = 0
                    const maxAttempts = 20

                    do {
                        spawnX = (Math.random() - 0.5) * 40
                        spawnZ = (Math.random() - 0.5) * 40

                        // Check distance to all other players
                        let tooClose = false
                        for (const [otherId, otherPlayer] of this.players) {
                            if (otherId === playerId) continue
                            const dx = spawnX - otherPlayer.x
                            const dz = spawnZ - otherPlayer.z
                            const distance = Math.sqrt(dx * dx + dz * dz)
                            if (distance < MIN_SPAWN_DISTANCE) {
                                tooClose = true
                                break
                            }
                        }

                        if (!tooClose) break
                        attempts++
                    } while (attempts < maxAttempts)

                    playerData.x = spawnX
                    playerData.z = spawnZ
                    playerData.isDead = false
                    playerData.deathTime = 0
                    this.setPlayerData(ws, playerData)
                    this.gameRoom.broadcast({ type: 'player_respawn', id: playerId, x: playerData.x, z: playerData.z, rotation: playerData.rotation, firstName: playerData.firstName, username: playerData.username, gender: playerData.gender, faceIndex: playerData.faceIndex, weapon: playerData.weapon })
                }
                break
            }
        }
    }
}
