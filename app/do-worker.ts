
import { GameRoomDurableObject } from './durable_objects/GameRoom'
import { GlobalChatDO } from './durable_objects/GlobalChat'

export { GameRoomDurableObject, GlobalChatDO }

export interface Env {
    GAMEROOM_NAMESPACE: DurableObjectNamespace
    GLOBAL_CHAT_NAMESPACE: DurableObjectNamespace
    DB: D1Database
    DO_SECRET: string
    GOOGLE_AI_API_KEY: string
    AI: any // Cloudflare Workers AI binding
}

export default {
    async fetch(request: Request, env: Env, ctx: any) {
        const url = new URL(request.url)

        // Manual trigger endpoint for Workers AI (TEMPORARY)
        if (url.pathname === '/trigger-workers-ai' && request.headers.get('X-DO-SECRET') === env.DO_SECRET) {
            console.log('🔧 Manual trigger: Workers AI')
            await triggerWorkersAI(env)
            return new Response('Workers AI triggered!', { status: 200 })
        }

        // Validate the shared secret - blocks direct access to DO Worker
        if (request.headers.get('X-DO-SECRET') !== env.DO_SECRET) {
            return new Response('Unauthorized', { status: 401 })
        }

        // Route to the Durable Object
        console.log('DO Worker URL:', url.toString()) // Keep basic logging
        const room = url.searchParams.get('room')
        const id = env.GAMEROOM_NAMESPACE.idFromName(room || 'global-room')
        const stub = env.GAMEROOM_NAMESPACE.get(id)
        return stub.fetch(request)
    },

    async scheduled(event: any, env: Env, ctx: any) {
        console.log('=== SCHEDULED EVENT TRIGGERED ===')
        console.log('Event object:', JSON.stringify(event))
        console.log('Cron string:', event.cron)
        console.log('Scheduled time:', event.scheduledTime)

        // Route based on cron schedule
        if (event.cron === "0 5 * * *") {
            console.log('▶ Triggering daily research (5am UTC / 9pm PST) - Gemini Deep Research')
            ctx.waitUntil(triggerResearch(env))
        } else if (event.cron === "0 16 * * *") {
            console.log('▶ Triggering daily AI news (4pm UTC / 8am PST) - Workers AI Llama')
            ctx.waitUntil(triggerWorkersAI(env))
        } else {
            console.log('▶ Polling for research results (every 5 min)')
            ctx.waitUntil(pollResearch(env))
        }
        console.log('=== SCHEDULED HANDLER COMPLETE ===')
    }
}

async function triggerResearch(env: Env) {
    console.log('📰 [triggerResearch] Starting AI Deep Research...')
    const apiKey = env.GOOGLE_AI_API_KEY
    if (!apiKey) {
        console.error('❌ [triggerResearch] GOOGLE_AI_API_KEY is not set in environment')
        return
    }
    console.log('✅ [triggerResearch] API key found, length:', apiKey.length)

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
        console.log('🌐 [triggerResearch] Making API request to Gemini Deep Research...')
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "agent": "deep-research-pro-preview-12-2025",
                "input": prompt,
                "background": true
            })
        })

        console.log('📡 [triggerResearch] Response status:', response.status, response.statusText)

        if (!response.ok) {
            const error = await response.text()
            console.error('❌ [triggerResearch] API request failed:', error)
            console.error('❌ [triggerResearch] Status:', response.status)
            return
        }

        const result: any = await response.json()
        console.log('📦 [triggerResearch] API response:', JSON.stringify(result))

        const interactionId = result.name || result.id
        console.log('🔑 [triggerResearch] Extracted interaction ID:', interactionId)

        if (interactionId) {
            console.log('💾 [triggerResearch] Inserting into PendingResearch table...')
            const dbResult = await env.DB.prepare("INSERT INTO PendingResearch (interaction_id) VALUES (?)")
                .bind(interactionId)
                .run()
            console.log('✅ [triggerResearch] Database insert result:', JSON.stringify(dbResult))
            console.log('✅ [triggerResearch] Research triggered successfully. ID:', interactionId)
        } else {
            console.error('❌ [triggerResearch] No interactionId found in API response')
            console.error('❌ [triggerResearch] Full result:', JSON.stringify(result))
        }
    } catch (e) {
        console.error('💥 [triggerResearch] EXCEPTION:', e)
        console.error('💥 [triggerResearch] Error type:', typeof e)
        console.error('💥 [triggerResearch] Error details:', JSON.stringify(e, Object.getOwnPropertyNames(e)))
    }
}

// Workers AI Function: Uses Cloudflare's Llama 3.1 for daily news generation
async function triggerWorkersAI(env: Env) {
    console.log('🤖 [triggerWorkersAI] Starting Workers AI news generation...')

    if (!env.AI) {
        console.error('❌ [triggerWorkersAI] AI binding not found')
        return
    }
    console.log('✅ [triggerWorkersAI] AI binding available')

    const prompt = `You are a tech journalist specializing in AI and coding developments. Write a comprehensive daily AI news article.

Focus on:
1. Latest AI coding tools and developer advancements
2. New AI models and their capabilities  
3. Industry trends and adoption
4. Practical applications for developers

Provide your response as a JSON object with this exact structure:
{
  "headline": "An engaging, SEO-optimized headline (max 80 chars)",
  "slug": "url-friendly-kebab-case-version",
  "summary": "A compelling 2-3 sentence summary highlighting the main points",
  "article_content": "Full HTML article with <h3> section headers, <p> paragraphs, and <ul><li> lists. Include at least 4-5 paragraphs covering different aspects.",
  "key_takeaways": ["Key insight 1", "Key insight 2", "Key insight 3"],
  "data_grid": [{"label": "Topic Category", "value": "AI Development"}, {"label": "Impact Level", "value": "High"}],
  "sources": [{"title": "Source name", "url": "https://example.com"}]
}

Make the content informative, accurate, and valuable for developers. Today's date is ${new Date().toISOString().split('T')[0]}.`

    try {
        console.log('🌐 [triggerWorkersAI] Running Llama 3.1 8B Instruct...')
        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
                { role: 'system', content: 'You are a skilled tech journalist. Always respond with valid JSON only, no markdown formatting.' },
                { role: 'user', content: prompt }
            ],
            max_tokens: 2048,
            temperature: 0.7
        })

        console.log('📡 [triggerWorkersAI] AI response received')

        if (!response || !response.response) {
            console.error('❌ [triggerWorkersAI] No response from AI')
            return
        }

        console.log('📝 [triggerWorkersAI] Parsing response...')
        let content = response.response.trim()

        // Remove markdown code blocks if present
        if (content.startsWith('```json')) {
            content = content.replace(/```json\n?/g, '').replace(/```$/g, '').trim()
        } else if (content.startsWith('```')) {
            content = content.replace(/```\n?/g, '').trim()
        }

        // Log the raw content for debugging
        console.log('📄 [triggerWorkersAI] Raw response (first 500 chars):', content.substring(0, 500))

        // Clean up the content: replace literal newlines and tabs in string values
        // This is a simple approach - replace control characters that break JSON parsing
        let data: any;
        try {
            // First attempt: parse as-is
            data = JSON.parse(content)
            console.log('✅ [triggerWorkersAI] JSON parsed successfully')
        } catch (jsonError) {
            console.warn('⚠️ [triggerWorkersAI] Initial JSON parse failed, attempting cleanup. Error:', jsonError)
            // Strategy: Replace all newlines with spaces. 
            // In JSON, newlines outside strings are whitespace (safe to replace with space).
            // Newlines inside strings are invalid unless escaped. replacing them with space makes them valid.
            // HTML content in the article will still render correctly without raw newlines.
            const cleanedContent = content.replace(/[\n\r]/g, ' ')
            console.log('📄 [triggerWorkersAI] Cleaned response (first 500 chars):', cleanedContent.substring(0, 500))
            console.log('📄 [triggerWorkersAI] Cleaned response (first 500 chars):', cleanedContent.substring(0, 500))
            try {
                data = JSON.parse(cleanedContent)
                console.log('✅ [triggerWorkersAI] JSON parsed successfully after cleanup')
            } catch (secondJsonError) {
                console.error('❌ [triggerWorkersAI] JSON parse failed even after cleanup:', secondJsonError)
                console.error('❌ [triggerWorkersAI] Original content that failed parsing:', content)
                return
            }
        }

        // Generate unique slug
        let inserted = false
        let attempts = 0
        const baseSlug = `workers-${data.slug || 'ai-news'}`
        let currentSlug = baseSlug

        while (!inserted && attempts < 5) {
            try {
                console.log('💾 [triggerWorkersAI] Inserting into NewsPosts table...')
                await env.DB.prepare(`
                    INSERT INTO NewsPosts (headline, summary, key_takeaways, data_grid, sources, article_content, slug)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    `[AI] ${data.headline}`,
                    data.summary,
                    JSON.stringify(data.key_takeaways || []),
                    JSON.stringify(data.data_grid || []),
                    JSON.stringify(data.sources || []),
                    data.article_content || "",
                    currentSlug
                ).run()
                inserted = true
                console.log('✅ [triggerWorkersAI] Article created successfully!')
                console.log('✅ [triggerWorkersAI] Slug:', currentSlug)
            } catch (e: any) {
                if (e.message.includes('UNIQUE constraint failed')) {
                    attempts++
                    currentSlug = `${baseSlug}-${Math.random().toString(36).substring(2, 7)}`
                    console.log(`⚠️ [triggerWorkersAI] Slug collision, retrying with ${currentSlug}`)
                } else {
                    throw e
                }
            }
        }
    } catch (e) {
        console.error('💥 [triggerWorkersAI] EXCEPTION:', e)
        console.error('💥 [triggerWorkersAI] Error details:', JSON.stringify(e, Object.getOwnPropertyNames(e)))
    }
}

async function pollResearch(env: Env) {
    console.log('🔍 [pollResearch] Checking for pending research tasks...')
    const pending = await env.DB.prepare("SELECT * FROM PendingResearch WHERE status = 'pending'").all()
    const interactions = pending.results || []
    console.log('📊 [pollResearch] Found', interactions.length, 'pending interactions')

    const apiKey = env.GOOGLE_AI_API_KEY
    if (!apiKey) {
        console.log('⚠️ [pollResearch] No API key, skipping')
        return
    }
    if (interactions.length === 0) {
        console.log('⏭️ [pollResearch] No pending interactions, skipping')
        return
    }

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
