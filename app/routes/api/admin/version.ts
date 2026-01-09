import { createRoute } from 'honox/factory'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

const ADMIN_EMAIL = 'mcapnw@gmail.com'

export const GET = createRoute(async (c) => {
    const db = c.env.DB
    const result = await db.prepare("SELECT value FROM GameConfig WHERE key = 'version'").first<{ value: string }>()
    return c.json({ version: result?.value || '1.0.0' })
})

const updateVersionSchema = z.object({
    version: z.string().min(1)
})

export const PATCH = createRoute(
    zValidator('json', updateVersionSchema),
    async (c) => {
        const user = c.get('user')
        if (!user || user.email !== ADMIN_EMAIL) {
            return c.text('Unauthorized', 401)
        }

        const { version } = c.req.valid('json')
        const db = c.env.DB

        await db.prepare("INSERT OR REPLACE INTO GameConfig (key, value) VALUES ('version', ?)").bind(version).run()

        return c.json({ success: true, version })
    }
)
