import { createRoute } from 'honox/factory'
import { setCookie } from 'hono/cookie'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo'

export const GET = createRoute(async (c) => {
    const clientId = c.env.GOOGLE_CLIENT_ID
    const redirectUri = c.req.url.replace('/auth/google', '/auth/callback')

    if (!clientId) {
        return c.text('Missing GOOGLE_CLIENT_ID', 500)
    }

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'profile email openid',
        access_type: 'offline',
        prompt: 'consent'
    })

    return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`)
})
