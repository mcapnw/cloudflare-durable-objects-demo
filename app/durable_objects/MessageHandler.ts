import { GameRoomDurableObject } from './GameRoom'
import { Player, Pickup, Bullet } from './game-logic/types'

// Helpers duplicated from GameRoom.ts to decouple and allow surgical extraction
function isValidNumber(val: any): val is number {
    return typeof val === 'number' && isFinite(val) && !isNaN(val)
}

function clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val))
}

const WORLD_BOUNDS = 25
const SHOOT_COOLDOWN_MS = 1500

export class MessageHandler {
    constructor(private gameRoom: GameRoomDurableObject) { }

    async handle(ws: WebSocket, message: string | ArrayBuffer) {
        try {
            const data = JSON.parse(message as string)
            const tags = this.gameRoom.state.getTags(ws)
            const playerId = tags[0]
            if (!playerId) return

            if (data.type === 'move') {
                const playerData = this.gameRoom.getPlayerData(ws)
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
                    this.gameRoom.players.set(playerId, playerData)
                    this.gameRoom.setPlayerData(ws, playerData)

                    this.gameRoom.broadcast({
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

                const playerData = this.gameRoom.getPlayerData(ws)
                if (playerData) {
                    playerData.gender = data.gender
                    this.gameRoom.setPlayerData(ws, playerData)
                    this.gameRoom.broadcast({
                        type: 'update',
                        id: playerId,
                        x: playerData.x,
                        z: playerData.z,
                        rotation: playerData.rotation,
                        gender: playerData.gender
                    }, playerId)
                }
            } else if (data.type === 'shoot') {
                if (this.gameRoom.dragon.isDead) return
                const playerData = this.gameRoom.getPlayerData(ws)
                if (!playerData) return
                if (playerData.isDead) return

                // Server-side rate limiting
                const now = Date.now()
                const lastShoot = this.gameRoom.playerLastShoot.get(playerId) || 0
                if (now - lastShoot < SHOOT_COOLDOWN_MS) return
                this.gameRoom.playerLastShoot.set(playerId, now)

                const speed = 2.0
                const rot = playerData.rotation
                const startDist = 1.0
                const vx = -Math.sin(rot) * speed
                const vz = -Math.cos(rot) * speed
                this.gameRoom.bullets.push({
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
                const scores = await this.gameRoom.env.DB.prepare('SELECT username, first_name, dragon_kills, deaths FROM Users ORDER BY dragon_kills DESC LIMIT 5').all()
                ws.send(JSON.stringify({ type: 'scores', scores: scores.results }))
            } else if (data.type === 'collect_pickup') {
                const pickup = this.gameRoom.pickups.get(data.pickupId)
                if (pickup && pickup.playerId === playerId) {
                    if (pickup.weaponType === 'coin') {
                        const amount = pickup.coinAmount || 1
                        this.gameRoom.pickups.delete(data.pickupId)
                        this.gameRoom.env.DB.prepare('UPDATE Users SET coins = coins + ? WHERE id = ?').bind(amount, playerId).run().catch(e => console.error('Failed to update coins:', e))
                        ws.send(JSON.stringify({ type: 'coins_earned', amount }))
                    } else {
                        const playerData = this.gameRoom.getPlayerData(ws)
                        if (playerData) {
                            playerData.weapon = pickup.weaponType
                            this.gameRoom.setPlayerData(ws, playerData)
                            this.gameRoom.pickups.delete(data.pickupId)

                            if (pickup.weaponType === 'staff_beginner') {
                                this.gameRoom.env.DB.prepare('UPDATE Users SET coins = coins + 10, weapon = ? WHERE id = ?')
                                    .bind(pickup.weaponType, playerId)
                                    .run()
                                    .catch(e => console.error('Failed to update weapon/coins:', e))
                                ws.send(JSON.stringify({ type: 'coins_earned', amount: 10 }))
                            } else {
                                this.gameRoom.env.DB.prepare('UPDATE Users SET weapon = ? WHERE id = ?')
                                    .bind(pickup.weaponType, playerId)
                                    .run()
                                    .catch(e => console.error('Failed to update weapon:', e))
                            }

                            this.gameRoom.broadcast({ type: 'weapon_update', id: playerId, weapon: pickup.weaponType })
                        }
                    }
                }
            } else if (data.type === 'spawn_dragon') {
                if (this.gameRoom.dragon.isDead) {
                    this.gameRoom.dragon.health = 10
                    this.gameRoom.dragon.isDead = false
                    this.gameRoom.dragon.x = 0
                    this.gameRoom.dragon.z = 0
                    this.gameRoom.dragon.damageMap.clear()
                    this.gameRoom.state.storage.put('dragon_state', { isDead: false, health: 10, damageMap: [] })
                    this.gameRoom.broadcast({ type: 'dragon_respawn' })
                }
            } else if (data.type === 'buy_item') {
                const itemId = data.itemId
                const costs: { [key: string]: number } = { 'wheat_seeds': 1, 'water_can': 5, 'trowel': 5 }
                const cost = costs[itemId]
                if (cost !== undefined) {
                    try {
                        const user = await this.gameRoom.env.DB.prepare('SELECT coins, inventory FROM Users WHERE id = ?').bind(playerId).first<{ coins: number, inventory: string }>()
                        if (user && user.coins >= cost) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            inv.push(itemId)
                            await this.gameRoom.env.DB.prepare('UPDATE Users SET coins = coins - ?, inventory = ? WHERE id = ?').bind(cost, JSON.stringify(inv), playerId).run()
                            ws.send(JSON.stringify({ type: 'buy_success', item: itemId, coins: user.coins - cost, inventory: inv }))
                        } else {
                            ws.send(JSON.stringify({ type: 'error', message: 'Not enough coins' }))
                        }
                    } catch (e) { console.error('Buy item error:', e) }
                }
            } else if (data.type === 'plant_seeds') {
                const plotId = data.plotId
                const plot = this.gameRoom.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 0) {
                    try {
                        const user = await this.gameRoom.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?').bind(playerId).first<{ inventory: string }>()
                        if (user) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            const hasTrowel = inv.includes('trowel')
                            const seedIndex = inv.indexOf('wheat_seeds')
                            if (hasTrowel && seedIndex !== -1) {
                                const pData = this.gameRoom.getPlayerData(ws)
                                if (pData) {
                                    pData.isActing = true; pData.actionType = 'planting'; pData.actionPlotId = plotId; this.gameRoom.setPlayerData(ws, pData)
                                    setTimeout(() => {
                                        const fresh = this.gameRoom.getPlayerData(ws)
                                        if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.gameRoom.setPlayerData(ws, fresh); }
                                    }, 2000)
                                }
                                inv.splice(seedIndex, 1)
                                await this.gameRoom.env.DB.prepare('UPDATE Users SET inventory = ? WHERE id = ?').bind(JSON.stringify(inv), playerId).run()
                                plot.planted = true; plot.growthStage = 1; plot.planterId = playerId
                                this.gameRoom.state.storage.put('farm_plots', this.gameRoom.farmPlots)
                                this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.gameRoom.farmPlots })
                                ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                            } else {
                                ws.send(JSON.stringify({ type: 'error', message: 'Need trowel and wheat seeds' }))
                            }
                        }
                    } catch (e) { console.error('Plant seeds error:', e) }
                }
            } else if (data.type === 'water_wheat') {
                const plotId = data.plotId
                const plot = this.gameRoom.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 1) {
                    try {
                        const user = await this.gameRoom.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?').bind(playerId).first<{ inventory: string }>()
                        if (user) {
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            const hasWaterCan = inv.includes('water_can')
                            if (hasWaterCan) {
                                const pData = this.gameRoom.getPlayerData(ws)
                                if (pData) {
                                    pData.isActing = true; pData.actionType = 'watering'; pData.actionPlotId = plotId; this.gameRoom.setPlayerData(ws, pData)
                                    setTimeout(() => {
                                        const fresh = this.gameRoom.getPlayerData(ws)
                                        if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.gameRoom.setPlayerData(ws, fresh); }
                                    }, 2000)
                                }
                                plot.watered = true; plot.growthStage = 2; plot.wateredAt = Date.now()
                                this.gameRoom.state.storage.put('farm_plots', this.gameRoom.farmPlots)
                                this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.gameRoom.farmPlots })
                            } else {
                                ws.send(JSON.stringify({ type: 'error', message: 'Need water can' }))
                            }
                        }
                    } catch (e) { console.error('Water wheat error:', e) }
                }
            } else if (data.type === 'harvest_wheat') {
                const plotId = data.plotId
                const plot = this.gameRoom.farmPlots.find(p => p.id === plotId)
                if (plot && plot.growthStage === 3) {
                    try {
                        const user = await this.gameRoom.env.DB.prepare('SELECT inventory FROM Users WHERE id = ?').bind(playerId).first<{ inventory: string }>()
                        if (user) {
                            const pData = this.gameRoom.getPlayerData(ws)
                            if (pData) {
                                pData.isActing = true; pData.actionType = 'harvesting'; pData.actionPlotId = plotId; this.gameRoom.setPlayerData(ws, pData)
                                setTimeout(() => {
                                    const fresh = this.gameRoom.getPlayerData(ws)
                                    if (fresh) { fresh.isActing = false; fresh.actionType = null; fresh.actionPlotId = null; this.gameRoom.setPlayerData(ws, fresh); }
                                }, 2000)
                            }
                            let inv = JSON.parse(user.inventory || '[]') as string[]
                            inv.push('wheat')
                            await this.gameRoom.env.DB.prepare('UPDATE Users SET inventory = ? WHERE id = ?').bind(JSON.stringify(inv), playerId).run()
                            plot.planted = false; plot.watered = false; plot.growthStage = 0; plot.wateredAt = 0; plot.planterId = null
                            this.gameRoom.state.storage.put('farm_plots', this.gameRoom.farmPlots)
                            this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.gameRoom.farmPlots })
                            ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                        }
                    } catch (e) { console.error('Harvest wheat error:', e) }
                }

            } else if (data.type === 'join_realm_lobby') {
                const p = this.gameRoom.getPlayerData(ws)
                if (p) {
                    this.gameRoom.realmManager.joinLobby(p)
                }
            } else if (data.type === 'leave_realm_lobby') {
                this.gameRoom.realmManager.leaveLobby(playerId)
            } else if (data.type === 'realm_ready') {
                this.gameRoom.realmManager.handleReady(playerId)
            } else if (data.type === 'get_player_realm') {
                // Query if this player has an active realm session
                // Load fresh from storage to avoid race condition
                try {
                    const mapping = await this.gameRoom.state.storage.get<[string, { realmId: string, expiresAt: number }][]>('player_realms')
                    if (mapping) {
                        this.gameRoom.realmManager.playerRealmMap = new Map(mapping)
                    }
                } catch (e) {
                    console.error('Failed to load player realms:', e)
                }

                const realmData = this.gameRoom.realmManager.playerRealmMap.get(playerId)
                if (realmData && Date.now() < realmData.expiresAt) {
                    ws.send(JSON.stringify({
                        type: 'player_realm_info',
                        realmId: realmData.realmId,
                        expiresAt: realmData.expiresAt
                    }))
                } else {
                    // No active realm or expired
                    if (realmData) {
                        this.gameRoom.realmManager.playerRealmMap.delete(playerId)
                        this.gameRoom.realmManager.savePlayerRealms()
                    }
                    ws.send(JSON.stringify({
                        type: 'player_realm_info',
                        realmId: null
                    }))
                }
            }
        } catch (err) { console.error('Error parsing message', err) }
    }
}
