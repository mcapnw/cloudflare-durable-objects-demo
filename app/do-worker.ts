
import { GameRoomDurableObject } from './durable_objects/GameRoom'

export { GameRoomDurableObject }

interface Env {
    GAMEROOM_NAMESPACE: DurableObjectNamespace
    DB: D1Database
    DO_SECRET: string
    GOOGLE_AI_API_KEY: string
}

export default {
    async fetch(request: Request, env: Env, ctx: any) {
        // Validate the shared secret - blocks direct access to DO Worker
        if (request.headers.get('X-DO-SECRET') !== env.DO_SECRET) {
            return new Response('Unauthorized', { status: 401 })
        }

        // Route to the Durable Object
        const url = new URL(request.url)
        console.log('DO Worker URL:', url.toString()) // Keep basic logging
        const room = url.searchParams.get('room')
        const id = env.GAMEROOM_NAMESPACE.idFromName(room || 'global-room')
        const stub = env.GAMEROOM_NAMESPACE.get(id)
        return stub.fetch(request)
    },

    async scheduled(event: any, env: Env, ctx: any) {
        console.log('Cron triggered in DO Worker:', event.cron)
        if (event.cron === "0 5 * * *") {
            ctx.waitUntil(triggerResearch(env))
        } else {
            ctx.waitUntil(pollResearch(env))
        }
    }
}

async function triggerResearch(env: Env) {
    console.log('Starting AI Deep Research...')
    const apiKey = env.GOOGLE_AI_API_KEY
    if (!apiKey) {
        console.error('GOOGLE_AI_API_KEY is not set')
        return
    }

    const prompt = `Perform deep research into the day's AI news and advancements. 
    Focus specifically on:
    1. AI-generated code and developer-centric advancements.
    2. High-signal social media posts (X, Reddit, etc.) regarding new use cases and emerging developer tools.
    3. Reliable news articles from reputable tech journalism sites and official company blogs.
    
    Provide a detailed, structured report of your findings that synthesizes these sources into high-value insights for developers.
    
    IMPORTANT requirements:
    1. Optimize the headline and summary for SEO (high-ranking keywords).
    2. Include a list of valid source URLs used in your research.
    3. "article_content" must be a long-form HTML string (no markdown block) suitable for a blog post. It MUST include a specific "Social Media Spotlight" section detailing popular use cases from X (Twitter) and Reddit.
    4. Generate a unique, SEO-friendly "slug" (kebab-case string) based on the headline.
    5. Return RAW JSON structure:
    {
      "headline": "String (SEO Optimized)",
      "slug": "String (kebab-case)",
      "summary": "String (SEO Optimized)",
      "article_content": "String (HTML, Long-form, with <h3>, <p>, <ul> tags)",
      "key_takeaways": ["String"],
      "data_grid": [{"label": "String", "value": "String"}],
      "sources": [{"title": "String", "url": "String"}]
    }`

    const schema = {
        "type": "OBJECT",
        "properties": {
            "headline": { "type": "STRING" },
            "summary": { "type": "STRING" },
            "key_takeaways": { "type": "ARRAY", "items": { "type": "STRING" } },
            "data_grid": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "category": { "type": "STRING" },
                        "value": { "type": "STRING" }
                    }
                }
            }
        }
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "agent": "deep-research-pro-preview-12-2025",
                "input": prompt,
                "background": true
            })
        })

        if (!response.ok) {
            const error = await response.text()
            console.error('Failed to trigger research:', error)
            return
        }

        const result: any = await response.json()
        const interactionId = result.name || result.id

        if (interactionId) {
            await env.DB.prepare("INSERT INTO PendingResearch (interaction_id) VALUES (?)")
                .bind(interactionId)
                .run()
            console.log('Research triggered successfully. ID:', interactionId)
        } else {
            console.error('No interactionId found in result')
        }
    } catch (e) {
        console.error('Error in triggerResearch:', e)
    }
}

async function pollResearch(env: Env) {
    const pending = await env.DB.prepare("SELECT * FROM PendingResearch WHERE status = 'pending'").all()
    const interactions = pending.results || []

    const apiKey = env.GOOGLE_AI_API_KEY
    if (!apiKey || interactions.length === 0) return

    for (const item of interactions) {
        const id = (item as any).interaction_id
        console.log('Polling interaction:', id)

        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${id}?key=${apiKey}`)
            if (!response.ok) {
                console.error(`Failed to fetch interaction ${id}:`, await response.text())
                continue
            }

            const result: any = await response.json()

            if (result.state === 'COMPLETED') {
                const content = result.response?.candidates?.[0]?.content?.parts?.[0]?.text
                if (content) {
                    const data = JSON.parse(content)

                    let inserted = false
                    let attempts = 0
                    const baseSlug = data.slug || data.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-')
                    let currentSlug = baseSlug

                    while (!inserted && attempts < 5) {
                        try {
                            await env.DB.prepare(`
                                INSERT INTO NewsPosts (headline, summary, key_takeaways, data_grid, sources, article_content, slug)
                                VALUES (?, ?, ?, ?, ?, ?, ?)
                            `).bind(
                                data.headline,
                                data.summary,
                                JSON.stringify(data.key_takeaways || []),
                                JSON.stringify(data.data_grid || []),
                                JSON.stringify(data.sources || []),
                                data.article_content || "",
                                currentSlug
                            ).run()
                            inserted = true
                        } catch (e: any) {
                            if (e.message.includes('UNIQUE constraint failed')) {
                                attempts++
                                currentSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`
                                console.log(`Slug collision for ${baseSlug}, retrying with ${currentSlug}`)
                            } else {
                                throw e
                            }
                        }
                    }

                    await env.DB.prepare("UPDATE PendingResearch SET status = 'completed' WHERE id = ?")
                        .bind(item.id)
                        .run()

                    console.log('Research completed and saved for ID:', id)
                }
            } else if (result.state === 'FAILED') {
                await env.DB.prepare("UPDATE PendingResearch SET status = 'failed' WHERE id = ?")
                    .bind(item.id)
                    .run()
                console.error('Research failed for ID:', id)
            }
        } catch (e) {
            console.error(`Error polling ${id}:`, e)
        }
    }
}
