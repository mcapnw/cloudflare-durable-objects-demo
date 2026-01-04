import { createRoute } from 'honox/factory'
import { deleteCookie } from 'hono/cookie'

export const GET = createRoute(async (c) => {
    deleteCookie(c, 'user_session', { path: '/' })
    return c.redirect('/login')
})
