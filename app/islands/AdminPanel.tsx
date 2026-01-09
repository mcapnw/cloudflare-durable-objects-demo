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

export default function AdminPanel() {
    const [users, setUsers] = useState<UserSummary[]>([])
    const [selectedUserId, setSelectedUserId] = useState<string>('')
    const [currentUser, setCurrentUser] = useState<UserDetails | null>(null)
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')

    useEffect(() => {
        fetchUsers()
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

    const loadUser = async (id: string) => {
        setLoading(true)
        setSelectedUserId(id)
        setCurrentUser(null)
        setMessage('')
        try {
            const res = await fetch(`/api/admin/user/${id}`)
            if (res.ok) {
                const data = await res.json() as { user: UserDetails }
                setCurrentUser(data.user)
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
        setSelectedUserId('')
        setMessage('')
        fetchUsers() // Refresh list on back
    }

    return (
        <div style={{
            maxWidth: '100%',
            margin: '0 auto',
            minHeight: '100vh',
            background: '#1a1a1a',
            color: '#fff',
            fontFamily: 'system-ui, sans-serif'
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
                    {currentUser ? 'Edit User' : 'Player Administration'}
                </h1>
            </div>

            <div style={{ padding: '16px' }}>
                {loading && <div style={{ textAlign: 'center', padding: '20px', opacity: 0.7 }}>Loading...</div>}

                {/* User List Mode */}
                {!currentUser && !loading && (
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
                    </form>
                )}
            </div>
        </div>
    )
}
