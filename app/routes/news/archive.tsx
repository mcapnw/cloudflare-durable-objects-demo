import { createRoute } from 'honox/factory'

export default createRoute(async (c) => {
    const db = c.env.DB
    const news = await db.prepare("SELECT * FROM NewsPosts ORDER BY created_at DESC").all()
    const posts = news.results || []

    return c.render(
        <div style={{
            background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
            minHeight: '100vh',
            color: 'white',
            padding: '2rem 1rem 4rem 1rem',
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
                .archive-container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .archive-header {
                    text-align: center;
                    margin-bottom: 3rem;
                }
                .archive-title {
                    font-size: 2.5rem;
                    font-weight: 800;
                    background: linear-gradient(to right, #fff, #bbb);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .back-link {
                    display: inline-block;
                    margin-bottom: 2rem;
                    color: #aaa;
                    text-decoration: none;
                    font-size: 0.9rem;
                    transition: color 0.2s;
                }
                .back-link:hover { color: white; }
                .archive-list {
                    list-style: none;
                    padding: 0;
                }
                .archive-item {
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 12px;
                    padding: 1.5rem;
                    margin-bottom: 1rem;
                    transition: transform 0.2s, background 0.2s;
                }
                .archive-item:hover {
                    background: rgba(255,255,255,0.1);
                    transform: translateX(5px);
                }
                .archive-item-link {
                    text-decoration: none;
                    color: inherit;
                    display: block;
                }
                .archive-date {
                    font-size: 0.8rem;
                    color: #888;
                    margin-bottom: 0.5rem;
                }
                .archive-headline {
                    font-size: 1.2rem;
                    font-weight: 700;
                    color: #64ffda;
                }
            `}</style>

            <div className="archive-container">
                <a href="/news" className="back-link">← Back to News</a>

                <header className="archive-header">
                    <h1 className="archive-title">News Archive</h1>
                </header>

                <ul className="archive-list">
                    {posts.map((post: any) => (
                        <li key={post.id} className="archive-item">
                            <a href={`/news/${post.slug}`} className="archive-item-link">
                                <div className="archive-date">{new Date(post.created_at).toLocaleDateString()}</div>
                                <div className="archive-headline">{post.headline}</div>
                            </a>
                        </li>
                    ))}
                    {posts.length === 0 && <li style={{ textAlign: 'center', color: '#666' }}>No articles found.</li>}
                </ul>
            </div>
        </div>,
        { title: 'News Archive | Antigravity' }
    )
})
