import { createRoute } from 'honox/factory'

export const GET = createRoute(async (c) => {
    const upgradeHeader = c.req.header('Upgrade')
    if (upgradeHeader && upgradeHeader.toLowerCase() === 'websocket') {
        const id = c.env.GLOBAL_CHAT_NAMESPACE.idFromName('global-chat-room')
        const stub = c.env.GLOBAL_CHAT_NAMESPACE.get(id)

        // Rewrite URL to match DO expectation
        const url = new URL(c.req.url)
        url.pathname = '/websocket'

        // Pass admin status securely to DO
        const user = c.get('user')
        if (user && user.email === 'mcapnw@gmail.com') {
            url.searchParams.set('admin', 'true')
        }

        const newReq = new Request(url.toString(), c.req.raw)

        return stub.fetch(newReq)
    }

    // Return history for non-websocket requests (optional, or handled by a separate endpoint)
    // For now, let's just handle the WS upgrade here.
    return c.json({ error: 'Expected Upgrade: websocket' }, 426)
})
