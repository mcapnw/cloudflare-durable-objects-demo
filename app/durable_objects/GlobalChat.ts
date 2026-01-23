import { DurableObject } from "cloudflare:workers";
import { Env } from "../do-worker";

interface ChatMessage {
    id?: number;
    user_name: string;
    content: string;
    type: 'user' | 'ai';
    created_at?: string;
}

export class GlobalChatDO extends DurableObject {
    sessions: Set<WebSocket>;
    env: Env;

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.env = env;
        this.sessions = new Set();
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === "/websocket") {
            const upgradeHeader = request.headers.get("Upgrade");
            if (!upgradeHeader || upgradeHeader !== "websocket") {
                return new Response("Expected Upgrade: websocket", { status: 426 });
            }

            const [client, server] = Object.values(new WebSocketPair());

            // Handle the connection
            const isAdmin = url.searchParams.get('admin') === 'true';
            await this.handleSession(server, isAdmin);

            return new Response(null, {
                status: 101,
                webSocket: client,
            });
        }

        return new Response("Not found", { status: 404 });
    }

    async handleSession(webSocket: WebSocket, isAdmin: boolean = false) {
        this.sessions.add(webSocket);
        (webSocket as any).accept();

        // 0. Send recent history
        try {
            const history = await this.env.DB.prepare(
                "SELECT user_name, content, type, created_at FROM GlobalChatMessages ORDER BY created_at DESC LIMIT 50"
            ).all();

            // Send strictly to this new socket
            // Start listening *after* sending history? Or parallel. 
            // Better parallel to not block if DB is slow.
            const results = (history.results || []);
            const reversed = results.reverse();

            webSocket.send(JSON.stringify({
                type: 'history',
                messages: reversed
            }));
        } catch (e) {
            console.error('Failed to load history', e);
        }

        webSocket.addEventListener("message", async (msg) => {
            try {
                const data = JSON.parse(msg.data as string);

                if (data.type === 'clear_chat') {
                    if (isAdmin) {
                        await this.env.DB.prepare("DELETE FROM GlobalChatMessages").run();
                        this.broadcast({ type: 'chat_cleared' });
                    }
                    return;
                }

                if (data.type === 'message') {
                    // 1. Broadcast user message immediately
                    const userMsg: ChatMessage = {
                        user_name: data.userName,
                        content: data.content,
                        type: 'user',
                        created_at: new Date().toISOString()
                    };

                    this.broadcast(userMsg);

                    // 2. Persist to D1 asynchronously
                    this.env.DB.prepare(
                        "INSERT INTO GlobalChatMessages (user_name, content, type) VALUES (?, ?, ?)"
                    ).bind(userMsg.user_name, userMsg.content, 'user').run().catch(e => console.error('Failed to save user msg', e));

                    // 3. Trigger AI response
                    this.generateAIResponse(userMsg);
                }
            } catch (err) {
                console.error("Error handling message", err);
            }
        });

        webSocket.addEventListener("close", () => {
            this.sessions.delete(webSocket);
        });
    }

    broadcast(msg: any) {
        const payload = JSON.stringify(msg);
        for (const session of this.sessions) {
            try {
                session.send(payload);
            } catch (err) {
                this.sessions.delete(session);
            }
        }
    }

    async generateAIResponse(userMsg: ChatMessage) {
        try {
            // Signal "typing"
            this.broadcast({ type: 'typing_start' });

            // Construct prompt including recent history? 
            // For now, let's keep it simple: generic response or strictly based on input.
            // TinyLlama is smart enough for basic chat.

            // Fetch last 10 messages for context (excluding the one just sent, which is in userMsg)
            // We select 11 to effectively get 10 previous + current, but we construct current manually
            // Add a 3-second delay to fix message ordering and simulate "typing" thought
            await new Promise(resolve => setTimeout(resolve, 3000));

            const history = await this.env.DB.prepare(
                "SELECT * FROM GlobalChatMessages ORDER BY created_at DESC LIMIT 50"
            ).all();

            const contextMessages = (history.results || []).reverse()
                .filter((msg: any) => {
                    // Filter out the current message if it was already saved to DB to avoid duplication
                    return !(msg.content === userMsg.content && msg.user_name === userMsg.user_name);
                })
                .map((msg: any) => ({
                    role: msg.type === 'ai' ? 'assistant' : 'user',
                    content: (msg.type === 'ai' || msg.user_name === 'Hope') ? msg.content : `${msg.user_name} says: ${msg.content}`
                }));

            const messages = [
                { role: "system", content: "You are Hope, a disgruntled female employee of a doorknob company. You work in the factory on the assembly line, NOT in sales. You are currently out in public (not at work), just speaking to random strangers who pass by. You are NOT talking to customers. You are bored, slightly emotional, and annoyed by your job. You have zero interest in selling doorknobs and will get annoyed if people ask. You are just here to chat because you are bored. If a request is ridiculous, play along with sarcasm. Keep responses concise. IMPORTANT: You MUST include the user's name in your response." },
                ...contextMessages,
                { role: "user", content: `${userMsg.user_name} says: ${userMsg.content}` }
            ];

            const stream = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                messages,
                stream: true
            });

            let fullResponse = "";

            const decoder = new TextDecoder();
            for await (const chunk of stream as any) {
                const text = decoder.decode(chunk, { stream: true });
                const lines = text.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr === '[DONE]') continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            const token = data.response ?? data.text ?? data.token ?? data.choices?.[0]?.delta?.content ?? '';

                            if (token) {
                                fullResponse += token;
                                this.broadcast({
                                    type: 'ai_stream',
                                    chunk: token
                                });
                            }
                        } catch (e) {
                            console.error('Error parsing AI chunk:', e);
                        }
                    }
                }
            }

            // Signal done and persist
            this.broadcast({ type: 'ai_done' });

            await this.env.DB.prepare(
                "INSERT INTO GlobalChatMessages (user_name, content, type) VALUES (?, ?, ?)"
            ).bind('TinyLlama', fullResponse, 'ai').run();

        } catch (e: any) {
            console.error('AI generation failed. Error:', e.message, e.stack);

            // Ensure we signal end of typing so UI unblocks
            this.broadcast({ type: 'ai_done' });

            this.broadcast({
                type: 'error',
                content: 'AI brain freeze! (' + (e.message || 'Unknown error') + ')'
            });
        }
    }
}
