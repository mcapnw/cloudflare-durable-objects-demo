import { useState, useEffect, useRef } from 'hono/jsx'

interface Message {
    user_name: string;
    content: string;
    type: 'user' | 'ai' | 'typing_start' | 'ai_stream' | 'ai_done' | 'error';
    chunk?: string;
    created_at?: string;
}

export default function GlobalAIChat({ userName, isAdmin }: { userName: string, isAdmin?: boolean }) {
    const [messages, setMessages] = useState<Message[]>([])
    const [input, setInput] = useState('')
    const [status, setStatus] = useState<'connecting' | 'connected' | 'error'>('connecting')
    const [aiThinking, setAiThinking] = useState(false)
    const wsRef = useRef<WebSocket | null>(null)
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Auto-scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }

    useEffect(() => {
        scrollToBottom()
    }, [messages, aiThinking])

    useEffect(() => {
        // Connect to WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const wsUrl = `${protocol}//${window.location.host}/api/chat`
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
            setStatus('connected')
        }

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)

                if (data.type === 'typing_start') {
                    setAiThinking(true)
                } else if (data.type === 'chat_cleared') {
                    setMessages([])
                } else if (data.type === 'history') {
                    if (Array.isArray(data.messages)) {
                        setMessages(data.messages)
                        setTimeout(() => scrollToBottom(), 100)
                    }
                } else if (data.type === 'ai_stream') {
                    // Update the last AI message or create new one
                    setMessages(prev => {
                        const lastMsg = prev[prev.length - 1]
                        if (lastMsg && lastMsg.type === 'ai' && lastMsg.user_name === 'Hope') {
                            const newContent = lastMsg.content + (data.chunk || '')
                            return [...prev.slice(0, -1), { ...lastMsg, content: newContent }]
                        } else {
                            return [...prev, { user_name: 'Hope', content: data.chunk || '', type: 'ai' }]
                        }
                    })
                } else if (data.type === 'ai_done') {
                    setAiThinking(false) // Clear typing indicator
                } else {
                    // Normal message or Error
                    setMessages(prev => [...prev, data])
                    if (data.type === 'error') {
                        setAiThinking(false) // Force clear typing on error
                    }
                }
            } catch (e) {
                console.error('WS Parse Error', e)
            }
        }

        ws.onerror = (e) => {
            console.error('WS Error', e)
            setStatus('error')
        }

        ws.onclose = () => {
            setStatus('error')
        }

        return () => {
            ws.close()
        }
    }, [])

    const sendMessage = (e: any) => {
        e.preventDefault()
        if (!input.trim() || !wsRef.current) return

        const payload = {
            type: 'message',
            userName: userName,
            content: input.trim()
        }

        wsRef.current.send(JSON.stringify(payload))
        setInput('')
    }

    const clearChat = () => {
        if (!wsRef.current || !isAdmin) return
        if (!confirm('Are you sure you want to delete all chat history for everyone?')) return

        wsRef.current.send(JSON.stringify({ type: 'clear_chat' }))
    }

    return (
        <div class="chat-box">
            {/* Status Bar */}
            <div class="chat-status-bar">
                <span class="status-indicator">
                    <span class={`status-dot ${status === 'connected' ? 'connected' : 'disconnected'}`}></span>
                    {status === 'connected' ? 'Live Connection' : 'Disconnected'}
                </span>
                <span>Agent: Hope</span>
                {isAdmin && (
                    <button
                        onClick={clearChat}
                        style={{
                            marginLeft: 'auto',
                            color: '#ef4444',
                            background: 'none',
                            border: '1px solid #ef4444',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            cursor: 'pointer',
                            fontSize: '0.75rem'
                        }}
                    >
                        Clear Chat
                    </button>
                )}
            </div>

            {/* Messages Area */}
            <div class="messages-area">
                {messages.length === 0 && (
                    <div style={{ textAlign: 'center', marginTop: '2.5rem', color: 'var(--text-secondary)' }}>
                        <p>No messages yet. Say hello!</p>
                    </div>
                )}

                {messages.map((msg, i) => (
                    <div class={`message-row ${msg.type === 'user' && msg.user_name === userName ? 'user' : 'ai'}`}>
                        <span class="message-sender">
                            {msg.user_name}
                        </span>
                        <div class={`message-bubble ${msg.type === 'user'
                            ? (msg.user_name === userName ? 'user-me' : 'user-other')
                            : msg.type === 'error'
                                ? 'error'
                                : 'ai'
                            }`}>
                            {msg.content}
                        </div>
                    </div>
                ))}

                {aiThinking && (
                    <div class="typing-indicator">
                        <span class="typing-dot">●</span>
                        <span class="typing-dot">●</span>
                        <span class="typing-dot">●</span>
                        <span>Hope is typing...</span>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={sendMessage} class="input-form">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput((e.target as HTMLInputElement).value)}
                    placeholder="Type a message..."
                    class="chat-input"
                    disabled={status !== 'connected'}
                />
                <button
                    type="submit"
                    disabled={!input.trim() || status !== 'connected'}
                    class="send-btn"
                >
                    Send
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                </button>
            </form>
        </div>
    )
}
