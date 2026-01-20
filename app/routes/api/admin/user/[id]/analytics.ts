import { createRoute } from 'honox/factory'

const ADMIN_EMAIL = 'mcapnw@gmail.com'

export const GET = createRoute(async (c) => {
    const user = c.get('user')
    if (!user || user.email !== ADMIN_EMAIL) {
        return c.text('Unauthorized', 401)
    }

    const userId = c.req.param('id')
    const db = c.env.DB

    // Query sessions for this user, ordered by session end (most recent first)
    const { results } = await db.prepare(`
        SELECT * FROM PlayerSessions 
        WHERE user_id = ? 
        ORDER BY session_end DESC 
        LIMIT 50
    `).bind(userId).all()

    return c.json({ sessions: results })
})
