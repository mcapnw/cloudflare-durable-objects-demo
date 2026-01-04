import { createRoute } from 'honox/factory'
import GameCanvas from '../islands/GameCanvas'

export default createRoute(async (c) => {
    const sessionUser = c.get('user')
    let dbUser = null
    if (sessionUser?.id) {
        const db = c.env.DB
        dbUser = await db.prepare('SELECT * FROM Users WHERE id = ?').bind(sessionUser.id).first()
    }

    const coins = (dbUser as any)?.coins || 0
    const inventory = JSON.parse((dbUser as any)?.inventory || '[]')

    return c.render(
        <div style="width: 100vw; height: 100vh; margin: 0; padding: 0; overflow: hidden;">
            <div id="ui-layer" style="position: fixed; top: 0; left: 0; width: 100%; pointer-events: none; z-index: 100;">
                <div style="position: absolute; top: 10px; right: 10px; display: flex; flex-direction: column; gap: 12px; align-items: flex-end; pointer-events: auto;">
                    <button id="scores-btn" style="color: #000; background: rgba(255, 193, 7, 0.9); padding: 10px 16px; border-radius: 0; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 700; border: 2px solid #000; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; width: 160px;">
                        <svg width="20" height="20" viewBox="0 0 100 100" style="position: absolute; left: 12px;">
                            <rect x="10" y="70" width="80" height="20" fill="#000" stroke="white" stroke-width="2"/>
                            <rect x="25" y="50" width="50" height="20" fill="#000" stroke="white" stroke-width="2"/>
                            <rect x="40" y="30" width="20" height="20" fill="#000" stroke="white" stroke-width="2"/>
                        </svg>
                        SCORES
                    </button>
                    <button id="character-btn" style="color: white; background: rgba(59, 130, 246, 0.9); padding: 10px 16px; border-radius: 0; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 600; border: 2px solid #000; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; width: 160px;">
                        <svg width="20" height="20" viewBox="0 0 100 100" style="position: absolute; left: 12px;">
                            <circle cx="50" cy="25" r="15" fill="white"/>
                            <path d="M30,80 Q30,45 50,45 Q70,45 70,80" fill="none" stroke="white" stroke-width="8"/>
                        </svg>
                        CHARACTER
                    </button>
                    <button id="camera-btn" style="color: white; background: rgba(139, 92, 246, 0.9); padding: 10px 16px; border-radius: 0; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 600; border: 2px solid #000; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; width: 160px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 12px;">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                            <circle cx="12" cy="13" r="4"></circle>
                        </svg>
                        CAMERA
                    </button>
                    <button id="inventory-btn" style="color: white; background: rgba(160, 82, 45, 0.9); padding: 10px 16px; border-radius: 0; font-family: system-ui, sans-serif; font-size: 14px; font-weight: 600; border: 2px solid #000; cursor: pointer; display: flex; align-items: center; justify-content: center; position: relative; width: 160px;">
                        <svg width="20" height="20" viewBox="0 0 100 100" style="position: absolute; left: 12px;">
                            <path d="M 20 35 C 20 15, 80 15, 80 35 L 80 75 C 80 95, 20 95, 20 75 Z" fill="none" stroke="white" stroke-width="8"/>
                            <path d="M 35 35 L 35 25 Q 35 15, 50 15 Q 65 15, 65 25 L 65 35" fill="none" stroke="white" stroke-width="6"/>
                        </svg>
                        INVENTORY
                    </button>
                </div>
            </div>
            <GameCanvas
                userId={sessionUser?.id}
                firstName={sessionUser?.firstName}
                username={(dbUser as any)?.username || sessionUser?.username}
                gender={((dbUser as any)?.gender || sessionUser?.gender) as 'male' | 'female'}
                faceIndex={(dbUser as any)?.face_index ?? sessionUser?.faceIndex}
                initialCoins={coins}
                initialInventory={inventory}
            />
        </div>,
        { title: 'Antigravity - Game' }
    )
})
