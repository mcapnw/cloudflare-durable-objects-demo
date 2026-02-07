import { createApp } from 'honox/server'
import { deleteCookie, getCookie } from 'hono/cookie'
import { parseAndVerifySession } from './lib/session'

export const app = createApp({
    init: (app) => {
        // Auth middleware - runs before all routes
        app.use('*', async (c, next) => {
            const path = c.req.path

            // Allow news page, auth routes, login page, static assets, and favicon
            if (path === '/news' || path.startsWith('/auth') || path === '/login' || path.startsWith('/static') || path.startsWith('/app') || path === '/favicon.ico') {
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
                return c.redirect('/login')
            }

            c.set('user', user)
            await next()
        })
    }
})

export default app
