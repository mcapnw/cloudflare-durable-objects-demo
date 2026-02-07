import { deleteCookie, getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { parseAndVerifySession } from '../lib/session'

export const onRequest = createMiddleware(async (c, next) => {
    // Allow auth routes, static assets, and favicon
    const path = c.req.path
    if (path.startsWith('/auth') || path.startsWith('/static') || path.startsWith('/app') || path === '/favicon.ico') {
        await next()
        return
    }

    const session = getCookie(c, 'user_session')
    const { user, invalid } = await parseAndVerifySession({
        sessionCookie: session,
        path,
        secret: c.env.SESSION_SECRET
    })

    if (!user) {
        if (invalid) {
            deleteCookie(c, 'user_session', { path: '/' })
        }

        // If it's a WebSocket request, reject
        if (c.req.header('upgrade') === 'websocket') {
            return c.text('Unauthorized', 401)
        }
        return c.redirect('/auth/google')
    }

    // Make user available in context
    c.set('user', user)

    await next()
})
