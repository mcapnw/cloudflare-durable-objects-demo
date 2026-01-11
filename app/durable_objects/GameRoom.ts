import { Player, Pickup, Sheep, FarmPlot, Bullet, Dragon } from './game-logic/types'
import { updateSheeps } from './game-logic/sheep'
import { updateDragon } from './game-logic/dragon'
import { updateBullets } from './game-logic/physics'
import { updateFarm } from './game-logic/farming'
import { MessageHandler } from './MessageHandler'
import { RealmManager } from './RealmManager'
import { DragonManager } from './DragonManager'
import { FarmManager } from './FarmManager'
import { SheepManager } from './SheepManager'
import { PlayerManager } from './PlayerManager'
import { RealmGameManager } from './RealmGameManager'

// Game constants
const WORLD_BOUNDS = 25
const SHOOT_COOLDOWN_MS = 1500

// Validation helpers
function isValidNumber(val: any): val is number {
    return typeof val === 'number' && isFinite(val) && !isNaN(val)
}

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val))
}

interface Env {
    GAMEROOM_NAMESPACE: DurableObjectNamespace
    DB: D1Database
}

export class GameRoomDurableObject implements DurableObject {
    state: DurableObjectState
    env: Env

    dragonManager: DragonManager

    bullets: Bullet[] = []
    pickups: Map<string, Pickup> = new Map()
    farmManager: FarmManager
    sheepManager: SheepManager
    playerManager: PlayerManager
    gameLoopInterval: number | null = null

    // Realm State
    messageHandler: MessageHandler
    realmManager: RealmManager
    realmGameManager: RealmGameManager


    constructor(state: DurableObjectState, env: Env) {
        this.state = state
        this.env = env
        this.messageHandler = new MessageHandler(this)
        this.realmManager = new RealmManager(this)
        this.dragonManager = new DragonManager(this)
        this.farmManager = new FarmManager(this)
        this.sheepManager = new SheepManager(this)
        this.playerManager = new PlayerManager(this)
        this.realmGameManager = new RealmGameManager(this)
    }

    async fetch(request: Request) {
        const url = new URL(request.url)

        // Internal API for inter-DO communication (no WebSocket upgrade needed)
        if (url.pathname === '/internal/init-realm') {
            const data = await request.json() as any
            console.log('[REALM-DO] Initializing realm with data:', data)
            this.realmManager.isRealm = true
            this.realmManager.realmExpiresAt = data.expiresAt
            this.realmManager.initialized = true

            // Update PlayerManager with roles (pre-seeding)
            if (data.roles) {
                for (const p of data.roles) {
                    this.realmManager.assignedRoles.set(p.playerId, p.role)
                }
            }

            // Persist realm config to storage so it survives worker restarts
            await this.state.storage.put('realm_config', {
                expiresAt: data.expiresAt,
                roles: data.roles || []
            })
            console.log('[REALM-DO] Saved realm config to storage')

            return new Response('OK')
        }
        if (url.pathname === '/internal/stats') {
            // Clean up expired realms first
            // Clean up expired realms first
            const now = Date.now()
            // Cleanup logic is now inside RealmManager update/init, but for specific API access we can access activeRealms via manager
            // Ideally RealmManager handles this, but for internal stats we access the map directly from manager
            for (const [realmId, expiresAt] of this.realmManager.activeRealms.entries()) {
                if (now > expiresAt) {
                    this.realmManager.activeRealms.delete(realmId)
                }
            }
            return new Response(JSON.stringify({
                activeRealmCount: this.realmManager.activeRealms.size
            }), { headers: { 'Content-Type': 'application/json' } })
        }

        if (url.pathname === '/internal/player-realm') {
            // Ensure state is loaded!
            console.log('[GLOBAL-ROOM] Player realm check requested')
            await this.realmManager.ensureInitialized('global-room')

            // CRITICAL: Always reload from storage to get latest data
            console.log('[GLOBAL-ROOM] Reloading player realms from storage...')
            const mapping = await this.state.storage.get<[string, { realmId: string, expiresAt: number }][]>('player_realms')
            if (mapping) {
                this.realmManager.playerRealmMap = new Map(mapping)
                console.log('[GLOBAL-ROOM] Loaded player realms from storage, map size:', this.realmManager.playerRealmMap.size)
            }
            console.log('[GLOBAL-ROOM] Final playerRealmMap size:', this.realmManager.playerRealmMap.size)

            const playerId = url.searchParams.get('playerId')
            if (!playerId) {
                return new Response(JSON.stringify({ error: 'playerId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
            }
            console.log('[GLOBAL-ROOM] Looking up realm for player:', playerId)
            const realmData = this.realmManager.playerRealmMap.get(playerId)
            console.log('[GLOBAL-ROOM] Realm data found:', realmData)
            if (realmData && Date.now() < realmData.expiresAt) {
                console.log('[GLOBAL-ROOM] Returning active realm:', realmData.realmId)
                return new Response(JSON.stringify({
                    realmId: realmData.realmId,
                    expiresAt: realmData.expiresAt
                }), { headers: { 'Content-Type': 'application/json' } })
            } else {
                // Clean up if expired
                if (realmData) {
                    console.log('[GLOBAL-ROOM] Realm expired, cleaning up')
                    this.realmManager.playerRealmMap.delete(playerId)
                    this.realmManager.savePlayerRealms()
                }
                console.log('[GLOBAL-ROOM] No active realm found')
                return new Response(JSON.stringify({ realmId: null }), { headers: { 'Content-Type': 'application/json' } })
            }
        }

        if (url.pathname === '/internal/track-player-realm') {
            // Track a player's realm connection
            const playerId = url.searchParams.get('playerId')
            const realmId = url.searchParams.get('realmId')
            const expiresAt = url.searchParams.get('expiresAt')

            console.log('[GLOBAL-ROOM] Received track-player-realm request:', { playerId, realmId, expiresAt })

            if (!playerId || !realmId || !expiresAt) {
                return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
            }

            await this.realmManager.ensureInitialized('global-room')
            this.realmManager.playerRealmMap.set(playerId, {
                realmId,
                expiresAt: parseInt(expiresAt)
            })
            console.log('[GLOBAL-ROOM] Player realm tracked, map size:', this.realmManager.playerRealmMap.size)
            await this.realmManager.savePlayerRealms()
            console.log('[GLOBAL-ROOM] Player realm map saved to storage')

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
        }

        if (url.pathname === '/internal/clear-player-realm') {
            // Clear a player's realm mapping (used when realm is invalid)
            const playerId = url.searchParams.get('playerId')

            if (!playerId) {
                return new Response(JSON.stringify({ error: 'playerId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
            }

            await this.realmManager.ensureInitialized('global-room')
            if (this.realmManager.playerRealmMap.has(playerId)) {
                console.log('[GLOBAL-ROOM] Clearing stale realm mapping for player:', playerId)
                this.realmManager.playerRealmMap.delete(playerId)
                await this.realmManager.savePlayerRealms()
            }

            return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
        }

        if (url.pathname === '/internal/clear-realm-players') {
            // Clear multiple players' realm mappings (used when realm manually destroyed)
            try {
                const body = await request.json() as { playerIds: string[] }
                await this.realmManager.ensureInitialized('global-room')

                for (const playerId of body.playerIds) {
                    if (this.realmManager.playerRealmMap.has(playerId)) {
                        this.realmManager.playerRealmMap.delete(playerId)
                    }
                }
                await this.realmManager.savePlayerRealms()
                console.log('[GLOBAL-ROOM] Cleared realm mappings for', body.playerIds.length, 'players')

                return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } })
            } catch (e) {
                console.error('[GLOBAL-ROOM] Error clearing realm players:', e)
                return new Response(JSON.stringify({ error: 'Failed to clear' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
            }
        }

        if (request.headers.get('Upgrade') !== 'websocket') {
            // Let PlayerManager handle WebSocket upgrade/init
            return this.playerManager.handleConnection(request, url)
        }
        return this.playerManager.handleConnection(request, url)
    }

    startGameLoop() {
        this.gameLoopInterval = setInterval(() => {
            this.updateGame()
        }, 100) as unknown as number
    }

    stopGameLoop() {
        if (this.gameLoopInterval !== null) {
            clearInterval(this.gameLoopInterval)
            this.gameLoopInterval = null
        }
    }



    updateGame() {
        try {
            const players = this.playerManager.getPlayers()
            if (players.length === 0) {
                this.stopGameLoop()
                return
            }

            const now = Date.now()

            if (this.realmManager.update(now, players)) {
                return
            }

            // Cooperative Game Logic
            this.realmGameManager.update(now)

            if (this.realmManager.isRealm) {
                this.broadcast({
                    type: 'world_update',
                    players: players,
                    realmTime: Math.max(0, Math.ceil((this.realmManager.realmExpiresAt - now) / 1000)),
                    activeRealmCount: this.realmManager.activeRealms.size,
                    ponds: this.realmGameManager.ponds
                })
                return
            }

            this.dragonManager.update(players)
            this.bullets = updateBullets(this.bullets, players, this.dragonManager.dragon, now, (msg) => this.broadcast(msg), (id) => this.playerManager.markPlayerDead(id), (b) => this.dragonManager.handleHit(b))
            this.sheepManager.update(players, now)

            this.farmManager.update(now)

            // Cleanup old pickups (60 seconds)
            for (const [id, p] of this.pickups.entries()) {
                if (now - p.createdAt > 60000) {
                    this.pickups.delete(id)
                }
            }

            this.broadcast({
                type: 'world_update',
                dragon: {
                    x: this.dragonManager.dragon.x,
                    z: this.dragonManager.dragon.z,
                    rotation: this.dragonManager.dragon.rotation,
                    health: this.dragonManager.dragon.health,
                    targetId: this.dragonManager.dragon.targetId,
                    isDead: this.dragonManager.dragon.isDead,
                    damageList: Array.from(this.dragonManager.dragon.damageMap.values())
                },
                bullets: this.bullets,
                pickups: Array.from(this.pickups.values()),
                sheeps: this.sheepManager.sheeps,
                farmPlots: this.farmManager.farmPlots,
                players: players,
                activeRealmCount: this.realmManager.activeRealms.size
            })
        } catch (e) {
            console.error('CRITICAL: Error in updateGame loop:', e)
        }
    }



    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        await this.messageHandler.handle(ws, message)
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        await this.playerManager.handleLeave(ws)
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        await this.playerManager.handleLeave(ws)
    }

    getPlayers(): Player[] {
        return this.playerManager.getPlayers()
    }

    getPlayerData(ws: WebSocket): Player | null {
        return this.playerManager.getPlayerData(ws)
    }

    setPlayerData(ws: WebSocket, data: Player) {
        this.playerManager.setPlayerData(ws, data)
    }

    broadcast(message: any, excludeId?: string) {
        const msg = JSON.stringify(message); const sockets = this.state.getWebSockets()
        for (const ws of sockets) {
            const tags = this.state.getTags(ws); const playerId = tags[0]
            if (playerId !== excludeId) { try { ws.send(msg) } catch (e) { } }
        }
    }




}