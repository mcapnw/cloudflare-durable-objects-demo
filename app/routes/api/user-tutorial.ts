import { createRoute } from 'honox/factory'
import { getCookie } from 'hono/cookie'

export const POST = createRoute(async (c) => {
    const session = getCookie(c, 'user_session')
    if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const user = JSON.parse(session)
    const db = c.env.DB
    if (!db) {
        return c.json({ error: 'D1 binding not found' }, 500)
    }

    try {
        await db.prepare(
            'UPDATE Users SET tutorial_complete = 1 WHERE id = ?'
        ).bind(user.id).run()

        return c.json({ success: true })
    } catch (err: any) {
        console.error('Tutorial complete update error:', err)
        return c.json({ error: err.message }, 500)
    }
})
