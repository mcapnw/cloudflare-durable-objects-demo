import { Player, Pickup, Sheep, FarmPlot, Bullet, Dragon } from './game-logic/types'
import { updateSheeps } from './game-logic/sheep'
import { updateDragon } from './game-logic/dragon'
import { updateBullets } from './game-logic/physics'
import { updateFarm } from './game-logic/farming'

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

    constructor(state: DurableObjectState, env: Env) {
        this.state = state
        this.env = env

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
        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('Expected Upgrade: websocket', { status: 426 })
        }

        const url = new URL(request.url)
        const usernameParam = url.searchParams.get('username') || null
        const firstNameParam = url.searchParams.get('firstName') || url.searchParams.get('name') || 'Player'
        const id = url.searchParams.get('id') || crypto.randomUUID()
        const faceIndex = parseInt(url.searchParams.get('faceIndex') || '0', 10)
        const genderParam = url.searchParams.get('gender')
        const gender: 'male' | 'female' = (genderParam === 'female') ? 'female' : 'male'

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
            updateDragon(this.dragon, players, this.bullets, (msg) => this.broadcast(msg))
            this.bullets = updateBullets(this.bullets, players, this.dragon, now, (msg) => this.broadcast(msg), (id) => this.markPlayerDead(id), (b) => this.handleDragonHit(b))
            updateSheeps(this.sheeps, players, now, 23)

            if (updateFarm(this.farmPlots, now)) {
                this.state.storage.put('farm_plots', this.farmPlots)
                this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
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
                players: players
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

        for (const [playerId, dmgData] of this.dragon.damageMap.entries()) {
            const player = players.find(p => p.id === playerId)
            let nextWeapon = ''
            if (player) {
                if (!player.weapon || player.weapon !== 'staff_beginner') {
                    nextWeapon = 'staff_beginner'
                }
            } else {
                nextWeapon = 'staff_beginner'
            }

            if (nextWeapon) {
                const pickupId = crypto.randomUUID()
                const pickup: Pickup = {
                    id: pickupId,
                    x: this.dragon.x,
                    z: this.dragon.z,
                    weaponType: nextWeapon,
                    playerId: playerId,
                    createdAt: Date.now()
                }
                this.pickups.set(pickupId, pickup)
                this.broadcast({ type: 'pickup_spawned', ...pickup })
            }
        }

        if (killerId && killerId !== 'dragon') {
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
                    playerId: killerId,
                    createdAt: Date.now()
                }
                this.pickups.set(pickupId, pickup)
                this.broadcast({ type: 'pickup_spawned', ...pickup })
            }

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
        try {
            const data = JSON.parse(message as string)
            const tags = this.state.getTags(ws)
            const playerId = tags[0]
            if (!playerId) return

            if (data.type === 'move') {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    // Validate input
                    if (!isValidNumber(data.x) || !isValidNumber(data.z)) return

                    // Clamp to world bounds
                    playerData.x = clamp(data.x, -WORLD_BOUNDS, WORLD_BOUNDS)
                    playerData.z = clamp(data.z, -WORLD_BOUNDS, WORLD_BOUNDS)

                    // Validate and normalize rotation
                    if (isValidNumber(data.rotation)) {
                        playerData.rotation = data.rotation % (Math.PI * 2)
                    }

                    // Update centralized map
                    this.players.set(playerId, playerData)
                    this.setPlayerData(ws, playerData)

                    this.broadcast({
                        type: 'update',
                        id: playerId,
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        firstName: playerData.firstName,
                        username: playerData.username
                    }, playerId)
                }
            } else if (data.type === 'change_gender') {
                // Validate gender value
                if (data.gender !== 'male' && data.gender !== 'female') return

                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    playerData.gender = data.gender
                    this.setPlayerData(ws, playerData)
                    this.broadcast({
                        type: 'update',
                        id: playerId,
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender
                    }, playerId)
                }
            } else if (data.type === 'shoot') {
                if (this.dragon.isDead) return
                const playerData = this.getPlayerData(ws)
                if (!playerData) return
                if (playerData.isDead) return

                // Server-side rate limiting
                const now = Date.now()
                const lastShoot = this.playerLastShoot.get(playerId) || 0
                if (now - lastShoot < SHOOT_COOLDOWN_MS) return
                this.playerLastShoot.set(playerId, now)

                const speed = 2.0
                const rot = playerData.rotation
                const startDist = 1.0
                const vx = -Math.sin(rot) * speed
                const vz = -Math.cos(rot) * speed
                this.bullets.push({
                    id: crypto.randomUUID(),
                    x: playerData.x - Math.sin(rot) * startDist,
                    z: playerData.z - Math.cos(rot) * startDist,
                    vx: vx,
                    vz: vz,
                    ownerId: playerId,
                    createdAt: now,
                    speed: speed
                })
            } else if (data.type === 'get_scores') {
                const scores = await this.env.DB.prepare('SELECT username, first_name, dragon_kills, deaths FROM Users ORDER BY dragon_kills DESC LIMIT 5').all()
                ws.send(JSON.stringify({ type: 'scores', scores: scores.results }))
            } else if (data.type === 'collect_pickup') {
                const pickup = this.pickups.get(data.pickupId)
                if (pickup && pickup.playerId === playerId) {
                    if (pickup.weaponType === 'coin') {
                        const amount = pickup.coinAmount || 1
                        this.pickups.delete(data.pickupId)
                        this.env.DB.prepare('UPDATE Users SET coins = coins + ? WHERE id = ?').bind(amount, playerId).run().catch(e => console.error('Failed to update coins:', e))
                        ws.send(JSON.stringify({ type: 'coins_earned', amount }))
                    } else {
                        const playerData = this.getPlayerData(ws)
                        if (playerData) {
                            playerData.weapon = pickup.weaponType
                            this.setPlayerData(ws, playerData)
                            this.pickups.delete(data.pickupId)
                            this.env.DB.prepare('UPDATE Users SET weapon = ? WHERE id = ?').bind(pickup.weaponType, playerId).run().catch(e => console.error('Failed to update weapon:', e))
                            this.broadcast({ type: 'weapon_update', id: playerId, weapon: pickup.weaponType })
                        }
                    }
                }
            } else if (data.type === 'spawn_dragon') {
                if (this.dragon.isDead) {
                    this.dragon.health = 10
                    this.dragon.isDead = false
                    this.dragon.x = 0
                    this.dragon.z = 0
                    this.dragon.damageMap.clear()
                    this.state.storage.put('dragon_state', { isDead: false, health: 10, damageMap: [] })
                    this.broadcast({ type: 'dragon_respawn' })
                }
            } else if (data.type === 'buy_item') {
                const itemId = data.itemId
                const costs: { [key: string]: number } = { 'wheat_seeds': 1, 'water_can': 5, 'trowel': 5 }
                const cost = costs[itemId]
                if (cost !== undefined) {
                    try {
                        const user = await this.env.DB.prepare('SELECT coins, inventory FROM Users WHERE id = ?').bind(playerId).first<{ coins: number, inventory: string }>()
                        if (user && user.coins >= cost) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            inv.push(itemId)
                            await this.env.DB.prepare('UPDATE Users SET coins = coins - ?, inventory = ? WHERE id = ?').bind(cost, JSON.stringify(inv), playerId).run()
                            ws.send(JSON.stringify({ type: 'buy_success', item: itemId, coins: user.coins - cost, inventory: inv }))
                        } else {
                            ws.send(JSON.stringify({ type: 'error', message: 'Not enough coins' }))
                        }
                    } catch (e) { console.error('Buy item error:', e) }
                }
            } else if (data.type === 'plant_seeds') {
                const plotId = data.plotId
                const plot = this.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 0) {
                    try {
                        const user = await this.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?').bind(playerId).first<{ inventory: string }>()
                        if (user) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            const hasTrowel = inv.includes('trowel')
                            const seedIndex = inv.indexOf('wheat_seeds')
                            if (hasTrowel && seedIndex !== -1) {
                                const pData = this.getPlayerData(ws)
                                if (pData) {
                                    pData.isActing = true; pData.actionType = 'planting'; pData.actionPlotId = plotId; this.setPlayerData(ws, pData)
                                    setTimeout(() => {
                                        const fresh = this.getPlayerData(ws)
                                        if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.setPlayerData(ws, fresh); }
                                    }, 2000)
                                }
                                inv.splice(seedIndex, 1)
                                await this.env.DB.prepare('UPDATE Users SET inventory = ? WHERE id = ?').bind(JSON.stringify(inv), playerId).run()
                                plot.planted = true; plot.growthStage = 1; plot.planterId = playerId
                                this.state.storage.put('farm_plots', this.farmPlots)
                                this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                                ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                            } else {
                                ws.send(JSON.stringify({ type: 'error', message: 'Need trowel and wheat seeds' }))
                            }
                        }
                    } catch (e) { console.error('Plant seeds error:', e) }
                }
            } else if (data.type === 'water_wheat') {
                const plotId = data.plotId
                const plot = this.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 1) {
                    try {
                        const user = await this.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?').bind(playerId).first<{ inventory: string }>()
                        if (user) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            const hasWaterCan = inv.includes('water_can')
                            if (hasWaterCan) {
                                const pData = this.getPlayerData(ws)
                                if (pData) {
                                    pData.isActing = true; pData.actionType = 'watering'; pData.actionPlotId = plotId; this.setPlayerData(ws, pData)
                                    setTimeout(() => {
                                        const fresh = this.getPlayerData(ws)
                                        if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.setPlayerData(ws, fresh); }
                                    }, 2000)
                                }
                                plot.watered = true; plot.growthStage = 2; plot.wateredAt = Date.now()
                                this.state.storage.put('farm_plots', this.farmPlots)
                                this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                            } else {
                                ws.send(JSON.stringify({ type: 'error', message: 'Need water can' }))
                            }
                        }
                    } catch (e) { console.error('Water wheat error:', e) }
                }
            } else if (data.type === 'harvest_wheat') {
                const plotId = data.plotId
                const plot = this.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 3) {
                    try {
                        const user = await this.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?').bind(playerId).first<{ inventory: string }>()
                        if (user) {
                            const pData = this.getPlayerData(ws)
                            if (pData) {
                                pData.isActing = true; pData.actionType = 'harvesting'; pData.actionPlotId = plotId; this.setPlayerData(ws, pData)
                                setTimeout(() => {
                                    const fresh = this.getPlayerData(ws)
                                    if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.setPlayerData(ws, fresh); }
                                }, 2000)
                            }
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            inv.push('wheat')
                            await this.env.DB.prepare('UPDATE Users SET inventory = ? WHERE id = ?').bind(JSON.stringify(inv), playerId).run()
                            plot.planted = false; plot.watered = false; plot.growthStage = 0; plot.wateredAt = 0; plot.planterId = null
                            this.state.storage.put('farm_plots', this.farmPlots)
                            this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                            ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                        }
                    } catch (e) { console.error('Harvest wheat error:', e) }
                }
            }
        } catch (err) { console.error('Error parsing message', err) }
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