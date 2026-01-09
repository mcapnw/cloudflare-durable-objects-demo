import { createRoute } from 'honox/factory'
import GameCanvas from '../islands/GameCanvas'

export default createRoute(async (c) => {
    const sessionUser = c.get('user')
    const db = c.env.DB

    // Get server version
    const versionRow = await db.prepare("SELECT value FROM GameConfig WHERE key = 'version'").first<{ value: string }>()
    const serverVersion = versionRow?.value || '1.0.0'

    let dbUser = null
    if (sessionUser?.id) {
        dbUser = await db.prepare('SELECT * FROM Users WHERE id = ?').bind(sessionUser.id).first()
    }

    const coins = (dbUser as any)?.coins || 0
    const inventory = JSON.parse((dbUser as any)?.inventory || '[]')

    // Check for active realm session server-side
    let activeRealmId: string | null = null
    if (sessionUser?.id) {
        try {
            const env = c.env as any
            const globalId = env.GAMEROOM_NAMESPACE.idFromName('global-room')
            const globalStub = env.GAMEROOM_NAMESPACE.get(globalId)
            console.log('[SERVER] Fetching realm info for user:', sessionUser.id)
            const response = await globalStub.fetch(`http://internal/internal/player-realm?playerId=${sessionUser.id}`)
            console.log('[SERVER] Response status:', response.status, response.ok)
            if (response.ok) {
                const data = await response.json() as { realmId: string | null }
                activeRealmId = data.realmId
                console.log('[SERVER] Active realm check result:', activeRealmId)
            } else {
                console.error('[SERVER] Response not OK:', await response.text())
            }
        } catch (e) {
            console.error('[SERVER] Failed to check active realm:', e)
        }
    }
    console.log('[SERVER] Final activeRealmId being passed to client:', activeRealmId)

    return c.render(
        <div style="width: 100vw; height: 100vh; margin: 0; padding: 0; overflow: hidden;">
            <div id="ui-layer" style="position: fixed; top: 0; left: 0; width: 100%; pointer-events: none; z-index: 100;">
                <div style="position: absolute; top: 15px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: row; gap: 12px; align-items: flex-start; pointer-events: auto;">
                    <style>
                        {`
                        .hud-btn {
                            background: rgba(255, 255, 255, 0.1);
                            border: 2px solid #000;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 0;
                            margin: 0;
                            width: 64px;
                            height: 64px;
                            overflow: hidden;
                            border-radius: 12px;
                            outline: none;
                            transition: transform 0.1s, filter 0.1s;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                            position: relative;
                            box-sizing: border-box;
                        }
                        .hud-btn:hover { transform: translateY(-2px); filter: brightness(1.1); }
                        .hud-btn:active { transform: translateY(1px); }
                        .hud-icon { 
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            width: 95px; 
                            height: 95px; 
                            display: block; 
                            object-fit: cover;
                            pointer-events: none;
                        }
                        `}
                    </style>
                    <button id="scores-btn" class="hud-btn">
                        <img src="/static/icon_hiscores.png" class="hud-icon" alt="Scores" />
                    </button>
                    <button id="character-btn" class="hud-btn">
                        <img src="/static/icon_character.png" class="hud-icon" alt="Character" />
                    </button>
                    <button id="camera-btn" class="hud-btn">
                        <img src="/static/icon_camera.png" class="hud-icon" alt="Camera" />
                    </button>
                    <button id="inventory-btn" class="hud-btn">
                        <img src="/static/icon_inventory.png" class="hud-icon" alt="Inventory" />
                    </button>
                </div>
            </div>
            <GameCanvas
                userId={sessionUser?.id}
                firstName={sessionUser?.firstName}
                email={sessionUser?.email}
                username={(dbUser as any)?.username || sessionUser?.username}
                gender={((dbUser as any)?.gender || sessionUser?.gender) as 'male' | 'female'}
                faceIndex={(dbUser as any)?.face_index ?? sessionUser?.faceIndex}
                initialCoins={coins}
                initialInventory={inventory}
                tutorialComplete={!!(dbUser as any)?.tutorial_complete}
                activeRealmId={activeRealmId}
                serverVersion={serverVersion}
            />
        </div>,
        { title: 'Antigravity - Game' }
    )
})
