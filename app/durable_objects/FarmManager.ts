import { GameRoomDurableObject } from './GameRoom'
import { FarmPlot } from './game-logic/types'
import { updateFarm } from './game-logic/farming'

export class FarmManager {
    farmPlots: FarmPlot[] = []

    constructor(private gameRoom: GameRoomDurableObject) {
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
        this.gameRoom.state.storage.get<FarmPlot[]>('farm_plots').then(saved => {
            if (saved && Array.isArray(saved)) {
                this.farmPlots = saved
            }
        }).catch(e => console.error('Failed to load farm plots:', e))
    }

    update(now: number): boolean {
        if (updateFarm(this.farmPlots, now)) {
            this.gameRoom.state.storage.put('farm_plots', this.farmPlots)
            this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
            return true
        }
        return false
    }

    async plantSeeds(ws: WebSocket, playerId: string, plotId: number) {
        const plot = this.farmPlots.find(p => p.id === plotId)
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
                        this.gameRoom.state.storage.put('farm_plots', this.farmPlots)
                        this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                        ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Need trowel and wheat seeds' }))
                    }
                }
            } catch (e) { console.error('Plant seeds error:', e) }
        }
    }

    async waterWheat(ws: WebSocket, playerId: string, plotId: number) {
        const plot = this.farmPlots.find(p => p.id === plotId)
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
                        this.gameRoom.state.storage.put('farm_plots', this.farmPlots)
                        this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Need water can' }))
                    }
                }
            } catch (e) { console.error('Water wheat error:', e) }
        }
    }

    async harvestWheat(ws: WebSocket, playerId: string, plotId: number) {
        const plot = this.farmPlots.find(p => p.id === plotId)
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
                    this.gameRoom.state.storage.put('farm_plots', this.farmPlots)
                    this.gameRoom.broadcast({ type: 'farm_update', farmPlots: this.farmPlots })
                    ws.send(JSON.stringify({ type: 'inventory_update', inventory: inv }))
                }
            } catch (e) { console.error('Harvest wheat error:', e) }
        }
    }
}
