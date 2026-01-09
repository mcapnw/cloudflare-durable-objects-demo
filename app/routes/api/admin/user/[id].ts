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

    return c.json({ user: dbUser })
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
