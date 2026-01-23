import { createRoute } from 'honox/factory'

export default createRoute(async (c) => {
    try {
        const doSecret = c.env.DO_SECRET
        if (!doSecret) {
            return c.json({ error: 'DO_SECRET not configured' })
        }

        // Call the DO worker's trigger endpoint
        const response = await fetch('https://antigravity-do.avjl.workers.dev/trigger-workers-ai', {
            headers: {
                'X-DO-SECRET': doSecret
            }
        })

        if (!response.ok) {
            const error = await response.text()
            return c.json({ error: `DO worker returned: ${error}`, status: response.status })
        }

        const result = await response.text()

        return c.json({
            success: true,
            message: result,
            timestamp: new Date().toISOString()
        })
    } catch (e: any) {
        return c.json({
            success: false,
            error: e.message
        })
    }
})
