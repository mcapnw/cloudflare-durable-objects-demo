import { createRoute } from 'honox/factory'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const ADMIN_EMAIL = 'mcapnw@gmail.com'

export const GET = createRoute(async (c) => {
    const user = c.get('user')
    if (!user || user.email !== ADMIN_EMAIL) {
        return c.text('Unauthorized', 401)
    }

    const userId = c.req.param('id')
    const db = c.env.DB

    const dbUser = await db.prepare('SELECT * FROM Users WHERE id = ?').bind(userId).first()

    if (!dbUser) {
        return c.text('User not found', 404)
    }

    // Fetch user analytics stats
    let userStats = null
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_sessions,
                SUM(duration_seconds) as total_playtime,
                SUM(dragon_kills) as total_dragon_kills,
                SUM(coins_earned) as total_coins_earned,
                SUM(deaths) as total_deaths
            FROM SessionAnalytics 
            WHERE user_id = ?
        `
        userStats = await db.prepare(statsQuery).bind(userId).first()
    } catch (e) {
        console.error('Failed to fetch user stats', e)
        // Fallback if table doesn't exist
        userStats = {
            total_sessions: 0,
            total_playtime: 0,
            total_dragon_kills: 0,
            total_coins_earned: 0,
            total_deaths: 0
        }
    }

    return c.json({ user: dbUser, stats: userStats })
})

const updateUserSchema = z.object({
    username: z.string().nullable().optional(),
    coins: z.number().int().min(0).optional(),
    weapon: z.string().nullable().optional(),
    inventory: z.string().optional(), // JSON string
    tutorial_complete: z.number().int().min(0).max(1).optional()
})

export const PATCH = createRoute(
    zValidator('json', updateUserSchema),
    async (c) => {
        const user = c.get('user')
        if (!user || user.email !== ADMIN_EMAIL) {
            return c.text('Unauthorized', 401)
        }

        const userId = c.req.param('id')
        const updates = c.req.valid('json') as any
        const db = c.env.DB

        // Build dynamic update query
        const fields = []
        const values = []

        if (updates.username !== undefined) { fields.push('username = ?'); values.push(updates.username); }
        if (updates.coins !== undefined) { fields.push('coins = ?'); values.push(updates.coins); }
        if (updates.weapon !== undefined) { fields.push('weapon = ?'); values.push(updates.weapon); }
        if (updates.inventory !== undefined) { fields.push('inventory = ?'); values.push(updates.inventory); }
        if (updates.tutorial_complete !== undefined) { fields.push('tutorial_complete = ?'); values.push(updates.tutorial_complete); }

        if (fields.length === 0) {
            return c.json({ success: true, message: 'No changes' })
        }

        values.push(userId)

        const query = `UPDATE Users SET ${fields.join(', ')} WHERE id = ?`

        await db.prepare(query).bind(...values).run()

        return c.json({ success: true })
    }
)
