import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'

export const onRequest = createMiddleware(async (c, next) => {
    // Allow auth routes, static assets, and favicon
    const path = c.req.path
    if (path.startsWith('/auth') || path.startsWith('/static') || path.startsWith('/app') || path === '/favicon.ico') {
        await next()
        return
    }

    const session = getCookie(c, 'user_session')
    if (!session) {
        // If it's a WebSocket request, we might handle it differently or reject
        if (c.req.header('upgrade') === 'websocket') {
            // For WS, maybe we allow it but the DO will check? 
            // Or we reject here. Let's reject for now.
            return c.text('Unauthorized', 401)
        }
        return c.redirect('/auth/google')
    }

    // Make user available in context
    const user = JSON.parse(session)
    c.set('user', user)

    await next()
})
