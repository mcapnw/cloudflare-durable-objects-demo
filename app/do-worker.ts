
import { GameRoomDurableObject } from './durable_objects/GameRoom'

export { GameRoomDurableObject }

interface Env {
    GAMEROOM_NAMESPACE: DurableObjectNamespace
    DB: D1Database
    DO_SECRET: string
}

export default {
    async fetch(request: Request, env: Env) {
        // Validate the shared secret - blocks direct access to DO Worker
        if (request.headers.get('X-DO-SECRET') !== env.DO_SECRET) {
            return new Response('Unauthorized', { status: 401 })
        }

        // Route to the Durable Object
        const id = env.GAMEROOM_NAMESPACE.idFromName('global-room')
        const stub = env.GAMEROOM_NAMESPACE.get(id)
        return stub.fetch(request)
    }
}
