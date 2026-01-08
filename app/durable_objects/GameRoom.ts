import { Player, Pickup, Sheep, FarmPlot, Bullet, Dragon } from './game-logic/types'
import { updateSheeps } from './game-logic/sheep'
import { updateDragon } from './game-logic/dragon'
import { updateBullets } from './game-logic/physics'
import { updateFarm } from './game-logic/farming'
import { MessageHandler } from './MessageHandler'
import { RealmManager } from './RealmManager'

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

    // Dragon State
    dragon: Dragon = {
        x: 0,
        z: 0,
        rotation: 0,
        health: 10,
        targetId: null,
        attackers: new Set<string>(),
        lastFireTime: 0,
        isDead: true,
        damageMap: new Map<string, { name: string, damage: number }>(),
        isCharging: false,
        chargeStartTime: 0
    }

    bullets: Bullet[] = []
    pickups: Map<string, Pickup> = new Map()
    sheeps: Sheep[] = []
    farmPlots: FarmPlot[] = []
    playerLastShoot: Map<string, number> = new Map() // Rate limiting for shoot action

    gameLoopInterval: number | null = null
    players: Map<string, Player> = new Map() // Central source of truth for all players

    // Realm State
    messageHandler: MessageHandler
    realmManager: RealmManager


    constructor(state: DurableObjectState, env: Env) {
        this.state = state
        this.env = env
        this.messageHandler = new MessageHandler(this)
        this.realmManager = new RealmManager(this)

        // Load dragon state
        this.state.storage.get<{ isDead: boolean, health: number, damageMap?: [string, { name: string, damage: number }][] }>('dragon_state').then(saved => {
            if (saved) {
                this.dragon.isDead = saved.isDead
                this.dragon.health = saved.health
                if (saved.damageMap && Array.isArray(saved.damageMap)) {
                    this.dragon.damageMap = new Map(saved.damageMap)
                }
            }
        }).catch(e => console.error('Failed to load dragon state:', e))

        // Initialize 9 farm plots
        for (let i = 0; i < 9; i++) {
            this.farmPlots.push({
                id: i,
                planted: false,
                watered: false,
                growthStage: 0,
                wateredAt: 0,
                planterId: null
            })
        }

        // Load farm state
        this.state.storage.get<FarmPlot[]>('farm_plots').then(saved => {
            if (saved && Array.isArray(saved)) {
                this.farmPlots = saved
            }
        }).catch(e => console.error('Failed to load farm plots:', e))

        // Initialize 3 sheep
        for (let i = 0; i < 3; i++) {
            this.sheeps.push({
                id: `sheep_${i}`,
                x: (Math.random() - 0.5) * 40,
                z: (Math.random() - 0.5) * 40,
                rotation: Math.random() * Math.PI * 2,
                isHopping: false,
                state: 'roaming',
                lastStateChange: Date.now(),
                targetAngle: Math.random() * Math.PI * 2,
                lastFleeTime: 0
            })
        }
    }

    async fetch(request: Request) {
        const url = new URL(request.url)

        // Internal API for inter-DO communication (no WebSocket upgrade needed)
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
            const playerId = url.searchParams.get('playerId')
            if (!playerId) {
                return new Response(JSON.stringify({ error: 'playerId required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
            }
            const realmData = this.realmManager.playerRealmMap.get(playerId)
            if (realmData && Date.now() < realmData.expiresAt) {
                return new Response(JSON.stringify({
                    realmId: realmData.realmId,
                    expiresAt: realmData.expiresAt
                }), { headers: { 'Content-Type': 'application/json' } })
            } else {
                // Clean up if expired
                if (realmData) {
                    this.realmManager.playerRealmMap.delete(playerId)
                    this.realmManager.savePlayerRealms()
                }
                return new Response(JSON.stringify({ realmId: null }), { headers: { 'Content-Type': 'application/json' } })
            }
        }

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
            const userRow = await this.env.DB.prepare('SELECT weapon FROM Users WHERE id = ?')
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
            savedLoc = await this.state.storage.get(`player_loc_${id}`)
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
            weapon: dbFound ? dbWeapon : (savedLoc?.weapon || null)
        }

        // Realm Init Logic - BEFORE welcome message
        this.realmManager.init(room)

        if (room && room !== 'global-room') {
            // Randomize player spawn location in realm
            const spawnRadius = 20 // Spawn within 20 units
            const randomAngle = Math.random() * Math.PI * 2
            const randomDistance = Math.random() * spawnRadius
            playerData.x = Math.cos(randomAngle) * randomDistance
            playerData.z = Math.sin(randomAngle) * randomDistance
            playerData.rotation = Math.random() * Math.PI * 2
        }

        this.players.set(id, playerData)
        this.setPlayerData(server, playerData)

        const dragonDamage = this.dragon.damageMap.get(id)
        if (dragonDamage) {
            dragonDamage.name = (playerData.username && playerData.username.trim() !== '') ? playerData.username : playerData.firstName
            this.dragon.damageMap.set(id, dragonDamage)
        }

        this.state.acceptWebSocket(server, [id])

        server.send(JSON.stringify({
            type: 'welcome',
            ...playerData,
            dragon: {
                x: this.dragon.x,
                z: this.dragon.z,
                rotation: this.dragon.rotation,
                health: this.dragon.health,
                isDead: this.dragon.isDead,
                damageList: Array.from(this.dragon.damageMap.values())
            },
            farmPlots: this.farmPlots
        }))

        this.broadcast({ type: 'join', ...playerData }, id)

        // Send realm-specific messages
        // Send realm-specific messages
        if (room && room !== 'global-room') {
            // Send time immediately
            server.send(JSON.stringify({
                type: 'realm_init',
                expiresAt: this.realmManager.realmExpiresAt
            }))
        } else {
            // Send waiting list to new player in global room
            if (this.realmManager.waitingPlayers.size > 0) {
                server.send(JSON.stringify({
                    type: 'realm_lobby_update',
                    players: Array.from(this.realmManager.waitingPlayers.values())
                }))
            }
        }


        const players = this.getPlayers()
        server.send(JSON.stringify({ type: 'init', players }))

        if (this.gameLoopInterval === null) {
            this.startGameLoop()
        }

        return new Response(null, {
            status: 101,
            webSocket: client,
        })
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
            const players = this.getPlayers()
            if (players.length === 0) {
                this.stopGameLoop()
                return
            }

            const now = Date.now()

            if (this.realmManager.update(now, players)) {
                return
            }

            if (this.realmManager.isRealm) {
                this.broadcast({
                    type: 'world_update',
                    players: players,
                    realmTime: Math.max(0, Math.ceil((this.realmManager.realmExpiresAt - now) / 1000)),
                    activeRealmCount: this.realmManager.activeRealms.size
                })
                return
            }

            updateDragon(this.dragon, players, this.bullets, (msg) => this.broadcast(msg))
            this.bullets = updateBullets(this.bullets, players, this.dragon, now, (msg) => this.broadcast(msg), (id) => this.markPlayerDead(id), (b) => this.handleDragonHit(b))
            updateSheeps(this.sheeps, players, now, 23)

            if (updateFarm(this.farmPlots, now)) {
                this.state.storage.put('farm_plots', this.farmPlots)
                this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
            }

            // Cleanup old pickups (60 seconds)
            for (const [id, p] of this.pickups.entries()) {
                if (now - p.createdAt > 60000) {
                    this.pickups.delete(id)
                }
            }

            this.broadcast({
                type: 'world_update',
                dragon: {
                    x: this.dragon.x,
                    z: this.dragon.z,
                    rotation: this.dragon.rotation,
                    health: this.dragon.health,
                    targetId: this.dragon.targetId,
                    isDead: this.dragon.isDead,
                    damageList: Array.from(this.dragon.damageMap.values())
                },
                bullets: this.bullets,
                pickups: Array.from(this.pickups.values()),
                sheeps: this.sheeps,
                farmPlots: this.farmPlots,
                players: players,
                activeRealmCount: this.realmManager.activeRealms.size
            })
        } catch (e) {
            console.error('CRITICAL: Error in updateGame loop:', e)
        }
    }

    handleDragonHit(b: Bullet) {
        this.dragon.health -= 1
        this.dragon.attackers.add(b.ownerId)

        let data = this.dragon.damageMap.get(b.ownerId)
        const players = this.getPlayers()
        const p = players.find(p => p.id === b.ownerId)
        const currentName = p ? ((p.username && p.username !== 'null' && p.username.trim() !== '') ? p.username : p.firstName) : (data ? data.name : 'Unknown')

        if (!data) {
            data = { name: currentName, damage: 0 }
        } else {
            data.name = currentName
        }
        data.damage += 1
        this.dragon.damageMap.set(b.ownerId, data)

        this.state.storage.put('dragon_state', {
            isDead: this.dragon.health <= 0,
            health: this.dragon.health,
            damageMap: Array.from(this.dragon.damageMap.entries())
        }).catch(e => console.error('Failed to save dragon state:', e))

        this.broadcast({
            type: 'dragon_hit',
            health: this.dragon.health,
            sourceId: b.ownerId,
            x: b.x,
            z: b.z,
            damageList: Array.from(this.dragon.damageMap.values())
        })

        if (this.dragon.health <= 0) {
            this.handleDragonDeath(b.ownerId)
        }
    }

    handleDragonDeath(killerId: string) {
        this.dragon.isDead = true
        const players = this.getPlayers()

        // Distribute drops to EVERYONE who damaged the dragon
        for (const [playerId, dmgData] of this.dragon.damageMap.entries()) {
            const player = players.find(p => p.id === playerId)
            let givingStaff = false

            // Check if they need the staff
            if (player) {
                if (!player.weapon || player.weapon !== 'staff_beginner') {
                    givingStaff = true
                }
            } else {
                // If player left but is in damage map, we assume they might need it, 
                // but if they are gone we can't really give it to them effectively unless we persist it.
                // For simplicity, if they aren't here, we generate it but they might miss it if not reconnected.
                // Actually, if they are not in `players` list, getWebSockets might return empty, so sending won't work.
                // But let's keep logic consistent.
                givingStaff = true
            }

            if (givingStaff) {
                const pickupId = crypto.randomUUID()
                const pickup: Pickup = {
                    id: pickupId,
                    x: this.dragon.x + 1,
                    z: this.dragon.z + 1,
                    weaponType: 'staff_beginner',
                    playerId: playerId,
                    createdAt: Date.now()
                }
                this.pickups.set(pickupId, pickup)

                // Only send to the specific player
                const sockets = this.state.getWebSockets(playerId)
                for (const ws of sockets) {
                    try {
                        ws.send(JSON.stringify({ type: 'pickup_spawned', ...pickup }))
                    } catch (e) {
                        console.error('Failed to send pickup to player', playerId, e)
                    }
                }
            } else {
                // Give Coins
                const numCoinPickups = Math.floor(Math.random() * 3) + 3
                for (let i = 0; i < numCoinPickups; i++) {
                    const coinAmount = 1 + Math.floor(Math.random() * 2)
                    const pickupId = crypto.randomUUID()
                    const offsetX = (Math.random() - 0.5) * 4
                    const offsetZ = (Math.random() - 0.5) * 4
                    const pickup: Pickup = {
                        id: pickupId,
                        x: this.dragon.x + offsetX,
                        z: this.dragon.z + offsetZ,
                        weaponType: 'coin',
                        coinAmount: coinAmount,
                        playerId: playerId,
                        createdAt: Date.now()
                    }
                    this.pickups.set(pickupId, pickup)

                    // Only send to the specific player
                    const sockets = this.state.getWebSockets(playerId)
                    for (const ws of sockets) {
                        try {
                            ws.send(JSON.stringify({ type: 'pickup_spawned', ...pickup }))
                        } catch (e) {
                            console.error('Failed to send coin pickup to player', playerId, e)
                        }
                    }
                }
            }
        }

        // Credit the killer
        if (killerId && killerId !== 'dragon') {
            this.env.DB.prepare('UPDATE Users SET dragon_kills = dragon_kills + 1 WHERE id = ?')
                .bind(killerId)
                .run()
                .catch(e => console.error('Failed to update dragon kills:', e))
        }

        this.dragon.attackers.clear()
        this.dragon.damageMap.clear()
        this.dragon.targetId = null
        this.state.storage.put('dragon_state', { isDead: true, health: 0, damageMap: [] })
        this.broadcast({ type: 'dragon_death' })
        this.bullets = []
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        await this.messageHandler.handle(ws, message)
    }

    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        const tags = this.state.getTags(ws); const playerId = tags[0]
        if (playerId) {
            const allSockets = this.state.getWebSockets(playerId)
            const otherSockets = allSockets.filter(s => s !== ws)
            if (otherSockets.length === 0) {
                const playerData = this.players.get(playerId)
                if (playerData) {
                    await this.state.storage.put(`player_loc_${playerId}`, {
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender,
                        faceIndex: playerData.faceIndex,
                        weapon: playerData.weapon
                    })
                    this.players.delete(playerId)
                }
                this.broadcast({ type: 'leave', id: playerId })

                // Cleanup waiting room if they disconnect
                this.realmManager.leaveLobby(playerId)
            }
            ws.close()
        }
        if (this.players.size === 0) this.stopGameLoop()
    }

    async webSocketError(ws: WebSocket, error: unknown) {
        const tags = this.state.getTags(ws); const playerId = tags[0]
        if (playerId) {
            const allSockets = this.state.getWebSockets(playerId)
            const otherSockets = allSockets.filter(s => s !== ws)
            if (otherSockets.length === 0) {
                const playerData = this.players.get(playerId)
                if (playerData) {
                    await this.state.storage.put(`player_loc_${playerId}`, {
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender,
                        faceIndex: playerData.faceIndex,
                        weapon: playerData.weapon
                    })
                    this.players.delete(playerId)
                }
                this.broadcast({ type: 'leave', id: playerId })
            }
        }
        ws.close()
        if (this.players.size === 0) this.stopGameLoop()
    }

    getPlayers(): Player[] {
        return Array.from(this.players.values())
    }

    getPlayerData(ws: WebSocket): Player | null {
        try {
            const tags = this.state.getTags(ws)
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

    broadcast(message: any, excludeId?: string) {
        const msg = JSON.stringify(message); const sockets = this.state.getWebSockets()
        for (const ws of sockets) {
            const tags = this.state.getTags(ws); const playerId = tags[0]
            if (playerId !== excludeId) { try { ws.send(msg) } catch (e) { } }
        }
    }

    markPlayerDead(playerId: string) {
        const sockets = this.state.getWebSockets()
        for (const ws of sockets) {
            const tags = this.state.getTags(ws)
            if (tags[0] === playerId) {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    playerData.isDead = true; playerData.deathTime = Date.now(); this.setPlayerData(ws, playerData)
                    if (this.dragon.targetId === playerId) this.dragon.targetId = null
                    this.dragon.attackers.delete(playerId)
                    setTimeout(() => this.respawnPlayer(playerId), 10000)
                    this.env.DB.prepare('UPDATE Users SET deaths = deaths + 1 WHERE id = ?').bind(playerId).run().catch(e => console.error('Failed to update deaths:', e))
                }
                break
            }
        }
    }

    respawnPlayer(playerId: string) {
        if (this.gameLoopInterval === null) this.startGameLoop()
        const sockets = this.state.getWebSockets()
        for (const ws of sockets) {
            const tags = this.state.getTags(ws)
            if (tags[0] === playerId) {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    playerData.x = (Math.random() - 0.5) * 40; playerData.z = (Math.random() - 0.5) * 40; playerData.isDead = false; playerData.deathTime = 0; this.setPlayerData(ws, playerData)
                    this.broadcast({ type: 'player_respawn', id: playerId, x: playerData.x, z: playerData.z, rotation: playerData.rotation, firstName: playerData.firstName, username: playerData.username, gender: playerData.gender, faceIndex: playerData.faceIndex, weapon: playerData.weapon })
                }
                break
            }
        }
    }
}