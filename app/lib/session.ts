/**
 * Session signing utilities using HMAC-SHA256
 * Prevents session forgery by cryptographically signing session data
 */

// Helper to convert ArrayBuffer to hex string
function bufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

// Helper to convert hex string to ArrayBuffer
function hexToBuffer(hex: string): ArrayBuffer {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes.buffer
}

// Unicode-safe base64 encoding using URL-safe characters
function base64UrlEncode(str: string): string {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(str)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    // btoa and make URL-safe
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Unicode-safe base64 decoding from URL-safe format
function base64UrlDecode(base64url: string): string {
    // Convert URL-safe back to standard base64
    let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    while (base64.length % 4) {
        base64 += '='
    }
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    const decoder = new TextDecoder()
    return decoder.decode(bytes)
}

/**
 * Signs session data with HMAC-SHA256
 * @param data - The session data object to sign
 * @param secret - The secret key for signing (SESSION_SECRET env var)
 * @returns A string in format: base64url(data).signature
 */
export async function signSession(data: Record<string, any>, secret: string): Promise<string> {
    try {
        const encoder = new TextEncoder()

        // Encode the data as URL-safe base64
        const jsonData = JSON.stringify(data)
        const base64Data = base64UrlEncode(jsonData)

        // Import the secret key
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        )

        // Sign the base64 data
        const signature = await crypto.subtle.sign(
            'HMAC',
            key,
            encoder.encode(base64Data)
        )

        // Return data.signature format
        return `${base64Data}.${bufferToHex(signature)}`
    } catch (error) {
        console.error('signSession error:', error)
        throw error
    }
}

/**
 * Verifies and parses a signed session
 * @param signedSession - The signed session string (base64data.signature)
 * @param secret - The secret key for verification
 * @returns The parsed session data, or null if invalid/tampered
 */
export async function verifySession(signedSession: string, secret: string): Promise<Record<string, any> | null> {
    try {
        // Find the last dot to split (signature is hex, so won't contain dots)
        const lastDotIndex = signedSession.lastIndexOf('.')
        if (lastDotIndex === -1) {
            console.error('Session format invalid: no signature separator')
            return null
        }

        const base64Data = signedSession.substring(0, lastDotIndex)
        const signatureHex = signedSession.substring(lastDotIndex + 1)

        if (!base64Data || !signatureHex) {
            console.error('Session format invalid: empty data or signature')
            return null
        }

        const encoder = new TextEncoder()

        // Import the secret key
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        )

        // Verify the signature
        const signatureBuffer = hexToBuffer(signatureHex)
        const isValid = await crypto.subtle.verify(
            'HMAC',
            key,
            signatureBuffer,
            encoder.encode(base64Data)
        )

        if (!isValid) {
            console.error('Session signature invalid')
            return null
        }

        // Decode and parse the data (unicode-safe)
        const jsonData = base64UrlDecode(base64Data)
        return JSON.parse(jsonData)
    } catch (error) {
        console.error('Session verification error:', error)
        return null
    }
}
