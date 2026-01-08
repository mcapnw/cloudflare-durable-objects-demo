import { GameRoomDurableObject } from './GameRoom'
import { Sheep, Player } from './game-logic/types'
import { updateSheeps } from './game-logic/sheep'

export class SheepManager {
    sheeps: Sheep[] = []

    constructor(private gameRoom: GameRoomDurableObject) {
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

    update(players: Player[], now: number) {
        updateSheeps(this.sheeps, players, now, 23)
    }
}
