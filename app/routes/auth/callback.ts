import { createRoute } from 'honox/factory'
import { setCookie } from 'hono/cookie'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo'

export const GET = createRoute(async (c) => {
    try {
        const code = c.req.query('code')
        const clientId = c.env.GOOGLE_CLIENT_ID
        const clientSecret = c.env.GOOGLE_CLIENT_SECRET
        const redirectUri = new URL(c.req.url).origin + '/auth/callback'

        if (!code || !clientId || !clientSecret) {
            return c.text('Missing code or credentials', 400)
        }

        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code'
            })
        })

        const tokenData = await tokenResponse.json() as any
        if (tokenData.error) {
            return c.text(`Token Error: ${tokenData.error} - ${tokenData.error_description || ''}`, 400)
        }

        const userResponse = await fetch(GOOGLE_USER_INFO_URL, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        })
        const userData = await userResponse.json() as any

        if (!userData || !userData.id) {
            return c.text('Failed to get user info from Google', 400)
        }

        const db = c.env.DB
        const googleUserId = userData.id
        const firstName = userData.given_name || (userData.name ? userData.name.split(' ')[0] : 'User')
        const lastName = userData.family_name || ''
        const picture = userData.picture || ''
        const email = userData.email

        // Check if user exists
        const existing = await db.prepare('SELECT * FROM Users WHERE google_id = ?').bind(googleUserId).first()

        let finalUserId: string
        if (existing) {
            finalUserId = existing.id as string
            // Update email/name/picture if changed
            await db.prepare('UPDATE Users SET email = ?, first_name = ?, last_name = ?, picture = ? WHERE id = ?')
                .bind(email, firstName, lastName, picture, finalUserId)
                .run()
        } else {
            finalUserId = crypto.randomUUID()
            await db.prepare('INSERT INTO Users (id, google_id, first_name, last_name, picture, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .bind(finalUserId, googleUserId, firstName, lastName, picture, email, Date.now())
                .run()
        }

        const sessionData: any = {
            id: finalUserId,
            firstName: firstName,
            email: email
        }

        if (existing) {
            if (existing.username) sessionData.username = existing.username
            if (existing.gender) sessionData.gender = existing.gender
            if (existing.face_index !== undefined) sessionData.faceIndex = existing.face_index
        }

        setCookie(c, 'user_session', JSON.stringify(sessionData), {
            httpOnly: true, // Protects against XSS - client gets data via server props
            secure: true,
            sameSite: 'Lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 7
        })

        return c.redirect('/')
    } catch (error) {
        console.error('Auth callback error:', error)
        return c.text(`Auth Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 500)
    }
})
