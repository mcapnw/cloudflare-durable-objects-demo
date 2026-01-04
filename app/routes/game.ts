import { createRoute } from 'honox/factory'

export const GET = createRoute(async (c) => {
    const upgrade = c.req.header('Upgrade')
    if (upgrade !== 'websocket') {
        return c.text('Expected Upgrade: websocket', 426)
    }

    // Require authenticated user - prevents anonymous connections
    const user = c.get('user')
    if (!user) {
        return c.text('Unauthorized', 401)
    }

    const doWorker = c.env.DO_WORKER
    if (!doWorker) {
        return c.text('DO_WORKER service binding not found', 500)
    }

    // Pass user info securely from server-side session (prevents impersonation)
    const url = new URL(c.req.url)
    url.searchParams.set('name', user.firstName)
    url.searchParams.set('id', user.id)

    // Add shared secret to validate this request came from Pages (not direct access)
    const doRequest = new Request(url.toString(), c.req.raw)
    doRequest.headers.set('X-DO-SECRET', c.env.DO_SECRET)

    return doWorker.fetch(doRequest)
})
