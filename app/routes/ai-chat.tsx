import { createRoute } from 'honox/factory'
import GlobalAIChat from '../islands/GlobalAIChat'

export default createRoute(async (c) => {
    const user = c.get('user')
    // If not logged in, redirect to login
    if (!user) {
        return c.redirect('/auth/login')
    }

    const userName = user.firstName || user.email?.split('@')[0] || 'Anonymous'

    return c.render(
        <div class="ai-chat-page">
            <style>{`
                :root {
                    --bg-page: #000000;
                    --bg-panel: #111827;
                    --border-color: #1f2937;
                    --text-primary: #f3f4f6;
                    --text-secondary: #9ca3af;
                    --accent-blue: #2563eb;
                    --accent-purple: #7e22ce;
                    --accent-red: #dc2626;
                }
                html, body {
                    overflow: auto !important;
                    height: auto !important;
                }
                .ai-chat-page {
                    min-height: 100vh;
                    background-color: var(--bg-page);
                    color: var(--text-primary);
                    padding-top: 5rem;
                    padding-bottom: 2.5rem;
                    padding-left: 1rem;
                    padding-right: 1rem;
                    font-family: system-ui, sans-serif;
                }
                @media (max-width: 640px) {
                    .ai-chat-page {
                        padding-top: 1.5rem; /* Reduced for mobile */
                    }
                    .chat-header {
                        margin-bottom: 1rem; /* Reduced for mobile */
                    }
                    .chat-title {
                        font-size: 1.75rem;
                    }
                }
                .chat-container-wrapper {
                    max-width: 56rem;
                    margin-left: auto;
                    margin-right: auto;
                }
                .chat-header {
                    margin-bottom: 2rem;
                    text-align: center;
                }
                .chat-title {
                    font-size: 2.25rem;
                    font-weight: 700;
                    margin-bottom: 0.5rem;
                    background: linear-gradient(to right, #60a5fa, #a855f7);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .chat-subtitle {
                    color: var(--text-secondary);
                }

                /* Component Styles - Globally available to the island */
                .chat-box {
                    background-color: var(--bg-panel);
                    border: 1px solid var(--border-color);
                    border-radius: 0.75rem;
                    overflow: hidden;
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                    display: flex;
                    flex-direction: column;
                    height: 70vh;
                }
                .chat-status-bar {
                    background-color: rgba(31, 41, 55, 0.5);
                    padding: 0.5rem 1rem;
                    font-size: 0.75rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    color: var(--text-secondary);
                    border-bottom: 1px solid var(--border-color);
                }
                .status-indicator {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                .status-dot {
                    width: 0.5rem;
                    height: 0.5rem;
                    border-radius: 9999px;
                }
                .status-dot.connected { background-color: #22c55e; box-shadow: 0 0 8px rgba(34, 197, 94, 0.6); }
                .status-dot.disconnected { background-color: #ef4444; }
                
                .messages-area {
                    flex: 1;
                    overflow-y: auto;
                    padding: 1rem;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }
                .message-row {
                    display: flex;
                    flex-direction: column;
                }
                .message-row.user { align-items: flex-end; }
                .message-row.ai { align-items: flex-start; }
                
                .message-sender {
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                    margin-bottom: 0.25rem;
                    padding-left: 0.25rem;
                    padding-right: 0.25rem;
                }
                
                .message-bubble {
                    max-width: 80%;
                    padding: 0.5rem 1rem;
                    border-radius: 1rem;
                    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
                }
                .message-bubble.user-me {
                    background-color: var(--accent-blue);
                    color: white;
                    border-bottom-right-radius: 0;
                }
                .message-bubble.user-other {
                    background-color: #1f2937;
                    color: #e5e7eb;
                }
                .message-bubble.ai {
                    background-color: rgba(88, 28, 135, 0.5);
                    border: 1px solid rgba(168, 85, 247, 0.3);
                    color: #f3e8ff;
                    border-bottom-left-radius: 0;
                    box-shadow: 0 0 15px rgba(168, 85, 247, 0.1);
                }
                .message-bubble.error {
                    background-color: rgba(127, 29, 29, 0.5);
                    border: 1px solid rgba(239, 68, 68, 0.5);
                    color: #fecaca;
                    border-bottom-left-radius: 0;
                    box-shadow: 0 0 15px rgba(239, 68, 68, 0.2);
                }

                .typing-indicator {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    color: #a78bfa;
                    font-size: 0.75rem;
                    padding-left: 0.5rem;
                }
                .typing-dot { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
                .typing-dot:nth-child(2) { animation-delay: 75ms; }
                .typing-dot:nth-child(3) { animation-delay: 150ms; }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: .5; }
                }

                .input-form {
                    padding: 1rem;
                    background-color: rgba(31, 41, 55, 0.3);
                    border-top: 1px solid var(--border-color);
                    display: flex;
                    gap: 0.5rem;
                    align-items: center;
                }
                .chat-input {
                    flex: 1;
                    background-color: #030712;
                    border: 1px solid #374151;
                    border-radius: 0.5rem;
                    padding: 0.5rem 1rem;
                    color: white;
                }
                .chat-input::placeholder { color: #6b7280; }
                .chat-input:focus {
                    outline: none;
                    border-color: var(--accent-blue);
                }
                .send-btn {
                    background-color: var(--accent-blue);
                    color: white;
                    padding: 0.5rem 1.5rem;
                    border-radius: 0.5rem;
                    font-weight: 500;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    transition: background-color 0.2s;
                }
                .send-btn:hover { background-color: #1d4ed8; }
                .send-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `}</style>
            <div class="chat-container-wrapper">
                <header class="chat-header">
                    <h1 class="chat-title">
                        Chat with Hope
                    </h1>
                    <p class="chat-subtitle">
                        Powered by <b>Llama 3.1</b> & Cloudflare Workers.
                    </p>
                </header>

                <GlobalAIChat
                    userName={userName}
                    isAdmin={user.email === 'mcapnw@gmail.com'}
                />
            </div>
        </div>,
        { title: 'Global AI Chat - Antigravity' }
    )
})
