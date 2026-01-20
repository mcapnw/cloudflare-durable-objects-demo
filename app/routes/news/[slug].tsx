import { createRoute } from 'honox/factory'

export default createRoute(async (c) => {
    const slug = c.req.param('slug')
    const db = c.env.DB
    const post = await db.prepare("SELECT * FROM NewsPosts WHERE slug = ?").bind(slug).first()

    if (!post) {
        return c.notFound()
    }

    const keyTakeaways = JSON.parse((post.key_takeaways as string) || '[]')
    const dataGrid = JSON.parse((post.data_grid as string) || '[]')
    const sources = JSON.parse((post.sources as string) || '[]')
    // Fallback to summary if no article content yet (backwards compatibility)
    const content = (post.article_content as string) || `<p>${post.summary}</p>`

    return c.render(
        <div style={{
            background: '#0f0c29',
            minHeight: '100vh',
            color: '#e0e0e0',
            fontFamily: "'Inter', sans-serif"
        }}>
            <style>{`
                html, body {
                    overflow: auto !important;
                    overflow-y: auto !important;
                    position: static !important;
                    touch-action: auto !important;
                    height: auto !important;
                    -webkit-user-select: text !important;
                    user-select: text !important;
                    overscroll-behavior: auto !important;
                }
                .article-container {
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 2rem 1.5rem 4rem;
                }
                .back-link {
                    display: inline-block;
                    margin-bottom: 2rem;
                    color: #64ffda;
                    text-decoration: none;
                    font-size: 0.9rem;
                    display: inline-flex;
                    align-items: center;
                }
                .back-link:hover { text-decoration: underline; }
                .article-header {
                    margin-bottom: 3rem;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                    padding-bottom: 2rem;
                }
                .meta {
                    color: #888;
                    font-size: 0.9rem;
                    margin-bottom: 1rem;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                .headline {
                    font-size: 3rem;
                    font-weight: 800;
                    line-height: 1.1;
                    margin: 0 0 1.5rem 0;
                    background: linear-gradient(to right, #fff, #bbb);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .content-body {
                    font-size: 1.15rem;
                    line-height: 1.8;
                    color: #ccc;
                }
                .content-body h3 {
                    color: #fff;
                    font-size: 1.5rem;
                    margin: 2.5rem 0 1rem;
                    border-left: 4px solid #64ffda;
                    padding-left: 1rem;
                }
                .content-body p { margin-bottom: 1.5rem; }
                .content-body ul { margin-bottom: 1.5rem; padding-left: 1.5rem; }
                .content-body li { margin-bottom: 0.5rem; }

                /* Sidebar / Grid styles embedded for article view */
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 1rem;
                    margin: 2rem 0;
                    background: rgba(255,255,255,0.03);
                    padding: 1.5rem;
                    border-radius: 12px;
                }
                .stat-item { text-align: center; }
                .stat-label { font-size: 0.75rem; color: #888; text-transform: uppercase; margin-bottom: 0.3rem;}
                .stat-value { font-size: 1.1rem; font-weight: 700; color: #64ffda; }

                .sources-section {
                    margin-top: 4rem;
                    padding-top: 2rem;
                    border-top: 1px solid rgba(255,255,255,0.1);
                }
                .sources-title {
                    font-size: 1rem;
                    font-weight: bold;
                    color: #888;
                    margin-bottom: 1rem;
                    text-transform: uppercase;
                }
                .source-link {
                    display: block;
                    padding: 0.5rem 0;
                    color: #888;
                    text-decoration: none;
                    transition: color 0.2s;
                    font-size: 0.9rem;
                }
                .source-link:hover { color: #64ffda; }
            `}</style>

            <div className="article-container">
                <a href="/news" className="back-link">← Back to News</a>

                <header className="article-header">
                    <div className="meta">Published on {new Date(post.created_at as string).toLocaleDateString()}</div>
                    <h1 className="headline">{post.headline}</h1>
                </header>

                {dataGrid.length > 0 && (
                    <div className="stats-grid">
                        {dataGrid.map((item: any, idx: number) => (
                            <div key={idx} className="stat-item">
                                <div className="stat-label">{item.label || item.category}</div>
                                <div className="stat-value">{item.value}</div>
                            </div>
                        ))}
                    </div>
                )}

                <div className="content-body" dangerouslySetInnerHTML={{ __html: content }} />

                {keyTakeaways.length > 0 && (
                    <div style={{ background: 'rgba(100,255,218,0.05)', padding: '2rem', borderRadius: '12px', marginTop: '3rem' }}>
                        <h3 style={{ color: '#64ffda', marginTop: 0, fontSize: '1.2rem' }}>Key Takeaways</h3>
                        <ul style={{ marginBottom: 0, paddingLeft: '1.2rem' }}>
                            {keyTakeaways.map((item: string, idx: number) => (
                                <li key={idx} style={{ color: '#ddd' }}>{item}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {sources.length > 0 && (
                    <div className="sources-section">
                        <div className="sources-title">Verified Sources</div>
                        {sources.map((src: any, idx: number) => (
                            <a key={idx} href={src.url} target="_blank" rel="noopener noreferrer" className="source-link">
                                🔗 {src.title}
                            </a>
                        ))}
                    </div>
                )}
            </div>
        </div>,
        { title: `${post.headline} | Antigravity` }
    )
})
