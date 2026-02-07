import { createRoute } from 'honox/factory'
import { deleteCookie, getCookie } from 'hono/cookie'
import { parseAndVerifySession } from '../../lib/session'

export const POST = createRoute(async (c) => {
    const session = getCookie(c, 'user_session')
    const { user, invalid } = await parseAndVerifySession({
        sessionCookie: session,
        path: c.req.path,
        secret: c.env.SESSION_SECRET
    })

    if (!user) {
        if (invalid) {
            deleteCookie(c, 'user_session', { path: '/' })
        }
        return c.json({ error: 'Unauthorized' }, 401)
    }

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
