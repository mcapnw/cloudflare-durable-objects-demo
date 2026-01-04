import { jsxRenderer } from 'hono/jsx-renderer'
import { Script } from 'honox/server'

export default jsxRenderer(({ children, title }) => {
    return (
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                {/* Mobile-optimized viewport: disable zoom, enable safe area */}
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
                {/* iOS Safari specific */}
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                {/* Theme color for browser UI */}
                <meta name="theme-color" content="#1a1a2e" />
                <title>{title}</title>
                <Script src="/app/client.ts" async />
                <style>{`
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                    }
                    html, body {
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                        position: fixed;
                        top: 0;
                        left: 0;
                        touch-action: none;
                        -webkit-touch-callout: none;
                        -webkit-user-select: none;
                        user-select: none;
                        -webkit-tap-highlight-color: transparent;
                        overscroll-behavior: none;
                    }
                    body {
                        font-family: system-ui, -apple-system, sans-serif;
                        /* Safe area padding for notched phones */
                        padding-top: env(safe-area-inset-top);
                        padding-bottom: env(safe-area-inset-bottom);
                        padding-left: env(safe-area-inset-left);
                        padding-right: env(safe-area-inset-right);
                    }
                    #game-container {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100vw;
                        height: 100vh;
                        height: 100dvh;
                    }
                    #game-container canvas {
                        display: block;
                        width: 100% !important;
                        height: 100% !important;
                    }
                `}</style>
            </head>
            <body>{children}</body>
        </html>
    )
})
