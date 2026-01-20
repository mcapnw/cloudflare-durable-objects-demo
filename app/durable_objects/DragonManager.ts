import { GameRoomDurableObject } from './GameRoom'
import { Dragon, Bullet, Pickup, Player } from './game-logic/types'
import { updateDragon } from './game-logic/dragon'

export class DragonManager {
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

    constructor(private gameRoom: GameRoomDurableObject) {
        // Load dragon state
        this.gameRoom.state.storage.get<{ isDead: boolean, health: number, damageMap?: [string, { name: string, damage: number }][] }>('dragon_state').then(saved => {
            if (saved) {
                this.dragon.isDead = saved.isDead
                this.dragon.health = saved.health
                if (saved.damageMap && Array.isArray(saved.damageMap)) {
                    this.dragon.damageMap = new Map(saved.damageMap)
                }
            }
        }).catch(e => console.error('Failed to load dragon state:', e))
    }

    update(players: Player[]) {
        updateDragon(this.dragon, players, this.gameRoom.bullets, (msg) => this.gameRoom.broadcast(msg))
    }

    respawn() {
        if (this.dragon.isDead) {
            this.dragon.health = 10
            this.dragon.isDead = false
            this.dragon.x = 0
            this.dragon.z = 0
            this.dragon.damageMap.clear()
            this.saveState()
            this.gameRoom.broadcast({ type: 'dragon_respawn' })
        }
    }

    handleHit(b: Bullet) {
        this.dragon.health -= 1
        this.dragon.attackers.add(b.ownerId)

        let data = this.dragon.damageMap.get(b.ownerId)
        const players = this.gameRoom.getPlayers()
        const p = players.find(p => p.id === b.ownerId)
        const currentName = p ? ((p.username && p.username !== 'null' && p.username.trim() !== '') ? p.username : p.firstName) : (data ? data.name : 'Unknown')

        if (!data) {
            data = { name: currentName, damage: 0 }
        } else {
            data.name = currentName
        }
        data.damage += 1
        this.dragon.damageMap.set(b.ownerId, data)

        this.saveState()

        this.gameRoom.broadcast({
            type: 'dragon_hit',
            health: this.dragon.health,
            sourceId: b.ownerId,
            x: b.x,
            z: b.z,
            damageList: Array.from(this.dragon.damageMap.values())
        })

        if (this.dragon.health <= 0) {
            this.handleDeath(b.ownerId)
        }
    }

    private handleDeath(killerId: string) {
        this.dragon.isDead = true
        const players = this.gameRoom.getPlayers()

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
                this.gameRoom.pickups.set(pickupId, pickup)

                // Only send to the specific player
                const sockets = this.gameRoom.state.getWebSockets(playerId)
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
                    this.gameRoom.pickups.set(pickupId, pickup)

                    // Only send to the specific player
                    const sockets = this.gameRoom.state.getWebSockets(playerId)
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
            this.gameRoom.env.DB.prepare('UPDATE Users SET dragon_kills = dragon_kills + 1 WHERE id = ?')
                .bind(killerId)
                .run()
                .catch(e => console.error('Failed to update dragon kills:', e))

            // Track dragon kill in session analytics
            const sessionData = this.gameRoom.playerManager.playerSessionData.get(killerId)
            if (sessionData) {
                sessionData.dragonKills++
            }
        }

        this.dragon.attackers.clear()
        this.dragon.damageMap.clear()
        this.dragon.targetId = null
        this.saveState()
        this.gameRoom.broadcast({ type: 'dragon_death' })
        this.gameRoom.bullets = []
    }

    private saveState() {
        this.gameRoom.state.storage.put('dragon_state', {
            isDead: this.dragon.isDead,
            health: this.dragon.health,
            damageMap: Array.from(this.dragon.damageMap.entries())
        }).catch(e => console.error('Failed to save dragon state:', e))
    }
}
