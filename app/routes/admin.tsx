import { createRoute } from 'honox/factory'
import AdminPanel from '../islands/AdminPanel'

const ADMIN_EMAIL = 'mcapnw@gmail.com'

export default createRoute(async (c) => {
    const user = c.get('user')
    // Check if user is logged in and has the correct email
    if (!user || user.email !== ADMIN_EMAIL) {
        // If not logged in, redirect to login
        if (!user) return c.redirect('/login')
        // If logged in but not admin, 401
        return c.text('Unauthorized', 401)
    }

    return c.render(
        <>
            {/* Override global styles to enable scrolling on admin page */}
            <style>{`
                html, body {
                    overflow: auto !important;
                    overflow-y: scroll !important;
                    position: static !important;
                    height: auto !important;
                    min-height: 100vh;
                    touch-action: auto !important;
                    user-select: auto !important;
                    -webkit-user-select: auto !important;
                    overscroll-behavior: auto !important;
                    -webkit-overflow-scrolling: touch !important;
                }
                body {
                    position: relative !important;
                }
            `}</style>
            <div style="background: #121212; min-height: 100vh; color: #fff; font-family: sans-serif; padding: 20px;">
                <h1 style="text-align: center; margin-bottom: 30px;">Admin Interface</h1>
                <AdminPanel />
            </div>
        </>,
        { title: 'Antigravity - Admin' }
    )
})
