import { Bullet, Player, Dragon } from './types'

export function updateBullets(
    bullets: Bullet[],
    players: Player[],
    dragon: Dragon,
    now: number,
    broadcast: (msg: any) => void,
    markPlayerDead: (id: string) => void,
    onDragonHit: (bullet: Bullet) => void
): Bullet[] {
    const bounds = 48
    const remainingBullets: Bullet[] = []

    for (const b of bullets) {
        b.x += b.vx
        b.z += b.vz

        let hit = false

        if (b.x < -bounds || b.x > bounds || b.z < -bounds || b.z > bounds || now - b.createdAt > 3000) {
            continue
        }

        if (b.ownerId === 'dragon') {
            for (const p of players) {
                if (p.isDead) continue
                const dx = p.x - b.x
                const dz = p.z - b.z
                if (dx * dx + dz * dz < 2.0) {
                    markPlayerDead(p.id)
                    broadcast({
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
            if (!dragon.isDead) {
                const dx = dragon.x - b.x
                const dz = dragon.z - b.z
                if (dx * dx + dz * dz < 16.0) {
                    onDragonHit(b)
                    hit = true
                }
            }
        }

        if (!hit) {
            remainingBullets.push(b)
        }
    }

    return remainingBullets
}
