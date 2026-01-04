import { } from 'hono'

type Head = {
    title?: string
}

declare module 'hono' {
    interface Env {
        Variables: {
            user: {
                id: string
                firstName: string
                username?: string
                gender?: string
                faceIndex?: number
            }
        }
        Bindings: {
            DB: D1Database
            DO_WORKER: Fetcher
            GOOGLE_CLIENT_ID: string
            GOOGLE_CLIENT_SECRET: string
            DO_SECRET: string
        }
    }
    interface ContextRenderer {
        (content: string | Promise<string>, head?: Head): Response | Promise<Response>
    }
}
