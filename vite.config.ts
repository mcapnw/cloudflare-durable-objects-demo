import { defineConfig } from 'vite'
import honox from 'honox/vite'
import build from '@hono/vite-build/cloudflare-pages'

export default defineConfig({
    build: {
        rollupOptions: {
            preserveEntrySignatures: 'strict',
        }
    },
    plugins: [
        honox({
            client: {
                input: ['./app/client.ts']
            }
        }),
        build()
    ]
})
