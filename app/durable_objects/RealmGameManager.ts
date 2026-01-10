import { GameRoomDurableObject } from './GameRoom'
import { Player, PlayerRole } from './game-logic/types'

interface Pond {
    id: number
    x: number
    z: number
    active: boolean
    activeUntil: number
}

// Pond locations (spread out in the realm)
const PONDS = [
    { x: 10, z: 10 },
    { x: -10, z: 12 },
    { x: 5, z: -15 }
]

export class RealmGameManager {
    ponds: Pond[] = []
    activePondIndex: number = -1
    lastPondChange: number = 0
    gameRoom: GameRoomDurableObject

    constructor(gameRoom: GameRoomDurableObject) {
        this.gameRoom = gameRoom
        this.initPonds()
    }

    initPonds() {
        this.ponds = PONDS.map((p, i) => ({
            id: i,
            x: p.x,
            z: p.z,
            active: false,
            activeUntil: 0
        }))
        // Start with first pond active
        this.activePondIndex = 0
        this.ponds[0].active = true
        this.lastPondChange = Date.now()
    }

    rotateActivePond(now: number) {
        // Deactivate current
        if (this.activePondIndex !== -1) {
            this.ponds[this.activePondIndex].active = false
        }

        // Cycle reliably to next pond
        this.activePondIndex = (this.activePondIndex + 1) % this.ponds.length

        this.ponds[this.activePondIndex].active = true
        this.ponds[this.activePondIndex].activeUntil = 0 // No timer expiration
        this.lastPondChange = now

        // Broadcast immediately
        this.gameRoom.broadcast({ type: 'pond_update', ponds: this.ponds })
    }

    update(now: number) {
        // Only run if we are in a Realm with players
        if (!this.gameRoom.realmManager.isRealm) return

        // Time-based cycling REMOVED as per user request
    }

    getDistance(p1: Player, p2: Player | { x: number, z: number }): number {
        return Math.hypot(p1.x - p2.x, p1.z - p2.z)
    }

    async startFishing(playerId: string) {
        const player = this.gameRoom.playerManager.players.get(playerId)
        if (!player) return

        // Validation
        if (player.role !== 'Fisher') return
        if (player.heldItem) return // Already has fish
        if (player.isActing) return // Busy

        // Check proximity to active pond
        const activePond = this.ponds[this.activePondIndex]
        const dist = Math.hypot(player.x - activePond.x, player.z - activePond.z)

        if (dist > 5.0) return // Too far

        // Start Fishing Action
        player.isActing = true
        player.actionType = 'fishing'
        player.actionStartTime = Date.now()

        // Broadcast Start
        this.gameRoom.broadcast({
            type: 'player_action',
            id: playerId,
            actionType: 'fishing',
            duration: 2500
        })

        // Schedule Completion (2.5 seconds)
        setTimeout(() => {
            const p = this.gameRoom.playerManager.players.get(playerId)
            if (p && p.isActing && p.actionType === 'fishing') {
                p.isActing = false
                p.actionType = null
                p.heldItem = 'fish'
                this.gameRoom.broadcast({
                    type: 'fishing_complete',
                    id: playerId,
                    heldItem: 'fish'
                })

                // Successful fish! Advance to next pond
                this.rotateActivePond(Date.now())
            }
        }, 2500)
    }

    passFish(fisherId: string) {
        const fisher = this.gameRoom.playerManager.players.get(fisherId)
        if (!fisher || fisher.role !== 'Fisher' || fisher.heldItem !== 'fish') return
        if (fisher.isFrozen) return

        // Find nearest Cooker
        const players = Array.from(this.gameRoom.playerManager.players.values())
        const cooker = players.find(p =>
            p.role === 'Cooker' &&
            !p.isFrozen &&
            this.getDistance(fisher, p) < 3.0 // 3 units distance
        )

        if (cooker) {
            // Lock both players
            fisher.isFrozen = true
            cooker.isFrozen = true

            // Broadcast animation start
            // Client handles the camera move and rotation based on this event
            this.gameRoom.broadcast({
                type: 'pass_fish_start',
                fisherId: fisher.id,
                cookerId: cooker.id,
                duration: 3000
            })

            // Complete transfer after 3 seconds
            setTimeout(() => {
                const f = this.gameRoom.playerManager.players.get(fisherId)
                const c = this.gameRoom.playerManager.players.get(cooker.id)

                if (f && c) {
                    // Update state
                    f.heldItem = null
                    f.isFrozen = false
                    f.isActing = false // ensure clear

                    c.heldItem = 'fish'
                    c.isFrozen = false

                    this.gameRoom.broadcast({
                        type: 'pass_fish_complete',
                        fisherId: f.id,
                        cookerId: c.id
                    })
                }
            }, 3000)
        }
    }
}
