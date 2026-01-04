import { Dragon, Player, Bullet } from './types'

export function updateDragon(dragon: Dragon, players: Player[], bullets: Bullet[], broadcast: (msg: any) => void): void {
    if (dragon.isDead) return

    if (players.length === 0) return

    // 1. Target Selection
    let target = players.find(p => p.id === dragon.targetId)

    if (!target) {
        const potentialTargets = players.filter(p => dragon.attackers.has(p.id))
        if (potentialTargets.length > 0) {
            target = potentialTargets[Math.floor(Math.random() * potentialTargets.length)]
            dragon.targetId = target.id
        }
    }

    // 2. AI Logic (Move & Attack)
    if (target) {
        const dx = target.x - dragon.x
        const dz = target.z - dragon.z
        const dist = Math.sqrt(dx * dx + dz * dz)

        dragon.rotation = Math.atan2(dx, dz)

        if (dist > 8) {
            const speed = 0.2
            dragon.x += Math.sin(dragon.rotation) * speed
            dragon.z += Math.cos(dragon.rotation) * speed
        }

        const now = Date.now()
        if (!dragon.isCharging && now - dragon.lastFireTime > 2000) {
            if (dist < 30) {
                dragon.isCharging = true
                dragon.chargeStartTime = now
                broadcast({
                    type: 'dragon_charging',
                    targetId: target.id
                })
            }
        }

        if (dragon.isCharging && now - dragon.chargeStartTime > 1000) {
            dragon.isCharging = false
            dragon.lastFireTime = now

            const headX = dragon.x + Math.sin(dragon.rotation) * 4
            const headZ = dragon.z + Math.cos(dragon.rotation) * 4
            const speed = 0.8

            bullets.push({
                id: crypto.randomUUID(),
                x: headX,
                z: headZ,
                vx: Math.sin(dragon.rotation) * speed,
                vz: Math.cos(dragon.rotation) * speed,
                ownerId: 'dragon',
                createdAt: now,
                speed: speed
            })

            broadcast({
                type: 'dragon_attack',
                targetId: target.id
            })
        }
    }
}
