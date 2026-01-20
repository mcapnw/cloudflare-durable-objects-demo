import { useState, useEffect } from 'hono/jsx'

interface UserSummary {
    id: string
    first_name: string
    last_name: string | null
    picture: string | null
    email: string | null
}

interface UserDetails {
    id: string
    first_name: string
    email: string | null
    username: string | null
    coins: number
    weapon: string | null
    inventory: string // JSON string
    tutorial_complete: number // 0 or 1
}

interface SessionAnalytics {
    id: number
    user_id: string
    session_start: number
    session_end: number
    duration_seconds: number
    coins_start: number
    coins_end: number
    coins_earned: number
    plants_planted: number
    plants_watered: number
    plants_harvested: number
    dragon_kills: number
    deaths: number
    shots_fired: number
    items_purchased: number
    realm_joins: number
}

interface GlobalAnalytics {
    totalPlayers: number
    totalSessions: number
    totalPlaytimeSeconds: number
    totalDragonKills: number
    totalDeaths: number
    totalShotsFired: number
    totalCoinsEarned: number
    totalPlantsPlanted: number
    totalPlantsHarvested: number
    totalRealmJoins: number
    playerStats: {
        user_id: string
        first_name: string
        last_name: string | null
        picture: string | null
        total_sessions: number
        total_playtime: number
        total_dragon_kills: number
        total_deaths: number
        total_coins_earned: number
    }[]
}

export default function AdminPanel() {
    const [users, setUsers] = useState<UserSummary[]>([])
    const [selectedUserId, setSelectedUserId] = useState<string>('')
    const [currentUser, setCurrentUser] = useState<UserDetails | null>(null)
    const [analytics, setAnalytics] = useState<SessionAnalytics[]>([])
    const [globalAnalytics, setGlobalAnalytics] = useState<GlobalAnalytics | null>(null)
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')
    const [activeTab, setActiveTab] = useState<'users' | 'analytics'>('users')

    useEffect(() => {
        fetchUsers()
        fetchGlobalAnalytics()
    }, [])

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/admin/users')
            if (res.ok) {
                const data = await res.json() as { users: UserSummary[] }
                setUsers(data.users)
            }
        } catch (e) {
            console.error('Failed to fetch users', e)
        }
    }

    const fetchGlobalAnalytics = async () => {
        try {
            const res = await fetch('/api/admin/analytics')
            if (res.ok) {
                const data = await res.json() as GlobalAnalytics
                setGlobalAnalytics(data)
            }
        } catch (e) {
            console.error('Failed to fetch global analytics', e)
        }
    }

    const loadUser = async (id: string) => {
        setLoading(true)
        setSelectedUserId(id)
        setCurrentUser(null)
        setAnalytics([])
        setMessage('')
        try {
            const res = await fetch(`/api/admin/user/${id}`)
            if (res.ok) {
                const data = await res.json() as { user: UserDetails }
                setCurrentUser(data.user)

                // Fetch analytics
                const analyticsRes = await fetch(`/api/admin/user/${id}/analytics`)
                if (analyticsRes.ok) {
                    const analyticsData = await analyticsRes.json() as { sessions: SessionAnalytics[] }
                    setAnalytics(analyticsData.sessions)
                }
            } else {
                setMessage('Failed to load user')
            }
        } catch (e) {
            setMessage('Error loading user')
        } finally {
            setLoading(false)
        }
    }

    const handleUpdate = async (e: Event) => {
        e.preventDefault()
        if (!currentUser) return

        setLoading(true)
        setMessage('Saving...')

        try {
            const res = await fetch(`/api/admin/user/${currentUser.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentUser.username || null,
                    coins: Number(currentUser.coins),
                    weapon: currentUser.weapon || null,
                    inventory: currentUser.inventory,
                    tutorial_complete: Number(currentUser.tutorial_complete)
                })
            })

            if (res.ok) {
                setMessage('Saved successfully!')
            } else {
                setMessage('Failed to save')
            }
        } catch (e) {
            setMessage('Error saving user')
        } finally {
            setLoading(false)
        }
    }

    const goBack = () => {
        setCurrentUser(null)
        setAnalytics([])
        setSelectedUserId('')
        setMessage('')
        fetchUsers() // Refresh list on back
    }

    const formatDuration = (seconds: number) => {
        const hours = Math.floor(seconds / 3600)
        const mins = Math.floor((seconds % 3600) / 60)
        if (hours > 0) return `${hours}h ${mins}m`
        return `${mins}m`
    }

    return (
        <div style={{
            maxWidth: '100%',
            margin: '0 auto',
            minHeight: '100vh',
            background: '#1a1a1a',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif',
            overflowY: 'auto'
        }}>
            {/* Header */}
            <div style={{
                background: '#2a2a2a',
                padding: '16px',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                borderBottom: '1px solid #333',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
            }}>
                {currentUser && (
                    <button
                        onClick={goBack}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#fff',
                            fontSize: '24px',
                            cursor: 'pointer',
                            padding: '0 8px'
                        }}
                    >
                        ←
                    </button>
                )}
                <h1 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                    {currentUser ? 'Edit User' : 'Admin Panel'}
                </h1>
            </div>

            {/* Tab Navigation - only show when not editing a user */}
            {!currentUser && (
                <div style={{
                    display: 'flex',
                    borderBottom: '1px solid #333',
                    background: '#252525'
                }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            flex: 1,
                            padding: '14px',
                            background: 'transparent',
                            border: 'none',
                            color: activeTab === 'users' ? '#4CAF50' : '#888',
                            fontWeight: activeTab === 'users' ? '600' : '400',
                            borderBottom: activeTab === 'users' ? '2px solid #4CAF50' : '2px solid transparent',
                            cursor: 'pointer',
                            fontSize: '14px'
                        }}
                    >
                        Players
                    </button>
                    <button
                        onClick={() => setActiveTab('analytics')}
                        style={{
                            flex: 1,
                            padding: '14px',
                            background: 'transparent',
                            border: 'none',
                            color: activeTab === 'analytics' ? '#4CAF50' : '#888',
                            fontWeight: activeTab === 'analytics' ? '600' : '400',
                            borderBottom: activeTab === 'analytics' ? '2px solid #4CAF50' : '2px solid transparent',
                            cursor: 'pointer',
                            fontSize: '14px'
                        }}
                    >
                        Analytics
                    </button>
                </div>
            )}

            <div style={{ padding: '16px' }}>
                {loading && <div style={{ textAlign: 'center', padding: '20px', opacity: 0.7 }}>Loading...</div>}

                {/* Analytics Tab */}
                {!currentUser && !loading && activeTab === 'analytics' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {/* Global Stats Summary */}
                        {globalAnalytics && (
                            <>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: '12px'
                                }}>
                                    <div style={{ background: '#333', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#4CAF50' }}>{globalAnalytics.totalPlayers}</div>
                                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Total Players</div>
                                    </div>
                                    <div style={{ background: '#333', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#2196F3' }}>{globalAnalytics.totalSessions}</div>
                                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Total Sessions</div>
                                    </div>
                                    <div style={{ background: '#333', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#FF9800' }}>{formatDuration(globalAnalytics.totalPlaytimeSeconds)}</div>
                                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Total Playtime</div>
                                    </div>
                                    <div style={{ background: '#333', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#f44336' }}>{globalAnalytics.totalDragonKills}</div>
                                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Dragon Kills</div>
                                    </div>
                                    <div style={{ background: '#333', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#FFD700' }}>{globalAnalytics.totalCoinsEarned}</div>
                                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Coins Earned</div>
                                    </div>
                                    <div style={{ background: '#333', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
                                        <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#9C27B0' }}>{globalAnalytics.totalRealmJoins}</div>
                                        <div style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>Realm Joins</div>
                                    </div>
                                </div>

                                {/* Player Leaderboard */}
                                <div>
                                    <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px', color: '#ccc' }}>Player Leaderboard</h2>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {globalAnalytics.playerStats.map((player, index) => (
                                            <div
                                                key={player.user_id}
                                                onClick={() => loadUser(player.user_id)}
                                                style={{
                                                    background: '#333',
                                                    borderRadius: '12px',
                                                    padding: '12px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '12px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                <div style={{
                                                    width: '24px',
                                                    height: '24px',
                                                    borderRadius: '50%',
                                                    background: index === 0 ? '#FFD700' : index === 1 ? '#C0C0C0' : index === 2 ? '#CD7F32' : '#555',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: '12px',
                                                    fontWeight: 'bold',
                                                    color: index < 3 ? '#000' : '#fff'
                                                }}>
                                                    {index + 1}
                                                </div>
                                                <img
                                                    src={player.picture || 'https://via.placeholder.com/36'}
                                                    alt=""
                                                    style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }}
                                                />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontWeight: '600', fontSize: '14px' }}>
                                                        {player.first_name} {player.last_name}
                                                    </div>
                                                    <div style={{ fontSize: '12px', color: '#888' }}>
                                                        {player.total_sessions} sessions • {formatDuration(player.total_playtime)}
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#f44336' }}>{player.total_dragon_kills} 🐉</div>
                                                    <div style={{ fontSize: '12px', color: '#FFD700' }}>+{player.total_coins_earned} coins</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )}
                        {!globalAnalytics && <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>Loading analytics...</div>}
                    </div>
                )}

                {/* User List Mode */}
                {!currentUser && !loading && activeTab === 'users' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {users.map(u => (
                            <div
                                key={u.id}
                                onClick={() => loadUser(u.id)}
                                style={{
                                    background: '#333',
                                    borderRadius: '12px',
                                    padding: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '16px',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s'
                                }}
                            >
                                <img
                                    src={u.picture || 'https://via.placeholder.com/48'}
                                    alt="Profile"
                                    style={{
                                        width: '48px',
                                        height: '48px',
                                        borderRadius: '50%',
                                        objectFit: 'cover',
                                        background: '#444'
                                    }}
                                />
                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                    <div style={{ fontWeight: '600', fontSize: '16px', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {u.first_name} {u.last_name}
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {u.email}
                                    </div>
                                </div>
                                <div style={{ color: '#555', fontSize: '20px' }}>›</div>
                            </div>
                        ))}
                        {users.length === 0 && <div style={{ textAlign: 'center', padding: '40px', color: '#666' }}>No users found</div>}
                    </div>
                )}

                {/* Edit User Mode */}
                {currentUser && !loading && (
                    <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px', margin: '0 auto' }}>

                        {/* User Identity Card */}
                        <div style={{ background: '#333', borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
                            <div style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>USER ID: {currentUser.id}</div>
                            <div style={{ fontSize: '20px', fontWeight: 'bold' }}>{currentUser.first_name}</div>
                            <div style={{ color: '#aaa' }}>{currentUser.email}</div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#ccc' }}>In-Game Username</label>
                                <input
                                    type="text"
                                    style={{ width: '100%', padding: '12px', background: '#252525', border: '1px solid #444', borderRadius: '8px', color: 'white', boxSizing: 'border-box' }}
                                    value={currentUser.username || ''}
                                    onChange={(e) => setCurrentUser({ ...currentUser, username: (e.target as HTMLInputElement).value })}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#ccc' }}>Coins</label>
                                <input
                                    type="number"
                                    style={{ width: '100%', padding: '12px', background: '#252525', border: '1px solid #444', borderRadius: '8px', color: 'white', boxSizing: 'border-box' }}
                                    value={currentUser.coins}
                                    onChange={(e) => setCurrentUser({ ...currentUser, coins: parseInt((e.target as HTMLInputElement).value) })}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#ccc' }}>Weapon</label>
                                <select
                                    style={{ width: '100%', padding: '12px', background: '#252525', border: '1px solid #444', borderRadius: '8px', color: 'white', boxSizing: 'border-box', appearance: 'none' }}
                                    value={currentUser.weapon ?? ''}
                                    onChange={(e) => setCurrentUser({ ...currentUser, weapon: (e.target as HTMLSelectElement).value || null })}
                                >
                                    <option value="">NULL</option>
                                    <option value="staff_beginner">staff_beginner</option>
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#ccc' }}>Tutorial Complete (0/1)</label>
                                <input
                                    type="number"
                                    min="0" max="1"
                                    style={{ width: '100%', padding: '12px', background: '#252525', border: '1px solid #444', borderRadius: '8px', color: 'white', boxSizing: 'border-box' }}
                                    value={currentUser.tutorial_complete}
                                    onChange={(e) => setCurrentUser({ ...currentUser, tutorial_complete: parseInt((e.target as HTMLInputElement).value) })}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: '#ccc' }}>Inventory (JSON)</label>
                                <textarea
                                    style={{ width: '100%', height: '100px', padding: '12px', background: '#252525', border: '1px solid #444', borderRadius: '8px', color: 'white', fontFamily: 'monospace', boxSizing: 'border-box' }}
                                    value={currentUser.inventory}
                                    onChange={(e) => setCurrentUser({ ...currentUser, inventory: (e.target as HTMLTextAreaElement).value })}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            style={{
                                padding: '16px',
                                background: '#4CAF50',
                                color: 'white',
                                border: 'none',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                marginTop: '10px'
                            }}
                        >
                            Save Changes
                        </button>

                        {message && <div style={{
                            padding: '12px',
                            borderRadius: '8px',
                            background: message.includes('success') ? 'rgba(46, 125, 50, 0.2)' : 'rgba(198, 40, 40, 0.2)',
                            color: message.includes('success') ? '#81c784' : '#ef9a9a',
                            textAlign: 'center'
                        }}>
                            {message}
                        </div>}

                        {/* Analytics Section - Aggregate Stats */}
                        <div style={{ marginTop: '40px', borderTop: '1px solid #444', paddingTop: '30px', paddingBottom: '40px' }}>
                            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', color: '#fff' }}>Player Statistics</h2>

                            {analytics.length === 0 && (
                                <div style={{ textAlign: 'center', padding: '30px', color: '#666' }}>
                                    No sessions recorded yet
                                </div>
                            )}

                            {analytics.length > 0 && (() => {
                                // Calculate aggregate stats
                                const totalSessions = analytics.length
                                const totalPlaytime = analytics.reduce((sum, s) => sum + s.duration_seconds, 0)
                                const totalCoinsEarned = analytics.reduce((sum, s) => sum + s.coins_earned, 0)
                                const totalDragonKills = analytics.reduce((sum, s) => sum + s.dragon_kills, 0)
                                const totalDeaths = analytics.reduce((sum, s) => sum + s.deaths, 0)
                                const totalShotsFired = analytics.reduce((sum, s) => sum + s.shots_fired, 0)
                                const totalPlanted = analytics.reduce((sum, s) => sum + s.plants_planted, 0)
                                const totalWatered = analytics.reduce((sum, s) => sum + s.plants_watered, 0)
                                const totalHarvested = analytics.reduce((sum, s) => sum + s.plants_harvested, 0)
                                const totalRealmJoins = analytics.reduce((sum, s) => sum + s.realm_joins, 0)
                                const totalPurchases = analytics.reduce((sum, s) => sum + s.items_purchased, 0)

                                const avgPlaytimePerSession = totalSessions > 0 ? Math.floor(totalPlaytime / totalSessions) : 0
                                const avgCoinsPerSession = totalSessions > 0 ? Math.floor(totalCoinsEarned / totalSessions) : 0

                                // Get last session date
                                const sortedSessions = [...analytics].sort((a, b) => b.session_end - a.session_end)
                                const lastSession = sortedSessions[0]
                                const lastSessionDate = lastSession ? new Date(lastSession.session_end).toLocaleDateString() : 'N/A'

                                const formatTime = (seconds: number) => {
                                    const hours = Math.floor(seconds / 3600)
                                    const mins = Math.floor((seconds % 3600) / 60)
                                    if (hours > 0) return `${hours}h ${mins}m`
                                    return `${mins}m`
                                }

                                // Simple bar component
                                const StatBar = ({ value, max, color, label }: { value: number, max: number, color: string, label: string }) => (
                                    <div style={{ marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                            <span style={{ fontSize: '13px', color: '#aaa' }}>{label}</span>
                                            <span style={{ fontSize: '14px', fontWeight: '600', color }}>{value}</span>
                                        </div>
                                        <div style={{ height: '8px', background: '#333', borderRadius: '4px', overflow: 'hidden' }}>
                                            <div style={{
                                                height: '100%',
                                                width: `${Math.min(100, (value / Math.max(max, 1)) * 100)}%`,
                                                background: color,
                                                borderRadius: '4px',
                                                transition: 'width 0.3s ease'
                                            }} />
                                        </div>
                                    </div>
                                )

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                        {/* Summary Card */}
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(3, 1fr)',
                                            gap: '8px',
                                            background: '#2a2a2a',
                                            borderRadius: '12px',
                                            padding: '16px'
                                        }}>
                                            <div style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#4CAF50' }}>{totalSessions}</div>
                                                <div style={{ fontSize: '11px', color: '#888' }}>Sessions</div>
                                            </div>
                                            <div style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FF9800' }}>{formatTime(totalPlaytime)}</div>
                                                <div style={{ fontSize: '11px', color: '#888' }}>Total Time</div>
                                            </div>
                                            <div style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#FFD700' }}>{totalCoinsEarned}</div>
                                                <div style={{ fontSize: '11px', color: '#888' }}>Coins</div>
                                            </div>
                                        </div>

                                        {/* Stats Bars */}
                                        <div style={{ background: '#2a2a2a', borderRadius: '12px', padding: '16px' }}>
                                            <StatBar value={totalDragonKills} max={50} color="#f44336" label="🐉 Dragon Kills" />
                                            <StatBar value={totalDeaths} max={100} color="#9C27B0" label="💀 Deaths" />
                                            <StatBar value={totalShotsFired} max={500} color="#2196F3" label="🔫 Shots Fired" />
                                            <StatBar value={totalRealmJoins} max={20} color="#E91E63" label="🌀 Realm Joins" />
                                        </div>

                                        {/* Farming Stats */}
                                        <div style={{ background: '#2a2a2a', borderRadius: '12px', padding: '16px' }}>
                                            <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px', color: '#ccc' }}>🌱 Farming Activity</div>
                                            <StatBar value={totalPlanted} max={100} color="#8BC34A" label="Planted" />
                                            <StatBar value={totalWatered} max={100} color="#03A9F4" label="Watered" />
                                            <StatBar value={totalHarvested} max={100} color="#FF9800" label="Harvested" />
                                        </div>

                                        {/* Additional Info */}
                                        <div style={{
                                            background: '#2a2a2a',
                                            borderRadius: '12px',
                                            padding: '16px',
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 1fr',
                                            gap: '12px',
                                            fontSize: '13px'
                                        }}>
                                            <div>
                                                <div style={{ color: '#888' }}>Avg. Session</div>
                                                <div style={{ fontWeight: '600', color: '#fff' }}>{formatTime(avgPlaytimePerSession)}</div>
                                            </div>
                                            <div>
                                                <div style={{ color: '#888' }}>Avg. Coins/Session</div>
                                                <div style={{ fontWeight: '600', color: '#FFD700' }}>{avgCoinsPerSession}</div>
                                            </div>
                                            <div>
                                                <div style={{ color: '#888' }}>Items Purchased</div>
                                                <div style={{ fontWeight: '600', color: '#fff' }}>{totalPurchases}</div>
                                            </div>
                                            <div>
                                                <div style={{ color: '#888' }}>Last Played</div>
                                                <div style={{ fontWeight: '600', color: '#fff' }}>{lastSessionDate}</div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
