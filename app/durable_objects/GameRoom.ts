// Using WebSocket Hibernation API for cost efficiency
// See: https://developers.cloudflare.com/durable-objects/api/websockets/

interface Player {
    id: string
    firstName: string // Google name/First name
    username: string | null // Custom username
    x: number
    z: number
    rotation: number
    gender: 'male' | 'female'
    faceIndex: number
    isDead: boolean
    deathTime: number
    weapon: string | null
    // Action State
    isActing?: boolean
    actionType?: string | null
    actionPlotId?: number | null
}

interface Pickup {
    id: string
    x: number
    z: number
    weaponType: string
    coinAmount?: number
    playerId: string // Intended recipient
    createdAt: number
}

interface Sheep {
    id: string
    x: number
    z: number
    rotation: number
    isHopping: boolean
    state: 'roaming' | 'stopped' | 'fleeing'
    lastStateChange: number
    targetAngle: number
    lastFleeTime: number // Cooldown for flee state triggering
    text?: string
    textClearTime?: number
}

interface FarmPlot {
    id: number
    planted: boolean
    watered: boolean
    growthStage: number // 0: empty, 1: planted, 2: watered/growing, 3: ready
    wateredAt: number // timestamp
    planterId: string | null
}

interface Env {
    GAMEROOM_NAMESPACE: DurableObjectNamespace
    DB: D1Database
}



interface Bullet {
    id: string
    x: number
    z: number
    vx: number
    vz: number
    ownerId: string // 'dragon' or playerId
    createdAt: number
    speed: number
}

export class GameRoomDurableObject implements DurableObject {
    state: DurableObjectState
    env: Env

    // Dragon State
    dragon = {
        x: 0,
        z: 0,
        rotation: 0,
        health: 10,
        targetId: null as string | null,
        attackers: new Set<string>(), // Players who have aggroed the dragon
        lastFireTime: 0,
        isDead: true, // Start dead, must be spawned via control panel
        damageMap: new Map<string, { name: string, damage: number }>(), // playerId -> damage info
        isCharging: false,
        chargeStartTime: 0
    }

    bullets: Bullet[] = []
    pickups: Map<string, Pickup> = new Map()
    sheeps: Sheep[] = []
    farmPlots: FarmPlot[] = []

    gameLoopInterval: number | null = null

    constructor(state: DurableObjectState, env: Env) {
        this.state = state
        this.env = env
        console.log('GameRoom DO initialized. Available env bindings:', Object.keys(env))
        console.log('DB Binding exists:', !!env.DB)

        // Load dragon state
        this.state.storage.get<{ isDead: boolean, health: number, damageMap?: [string, { name: string, damage: number }][] }>('dragon_state').then(saved => {
            if (saved) {
                this.dragon.isDead = saved.isDead
                this.dragon.health = saved.health
                if (saved.damageMap && Array.isArray(saved.damageMap)) {
                    this.dragon.damageMap = new Map(saved.damageMap)
                }
                console.log('Loaded dragon state:', saved)
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
                console.log('Loaded farm plots state')
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
        console.log('--- DO FETCH CALLED ---')
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

        // Create WebSocket pair
        const { 0: client, 1: server } = new WebSocketPair()

        // Fetch weapon from DB (source of truth)
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
            console.log(`Loaded weapon for ${id} from DB: ${dbWeapon} (found: ${dbFound})`)
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

        // Use Hibernation API - attach player data to WebSocket
        const playerData: Player = {
            id,
            firstName: firstNameParam,
            username: usernameParam,
            x: savedLoc?.x ?? 0,
            z: savedLoc?.z ?? 0,
            rotation: savedLoc?.rotation ?? 0,
            gender: gender, // Use fresh gender from login if provided, else fallback to saved? No, login overrides
            faceIndex: faceIndex,
            isDead: false,
            deathTime: 0,
            weapon: dbFound ? dbWeapon : (savedLoc?.weapon || null)
        }

        // FIX: Save initial state to WebSocket attachment so getPlayers() works immediately
        this.setPlayerData(server, playerData)

        // Update name in dragon damage map if they already attacked in a previous session
        const dragonDamage = this.dragon.damageMap.get(id)
        if (dragonDamage) {
            dragonDamage.name = (playerData.username && playerData.username.trim() !== '') ? playerData.username : playerData.firstName
            this.dragon.damageMap.set(id, dragonDamage)
        }

        // acceptWebSocket enables hibernation mode
        this.state.acceptWebSocket(server, [id])

        // Send welcome message
        server.send(JSON.stringify({
            type: 'welcome',
            ...playerData,
            // Send initial dragon state
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

        // Broadcast join to others
        this.broadcast({ type: 'join', ...playerData }, id)

        // Send current state to new player
        const players = this.getPlayers()
        server.send(JSON.stringify({ type: 'init', players }))

        // Start game loop if first player
        if (this.gameLoopInterval === null) {
            this.startGameLoop()
        }

        return new Response(null, {
            status: 101,
            webSocket: client,
        })
    }

    startGameLoop() {
        console.log('Starting Game Loop')
        // Run at 10 ticks per second
        this.gameLoopInterval = setInterval(() => {
            this.updateGame()
        }, 100) as unknown as number
    }

    stopGameLoop() {
        if (this.gameLoopInterval !== null) {
            console.log('Stopping Game Loop. Active players:', this.getPlayers().length)
            clearInterval(this.gameLoopInterval)
            this.gameLoopInterval = null
        }
    }

    updateGame() {
        try {
            this.updateDragon()
            this.updateBullets()
            this.updateSheeps()
            this.updateFarm()

            // Broadcast World Update
            // Includes Dragon + Bullets
            // Optimization: Could separate if bandwidth heavy, but for now combine
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
                players: this.getPlayers() // Always sync acting state
            })
        } catch (e) {
            console.error('CRITICAL: Error in updateGame loop:', e)
        }
    }

    updateBullets() {
        const now = Date.now()
        const players = this.getPlayers()
        const bounds = 48 // World bounds

        // Move and Check Collisions
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i]

            // 1. Move
            // 10 ticks/sec, speed is units per tick? No, speed is units per second approx?
            // Actually let's assume speed is speed per tick (0.1s)

            b.x += b.vx
            b.z += b.vz

            let hit = false

            // 2. Out of bounds or too old (3s lifetime)
            if (b.x < -bounds || b.x > bounds || b.z < -bounds || b.z > bounds || now - b.createdAt > 3000) {
                this.bullets.splice(i, 1)
                continue
            }

            // 3. Collision
            if (b.ownerId === 'dragon') {
                // Check vs Players (skip dead players)
                for (const p of players) {
                    if (p.isDead) continue // Skip dead players

                    const dx = p.x - b.x
                    const dz = p.z - b.z
                    // Player radius ~1
                    if (dx * dx + dz * dz < 2.0) {
                        // HIT PLAYER - Mark as dead
                        this.markPlayerDead(p.id)

                        // Broadcast death to all clients
                        this.broadcast({
                            type: 'player_death',
                            id: p.id,
                            firstName: p.firstName,
                            username: p.username
                        })

                        hit = true
                        break
                    }
                }
            } else {
                // Check vs Dragon
                if (!this.dragon.isDead) {
                    const dx = this.dragon.x - b.x
                    const dz = this.dragon.z - b.z
                    // Dragon radius ~4
                    if (dx * dx + dz * dz < 16.0) {
                        // HIT DRAGON
                        this.dragon.health -= 1

                        this.dragon.attackers.add(b.ownerId)

                        // Track damage
                        let data = this.dragon.damageMap.get(b.ownerId)
                        const p = players.find(p => p.id === b.ownerId)
                        const currentName = p ? ((p.username && p.username !== 'null' && p.username.trim() !== '') ? p.username : p.firstName) : (data ? data.name : 'Unknown')

                        if (!data) {
                            data = { name: currentName, damage: 0 }
                        } else {
                            data.name = currentName // Always update to latest known name
                        }
                        data.damage += 1
                        this.dragon.damageMap.set(b.ownerId, data)

                        // Persist Dragon State (Health + Damage) immediately
                        this.state.storage.put('dragon_state', { 
                            isDead: this.dragon.health <= 0, 
                            health: this.dragon.health,
                            damageMap: Array.from(this.dragon.damageMap.entries())
                        }).catch(e => console.error('Failed to save dragon state:', e))

                        hit = true

                        // Broadcast hit
                        this.broadcast({
                            type: 'dragon_hit',
                            health: this.dragon.health,
                            sourceId: b.ownerId,
                            x: b.x,
                            z: b.z,
                            damageList: Array.from(this.dragon.damageMap.values())
                        })

                        if (this.dragon.health <= 0) {
                            this.dragon.isDead = true

                            // ROLL FOR WEAPONS for all participants
                            for (const [playerId, dmgData] of this.dragon.damageMap.entries()) {
                                // Find player to check current weapon
                                const player = players.find(p => p.id === playerId)
                                
                                let chance = 0
                                let nextWeapon = ''

                                if (player) {
                                    if (!player.weapon || player.weapon !== 'staff_beginner') {
                                        chance = 1.0
                                        nextWeapon = 'staff_beginner'
                                    }
                                } else {
                                    // Player offline, assume they need a staff?
                                    chance = 1.0
                                    nextWeapon = 'staff_beginner'
                                }

                                if (nextWeapon && Math.random() < chance) {
                                    // SPAWN PICKUP
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
                                    console.log(`Spawned ${nextWeapon} pickup for ${playerId}`)
                                    this.broadcast({ type: 'pickup_spawned', ...pickup })
                                }
                            }

                            // Attribution: Killer is b.ownerId
                            // SPAWN COINS as pickups
                            if (b.ownerId && b.ownerId !== 'dragon') {
                                const numCoinPickups = Math.floor(Math.random() * 3) + 3 // 3-5 individual coin meshes
                                for (let i = 0; i < numCoinPickups; i++) {
                                    const coinAmount = 1 + Math.floor(Math.random() * 2) // 1-2 coins per pickup
                                    const pickupId = crypto.randomUUID()
                                    // Spread coins around dragon's death position
                                    const offsetX = (Math.random() - 0.5) * 4
                                    const offsetZ = (Math.random() - 0.5) * 4
                                    
                                    const pickup: Pickup = {
                                        id: pickupId,
                                        x: this.dragon.x + offsetX,
                                        z: this.dragon.z + offsetZ,
                                        weaponType: 'coin',
                                        coinAmount: coinAmount,
                                        playerId: b.ownerId, // Only killer can pick up
                                        createdAt: Date.now()
                                    }
                                    this.pickups.set(pickupId, pickup)
                                    this.broadcast({ type: 'pickup_spawned', ...pickup })
                                }

                                // Still update kills count in DB
                                this.env.DB.prepare('UPDATE Users SET dragon_kills = dragon_kills + 1 WHERE id = ?')
                                    .bind(b.ownerId)
                                    .run()
                                    .catch(e => console.error('Failed to update dragon kills:', e))
                            }

                            // Reset Dragon State
                            this.dragon.attackers.clear()
                            this.dragon.damageMap.clear()
                            this.dragon.targetId = null
                            this.state.storage.put('dragon_state', { isDead: true, health: 0, damageMap: [] })

                            this.broadcast({ type: 'dragon_death' })

                            this.bullets = []
                        }
                    }
                }
            }

            if (hit) {
                this.bullets.splice(i, 1)
            }
        }
    }

    updateDragon() {
        if (this.dragon.isDead) return

        const players = this.getPlayers()

        // optimized: Stop loop if no players
        if (players.length === 0) {
            this.stopGameLoop()
            return
        }

        // 1. Target Selection
        let target = players.find(p => p.id === this.dragon.targetId)

        if (!target) {
            const potentialTargets = players.filter(p => this.dragon.attackers.has(p.id))
            if (potentialTargets.length > 0) {
                // Pick random attacker
                target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)]
                this.dragon.targetId = target.id
            }
            // REMOVED: Aggressive targeting of random players. Now only attacks if attacked.
        }

        // 2. AI Logic (Move & Attack)
        if (target) {
            // Move towards target
            const dx = target.x - this.dragon.x
            const dz = target.z - this.dragon.z
            const dist = Math.sqrt(dx * dx + dz * dz)

            // Look at target
            this.dragon.rotation = Math.atan2(dx, dz)

            // Move if far enough
            if (dist > 8) { // Increased distance to keep some range
                const speed = 0.2 // Faster than before due to tick rate? No 0.05 was very slow.
                this.dragon.x += Math.sin(this.dragon.rotation) * speed
                this.dragon.z += Math.cos(this.dragon.rotation) * speed
            }

            // Attack logic
            const now = Date.now()
            if (!this.dragon.isCharging && now - this.dragon.lastFireTime > 2000) { // Fire every 2s
                if (dist < 30) {
                    this.dragon.isCharging = true
                    this.dragon.chargeStartTime = now

                    // Broadcast charging state
                    this.broadcast({
                        type: 'dragon_charging',
                        targetId: target.id
                    })
                }
            }

            if (this.dragon.isCharging && now - this.dragon.chargeStartTime > 1000) {
                // SPAWN DRAGON BULLET after 1s charge
                this.dragon.isCharging = false
                this.dragon.lastFireTime = now

                // Start at dragon head
                const headX = this.dragon.x + Math.sin(this.dragon.rotation) * 4
                const headZ = this.dragon.z + Math.cos(this.dragon.rotation) * 4

                const speed = 0.8 // Slow bullet

                this.bullets.push({
                    id: crypto.randomUUID(),
                    x: headX,
                    z: headZ,
                    vx: Math.sin(this.dragon.rotation) * speed,
                    vz: Math.cos(this.dragon.rotation) * speed,
                    ownerId: 'dragon',
                    createdAt: now,
                    speed: speed
                })

                // Broadcast attack anim
                this.broadcast({
                    type: 'dragon_attack',
                    targetId: target.id
                })
            }
        }

    }

    updateFarm() {
        // Update Farm Growth
        const now = Date.now()
        let farmUpdated = false
        const GROWTH_TIME = 5 * 60 * 1000 // 5 minutes

        for (const plot of this.farmPlots) {
            if (plot.growthStage === 2 && plot.wateredAt > 0) {
                if (now - plot.wateredAt >= GROWTH_TIME) {
                    plot.growthStage = 3 // READY
                    farmUpdated = true
                }
            }
        }

        if (farmUpdated) {
            this.state.storage.put('farm_plots', this.farmPlots)
            this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
        }
    }

    updateSheeps() {
        const now = Date.now()
        const bounds = 23 // Stay within walls (25 - padding)
        const players = this.getPlayers()

        for (const s of this.sheeps) {
            // 1. Proximity Detection (Fleeing)
            let closestPlayer = null
            let minDistSq = Infinity
            for (const p of players) {
                if (p.isDead) continue
                const dx = p.x - s.x
                const dz = p.z - s.z
                const distSq = dx * dx + dz * dz
                if (distSq < minDistSq) {
                    minDistSq = distSq
                    closestPlayer = p
                }
            }

            const fleeRange = 5 // Detection range
            if (closestPlayer && minDistSq < fleeRange * fleeRange) {
                // General Flee Cooldown: Only trigger flee state if 5s passed since LAST flee trigger
                if (now - s.lastFleeTime > 5000) {
                    s.state = 'fleeing'
                    s.text = "AHH!!!"
                    s.textClearTime = now + 2000
                    s.lastStateChange = now
                    s.lastFleeTime = now // Set cooldown

                    // Calculate angle AWAY from player
                    const dx = s.x - closestPlayer.x
                    const dz = s.z - closestPlayer.z
                    s.targetAngle = Math.atan2(dx, dz)
                }
            } else if (s.state === 'fleeing') {
                // Stop fleeing if player is far enough
                if (minDistSq > (fleeRange * 1.5) * (fleeRange * 1.5)) {
                    s.state = 'roaming'
                    s.lastStateChange = now
                }
            }

            // 2. Random Vocalization
            if (s.state !== 'fleeing' && !s.text && Math.random() < 0.005) { // ~0.5% chance per tick
                s.text = "Baa!"
                s.textClearTime = now + 2000
            }

            // 3. Text Clearing
            if (s.text && s.textClearTime && now > s.textClearTime) {
                s.text = undefined
                s.textClearTime = undefined
            }

            // 4. State machine & Movement
            if (s.state !== 'fleeing' && now - s.lastStateChange > (s.state === 'roaming' ? 3000 + Math.random() * 5000 : 2000 + Math.random() * 3000)) {
                s.state = s.state === 'roaming' ? 'stopped' : 'roaming'
                s.lastStateChange = now
                if (s.state === 'roaming') {
                    s.targetAngle = Math.random() * Math.PI * 2
                }
            }

            if (s.state === 'roaming' || s.state === 'fleeing') {
                // Smoothly rotate towards target angle (faster if fleeing)
                const turnSpeed = s.state === 'fleeing' ? 0.3 : 0.1
                let diff = s.targetAngle - s.rotation

                // Normalize angle safely
                diff = Math.atan2(Math.sin(diff), Math.cos(diff))

                s.rotation += diff * turnSpeed

                // Use a consistent, smooth speed for roaming, but faster for fleeing
                // Requested: move away faster when fleeing
                const speed = s.state === 'fleeing' ? 0.6 : 0.15
                const nextX = s.x + Math.sin(s.rotation) * speed
                const nextZ = s.z + Math.cos(s.rotation) * speed

                // WALL COLLISION with Smart Redirection
                let hitX = false
                let hitZ = false

                if (Math.abs(nextX) > bounds) hitX = true
                if (Math.abs(nextZ) > bounds) hitZ = true

                // OBJECT COLLISION (Obelisk & Store) with sliding
                const obeliskX = -22, obeliskZ = 22, obeliskR = 1.2
                const storeX = -18, storeZ = -18, storeR = 2.8

                const distObelisk = Math.hypot(nextX - obeliskX, nextZ - obeliskZ)
                const distStore = Math.hypot(nextX - storeX, nextZ - storeZ)

                let finalNextX = nextX
                let finalNextZ = nextZ

                if (distObelisk < obeliskR) {
                    const angle = Math.atan2(nextZ - obeliskZ, nextX - obeliskX)
                    finalNextX = obeliskX + Math.cos(angle) * obeliskR
                    finalNextZ = obeliskZ + Math.sin(angle) * obeliskR
                } else if (distStore < storeR) {
                    const angle = Math.atan2(nextZ - storeZ, nextX - storeX)
                    finalNextX = storeX + Math.cos(angle) * storeR
                    finalNextZ = storeZ + Math.sin(angle) * storeR
                }

                if (Math.abs(finalNextX) > bounds) {
                    hitX = true
                }
                if (Math.abs(finalNextZ) > bounds) {
                    hitZ = true
                }

                if (hitX || hitZ) {
                    if (s.state === 'fleeing') {
                        // Corner detection & escape
                        if (hitX && hitZ) {
                            // Point toward center
                            s.targetAngle = Math.atan2(-s.x, -s.z)
                        } else if (hitX) {
                            // Redirect along Z axis
                            s.targetAngle = Math.cos(s.targetAngle) > 0 ? 0 : Math.PI
                        } else if (hitZ) {
                            // Redirect along X axis
                            s.targetAngle = Math.sin(s.targetAngle) > 0 ? Math.PI / 2 : -Math.PI / 2
                        }
                    } else if (s.state === 'roaming') {
                        s.targetAngle = Math.random() * Math.PI * 2
                    }
                }

                if (!hitX) s.x = finalNextX
                if (!hitZ) s.z = finalNextZ

                s.isHopping = true
            } else {
                s.isHopping = false
            }
        }
    }

    // Hibernation API: Called when a WebSocket receives a message
    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        try {
            const data = JSON.parse(message as string)
            const tags = this.state.getTags(ws)
            const playerId = tags[0]

            if (!playerId) return

            if (data.type === 'move') {
                // Update player position
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    playerData.x = data.x
                    playerData.z = data.z
                    playerData.rotation = data.rotation ?? playerData.rotation
                    this.setPlayerData(ws, playerData)

                    // Broadcast movement with rotation
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
                // Player shooting at dragon
                if (this.dragon.isDead) return;

                const playerData = this.getPlayerData(ws)
                if (!playerData) return

                // SPAWN PLAYER BULLET
                // Start at player pos + forward
                // Player rotation PI offset handled in client?
                // Client sends raw rotation.
                // Assuming client rotation 0 = -Z (Forward) relative to camera?
                // Wait, previous investigation: Camera looks at 0,0,0.
                // Client Input Up -> -Z.
                // Rotation 0 -> Facing -Z?
                // Let's rely on stored rotation.

                const speed = 2.0 // Fast bullet
                const rot = playerData.rotation

                // Offset to spawn in front of player
                const startDist = 1.0
                // Use standard math: sin, cos
                // If rot=0 is -Z? Then x += sin(0)*1 = 0, z += cos(0)*1 = 1 (Wait, cos(0)=1 is +Z)
                // If player moves -Z with "Up", then Rot=0 should mean "Facing -Z"?
                // Let's stick to the math used in updateDragon: x += sin, z += cos.

                // FIX: Invert direction for player bullets to match "Forward" (-Z for rot 0)
                // Forward vector for player: (-sin(rot), -cos(rot))

                const vx = -Math.sin(rot) * speed
                const vz = -Math.cos(rot) * speed

                this.bullets.push({
                    id: crypto.randomUUID(),
                    x: playerData.x - Math.sin(rot) * startDist,
                    z: playerData.z - Math.cos(rot) * startDist,
                    vx: vx,
                    vz: vz,
                    ownerId: playerId,
                    createdAt: Date.now(),
                    speed: speed
                })
            } else if (data.type === 'get_scores') {
                // Fetch top 5 scores
                const scores = await this.env.DB.prepare('SELECT username, first_name, dragon_kills, deaths FROM Users ORDER BY dragon_kills DESC LIMIT 5')
                    .all()

                console.log(`Fetched ${scores.results?.length} scores for modal`)

                ws.send(JSON.stringify({
                    type: 'scores',
                    scores: scores.results
                }))
            } else if (data.type === 'collect_pickup') {
                const pickup = this.pickups.get(data.pickupId)
                if (pickup && pickup.playerId === playerId) {
                    if (pickup.weaponType === 'coin') {
                        const amount = pickup.coinAmount || 1
                        this.pickups.delete(data.pickupId)
                        
                        // Update DB
                        this.env.DB.prepare('UPDATE Users SET coins = coins + ? WHERE id = ?')
                            .bind(amount, playerId)
                            .run()
                            .catch(e => console.error('Failed to update coins:', e))
                            
                        // Notify player
                        ws.send(JSON.stringify({ type: 'coins_earned', amount }))
                    } else {
                        const playerData = this.getPlayerData(ws)
                        if (playerData) {
                            playerData.weapon = pickup.weaponType
                            this.setPlayerData(ws, playerData)
                            this.pickups.delete(data.pickupId)

                            // Update DB
                            this.env.DB.prepare('UPDATE Users SET weapon = ? WHERE id = ?')
                                .bind(pickup.weaponType, playerId)
                                .run()
                                .catch(e => console.error('Failed to update weapon:', e))

                            // Broadcast update
                            this.broadcast({
                                type: 'weapon_update',
                                id: playerId,
                                weapon: pickup.weaponType
                            })
                        }
                    }
                }
            } else if (data.type === 'spawn_dragon') {
                if (this.dragon.isDead) {
                    this.dragon.health = 10
                    this.dragon.isDead = false
                    this.dragon.x = 0
                    this.dragon.z = 0
                    this.dragon.damageMap.clear() // Ensure clear on fresh spawn
                    this.state.storage.put('dragon_state', { isDead: false, health: 10, damageMap: [] })
                    this.broadcast({ type: 'dragon_respawn' })
                    console.log(`Dragon spawned by player ${playerId}`)
                }
            } else if (data.type === 'buy_item') {
                const itemId = data.itemId
                const costs: { [key: string]: number } = { 'wheat_seeds': 1, 'water_can': 5, 'trowel': 5 }
                const cost = costs[itemId]

                if (cost !== undefined) {
                    try {
                        const user = await this.env.DB.prepare('SELECT coins, inventory FROM Users WHERE id = ?')
                            .bind(playerId)
                            .first<{ coins: number, inventory: string }>()

                        if (user && user.coins >= cost) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            inv.push(itemId)

                            await this.env.DB.prepare('UPDATE Users SET coins = coins - ?, inventory = ? WHERE id = ?')
                                .bind(cost, JSON.stringify(inv), playerId)
                                .run()

                            ws.send(JSON.stringify({ type: 'buy_success', item: itemId, coins: user.coins - cost, inventory: inv }))
                        } else {
                            ws.send(JSON.stringify({ type: 'error', message: 'Not enough coins' }))
                        }
                    } catch (e) {
                        console.error('Buy item error:', e)
                    }
                }
            } else if (data.type === 'plant_seeds') {
                const plotId = data.plotId
                const plot = this.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 0) {
                    try {
                        const user = await this.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?')
                            .bind(playerId)
                            .first<{ inventory: string }>()

                        if (user) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            const hasTrowel = inv.includes('trowel')
                            const seedIndex = inv.indexOf('wheat_seeds')

                            if (hasTrowel && seedIndex !== -1) {
                                // Update player acting state for 2 seconds
                                const pData = this.getPlayerData(ws)
                                if (pData) {
                                    pData.isActing = true
                                    pData.actionType = 'planting'
                                    pData.actionPlotId = plotId
                                    this.setPlayerData(ws, pData)
                                    setTimeout(() => {
                                        const fresh = this.getPlayerData(ws)
                                        if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.setPlayerData(ws, fresh); }
                                    }, 2000)
                                }

                                // Remove 1 wheat seed
                                inv.splice(seedIndex, 1)

                                await this.env.DB.prepare('UPDATE Users SET inventory = ? WHERE id = ?')
                                    .bind(JSON.stringify(inv), playerId)
                                    .run()

                                plot.planted = true
                                plot.growthStage = 1
                                plot.planterId = playerId
                                this.state.storage.put('farm_plots', this.farmPlots)

                                this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                                ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                            } else {
                                ws.send(JSON.stringify({ type: 'error', message: 'Need trowel and wheat seeds' }))
                            }
                        }
                    } catch (e) {
                        console.error('Plant seeds error:', e)
                    }
                }
            } else if (data.type === 'water_wheat') {
                const plotId = data.plotId
                const plot = this.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 1) {
                    try {
                        const user = await this.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?')
                            .bind(playerId)
                            .first<{ inventory: string }>()

                        if (user) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            const hasWaterCan = inv.includes('water_can')

                            if (hasWaterCan) {
                                // Update player acting state for 2 seconds
                                const pData = this.getPlayerData(ws)
                                if (pData) {
                                    pData.isActing = true
                                    pData.actionType = 'watering'
                                    pData.actionPlotId = plotId
                                    this.setPlayerData(ws, pData)
                                    setTimeout(() => {
                                        const fresh = this.getPlayerData(ws)
                                        if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.setPlayerData(ws, fresh); }
                                    }, 2000)
                                }

                                plot.watered = true
                                plot.growthStage = 2
                                plot.wateredAt = Date.now()
                                this.state.storage.put('farm_plots', this.farmPlots)

                                this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                            } else {
                                ws.send(JSON.stringify({ type: 'error', message: 'Need water can' }))
                            }
                        }
                    } catch (e) {
                        console.error('Water wheat error:', e)
                    }
                }
            } else if (data.type === 'harvest_wheat') {
                const plotId = data.plotId
                const plot = this.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 3) {
                    try {
                        const user = await this.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?')
                            .bind(playerId)
                            .first<{ inventory: string }>()

                        if (user) {
                            // Update player acting state for 2 seconds
                            const pData = this.getPlayerData(ws)
                            if (pData) {
                                pData.isActing = true
                                pData.actionType = 'harvesting'
                                pData.actionPlotId = plotId
                                this.setPlayerData(ws, pData)
                                setTimeout(() => {
                                    const fresh = this.getPlayerData(ws)
                                    if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.setPlayerData(ws, fresh); }
                                }, 2000)
                            }

                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            inv.push('wheat')

                            await this.env.DB.prepare('UPDATE Users SET inventory = ? WHERE id = ?')
                                .bind(JSON.stringify(inv), playerId)
                                .run()

                            plot.planted = false
                            plot.watered = false
                            plot.growthStage = 0
                            plot.wateredAt = 0
                            plot.planterId = null
                            this.state.storage.put('farm_plots', this.farmPlots)

                            this.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                            ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                        }
                    } catch (e) {
                        console.error('Harvest wheat error:', e)
                    }
                }
            }
        } catch (err) {
            console.error('Error parsing message', err)
        }
    }

    // Hibernation API: Called when a WebSocket is closed
    async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
        const tags = this.state.getTags(ws)
        const playerId = tags[0]

        if (playerId) {
            // Only save and broadcast leave if this is the LAST open socket for this playerId
            const allSockets = this.state.getWebSockets(playerId)
            const otherSockets = allSockets.filter(s => s !== ws)

            if (otherSockets.length === 0) {
                // Save location ONLY if this is the last one (avoid stale data overwrites)
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    await this.state.storage.put(`player_loc_${playerId}`, {
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender,
                        faceIndex: playerData.faceIndex,
                        weapon: playerData.weapon
                    })
                }
                this.broadcast({ type: 'leave', id: playerId })
            }
            ws.close()
        }

        // Check if empty
        if (this.getPlayers().length === 0) {
            this.stopGameLoop()
        }
    }

    // Hibernation API: Called when a WebSocket encounters an error
    async webSocketError(ws: WebSocket, error: unknown) {
        const tags = this.state.getTags(ws)
        const playerId = tags[0]

        console.error('WebSocket error for player', playerId, error)

        if (playerId) {
            const allSockets = this.state.getWebSockets(playerId)
            const otherSockets = allSockets.filter(s => s !== ws)

            if (otherSockets.length === 0) {
                // Save location ONLY if this is the last one (avoid stale data overwrites)
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    await this.state.storage.put(`player_loc_${playerId}`, {
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender,
                        faceIndex: playerData.faceIndex,
                        weapon: playerData.weapon
                    })
                }
                this.broadcast({ type: 'leave', id: playerId })
            }
        }
        ws.close()

        // Check if empty
        if (this.getPlayers().length === 0) {
            this.stopGameLoop()
        }
    }

    // Get all connected players' data (Unique by ID)
    getPlayers(): Player[] {
        const sockets = this.state.getWebSockets()
        const playersMap = new Map<string, Player>()

        for (const ws of sockets) {
            const playerData = this.getPlayerData(ws)
            if (playerData) {
                // If multiple connections from the same user, the last one wins
                // (Usually the newest one is processed last in getWebSockets() or just arbitrary)
                playersMap.set(playerData.id, playerData)
            }
        }

        return Array.from(playersMap.values())
    }

    // Get player data from WebSocket attachment
    getPlayerData(ws: WebSocket): Player | null {
        try {
            const data = (ws as any).deserializeAttachment?.() as Player | null
                ?? (ws as any).attachment as Player | null
            if (data) return data

            console.warn('!!! WEBSOCKET ATTACHMENT MISSING - USING FALLBACK !!!')
            // Fallback: reconstruct from tags
            const tags = this.state.getTags(ws)
            if (tags[0]) {
                return { id: tags[0], firstName: 'Player', username: null, x: 0, z: 0, rotation: 0, gender: 'male', faceIndex: 0, isDead: false, deathTime: 0, weapon: null }
            }
            return null
        } catch (e) {
            console.error('Error in getPlayerData:', e)
            return null
        }
    }

    // Set player data as WebSocket attachment
    setPlayerData(ws: WebSocket, data: Player) {
        try {
            (ws as any).serializeAttachment?.(data)
        } catch {
            (ws as any).attachment = data
        }
    }

    // Broadcast to all connected WebSockets
    broadcast(message: any, excludeId?: string) {
        const msg = JSON.stringify(message)
        const sockets = this.state.getWebSockets()

        for (const ws of sockets) {
            const tags = this.state.getTags(ws)
            const playerId = tags[0]

            if (playerId !== excludeId) {
                try {
                    ws.send(msg)
                } catch (e) {
                    // Socket is closed, will be cleaned up
                }
            }
        }
    }

    // Mark a player as dead and schedule respawn
    markPlayerDead(playerId: string) {
        const sockets = this.state.getWebSockets()

        for (const ws of sockets) {
            const tags = this.state.getTags(ws)
            if (tags[0] === playerId) {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    playerData.isDead = true
                    playerData.deathTime = Date.now()
                    this.setPlayerData(ws, playerData)
                    console.log(`!!! PLAYER ${playerId} MARKED DEAD IN DO !!!`)

                    // Remove from dragon's target/attackers/damageMap
                    if (this.dragon.targetId === playerId) {
                        this.dragon.targetId = null
                    }
                    this.dragon.attackers.delete(playerId)
                    
                    // Do NOT delete from damageMap here, otherwise they lose credit if they die.
                    // The prompt said: "when the dragon dies, remove this." implyinng it persists until then.
                    // So dead players should still be in damage list? "all players who have damaged... should receive item drops"
                    // Yes. So I should NOT delete from damageMap.
                    
                    // Schedule respawn after 10 seconds
                    setTimeout(() => {
                        this.respawnPlayer(playerId)
                    }, 10000)

                    // Increment death count in DB
                    console.log(`Incrementing death count for player: ${playerId}`)
                    this.env.DB.prepare('UPDATE Users SET deaths = deaths + 1 WHERE id = ?')
                        .bind(playerId)
                        .run()
                        .then(res => {
                            console.log(`Successfully updated deaths for ${playerId}:`, res)
                        })
                        .catch(e => console.error('Failed to update deaths:', e))
                } else {
                    console.error(`playerData not found for death increment: ${playerId}`)
                }
                break
            }
        }
    }

    // Respawn a player at random location
    respawnPlayer(playerId: string) {
        // Safety: Ensure game loop is running if it stopped appropriately or erroneously
        if (this.gameLoopInterval === null) {
            console.log('Restarting Game Loop in respawnPlayer')
            this.startGameLoop()
        }

        const sockets = this.state.getWebSockets()
        const BOUNDS = 20 // Safe spawn area

        for (const ws of sockets) {
            const tags = this.state.getTags(ws)
            if (tags[0] === playerId) {
                const playerData = this.getPlayerData(ws)
                if (playerData) {
                    // Random spawn location
                    playerData.x = (Math.random() - 0.5) * BOUNDS * 2
                    playerData.z = (Math.random() - 0.5) * BOUNDS * 2
                    playerData.isDead = false
                    playerData.deathTime = 0
                    this.setPlayerData(ws, playerData)

                    // Broadcast respawn to all clients
                    this.broadcast({
                        type: 'player_respawn',
                        id: playerId,
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        firstName: playerData.firstName,
                        username: playerData.username,
                        gender: playerData.gender,
                        faceIndex: playerData.faceIndex,
                        weapon: playerData.weapon
                    })
                }
                break
            }
        }
    }
}
