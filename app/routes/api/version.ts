import { createRoute } from 'honox/factory'

export const GET = createRoute(async (c) => {
    const db = c.env.DB
    if (!db) {
        return c.json({ error: 'D1 binding not found' }, 500)
    }

    try {
        const result = await db.prepare('SELECT value FROM GameConfig WHERE key = ?')
            .bind('version')
            .first()

        return c.json({ version: result?.value || '0.0.0' })
    } catch (err: any) {
        console.error('Database query error:', err)
        return c.json({ error: err.message }, 500)
    }
})
