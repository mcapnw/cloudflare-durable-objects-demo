import { Sheep, Player } from './types'

export function updateSheeps(sheeps: Sheep[], players: Player[], now: number, bounds: number): void {
    for (const s of sheeps) {
        let closestPlayer: Player | null = null
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

        const fleeRange = 5
        if (closestPlayer && minDistSq < fleeRange * fleeRange) {
            if (now - s.lastFleeTime > 5000) {
                s.state = 'fleeing'
                s.text = "AHH!!!"
                s.textClearTime = now + 2000
                s.lastStateChange = now
                s.lastFleeTime = now
                const dx = s.x - closestPlayer.x
                const dz = s.z - closestPlayer.z
                s.targetAngle = Math.atan2(dx, dz)
            }
        } else if (s.state === 'fleeing') {
            if (minDistSq > (fleeRange * 1.5) * (fleeRange * 1.5)) {
                s.state = 'roaming'
                s.lastStateChange = now
            }
        }

        if (s.state !== 'fleeing' && !s.text && Math.random() < 0.005) {
            s.text = "Baa!"
            s.textClearTime = now + 2000
        }

        if (s.text && s.textClearTime && now > s.textClearTime) {
            s.text = undefined
            s.textClearTime = undefined
        }

        if (s.state !== 'fleeing' && now - s.lastStateChange > (s.state === 'roaming' ? 3000 + Math.random() * 5000 : 2000 + Math.random() * 3000)) {
            s.state = s.state === 'roaming' ? 'stopped' : 'roaming'
            s.lastStateChange = now
            if (s.state === 'roaming') {
                s.targetAngle = Math.random() * Math.PI * 2
            }
        }

        if (s.state === 'roaming' || s.state === 'fleeing') {
            const turnSpeed = s.state === 'fleeing' ? 0.3 : 0.1
            let diff = s.targetAngle - s.rotation
            diff = Math.atan2(Math.sin(diff), Math.cos(diff))
            s.rotation += diff * turnSpeed

            const speed = s.state === 'fleeing' ? 0.6 : 0.15
            const nextX = s.x + Math.sin(s.rotation) * speed
            const nextZ = s.z + Math.cos(s.rotation) * speed

            let hitX = false
            let hitZ = false

            if (Math.abs(nextX) > bounds) hitX = true
            if (Math.abs(nextZ) > bounds) hitZ = true

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

            if (Math.abs(finalNextX) > bounds) hitX = true
            if (Math.abs(finalNextZ) > bounds) hitZ = true

            if (hitX || hitZ) {
                if (s.state === 'fleeing') {
                    if (hitX && hitZ) s.targetAngle = Math.atan2(-s.x, -s.z)
                    else if (hitX) s.targetAngle = Math.cos(s.targetAngle) > 0 ? 0 : Math.PI
                    else if (hitZ) s.targetAngle = Math.sin(s.targetAngle) > 0 ? Math.PI / 2 : -Math.PI / 2
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
