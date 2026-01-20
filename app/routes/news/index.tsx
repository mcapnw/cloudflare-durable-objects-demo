import { createRoute } from 'honox/factory'

export default createRoute(async (c) => {
    const db = c.env.DB
    const news = await db.prepare("SELECT * FROM NewsPosts ORDER BY created_at DESC LIMIT 3").all()
    const posts = news.results || []

    return c.render(
        <div style={{
            background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
            minHeight: '100vh',
            color: 'white',
            padding: '2rem 1rem',
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
                .hero-section {
                    text-align: center;
                    margin-bottom: 4rem;
                }
                .hero-title {
                    font-size: 3.5rem;
                    font-weight: 900;
                    margin-bottom: 1rem;
                    letter-spacing: -2px;
                    background: linear-gradient(to right, #fff 0%, #888 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .hero-subtitle {
                    color: #aaa;
                    font-size: 1.2rem;
                }
                .news-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
                    gap: 2rem;
                    max-width: 1200px;
                    margin: 0 auto 4rem auto;
                }
                .news-card {
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(10px);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    padding: 2rem;
                    transition: all 0.3s ease;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    text-decoration: none;
                    color: white;
                }
                .news-card:hover {
                    transform: translateY(-5px);
                    box-shadow: 0 15px 40px rgba(0,0,0,0.3);
                    background: rgba(255, 255, 255, 0.08);
                    border-color: rgba(100, 255, 218, 0.3);
                }
                .card-date {
                    font-size: 0.8rem;
                    color: #64ffda;
                    text-transform: uppercase;
                    margin-bottom: 1rem;
                    letter-spacing: 1px;
                }
                .card-headline {
                    font-size: 1.8rem;
                    font-weight: 800;
                    margin-bottom: 1rem;
                    line-height: 1.2;
                }
                .card-summary {
                    font-size: 1rem;
                    color: #ccc;
                    line-height: 1.6;
                    margin-bottom: 1.5rem;
                    flex-grow: 1; /* Push footer down */
                }
                .card-footer {
                    margin-top: auto;
                    font-size: 0.9rem;
                    color: #64ffda;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                }
                .card-footer::after {
                    content: '→';
                    margin-left: 0.5rem;
                    transition: transform 0.2s;
                }
                .news-card:hover .card-footer::after {
                    transform: translateX(5px);
                }
                .archive-cta {
                    text-align: center;
                    margin-top: 4rem;
                }
                .archive-button {
                    display: inline-block;
                    padding: 1rem 2.5rem;
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 50px;
                    color: white;
                    text-decoration: none;
                    font-weight: 600;
                    transition: all 0.3s;
                }
                .archive-button:hover {
                    background: white;
                    color: black;
                }
            `}</style>

            <header className="hero-section">
                <h1 className="hero-title">AI Coding Insights</h1>
                <p className="hero-subtitle">Deep research on the latest trends in generative engineering</p>
            </header>

            <div className="news-grid">
                {posts.length === 0 ? (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', color: '#666', fontStyle: 'italic' }}>
                        Initializing research modules...
                    </div>
                ) : (
                    posts.map((post: any) => (
                        <a key={post.id} href={`/news/${post.slug}`} className="news-card">
                            <div className="card-date">{new Date(post.created_at).toLocaleDateString()}</div>
                            <h2 className="card-headline">{post.headline}</h2>
                            <p className="card-summary">{post.summary}</p>
                            <div className="card-footer">Read Full Report</div>
                        </a>
                    ))
                )}
            </div>

            <div className="archive-cta">
                <a href="/news/archive" className="archive-button">View All Archives</a>
            </div>
        </div>,
        { title: 'AI Coding News | Antigravity' }
    )
})
