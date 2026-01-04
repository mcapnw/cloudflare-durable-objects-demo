import { createApp } from 'honox/server'
import { getCookie } from 'hono/cookie'

export const app = createApp({
    init: (app) => {
        // Auth middleware - runs before all routes
        app.use('*', async (c, next) => {
            const path = c.req.path

            // Allow auth routes, login page, static assets, and favicon
            if (path.startsWith('/auth') || path === '/login' || path.startsWith('/static') || path.startsWith('/app') || path === '/favicon.ico') {
                await next()
                return
            }

            const session = getCookie(c, 'user_session')
            if (!session) {
                // If it's a WebSocket request, reject
                if (c.req.header('upgrade') === 'websocket') {
                    return c.text('Unauthorized', 401)
                }
                return c.redirect('/login')
            }

            // Make user available in context
            const user = JSON.parse(session)
            c.set('user', user)

            await next()
        })
    }
})

export default app
