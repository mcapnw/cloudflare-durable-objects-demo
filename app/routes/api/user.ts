import { createRoute } from 'honox/factory'
import { getCookie, setCookie } from 'hono/cookie'

export const POST = createRoute(async (c) => {
    const session = getCookie(c, 'user_session')
    if (!session) {
        return c.json({ error: 'Unauthorized' }, 401)
    }

    const { username, gender, faceIndex } = await c.req.json()
    const user = JSON.parse(session)

    const db = c.env.DB
    if (!db) {
        return c.json({ error: 'D1 binding not found' }, 500)
    }

    try {
        await db.prepare(
            'UPDATE Users SET username = ?, gender = ?, face_index = ? WHERE id = ?'
        )
            .bind(username, gender, faceIndex, user.id)
            .run()

        // Update session cookie with new data?
        // Usually we want to keep it in sync if we use it for display
        const updatedUser = { ...user, username, gender, faceIndex }
        setCookie(c, 'user_session', JSON.stringify(updatedUser), {
            path: '/',
            httpOnly: true, // Protects against XSS - client gets data via server props
            secure: true,
            sameSite: 'Lax',
            maxAge: 60 * 60 * 24 * 7 // 1 week
        })

        return c.json({ success: true })
    } catch (err: any) {
        console.error('Database update error:', err)
        return c.json({ error: err.message }, 500)
    }
})
