import { createRoute } from 'honox/factory'

const ADMIN_EMAIL = 'mcapnw@gmail.com'

export const GET = createRoute(async (c) => {
    const user = c.get('user')
    if (!user || user.email !== ADMIN_EMAIL) {
        return c.text('Unauthorized', 401)
    }

    const db = c.env.DB
    const { results } = await db.prepare('SELECT id, first_name, last_name, picture, email FROM Users ORDER BY first_name ASC').all()

    return c.json({ users: results })
})
