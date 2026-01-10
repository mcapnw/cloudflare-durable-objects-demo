import { useEffect, useRef } from 'hono/jsx'
import * as Types from './types'
import * as Constants from './constants'
import * as Utils from './utils'
import * as MeshFactories from './meshFactories'
import * as UIGenerators from './uiGenerators'
import * as LobbyManager from './lobbyManager'
import * as RealmManager from './realmManager'
import * as SelectionCard from './selectionCard'
import { FarmingUI } from './farmingUI'
import { FishingUI } from './fishingUI'

export default function GameCanvas({ userId, firstName, username, email, gender, faceIndex, initialCoins, initialInventory, tutorialComplete, activeRealmId, serverVersion }: Types.GameCanvasProps & { activeRealmId?: string | null }) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current) return
        Promise.all([
            import('three'),
            import('three/examples/jsm/loaders/GLTFLoader.js'),
            import('three/examples/jsm/utils/SkeletonUtils.js')
        ]).then(([THREE, { GLTFLoader }, SkeletonUtils]) => {
            initGame(THREE, { GLTFLoader, SkeletonUtils }, containerRef.current!, userId || 'anonymous', firstName || 'Player', email, username, gender, faceIndex, initialCoins, initialInventory, tutorialComplete, activeRealmId, serverVersion)
        })
    }, [])

    return (
        <div ref={containerRef} id="game-container" style="width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; touch-action: none;"></div>
    )
}

function initGame(THREE: any, LOADERS: { GLTFLoader: any, SkeletonUtils: any }, container: HTMLElement, myUserId: string, myFirstName: string, myEmail?: string, initialUsername?: string, initialGender?: 'male' | 'female', initialFaceIndex?: number, initialCoins: number = 0, initialInventory: string[] = [], tutorialComplete: boolean = false, initialActiveRealmId?: string | null, serverVersion?: string) {
    const ADMIN_EMAIL = 'mcapnw@gmail.com'
    const isAdmin = myEmail === ADMIN_EMAIL

    // Initialize Factories
    MeshFactories.initFactories(THREE, LOADERS.SkeletonUtils);


    const { GLTFLoader, SkeletonUtils } = LOADERS
    const textureLoader = new THREE.TextureLoader()
    const gltfLoader = new GLTFLoader()

    // State Variables (Moved to top to avoid ReferenceError/TDZ issues)
    const players = new Map<string, Types.PlayerData>()
    const pickups = new Map<string, Types.PickupData>()
    let dragon: Types.DragonData | null = null
    const sheeps = new Map<string, Types.SheepData>()
    let globalPickupIndicator: any = null
    let coins = initialCoins
    let inventory = initialInventory
    let farmPlotsState: any[] = []
    let pondsState: any[] = []
    let pondIndicators: any[] = []

    let currentRoomId = initialActiveRealmId || null
    let isInRealm = !!initialActiveRealmId
    let lobbyState: LobbyManager.LobbyState | null = null
    let realmState: RealmManager.RealmState | null = null

    // Restore essential state variables
    let realmWaitModal: HTMLDivElement | null = null
    let isWaitingForRealm = false
    let realmPlayers: any[] = []
    let realmTime = 0
    let realmTimerLabel: any = null
    const farmPlotWheat: (any | null)[] = new Array(9).fill(null)

    // UI state variables
    let isModalOpen = false
    let isInventoryOpen = false
    let isShopOpen = false
    let isScoreboardOpen = false
    let isCharacterCustomizing = !initialActiveRealmId



    let myPlayerId: string | null = null
    let myX = 0
    let myZ = 0
    let myRotation = 0
    let myIsDead = false

    let lastAnimateTime = Date.now()
    let lastModalCloseTime = 0
    let lastFireTime = 0

    const activeTouches = new Map<number, Types.TouchState>()
    let joystickDeltaX = 0
    let joystickDeltaY = 0

    let currentMode: 'game' | 'character' | 'spectate' | 'congratulations' | 'front_camera' = initialActiveRealmId ? 'game' : 'character'
    let tempFaceOverride: string | null = null
    let myUsername = initialUsername || ''
    let myGender: 'male' | 'female' = initialGender || 'male'
    let tutorialStarted = tutorialComplete

    let ws: WebSocket | null = null
    let wsConnected = false

    let isVersionMismatch = false
    let versionInterval: any = null
    async function checkVersion() {
        try {
            const resp = await fetch('/api/version')
            const data = (await resp.json()) as { version?: string }
            if (data.version && data.version !== Constants.CLIENT_VERSION) {
                isVersionMismatch = true
                if (versionInterval) clearInterval(versionInterval)
                UIGenerators.showUpdateOverlay(data.version)
            }
        } catch (err) {
            console.error('Failed to check version:', err)
        }
    }

    // interaction buttons
    const interactBtn = document.createElement('button')
    interactBtn.id = 'interact-btn'
    interactBtn.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, calc(-50% - 60px));
        padding: 10px 24px; background: #A7F3D0; border: 2px solid black;
        border-radius: 999px; color: black; font-weight: bold; cursor: pointer;
        display: none; z-index: 50; font-size: 16px; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.2);
        pointer-events: auto;
        font-family: system-ui, sans-serif;
        text-transform: uppercase;
    `
    document.body.appendChild(interactBtn)

    // Initialize Farming UI
    const farmingUI = new FarmingUI({
        interactBtn,
        onSendMessage: (msg) => {
            if (wsConnected && ws) {
                ws.send(JSON.stringify(msg))
            }
        },
        setJoystickVisible: (visible: boolean) => {
            // Access the joystick container which is created further down
            const jContainer = document.getElementById('joystick-container')
            if (jContainer) jContainer.style.display = visible ? 'block' : 'none'
        }
    })

    let fishingUI: FishingUI

    // Scene Modes
    let spectateRotationOffset = 0
    let currentCountdownLabel: any = null

    // WebSocket vars
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/game`



    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87ceeb)

    globalPickupIndicator = MeshFactories.createGlobalIndicatorMesh()
    globalPickupIndicator.visible = false
    scene.add(globalPickupIndicator)

    // Scoreboard UI
    const scoreModal = document.createElement('div')
    scoreModal.id = 'score-modal'
    scoreModal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 24px;
        border-radius: 16px;
        width: 80%;
        max-width: 400px;
        font-family: system-ui, sans-serif;
        z-index: 100;
        display: none;
        border: 2px solid #FFD54F;
        box-shadow: 0 0 20px rgba(0,0,0,0.8);
        overflow-y: auto;
        max-height: 80vh;
    `
    document.body.appendChild(scoreModal)

    document.body.appendChild(scoreModal)

    // Dragon Damage List UI
    const damageListEl = document.createElement('div')
    damageListEl.id = 'dragon-damage-list'
    damageListEl.style.cssText = `
        position: fixed;
        top: 100px;
        left: 20px;
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 10px;
        border-radius: 8px;
        font-family: system-ui, sans-serif;
        font-size: 14px;
        z-index: 90;
        display: none;
        pointer-events: none;
        min-width: 150px;
        border: 1px solid rgba(255, 213, 79, 0.3);
    `
    document.body.appendChild(damageListEl)

    // Congratulations Modal UI
    const congratsModal = document.createElement('div')
    congratsModal.id = 'congrats-modal'
    congratsModal.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 24px;
        border-radius: 24px;
        width: 90%;
        max-width: 400px;
        font-family: 'Outfit', 'Inter', system-ui, sans-serif;
        z-index: 1000;
        display: none;
        border: 3px solid #FFD54F;
        box-shadow: 0 0 30px rgba(255, 213, 79, 0.3);
        text-align: center;
        backdrop-filter: blur(8px);
    `
    congratsModal.innerHTML = `
        <h1 style="margin-top:0; color: #FFD54F; font-size: 24px; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">Congratulations!</h1>
        <p style="font-size: 16px; margin: 12px 0; line-height: 1.4; color: #FFF;">You earned the <span style="color: #4CAF50; font-weight: bold; font-size: 18px;">Beginner's Staff</span></p>
        <button id="accept-congrats-btn" style="
            background: #FFD54F;
            color: #000;
            border: none;
            padding: 10px 32px;
            font-size: 16px;
            font-weight: 800;
            border-radius: 999px;
            cursor: pointer;
            transition: transform 0.2s, background 0.2s;
            text-transform: uppercase;
            margin-top: 8px;
        ">Accept</button>
    `
    document.body.appendChild(congratsModal)

    const acceptCongratsBtn = congratsModal.querySelector('#accept-congrats-btn') as HTMLButtonElement
    if (acceptCongratsBtn) {
        acceptCongratsBtn.addEventListener('mouseenter', () => { acceptCongratsBtn.style.background = '#FFCA28'; acceptCongratsBtn.style.transform = 'scale(1.05)' })
        acceptCongratsBtn.addEventListener('mouseleave', () => { acceptCongratsBtn.style.background = '#FFD54F'; acceptCongratsBtn.style.transform = 'scale(1)' })
        acceptCongratsBtn.addEventListener('click', () => {
            currentMode = 'game'
            tempFaceOverride = null
            updateCharacterFace()
            congratsModal.style.display = 'none'
            updateUIVisibility()
        })
    }

    function updateDamageList(list: { name: string, damage: number }[]) {
        if (!list || list.length === 0) {
            damageListEl.innerHTML = ''
            damageListEl.style.display = 'none'
            return
        }
        const sorted = [...list].sort((a, b) => b.damage - a.damage)
        const html = sorted.map(p => `
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span style="font-weight:bold; margin-right: 10px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${Utils.escapeHtml(p.name)}</span>
                <span style="color: #FFD54F;">${p.damage}</span>
            </div>
        `).join('')
        damageListEl.innerHTML = `
            <div style="color: #EF5350; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px;">Dragon Damage</div>
            ${html}
        `
        updateUIVisibility()
    }

    const closeScoreModal = (e: any) => {
        if (scoreModal.style.display === 'block' && !scoreModal.contains(e.target as Node)) {
            const btn = document.getElementById('scores-btn')
            if (btn && !btn.contains(e.target as Node)) {
                scoreModal.style.display = 'none'
                lastModalCloseTime = Date.now()
                updateUIVisibility()
            }
        }
    }
    document.addEventListener('mousedown', closeScoreModal)
    document.addEventListener('touchstart', closeScoreModal)

    const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500)
    camera.position.set(0, 8, 12)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.4
    container.appendChild(renderer.domElement)

    // Global Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
    scene.add(ambientLight)
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3a5a40, 1.5)
    hemiLight.position.set(0, 50, 0)
    scene.add(hemiLight)
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2)
    dirLight1.position.set(10, 20, 10)
    scene.add(dirLight1)
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.9)
    dirLight2.position.set(-10, 20, -10)
    scene.add(dirLight2)

    // Ground
    const groundGeo = new THREE.PlaneGeometry(50, 50)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a5a40 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    const gridHelper = new THREE.GridHelper(50, 25, 0x588157, 0x588157)
    gridHelper.position.y = 0.01
    scene.add(gridHelper)

    // Boundary walls
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4033, transparent: true, opacity: 0.7 })
    const wallHeight = 0.5
    const wallThickness = 0.3
    const wallGeo = new THREE.BoxGeometry(50, wallHeight, wallThickness)
    const wallGeoSide = new THREE.BoxGeometry(wallThickness, wallHeight, 50)
    const wallN = new THREE.Mesh(wallGeo, wallMaterial); wallN.position.set(0, wallHeight / 2, -25); scene.add(wallN)
    const wallS = new THREE.Mesh(wallGeo, wallMaterial); wallS.position.set(0, wallHeight / 2, 25); scene.add(wallS)
    const wallE = new THREE.Mesh(wallGeoSide, wallMaterial); wallE.position.set(25, wallHeight / 2, 0); scene.add(wallE)
    const wallW = new THREE.Mesh(wallGeoSide, wallMaterial); wallW.position.set(-25, wallHeight / 2, 0); scene.add(wallW)

    function switchToScene(type: 'lobby' | 'realm') {
        if (type === 'realm') {
            if (lobbyState) {
                LobbyManager.cleanupLobby(scene, lobbyState)
                lobbyState = null
                sheeps.forEach(s => {
                    if (s.mesh) scene.remove(s.mesh)
                    if (s.label) scene.remove(s.label)
                })
                sheeps.clear()
            }
            // Hide dragon when entering realm
            if (dragon) {
                if (dragon.mesh) dragon.mesh.visible = false
                if (dragon.labelGroup) dragon.labelGroup.visible = false
            }
            if (!realmState) {
                realmState = RealmManager.setupRealm(scene, THREE)
                isInRealm = true
            }
        } else {
            if (realmState) {
                RealmManager.cleanupRealm(scene, THREE)
                realmState = null
            }
            // Restore dragon visibility when returning to lobby
            if (dragon && !dragon.isDead) {
                if (dragon.mesh) dragon.mesh.visible = true
                if (dragon.labelGroup) dragon.labelGroup.visible = true
            }
            if (!lobbyState) {
                lobbyState = LobbyManager.setupLobby(scene, THREE, textureLoader, MeshFactories, UIGenerators)
                isInRealm = false
            }
        }
        updateUIVisibility()
    }



    // CHARACTER SCENE
    const charScene = new THREE.Scene()
    charScene.background = new THREE.Color(0x222222)
    const charCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)

    function updateCharCamera() {
        const isMobile = window.innerWidth <= 768
        // Mobile: Shift view up (camera down) and zoom out slightly
        const targetY = isMobile ? -1.2 : 0
        const targetZ = isMobile ? 9.0 : 7
        charCamera.position.set(0, targetY, targetZ)
        charCamera.lookAt(0, targetY, 0)
    }
    updateCharCamera()
    const charAmbient = new THREE.AmbientLight(0xffffff, 1.8)
    charScene.add(charAmbient)
    const charHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.8)
    charScene.add(charHemi)
    const charFill1 = new THREE.DirectionalLight(0xffffff, 1.5)
    charFill1.position.set(5, 5, 5)
    charScene.add(charFill1)
    const charFill2 = new THREE.DirectionalLight(0xffffff, 1.0)
    charFill2.position.set(-5, 5, -5)
    charScene.add(charFill2)

    let charModel: any = null
    let charMixer: any = null
    let currentFaceIndex = (initialFaceIndex !== undefined) ? initialFaceIndex : 0
    let charGender: 'male' | 'female' = initialGender || 'male'
    myGender = charGender
    let isDraggingChar = false
    let previousMouseX = 0
    let charRotation = 0

    MeshFactories.loadCharacterModel(gltfLoader, () => {
        charModel = SkeletonUtils.clone(MeshFactories.baseCharModel)
        charScene.add(charModel)
        charModel.position.y = -1.0
        charModel.scale.set(0.525, 0.525, 0.525)

        const showParts = ['head', 'head_1', 'hands', 'pants', 'shirt', 'shoes', 'hair_short']
        charModel.traverse((child: any) => {
            if (showParts.includes(child.name)) child.visible = true
        })

        if (MeshFactories.baseAnimations && MeshFactories.baseAnimations.length > 0) {
            charMixer = new THREE.AnimationMixer(charModel)
            const clip = THREE.AnimationClip.findByName(MeshFactories.baseAnimations, 'character_selection') || MeshFactories.baseAnimations[0]
            if (clip) {
                const action = charMixer.clipAction(clip)
                action.play()
            }
        }
        updateCharacterFace()
        updateCharacterGender()
    })

    function updateCharacterFace() {
        const faceName = tempFaceOverride || MeshFactories.charFaces[currentFaceIndex]
        const texture = MeshFactories.loadedTextures.get(faceName)
        if (!texture) return

        if (charModel) {
            charModel.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    if (child.name === 'custom_head_mesh' || child.material.name === 'full_face.001' || child.name === 'head' || child.name === 'head_1') {
                        child.material.map = texture
                        child.material.needsUpdate = true
                        child.material.color.setHex(0xffffff)
                        child.frustumCulled = false
                    }
                }
            })
        }

        if (myPlayerId) {
            const p = players.get(myPlayerId)
            if (p && p.mesh) {
                p.mesh.traverse((child: any) => {
                    if (child.isMesh && child.material) {
                        if (child.name === 'custom_head_mesh' || child.material.name === 'full_face.001' || child.name === 'head' || child.name === 'head_1') {
                            child.material.map = texture
                            child.material.needsUpdate = true
                            child.material.color.setHex(0xffffff)
                            child.frustumCulled = false
                        }
                    }
                })
            }
        }
    }

    function updateCharacterGender() {
        if (!charModel) return
        charModel.traverse((child: any) => {
            if (child.name === 'hair_short') child.visible = (charGender === 'male')
            if (child.name === 'hair_long') child.visible = (charGender === 'female')
            if (child.name === 'shirt' && child.material) {
                child.material.map = (charGender === 'male') ? MeshFactories.shirtTextures.male : MeshFactories.shirtTextures.female
                child.material.needsUpdate = true
            }
        })
    }

    const reconnectOverlay = document.createElement('div')
    reconnectOverlay.id = 'reconnect-overlay'
    reconnectOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.7); color: white; display: none;
        flex-direction: column; justify-content: center; align-items: center;
        z-index: 9999; font-family: system-ui, sans-serif; pointer-events: auto;
    `
    const reconnectText = document.createElement('div')
    reconnectText.style.cssText = 'font-size: 24px; font-weight: bold; color: #FFD54F; text-align: center; padding: 0 40px; max-width: 600px;'
    reconnectOverlay.appendChild(reconnectText)
    document.body.appendChild(reconnectOverlay)

    function clearRealmAssets() {
        console.log('[Cleanup] Clearing Realm assets (Ponds)...')
        pondsState = []
        pondIndicators.forEach(p => scene.remove(p))
        pondIndicators = []
    }

    function connectWebSocket(isInitial: boolean = false) {
        if (isVersionMismatch) return
        if (currentMode === 'character') return
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

        reconnectText.innerText = isInitial ? 'Connecting...' : 'Attempting to re-establish connection...'
        reconnectOverlay.style.display = 'flex'

        const params = new URLSearchParams()
        params.append('id', myUserId)
        params.append('faceIndex', currentFaceIndex.toString())
        params.append('gender', charGender)
        params.append('username', myUsername || '')
        params.append('firstName', myFirstName || '')
        if (currentRoomId) params.append('room', currentRoomId)

        ws = new WebSocket(`${wsUrl}?${params.toString()}`)

        ws.onopen = () => {
            wsConnected = true
            console.log('WebSocket connected')
            reconnectOverlay.style.display = 'none'
            checkVersion()

            // If we are connecting (and it's not a reconnect to an active room), assume Lobby logic might apply first.
            // But 'welcome' will confirm.

            // Query if player has an active realm session
            if (!currentRoomId && ws) {
                ws.send(JSON.stringify({ type: 'get_player_realm' }))
            }
        }
        ws.onclose = () => {
            wsConnected = false
            reconnectText.innerText = 'Attempting to re-establish connection...'
            reconnectOverlay.style.display = 'flex'
            setTimeout(() => connectWebSocket(false), 2000)
        }
        ws.onerror = (error) => {
            console.error('WebSocket error:', error)
            reconnectText.innerText = 'Attempting to re-establish connection...'
            reconnectOverlay.style.display = 'flex'
        }
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data)
            if (data.type === 'scores') {
                // ... (scores logic same as before)
                const list = data.scores.map((s: any, i: number) => {
                    const displayName = (s.username && s.username !== 'null' && s.username.trim() !== '') ? s.username : (s.first_name || 'Anonymous')
                    return `
                    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                        <span>${i + 1}. ${Utils.escapeHtml(displayName)}</span>
                        <span style="color:#FFD54F;font-weight:bold;">${s.dragon_kills} Kills | ${s.deaths || 0} Deaths</span>
                    </div>
                `}).join('')
                scoreModal.innerHTML = `
                    <h2 style="margin-top:0;text-align:center;color:#FFD54F;">Dragon Slayers</h2>
                    <div style="margin-top:16px;">
                        ${list.length > 0 ? list : '<div style="text-align:center;opacity:0.7;">No kills yet...</div>'}
                    </div>
                    <div style="text-align:center;margin-top:24px;font-size:12px;opacity:0.5;">Click outside to close</div>
                `
            } else if (data.type === 'buy_success') {
                coins = data.coins
                inventory = data.inventory
                updateEconomicUI()
            } else if (data.type === 'inventory_update') {
                inventory = data.inventory
                updateEconomicUI()
            } else if (data.type === 'coins_earned') {
                coins += data.amount
                updateEconomicUI()
            } else if (data.type === 'farm_update') {
                updateFarmPlots(data.farmPlots)
            } else if (data.type === 'welcome') {
                if (data.activeRealm) {
                    console.log('Active realm found, redirecting...', data.activeRealm)
                    currentRoomId = data.activeRealm
                    isInRealm = true
                    currentMode = 'game' // Bypass character screen
                    updateUIVisibility()
                    if (ws) ws.close()
                    ws = null
                    wsConnected = false
                    setTimeout(() => connectWebSocket(true), 100)
                    return // Stop processing welcome message
                }

                // We are in Lobby (or failed to join realm)
                // Clear any Realm Assets
                clearRealmAssets()

                myPlayerId = data.id
                myX = data.x || 0
                myZ = data.z || 0
                myRotation = data.rotation || 0
                myGender = data.gender || 'male'
                updatePlayer({ ...data, firstName: data.firstName || myFirstName, username: data.username || myUsername }, true)
                if (data.farmPlots) updateFarmPlots(data.farmPlots)
                if (data.dragon) updateDragonState(data.dragon)

                // Trigger Tutorial if needed
                if (!tutorialStarted) {
                    tutorialStarted = true
                    import('./tutorial').then(m => m.startTutorial())
                }
            } else if (data.type === 'init') {
                data.players.forEach((p: any) => updatePlayer(p, p.id === myPlayerId))
            } else if (data.type === 'join') {
                updatePlayer(data, false)
            } else if (data.type === 'leave') {
                removePlayer(data.id)
            } else if (data.type === 'update') {
                if (data.id !== myPlayerId) {
                    const playerData = players.get(data.id)
                    if (playerData && data.gender && playerData.gender !== data.gender) {
                        scene.remove(playerData.mesh)
                        const fIndex = (data.faceIndex !== undefined) ? data.faceIndex : (playerData['faceIndex'] || 0)
                        const { group, mixer, actions } = MeshFactories.createPlayerMesh(false, data.gender, fIndex)
                        scene.add(group)
                        playerData.mesh = group
                        playerData.mixer = mixer
                        playerData.actions = actions
                        playerData.gender = data.gender
                    }
                    updatePlayerTarget(data)
                }
            } else if (data.type === 'dragon_update') {
                updateDragonState(data)
            } else if (data.type === 'dragon_hit') {
                if (data.damageList) updateDamageList(data.damageList)
                if (dragon) {
                    dragon.health = data.health
                    dragon.flinchTime = Date.now()
                    if (data.x !== undefined && data.z !== undefined) {
                        const frags = MeshFactories.spawnFragments(data.x, 1.5, data.z, 0xFFEB3B)
                        frags.forEach(f => {
                            scene.add(f.mesh)
                            fragments.push(f)
                        })
                    }
                }
            } else if (data.type === 'dragon_death') {
                updateDragonState({ isDead: true })
                updateDamageList([])
            } else if (data.type === 'dragon_respawn') {
            } else if (data.type === 'dragon_charging') {
                if (dragon) dragon.chargeStartTime = Date.now()
            } else if (data.type === 'player_death') {
                handlePlayerDeath(data.id, data.firstName, data.username)
            } else if (data.type === 'player_respawn') {
                handlePlayerRespawn(data)
            } else if (data.type === 'world_update') {
                if (data.dragon) updateDragonState(data.dragon)
                if (data.bullets) updateBullets(data.bullets)
                if (data.pickups) updatePickups(data.pickups)
                if (data.sheeps) updateSheeps(data.sheeps)
                if (data.farmPlots) updateFarmPlots(data.farmPlots)
                if (data.ponds) {
                    pondsState = data.ponds
                    updatePondIndicators()
                }
                if (data.players) data.players.forEach((p: any) => updatePlayer(p, p.id === myPlayerId))

                if (data.realmTime !== undefined) {
                    realmTime = data.realmTime
                    let timerEl = document.getElementById('realm-timer')
                    if (!timerEl) {
                        timerEl = document.createElement('div')
                        timerEl.id = 'realm-timer'
                        timerEl.style.cssText = `
                            position: fixed; top: 90px; left: 50%; transform: translateX(-50%);
                            color: #000000; font-family: 'Outfit', 'Inter', system-ui, sans-serif; 
                            font-size: 20px; font-weight: 400; 
                            z-index: 10000; text-align: center;
                            pointer-events: none; white-space: nowrap;
                        `
                        document.body.appendChild(timerEl)
                    }
                    const minutes = Math.floor(realmTime / 60)
                    const seconds = realmTime % 60
                    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
                    timerEl.innerText = `Remaining Time in Realm: ${timeStr}`
                    timerEl.style.display = 'block'

                    // Instance ID display
                    let instanceEl = document.getElementById('realm-instance-id')
                    if (!instanceEl) {
                        instanceEl = document.createElement('div')
                        instanceEl.id = 'realm-instance-id'
                        instanceEl.style.cssText = `
                            position: fixed; top: 115px; left: 50%; transform: translateX(-50%);
                            color: #666666; font-family: 'Outfit', 'Inter', system-ui, sans-serif; 
                            font-size: 12px; font-weight: 400; 
                            z-index: 10000; text-align: center;
                            pointer-events: none; white-space: nowrap;
                        `
                        document.body.appendChild(instanceEl)
                    }
                    if (currentRoomId) {
                        instanceEl.innerText = `Instance ${currentRoomId}`
                        instanceEl.style.display = 'block'
                    }

                    // Active realms count display
                    if (data.activeRealmCount !== undefined) {
                        let activeCountEl = document.getElementById('active-realms-count')
                        if (!activeCountEl) {
                            activeCountEl = document.createElement('div')
                            activeCountEl.id = 'active-realms-count'
                            activeCountEl.style.cssText = `
                                position: fixed; top: 135px; left: 50%; transform: translateX(-50%);
                                color: #888888; font-family: 'Outfit', 'Inter', system-ui, sans-serif; 
                                font-size: 11px; font-weight: 400; 
                                z-index: 10000; text-align: center;
                                pointer-events: none; white-space: nowrap;
                            `
                            document.body.appendChild(activeCountEl)
                        }
                        activeCountEl.innerText = `Active Realms: ${data.activeRealmCount}`
                        activeCountEl.style.display = 'block'
                    }
                } else {
                    const t = document.getElementById('realm-timer')
                    if (t) t.style.display = 'none'
                    const i = document.getElementById('realm-instance-id')
                    if (i) i.style.display = 'none'
                    const a = document.getElementById('active-realms-count')
                    if (a) a.style.display = 'none'
                }
            } else if (data.type === 'pickup_spawned') {
                updatePickups([...Array.from(pickups.values()), data])
            } else if (data.type === 'weapon_update') {
                updatePlayer(data, data.id === myPlayerId)
            } else if (data.type === 'error') {
                if (data.message === 'Not enough coins') showShopError('Not Enough Coins')
            } else if (data.type === 'realm_lobby_update') {
                realmPlayers = data.players
                if (isWaitingForRealm) {
                    updateRealmWaitModal()
                }
            } else if (data.type === 'start_realm') {
                isWaitingForRealm = false
                if (realmWaitModal) realmWaitModal.style.display = 'none'
                updateUIVisibility()
                // Determine current URL parameters to preserve customization
                const currentParams = new URL(wsUrl).searchParams // Actually wsUrl is string, constructing from window.location
                const params = new URLSearchParams(window.location.search)
                params.set('room', data.realmId)

                // Reconnect to new room
                if (ws) ws.close()
                ws = null
                wsConnected = false
                isInRealm = true
                console.log('Joining Realm Instance:', data.realmId)

                // We need to reconstruct the WS URL with the room param
                // connectWebSocket constructs it from state, so we need to override logic or pass room
                // Actually connectWebSocket pulls from globals.
                // Let's modify connectWebSocket signature or handling.
                // Easier: just append room to global state so next connect uses it? 
                // No, better to update the connectWebSocket function or pass it as arg. 
                // But connectWebSocket parses vars.
                // Let's add a `currentRoomId` var in top scope.
                currentRoomId = data.realmId
                clearAllPlayers() // Ensure clean slate for new room

                setTimeout(() => connectWebSocket(true), 500)
            } else if (data.type === 'realm_init') {
                isWaitingForRealm = false
                if (realmWaitModal) realmWaitModal.style.display = 'none'
                switchToScene('realm')
                // Disable other UI
                damageListEl.style.display = 'none'
            } else if (data.type === 'realm_expired') {
                currentRoomId = null // Back to lobby
                switchToScene('lobby')
                if (ws) ws.close()
                ws = null
                wsConnected = false
                const t = document.getElementById('realm-timer')
                if (t) t.remove()
                const i = document.getElementById('realm-instance-id')
                if (i) i.remove()
                const a = document.getElementById('active-realms-count')
                if (a) a.remove()
                clearAllPlayers() // Ensure clean slate for lobby
                setTimeout(() => connectWebSocket(true), 500)
            } else if (data.type === 'player_realm_info') {
                // Response to get_player_realm query
                if (data.realmId && currentMode === 'character') {
                    // Player has an active realm! Reconnect them
                    console.log('Reconnecting to active realm:', data.realmId)
                    currentRoomId = data.realmId
                    isInRealm = true
                    // Skip character screen and go straight to game
                    currentMode = 'game'
                    updateUIVisibility()
                    // Close and reconnect with the realm ID
                    if (ws) ws.close()
                    ws = null
                    wsConnected = false
                    setTimeout(() => connectWebSocket(true), 500)
                }
            } else if (data.type === 'pond_update') {
                pondsState = data.ponds
                updatePondIndicators()
            } else if (data.type === 'pass_fish_start') {
                if (fishingUI) fishingUI.handlePassFishAnimation(data.fisherId, data.cookerId, data.duration, players)
            } else if (data.type === 'pass_fish_complete') {
                // Handled by state update
            } else if (data.type === 'fishing_complete') {
                // Handled by state update
            }
        }
    }



    function updateEconomicUI() {
        const invModal = document.getElementById('inventory-modal')
        if (invModal && invModal.style.display === 'block') showInventoryModal()
        const shopCoinsEl = document.getElementById('shop-coins-display')
        if (shopCoinsEl) shopCoinsEl.innerText = coins.toString()
    }

    function showShopError(msg: string) {
        const shopCoinsEl = document.getElementById('shop-coins-display')
        if (shopCoinsEl) {
            const originalColor = '#FFD700'
            shopCoinsEl.innerText = msg
            shopCoinsEl.style.color = '#EF5350'
            setTimeout(() => {
                const currentShopCoinsEl = document.getElementById('shop-coins-display')
                if (currentShopCoinsEl) {
                    currentShopCoinsEl.innerText = coins.toString()
                    currentShopCoinsEl.style.color = originalColor
                }
            }, 2000)
        }
    }

    function showInventoryModal() {
        let modal = document.getElementById('inventory-modal')
        if (!modal) {
            modal = document.createElement('div')
            modal.id = 'inventory-modal'
            modal.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9); color: white; padding: 24px; border-radius: 16px;
                width: 80%; max-width: 400px; font-family: system-ui, sans-serif; z-index: 200;
                border: 2px solid #10B981; box-shadow: 0 0 20px rgba(0,0,0,0.8);
            `
            document.body.appendChild(modal)
            const closeHandler = (e: any) => {
                if (modal!.style.display === 'block' && !modal!.contains(e.target as Node)) {
                    const btn = document.getElementById('inventory-btn')
                    if (btn && !btn.contains(e.target as Node)) {
                        modal!.style.display = 'none'
                        lastModalCloseTime = Date.now()
                        updateUIVisibility()
                    }
                }
            }
            document.addEventListener('mousedown', closeHandler)
            document.addEventListener('touchstart', closeHandler)
        }


        const counts: { [key: string]: number } = {}
        inventory.forEach((item: string) => counts[item] = (counts[item] || 0) + 1)
        const coinHtml = `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.2);">
                <div style="display:flex;align-items:center;">${UIGenerators.getItemIcon('coins')} <span style="font-size:18px;">Coins</span></div>
                <span style="color:#FFD700; font-weight:bold; font-size:18px;">${coins}</span>
            </div>
        `
        const itemsList = Object.entries(counts).map(([name, count]) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex;align-items:center;">
                    ${UIGenerators.getItemIcon(name)}
                    <span style="text-transform: capitalize;">${name.replace('_', ' ')}</span>
                </div>
                <span style="color:#10B981; font-weight:bold;">x${count}</span>
            </div>
        `).join('')
        modal.innerHTML = `
            <h2 style="margin-top:0; text-align:center; color:#10B981;">Inventory</h2>
            <div style="margin-top:16px; max-height: 300px; overflow-y: auto;">
                ${coinHtml}
                ${itemsList || '<div style="text-align:center; opacity:0.5; padding: 20px;">No items</div>'}
            </div>
            <div style="text-align:center; margin-top:24px; font-size:12px; opacity:0.5;">Click outside to close</div>
        `
        modal.style.display = 'block'
        updateUIVisibility()
    }

    function showShopModal() {
        let modal = document.getElementById('shop-modal')
        if (!modal) {
            modal = document.createElement('div')
            modal.id = 'shop-modal'
            modal.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.95); color: white; padding: 24px; border-radius: 16px;
                width: 80%; max-width: 400px; font-family: system-ui, sans-serif; z-index: 200;
                border: 2px solid #FFD54F; box-shadow: 0 0 20px rgba(0,0,0,0.8);
            `
            document.body.appendChild(modal)
            const closeHandler = (e: any) => {
                if (modal!.style.display === 'block' && !modal!.contains(e.target as Node)) {
                    modal!.style.display = 'none'
                    lastModalCloseTime = Date.now()
                    updateUIVisibility()
                }
            }
            document.addEventListener('mousedown', closeHandler)
        }
        const shopItems = [
            { id: 'wheat_seeds', name: 'Wheat Seeds', cost: 1 },
            { id: 'water_can', name: 'Water Can', cost: 5 },
            { id: 'trowel', name: 'Trowel', cost: 5 }
        ]
        const itemsList = shopItems.map(item => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex; align-items:center;">
                    ${UIGenerators.getItemIcon(item.id)}
                    <span>${item.name}</span>
                </div>
                <button onclick="window.buyItem('${item.id}', this)" style="background:#FFD54F; color:black; border:none; padding:4px 12px; border-radius:4px; font-weight:bold; cursor:pointer; min-width: 80px;">
                    ${item.cost} Coins
                </button>
            </div>
        `).join('')
        modal.innerHTML = `
            <h2 style="margin-top:0; text-align:center; color:#FFD54F;">Village Shop</h2>
            <div style="text-align:center; color:#FFD700; font-size:18px; margin-bottom:12px; font-weight:bold;">
                Available Coins: <span id="shop-coins-display">${coins}</span>
            </div>
            <div style="margin-top:16px;">
                ${itemsList}
            </div>
            <div style="text-align:center; margin-top:24px; font-size:12px; opacity:0.5;">Click outside to close</div>
        `
        modal.style.display = 'block'
        updateUIVisibility()
    }

    (window as any).buyItem = (itemId: string, btnElement?: HTMLButtonElement) => {
        if (wsConnected && ws) {
            ws.send(JSON.stringify({ type: 'buy_item', itemId }))
            if (btnElement) {
                const originalText = btnElement.innerText
                btnElement.disabled = true
                btnElement.style.opacity = '0.7'
                btnElement.innerText = '...'
                setTimeout(() => {
                    btnElement.disabled = false
                    btnElement.style.opacity = '1'
                    btnElement.innerText = originalText
                }, 1000)
            }
        }
    }

    const invBtn = document.getElementById('inventory-btn')
    if (invBtn) invBtn.addEventListener('click', () => {
        if (Date.now() - lastModalCloseTime < 300) return
        showInventoryModal()
    })

    connectWebSocket(true)

    function updateFarmPlots(plots: any[]) {
        farmPlotsState = plots
        farmingUI.updateFarmPlots(plots, lobbyState, farmPlotWheat, players)
    }

    function updatePlayerWeapon(playerData: Types.PlayerData, newWeapon: string | null) {
        playerData.weapon = newWeapon

        // Hide/Show Staff - Hide in Realm for ALL players with a role
        const hasRole = playerData.role && playerData.role !== 'None'
        playerData.mesh.traverse((child: any) => {
            if (child.name === 'staff_beginner' || child.name.includes('staff')) {
                // Hide staff if player has a role (in Realm) or if weapon isn't staff_beginner
                child.visible = !hasRole && (newWeapon === 'staff_beginner')
                if (child.visible) child.frustumCulled = false
            }
        })

        // Clear external mesh if valid
        if (playerData.weaponMesh) {
            const parent = playerData.weaponMesh.parent
            if (parent) parent.remove(playerData.weaponMesh)
            playerData.weaponMesh = null
        }

        // Force hide default staff if in Realm (has any role)
        if (hasRole) {
            playerData.mesh.traverse((child: any) => {
                if (child.name === 'staff_beginner' || child.name.includes('staff')) {
                    child.visible = false
                }
            })
        }

        // Logic for Custom Meshes (Weapons, Pole, Fish)
        let meshToCreate = null

        if (playerData.role === 'Fisher') {
            if (playerData.heldItem === 'fish') {
                meshToCreate = MeshFactories.createFishMesh()
            } else {
                meshToCreate = MeshFactories.createFishingPoleMesh()
            }
        } else if (playerData.role === 'Cooker' && playerData.heldItem === 'fish') {
            meshToCreate = MeshFactories.createFishMesh()
        } else if (newWeapon && newWeapon !== 'staff_beginner') {
            meshToCreate = MeshFactories.createWeaponMesh(newWeapon)
        }

        if (meshToCreate) {
            // Helper to find ACTUAL bones (isBone=true) recursively
            const findActualBone = (obj: any, name: string): any | null => {
                const lowerName = name.toLowerCase()
                if (obj.isBone && obj.name && obj.name.toLowerCase().includes(lowerName)) return obj
                for (const child of obj.children) {
                    const found = findActualBone(child, name)
                    if (found) return found
                }
                return null
            }

            // Collect ALL bones and ALL objects with 'hand' in name for debug
            const allBones: string[] = []
            const allHandObjects: string[] = []
            let skeletonBones: any[] = []

            playerData.mesh.traverse((child: any) => {
                if (child.isBone) {
                    allBones.push(child.name)
                }
                if (child.name && child.name.toLowerCase().includes('hand')) {
                    allHandObjects.push(`${child.name} (isBone: ${child.isBone})`)
                }
                // Try to get skeleton from SkinnedMesh
                if (child.isSkinnedMesh && child.skeleton && child.skeleton.bones) {
                    skeletonBones = child.skeleton.bones
                }
            })
            console.log('[BoneDebug] All isBone objects:', allBones)
            console.log('[BoneDebug] All hand objects:', allHandObjects)
            console.log('[BoneDebug] Skeleton bones count:', skeletonBones.length)

            // Log skeleton bone names if available
            if (skeletonBones.length > 0) {
            }

            // Try to find hand bone from skeleton first
            let handBone = null
            if (skeletonBones.length > 0) {

                // Search for leftHand specifically (exact match or partial)
                handBone = skeletonBones.find((b: any) => b.name === 'leftHand')
                if (!handBone) {
                    handBone = skeletonBones.find((b: any) =>
                        b.name.toLowerCase().includes('lefthand') ||
                        b.name.toLowerCase().includes('righthand') ||
                        b.name.toLowerCase().includes('hand_l') ||
                        b.name.toLowerCase().includes('hand_r') ||
                        b.name.toLowerCase() === 'hand.l' ||
                        b.name.toLowerCase() === 'hand.r'
                    )
                }

            }

            // Fallback to recursive search for actual bones
            if (!handBone) {
                handBone = findActualBone(playerData.mesh, 'leftHand') ||
                    findActualBone(playerData.mesh, 'rightHand') ||
                    findActualBone(playerData.mesh, 'Hand')
            }

            // Last resort: find any object named 'hands' even if not a bone
            if (!handBone) {
                handBone = playerData.mesh.getObjectByName('hands') ||
                    playerData.mesh.getObjectByName('leftHand')

            }

            if (handBone) {
                // Determine if custom tool (Pole/Fish) or standard
                const isCustomTool = (playerData.role === 'Fisher' && !playerData.heldItem)
                const isFish = (playerData.heldItem === 'fish')

                if (isCustomTool) {
                    // Fishing Pole - rod mesh is now vertical Y-up in mesh factory
                    meshToCreate.position.set(0, 0, 0)
                    meshToCreate.scale.set(2, 2, 2) // Compensate for 0.5 player scale

                    // Rotate X by ~-80 degrees (-1.4 rad) to point it forward/out from hand
                    // Adjust Y/Z if needed to prevent left/right tilt.
                    // Assuming hand bone Y is up, Z is out?
                    // Let's try pointing it "Forward" (-PI/2 on X) + "Slightly Up" (+0.2-0.3 rad)
                    // Result: -PI/2 + 0.3 = -1.27
                    meshToCreate.rotation.set(-1.3, 0, 0)
                    // If it leaned left/right before, we might need Z rotation.
                    // But start with pure forward pitch.
                } else if (isFish) {
                    // Fish - held in hand
                    meshToCreate.position.set(0.2, 0, 0)
                    meshToCreate.scale.set(1, 1, 1) // Compensate for 0.5 player scale  
                    meshToCreate.rotation.set(0, 0, Math.PI / 2)
                } else {
                    // Standard Weapon
                    meshToCreate.position.set(0, 0, 0)
                    meshToCreate.scale.set(6, 6, 6) // 3 * 2 to compensate for 0.5 player scale
                    meshToCreate.rotation.set(0, -Math.PI / 2, Math.PI / 2)
                }

                handBone.add(meshToCreate)
            } else {

                // Fallback
                const isCustomTool = (playerData.role === 'Fisher' && !playerData.heldItem)
                if (isCustomTool) {
                    meshToCreate.position.set(0.3, 0.8, 0.5)
                } else {
                    meshToCreate.position.set(-0.5, 1.5, 0.5)
                }
                playerData.mesh.add(meshToCreate)
            }
            playerData.weaponMesh = meshToCreate
        }
    }

    function updatePlayer(data: any, isMe: boolean) {
        let playerData = players.get(data.id)
        let isNew = false

        if (!playerData) {
            isNew = true
            const gender = data.gender || 'male'
            const faceIndex = data.faceIndex || 0
            const { group: mesh, mixer, actions } = MeshFactories.createPlayerMesh(isMe, gender, faceIndex)
            const displayName = (data.username && data.username !== 'null' && data.username.trim() !== '') ? data.username : (data.firstName || 'Player')
            const label = UIGenerators.createTextSprite(THREE, displayName, isMe)

            scene.add(mesh)
            scene.add(label)

            playerData = {
                mesh,
                label,
                firstName: data.firstName || 'Player',
                username: data.username || null,
                currentX: data.x,
                currentZ: data.z,
                currentRotation: data.rotation ?? 0,
                targetX: data.x,
                targetZ: data.z,
                targetRotation: data.rotation ?? 0,
                gender: gender,
                mixer,
                actions,
                isDead: false,
                weapon: data.weapon || null
            }
            players.set(data.id, playerData)
            updatePlayerWeapon(playerData, data.weapon || null)
        }

        if (!playerData) return

        if (data.isActing !== undefined) {
            // Only update action state for other players. For local player, we manage this state optimistically
            // to prevents server updates from cancelling animations early
            if (!isMe) {
                playerData.isActing = data.isActing
                playerData.actionType = data.actionType
                playerData.actingPlotId = data.actionPlotId
            }
        }

        const currentDisplayName = (playerData.username && playerData.username.trim() !== '') ? playerData.username : (playerData.firstName || 'Player')
        const newDisplayName = (data.username !== undefined)
            ? ((data.username && data.username.trim() !== '') ? data.username : (data.firstName || playerData.firstName))
            : ((data.firstName && data.firstName !== playerData.firstName) ? data.firstName : currentDisplayName)

        if (newDisplayName !== currentDisplayName || (data.role && data.role !== playerData.role)) {
            scene.remove(playerData.label)
            playerData.firstName = data.firstName ?? playerData.firstName
            playerData.username = data.username !== undefined ? data.username : playerData.username
            // Update Label to include Role if present
            let labelText = newDisplayName
            // Use new role if provided, otherwise existing role
            const role = data.role || playerData.role
            if (role && role !== 'None') {
                labelText = `[${role}] ${newDisplayName}`
            }

            playerData.label = UIGenerators.createTextSprite(THREE, labelText, isMe)
            scene.add(playerData.label)
        }

        if (data.faceIndex !== undefined && playerData.faceIndex !== data.faceIndex ||
            data.gender !== undefined && playerData.gender !== data.gender) {
            scene.remove(playerData.mesh)
            const newFace = data.faceIndex ?? playerData.faceIndex ?? 0
            const newGender = data.gender ?? playerData.gender
            const { group: mesh, mixer, actions } = MeshFactories.createPlayerMesh(isMe, newGender, newFace)
            mesh.position.set(playerData.currentX, 0, playerData.currentZ)
            mesh.rotation.y = playerData.currentRotation + (isMe ? Math.PI : 0)
            scene.add(mesh)
            playerData.mesh = mesh
            playerData.mixer = mixer
            playerData.actions = actions
            playerData.gender = newGender
            playerData.faceIndex = newFace
            updatePlayerWeapon(playerData, playerData.weapon)
        }

        const weaponChanged = playerData.weapon !== (data.weapon || null)
        const roleChanged = playerData.role !== data.role
        const itemChanged = playerData.heldItem !== data.heldItem

        // Update data
        playerData.role = data.role
        playerData.heldItem = data.heldItem

        if (weaponChanged || roleChanged || itemChanged) {
            updatePlayerWeapon(playerData, data.weapon || null)
        }

        if (data.x !== undefined && data.z !== undefined) {
            if (isNew) {
                playerData.currentX = data.x
                playerData.currentZ = data.z
                playerData.currentRotation = data.rotation ?? playerData.currentRotation
            }
            playerData.targetX = data.x
            playerData.targetZ = data.z
            playerData.targetRotation = data.rotation ?? playerData.targetRotation
        }

        if (isMe && weaponChanged && data.weapon === 'staff_beginner') {
            currentMode = 'congratulations'
            tempFaceOverride = 'wonder.png'
            updateCharacterFace()
            if (congratsModal) congratsModal.style.display = 'block'
            updateUIVisibility()
        }
    }

    function updateDragonState(data: any) {
        if (data.damageList) updateDamageList(data.damageList)
        if (!dragon) {
            if (data.isDead) return
            const { group, wings, labelGroup, healthBar } = MeshFactories.createDragonMesh()
            scene.add(group)
            scene.add(labelGroup)
            dragon = {
                mesh: group,
                wings,
                labelGroup,
                healthBar,
                currentX: data.x,
                currentZ: data.z,
                currentRotation: data.rotation,
                targetX: data.x,
                targetZ: data.z,
                targetRotation: data.rotation,
                health: data.health,
                isDead: false,
                targetId: data.targetId || null,
                spawnStartTime: Date.now()
            }
            group.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true
                    child.material.opacity = 0
                }
            })
        } else {
            if (data.isDead) {
                if (!dragon.isDead) {
                    dragon.isDead = true
                    dragon.deathTime = Date.now()
                    dragon.spawnStartTime = undefined
                    if (dragon.labelGroup) scene.remove(dragon.labelGroup)
                    updateUIVisibility()
                }
                return
            }
            if (dragon.isDead) {
                dragon.isDead = false
                dragon.spawnStartTime = Date.now()
                if (dragon.labelGroup) scene.add(dragon.labelGroup)
                dragon.mesh.traverse((child: any) => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = true
                        child.material.opacity = 0
                    }
                })
            }
            dragon.targetX = data.x
            dragon.targetZ = data.z
            dragon.targetRotation = data.rotation
            dragon.health = data.health
            dragon.targetId = data.targetId || null
            if (dragon.healthBar) {
                const scale = Math.max(0, dragon.health / 10)
                dragon.healthBar.scale.x = scale * 4
                const r = 1 - scale
                const g = scale
                MeshFactories.dragHealthMat.color.setRGB(r, g, 0)
            }
        }
        updateUIVisibility()
    }

    function updatePondIndicators() {
        pondIndicators.forEach(p => scene.remove(p))
        pondIndicators = []
        pondsState.forEach(pond => {
            const ind = MeshFactories.createPondIndicatorMesh()
            ind.position.set(pond.x, 0.1, pond.z)
            ind.userData.active = pond.active // Store for animation loop

            const baseRing = ind.getObjectByName('baseRing') as any

            if (pond.active) {
                // Keep default blue glow (already in factory)
                if (baseRing) {
                    baseRing.material.color.setHex(0x00B0FF)
                    baseRing.material.opacity = 0.8
                }
            } else {
                // Change material to inactive
                if (baseRing) {
                    baseRing.material.color.setHex(0x555555) // Grey
                    baseRing.material.opacity = 0.3
                }
            }

            scene.add(ind)
            pondIndicators.push(ind)
        })
    }

    function updatePlayerTarget(data: any) {
        const playerData = players.get(data.id)
        if (playerData) {
            // Only update position if values are defined
            if (data.x !== undefined) playerData.targetX = data.x
            if (data.z !== undefined) playerData.targetZ = data.z
            if (data.rotation !== undefined) playerData.targetRotation = data.rotation
            if (data.isActing !== undefined) playerData.isActing = data.isActing
            if (data.actionType !== undefined) playerData.actionType = data.actionType
            if (data.actionPlotId !== undefined) playerData.actingPlotId = data.actionPlotId
        }
    }

    function updateSheeps(data: any[]) {
        data.forEach(s => {
            let sheep = sheeps.get(s.id)
            if (!sheep) {
                const mesh = MeshFactories.createSheepMesh()
                scene.add(mesh)
                sheep = {
                    mesh,
                    currentX: s.x,
                    currentZ: s.z,
                    currentRotation: s.rotation,
                    targetX: s.x,
                    targetZ: s.z,
                    targetRotation: s.rotation,
                    isHopping: s.isHopping,
                    hopPhase: Math.random() * Math.PI * 2
                }
                sheeps.set(s.id, sheep)
            }
            sheep.mesh.visible = (lobbyState !== null)
            sheep.targetX = s.x
            sheep.targetZ = s.z
            sheep.targetRotation = s.rotation
            if (sheep.isHopping !== s.isHopping) sheep.isHopping = s.isHopping
            if (s.text !== sheep.lastText) {
                if (sheep.label) {
                    scene.remove(sheep.label)
                    sheep.label = null
                }
                if (s.text) {
                    sheep.label = UIGenerators.createSheepTextSprite(THREE, s.text)
                    scene.add(sheep.label)
                    sheep.label.visible = (lobbyState !== null)
                }
                sheep.lastText = s.text
            }
        })
    }

    function removePlayer(id: string) {
        const playerData = players.get(id)
        if (playerData) {
            scene.remove(playerData.mesh)
            scene.remove(playerData.label)
            players.delete(id)
        }
    }

    function clearAllPlayers() {
        players.forEach((p, id) => {
            if (p.mesh) scene.remove(p.mesh)
            if (p.label) scene.remove(p.label)
            if (p.weaponMesh) scene.remove(p.weaponMesh)
        })
        players.clear()
        // Ensure my player data is cleared too so we fetch fresh
        // actually myPlayerData is a subset of players usually, but we keep myPlayerId
    }

    function handlePlayerDeath(playerId: string, firstName: string, username?: string | null) {
        const playerData = players.get(playerId)
        if (!playerData) return
        const isMe = playerId === myPlayerId
        playerData.isDead = true
        scene.remove(playerData.mesh)
        const tombstone = MeshFactories.createTombstoneMesh()
        const tX = isMe ? myX : playerData.currentX
        const tZ = isMe ? myZ : playerData.currentZ
        playerData.deathX = tX
        playerData.deathZ = tZ
        tombstone.position.set(tX, 0, tZ)
        scene.add(tombstone)
        playerData.mesh = tombstone
        playerData.mixer = null
        playerData.actions = {}
        playerData.weaponMesh = null
        scene.remove(playerData.label)
        const deadName = (username && username.trim() !== '') ? username : (firstName || 'Player')
        const deathLabel = UIGenerators.createTextSprite(THREE, isMe ? 'You died' : `${deadName} died`, false)
        deathLabel.position.set(tX, 2.5, tZ)
        scene.add(deathLabel)
        playerData.label = deathLabel
        if (isMe) {
            myIsDead = true
            myX = tX
            myZ = tZ
            if (playerData.label) scene.remove(playerData.label)
            const topLabel = UIGenerators.createTextSprite(THREE, 'You died', false)
            topLabel.scale.set(3, 0.75, 1)
            topLabel.position.set(tX, 4.7, tZ)
            scene.add(topLabel)
            playerData.label = topLabel
            if (currentCountdownLabel) scene.remove(currentCountdownLabel)
            let timeLeft = 10
            currentCountdownLabel = UIGenerators.createTextSprite(THREE, `Respawning in ${timeLeft}...`, false)
            currentCountdownLabel.scale.set(4, 1, 1)
            currentCountdownLabel.position.set(tX, 3.7, tZ)
            scene.add(currentCountdownLabel)
            const timerInterval = setInterval(() => {
                timeLeft--
                if (timeLeft > 0) {
                    if (currentCountdownLabel) scene.remove(currentCountdownLabel)
                    currentCountdownLabel = UIGenerators.createTextSprite(THREE, `Respawning in ${timeLeft}...`, false)
                    currentCountdownLabel.scale.set(4, 1, 1)
                    currentCountdownLabel.position.set(tX, 3.7, tZ)
                    scene.add(currentCountdownLabel)
                } else {
                    clearInterval(timerInterval)
                    if (currentCountdownLabel) scene.remove(currentCountdownLabel)
                    currentCountdownLabel = null
                }
            }, 1000)
        }
        updateUIVisibility()
    }

    function handlePlayerRespawn(data: any) {
        const playerData = players.get(data.id)
        const isMe = data.id === myPlayerId
        if (playerData) {
            scene.remove(playerData.mesh)
            scene.remove(playerData.label)
            if (playerData.weaponMesh) {
                playerData.mesh.remove(playerData.weaponMesh)
                playerData.weaponMesh = null
            }
            const { group: mesh, mixer, actions } = MeshFactories.createPlayerMesh(isMe, data.gender, data.faceIndex || 0)
            mesh.position.set(data.x, 0, data.z)
            mesh.rotation.y = data.rotation + Math.PI
            scene.add(mesh)
            const respawnName = (data.username && data.username !== 'null' && data.username.trim() !== '') ? data.username : (data.firstName || 'Player')
            const label = UIGenerators.createTextSprite(THREE, respawnName, isMe)
            label.position.set(data.x, 4.2, data.z)
            scene.add(label)
            playerData.mesh = mesh
            playerData.label = label
            playerData.firstName = data.firstName
            playerData.username = data.username || null
            playerData.mixer = mixer
            playerData.actions = actions
            playerData.isDead = false
            playerData.weaponMesh = null
            playerData.currentX = data.x
            playerData.currentZ = data.z
            playerData.targetX = data.x
            playerData.targetZ = data.z
            playerData.currentRotation = data.rotation
            playerData.targetRotation = data.rotation
            playerData.weapon = data.weapon !== undefined ? data.weapon : playerData.weapon
            updatePlayerWeapon(playerData, playerData.weapon)
        }
        if (isMe) {
            myIsDead = false
            myX = data.x
            myZ = data.z
            myRotation = data.rotation
            updateUIVisibility()
        }
    }

    // Admin Modal (if user is admin)
    let adminModal: HTMLDivElement | null = null
    let adminModalContent: HTMLDivElement | null = null
    if (isAdmin) {
        adminModal = document.createElement('div')
        adminModal.id = 'admin-modal'
        adminModal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.9); z-index: 500; display: none;
            overflow-y: auto;
        `
        adminModalContent = document.createElement('div')
        adminModalContent.style.cssText = `
            max-width: 600px; margin: 0 auto; padding: 20px;
        `
        adminModal.appendChild(adminModalContent)
        document.body.appendChild(adminModal)
    }

    async function openAdminPanel() {
        if (!adminModal || !adminModalContent) return
        adminModal.style.display = 'block'
        adminModalContent.innerHTML = '<div style="color: white; text-align: center; padding: 40px;">Loading...</div>'

        try {
            const res = await fetch('/api/admin/users')
            if (!res.ok) {
                adminModalContent.innerHTML = '<div style="color: #EF5350; text-align: center; padding: 40px;">Access denied</div>'
                return
            }
            const data = await res.json() as { users: any[] }
            renderAdminUserList(data.users)
        } catch (e) {
            adminModalContent.innerHTML = '<div style="color: #EF5350; text-align: center; padding: 40px;">Error loading users</div>'
        }
    }

    function renderAdminUserList(users: any[]) {
        if (!adminModalContent) return
        adminModalContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 16px 0; border-bottom: 1px solid #333;">
                <h2 style="margin: 0; color: white; font-size: 18px;">Player Administration</h2>
                <button id="admin-close-btn" style="background: none; border: none; color: #aaa; font-size: 24px; cursor: pointer;">×</button>
            </div>
            <div style="background: #333; border-radius: 12px; padding: 16px; margin: 16px 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <div>
                        <div style="font-size: 11px; color: #888; text-transform: uppercase; margin-bottom: 4px;">Game Version</div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <input id="admin-version-input" type="text" value="" style="width: 100px; padding: 8px 12px; background: #252525; border: 1px solid #444; border-radius: 6px; color: white; font-family: monospace;" />
                            <button id="admin-version-save" style="padding: 8px 16px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px;">Update</button>
                        </div>
                    </div>
                    <div style="font-size: 11px; color: #666;">Client: ${Constants.CLIENT_VERSION}</div>
                </div>
                <div id="admin-version-msg" style="margin-top: 8px; font-size: 12px; color: #81c784;"></div>
            </div>
            <div id="admin-user-list" style="display: flex; flex-direction: column; gap: 8px; padding: 0 0 16px 0;"></div>
        `
        // Load current version
        fetch('/api/version').then(r => r.json()).then((data: any) => {
            const input = document.getElementById('admin-version-input') as HTMLInputElement
            if (input) input.value = data.version || ''
        })
        // Save version handler
        document.getElementById('admin-version-save')?.addEventListener('click', async () => {
            const input = document.getElementById('admin-version-input') as HTMLInputElement
            const msgEl = document.getElementById('admin-version-msg')!
            msgEl.innerText = 'Saving...'
            msgEl.style.color = '#aaa'
            try {
                const res = await fetch('/api/admin/version', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ version: input.value })
                })
                if (res.ok) {
                    msgEl.innerText = 'Version updated! Users will be prompted to refresh.'
                    msgEl.style.color = '#81c784'
                } else {
                    msgEl.innerText = 'Failed to update'
                    msgEl.style.color = '#ef9a9a'
                }
            } catch (e) {
                msgEl.innerText = 'Error'
                msgEl.style.color = '#ef9a9a'
            }
        })
        const listEl = document.getElementById('admin-user-list')!
        users.forEach(u => {
            const row = document.createElement('div')
            row.style.cssText = 'background: #333; border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 16px; cursor: pointer;'
            row.innerHTML = `
                <img src="${u.picture || 'https://via.placeholder.com/48'}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; background: #444;" />
                <div style="flex: 1; overflow: hidden;">
                    <div style="font-weight: 600; font-size: 16px; color: white; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${u.first_name} ${u.last_name || ''}</div>
                    <div style="font-size: 13px; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${u.email || ''}</div>
                </div>
                <div style="color: #555; font-size: 20px;">›</div>
            `
            row.addEventListener('click', () => loadAdminUserDetails(u.id))
            listEl.appendChild(row)
        })
        document.getElementById('admin-close-btn')?.addEventListener('click', () => { if (adminModal) adminModal.style.display = 'none' })
    }

    async function loadAdminUserDetails(userId: string) {
        if (!adminModalContent) return
        adminModalContent.innerHTML = '<div style="color: white; text-align: center; padding: 40px;">Loading...</div>'
        try {
            const res = await fetch(`/api/admin/user/${userId}`)
            if (!res.ok) { adminModalContent.innerHTML = '<div style="color: #EF5350;">Error</div>'; return }
            const data = await res.json() as { user: any }
            renderAdminUserEdit(data.user)
        } catch (e) {
            adminModalContent.innerHTML = '<div style="color: #EF5350;">Error loading user</div>'
        }
    }

    function renderAdminUserEdit(user: any) {
        if (!adminModalContent) return
        adminModalContent.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; padding: 16px 0; border-bottom: 1px solid #333;">
                <button id="admin-back-btn" style="background: none; border: none; color: white; font-size: 24px; cursor: pointer;">←</button>
                <h2 style="margin: 0; color: white; font-size: 18px;">Edit User</h2>
            </div>
            <div style="background: #333; border-radius: 12px; padding: 20px; text-align: center; margin: 16px 0;">
                <div style="font-size: 13px; color: #888; margin-bottom: 4px;">USER ID: ${user.id}</div>
                <div style="font-size: 20px; font-weight: bold; color: white;">${user.first_name}</div>
                <div style="color: #aaa;">${user.email || ''}</div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 16px;">
                <div>
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; color: #ccc;">Username</label>
                    <input id="admin-username" type="text" value="${user.username || ''}" style="width: 100%; padding: 12px; background: #252525; border: 1px solid #444; border-radius: 8px; color: white; box-sizing: border-box;" />
                </div>
                <div>
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; color: #ccc;">Coins</label>
                    <input id="admin-coins" type="number" value="${user.coins || 0}" style="width: 100%; padding: 12px; background: #252525; border: 1px solid #444; border-radius: 8px; color: white; box-sizing: border-box;" />
                </div>
                <div>
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; color: #ccc;">Weapon</label>
                    <select id="admin-weapon" style="width: 100%; padding: 12px; background: #252525; border: 1px solid #444; border-radius: 8px; color: white; box-sizing: border-box;">
                        <option value="" ${!user.weapon ? 'selected' : ''}>NULL</option>
                        <option value="staff_beginner" ${user.weapon === 'staff_beginner' ? 'selected' : ''}>staff_beginner</option>
                    </select>
                </div>
                <div>
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; color: #ccc;">Tutorial Complete</label>
                    <input id="admin-tutorial" type="number" min="0" max="1" value="${user.tutorial_complete || 0}" style="width: 100%; padding: 12px; background: #252525; border: 1px solid #444; border-radius: 8px; color: white; box-sizing: border-box;" />
                </div>
                <div>
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; color: #ccc;">Inventory (JSON)</label>
                    <textarea id="admin-inventory" style="width: 100%; height: 100px; padding: 12px; background: #252525; border: 1px solid #444; border-radius: 8px; color: white; font-family: monospace; box-sizing: border-box;">${user.inventory || '[]'}</textarea>
                </div>
            </div>
            <button id="admin-save-btn" style="width: 100%; padding: 16px; background: #4CAF50; color: white; border: none; border-radius: 12px; cursor: pointer; font-size: 16px; font-weight: bold; margin-top: 20px;">Save Changes</button>
            <div id="admin-message" style="text-align: center; margin-top: 12px; color: #81c784;"></div>
        `
        document.getElementById('admin-back-btn')?.addEventListener('click', openAdminPanel)
        document.getElementById('admin-save-btn')?.addEventListener('click', async () => {
            const msgEl = document.getElementById('admin-message')!
            msgEl.innerText = 'Saving...'
            msgEl.style.color = '#aaa'
            try {
                const res = await fetch(`/api/admin/user/${user.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: (document.getElementById('admin-username') as any).value || null,
                        coins: parseInt((document.getElementById('admin-coins') as any).value),
                        weapon: (document.getElementById('admin-weapon') as any).value || null,
                        tutorial_complete: parseInt((document.getElementById('admin-tutorial') as any).value),
                        inventory: (document.getElementById('admin-inventory') as any).value
                    })
                })
                if (res.ok) {
                    msgEl.innerText = 'Saved successfully!'
                    msgEl.style.color = '#81c784'
                } else {
                    msgEl.innerText = 'Failed to save'
                    msgEl.style.color = '#ef9a9a'
                }
            } catch (e) {
                msgEl.innerText = 'Error saving'
                msgEl.style.color = '#ef9a9a'
            }
        })
    }

    // Selection Card (Character Customization)
    const selectionCardElements = SelectionCard.createSelectionCard({
        initialUsername: myUsername || myFirstName || '',
        initialGender: charGender,
        initialFaceIndex: currentFaceIndex,
        isAdmin: isAdmin,
        onGenderChange: (g) => {
            charGender = g
            myGender = g
            updateCharacterGender()
        },
        onFaceChange: (i) => {
            currentFaceIndex = i
            updateCharacterFace()
        },
        onEnterWorld: async (username, gender, faceIndex) => {
            myUsername = username
            try {
                const resp = await fetch('/api/user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, gender, faceIndex })
                })
                if (!resp.ok) console.error('Failed to sync user data')
                const nameLabel = document.getElementById('player-name-label')
                if (nameLabel) nameLabel.innerText = username || myFirstName
            } catch (err) {
                console.error('Error syncing user data:', err)
            }
            currentMode = 'game'
            updateUIVisibility()
            connectWebSocket(true)
        },
        onAdminClick: () => {
            openAdminPanel()
        }
    })
    const selectionCard = selectionCardElements.card
    const usernameInput = selectionCardElements.usernameInput

    function switchToMode(mode: 'game' | 'character' | 'spectate' | 'congratulations' | 'front_camera') {
        currentMode = mode
        if (mode === 'character') {
            if (ws) {
                ws.onclose = null
                ws.close()
                ws = null
                wsConnected = false
            }
            if (charModel) {
                updateCharacterFace()
                updateCharacterGender()
            }
        } else {
            connectWebSocket(true)
        }
        updateUIVisibility()
    }

    function startFarmingAction(type: 'planting' | 'watering' | 'harvesting', plotId: number) {
        farmingUI.startFarmingAction(type, plotId, myPlayerId, players, updateUIVisibility)
    }

    const joystickContainer = document.createElement('div')
    joystickContainer.id = 'joystick-container'
    joystickContainer.style.cssText = `
        position: fixed;
        bottom: max(40px, env(safe-area-inset-bottom) + 20px);
        left: max(40px, env(safe-area-inset-left) + 20px);
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        border: 2px solid rgba(255, 255, 255, 0.3);
        touch-action: none;
        z-index: 50;
        display: none;
    `
    const joystickKnob = document.createElement('div')
    joystickKnob.id = 'joystick-knob'
    joystickKnob.style.cssText = `
        position: absolute;
        width: 50px;
        height: 50px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.5);
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
    `
    joystickContainer.appendChild(joystickKnob)
    document.body.appendChild(joystickContainer)

    fishingUI = new FishingUI({
        interactBtn,
        onSendMessage: (msg) => { if (ws && wsConnected) ws.send(JSON.stringify(msg)) },
        setControlsEnabled: (enabled) => { if (!enabled) { joystickDeltaX = 0; joystickDeltaY = 0; } },
        camera: camera,
        setJoystickVisible: (v) => { if (joystickContainer) joystickContainer.style.display = v ? 'block' : 'none' }
    })

    const shootBtn = document.createElement('div')
    shootBtn.id = 'shoot-btn'
    shootBtn.style.cssText = `
        position: fixed;
        bottom: max(60px, env(safe-area-inset-bottom) + 40px);
        right: max(40px, env(safe-area-inset-right) + 40px);
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: rgba(244, 67, 54, 0.8);
        color: white;
        font-weight: bold;
        border: none;
        font-family: system-ui, sans-serif;
        font-size: 16px;
        touch-action: none;
        user-select: none;
        z-index: 50;
        display: none;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        overflow: visible;
        transition: background 0.2s, transform 0.1s;
    `
    const size = 80
    const strokeWidth = 6
    const radius = (size - strokeWidth) / 2
    const circumference = 2 * Math.PI * radius
    shootBtn.innerHTML = `
        <span style="z-index:2;position:relative;">SHOOT</span>
        <svg class="progress-ring" width="${size}" height="${size}" style="position:absolute;top:0;left:0;transform:rotate(-90deg);pointer-events:none;">
             <circle stroke="rgba(255,255,255,0.3)" stroke-width="${strokeWidth}" fill="transparent" r="${radius}" cx="${size / 2}" cy="${size / 2}" />
             <circle id="cooldown-circle" stroke="white" stroke-width="${strokeWidth}" fill="transparent" r="${radius}" cx="${size / 2}" cy="${size / 2}" 
                     style="stroke-dasharray: ${circumference} ${circumference}; stroke-dashoffset: ${circumference}; transition: stroke-dashoffset 0.1s linear;" />
        </svg>
    `
    document.body.appendChild(shootBtn)

    const spawnBtn = document.createElement('button')
    spawnBtn.id = 'spawn-dragon-btn'
    spawnBtn.innerText = 'ACTIVATE OBELISK'
    spawnBtn.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, calc(-50% - 60px));
        padding: 10px 24px; background: #A7F3D0; border: 2px solid black;
        border-radius: 999px; color: black; font-weight: bold; cursor: pointer;
        display: none; z-index: 50; font-size: 16px; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.2);
        pointer-events: auto;
        font-family: system-ui, sans-serif;
        text-transform: uppercase;
    `
    document.body.appendChild(spawnBtn)

    const handleSpawnDragon = () => {
        if (wsConnected && ws) {
            ws.send(JSON.stringify({ type: 'spawn_dragon' }))
            spawnBtn.style.display = 'none'
            const dx = 0 - myX
            const dz = 0 - myZ
            myRotation = Math.atan2(dx, dz) + Math.PI
        }
    }
    spawnBtn.addEventListener('click', handleSpawnDragon)
    spawnBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleSpawnDragon() })

    const handleShoot = () => {
        if (myIsDead) return
        const now = Date.now()
        if (now - lastFireTime < Constants.FIRE_COOLDOWN) return
        if (wsConnected && ws) {
            ws.send(JSON.stringify({ type: 'shoot' }))
            lastFireTime = now
            shootBtn.style.transform = 'scale(0.95)'
            setTimeout(() => { shootBtn.style.transform = 'scale(1)' }, 100)
        }
    }
    shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleShoot() })
    shootBtn.addEventListener('mousedown', (e) => { e.preventDefault(); handleShoot() })
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') handleShoot() })

    const scoreBtn = document.getElementById('scores-btn') as HTMLButtonElement
    const charNavBtn = document.getElementById('character-btn') as HTMLButtonElement
    const cameraNavBtn = document.getElementById('camera-btn') as HTMLButtonElement

    if (charNavBtn) {
        charNavBtn.addEventListener('click', () => {
            if (Date.now() - lastModalCloseTime < 300) return
            switchToMode('character')
        })
    }

    if (cameraNavBtn) {
        cameraNavBtn.addEventListener('click', () => {
            if (Date.now() - lastModalCloseTime < 300) return
            // Set to a front-facing selfie camera mode
            switchToMode('front_camera')
        })
    }

    const exitCameraBtn = document.createElement('button')
    exitCameraBtn.innerText = 'EXIT CAMERA'
    exitCameraBtn.style.cssText = `
        position: fixed;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%);
        color: white;
        background: rgba(239, 68, 68, 0.9);
        padding: 12px 24px;
        border-radius: 12px;
        border: none;
        cursor: pointer;
        font-weight: 700;
        font-size: 16px;
        z-index: 110;
        display: none;
        font-family: system-ui, sans-serif;
    `
    document.body.appendChild(exitCameraBtn)
    exitCameraBtn.addEventListener('click', () => {
        switchToMode('game')
    })

    // Character screen top bar with Admin and Logout buttons
    const characterTopBar = document.createElement('div')
    characterTopBar.id = 'character-top-bar'
    characterTopBar.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        display: none;
        gap: 16px;
        z-index: 120;
        font-family: system-ui, sans-serif;
    `

    if (isAdmin) {
        const characterAdminBtn = document.createElement('button')
        characterAdminBtn.innerText = 'Admin'
        characterAdminBtn.style.cssText = `
            color: rgba(255, 255, 255, 0.6);
            background: transparent;
            padding: 8px 16px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-weight: 500;
            font-size: 14px;
            font-family: system-ui, sans-serif;
            text-decoration: underline;
            letter-spacing: 0.5px;
            transition: color 0.2s;
        `
        characterAdminBtn.addEventListener('mouseenter', () => characterAdminBtn.style.color = '#FFD54F')
        characterAdminBtn.addEventListener('mouseleave', () => characterAdminBtn.style.color = 'rgba(255, 255, 255, 0.6)')
        characterAdminBtn.addEventListener('click', () => openAdminPanel())
        characterTopBar.appendChild(characterAdminBtn)
    }

    const characterLogoutBtn = document.createElement('button')
    characterLogoutBtn.innerText = 'Logout'
    characterLogoutBtn.style.cssText = `
        color: rgba(255, 255, 255, 0.6);
        background: transparent;
        padding: 8px 16px;
        border-radius: 8px;
        border: none;
        cursor: pointer;
        font-weight: 500;
        font-size: 14px;
        font-family: system-ui, sans-serif;
        text-decoration: underline;
        letter-spacing: 0.5px;
        transition: color 0.2s;
    `
    characterLogoutBtn.addEventListener('mouseenter', () => characterLogoutBtn.style.color = '#EF5350')
    characterLogoutBtn.addEventListener('mouseleave', () => characterLogoutBtn.style.color = 'rgba(255, 255, 255, 0.6)')
    characterLogoutBtn.addEventListener('click', () => window.location.href = '/auth/logout')
    characterTopBar.appendChild(characterLogoutBtn)
    document.body.appendChild(characterTopBar)

    function updateUIVisibility() {
        if (isVersionMismatch) return
        const invBtn = document.getElementById('inventory-btn')
        const scoreModal = document.getElementById('score-modal')
        const invModal = document.getElementById('inventory-modal')
        const shopModal = document.getElementById('shop-modal')
        const rModal = document.getElementById('realm-wait-modal')

            // Expose for window helpers
            ; (window as any).updateUIVisibility = updateUIVisibility

        isModalOpen = !!(
            (scoreModal && scoreModal.style.display === 'block') ||
            (invModal && invModal.style.display === 'block') ||
            (shopModal && shopModal.style.display === 'block') ||
            (rModal && rModal.style.display === 'block')
        )

        characterTopBar.style.display = 'none' // Default hidden

        if (currentMode === 'character') {
            const selectionCard = document.getElementById('selection-card')
            if (selectionCard) selectionCard.style.display = 'flex'

            characterTopBar.style.display = 'flex' // Show only on character screen

            exitCameraBtn.style.display = 'none'
            damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = 'none'
            if (charNavBtn) charNavBtn.style.display = 'none'
            if (cameraNavBtn) cameraNavBtn.style.display = 'none'
            shootBtn.style.display = 'none'
            joystickContainer.style.display = 'none'
            spawnBtn.style.display = 'none'
            interactBtn.style.display = 'none'
            if (invBtn) invBtn.style.display = 'none'
            if (congratsModal) congratsModal.style.display = 'none'
            if (congratsModal) congratsModal.style.display = 'none'
        } else if (currentMode === 'spectate' || currentMode === 'front_camera') {
            const selectionCard = document.getElementById('selection-card')
            if (selectionCard) selectionCard.style.display = 'none'

            exitCameraBtn.style.display = 'block'
            damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = 'none'
            if (charNavBtn) charNavBtn.style.display = 'none'
            if (cameraNavBtn) cameraNavBtn.style.display = 'none'
            shootBtn.style.display = 'none'
            joystickContainer.style.display = 'none'
            spawnBtn.style.display = 'none'
            interactBtn.style.display = 'none'
            if (invBtn) invBtn.style.display = 'none'
            if (congratsModal) congratsModal.style.display = 'none'
        } else if (currentMode === 'congratulations') {
            const selectionCard = document.getElementById('selection-card')
            if (selectionCard) selectionCard.style.display = 'none'

            exitCameraBtn.style.display = 'none'
            damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = 'none'
            if (charNavBtn) charNavBtn.style.display = 'none'
            if (cameraNavBtn) cameraNavBtn.style.display = 'none'
            shootBtn.style.display = 'none'
            joystickContainer.style.display = 'none'
            spawnBtn.style.display = 'none'
            interactBtn.style.display = 'none'
            if (invBtn) invBtn.style.display = 'none'
            if (congratsModal) congratsModal.style.display = 'block'
        } else {
            const selectionCard = document.getElementById('selection-card')
            if (selectionCard) selectionCard.style.display = 'none'

            exitCameraBtn.style.display = 'none'
            if (dragon && !dragon.isDead && damageListEl.innerHTML.includes('Dragon Damage') && !isModalOpen) damageListEl.style.display = 'block'
            else damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = isModalOpen ? 'none' : 'block'
            if (charNavBtn) charNavBtn.style.display = isModalOpen ? 'none' : 'block'
            if (cameraNavBtn) cameraNavBtn.style.display = isModalOpen ? 'none' : 'block'
            shootBtn.style.display = (!isModalOpen && dragon && !dragon.isDead && !myIsDead) ? 'flex' : 'none'
            joystickContainer.style.display = (isModalOpen || myIsDead) ? 'none' : 'block'
            interactBtn.style.display = (isModalOpen || myIsDead) ? 'none' : interactBtn.style.display
            if (invBtn) invBtn.style.display = isModalOpen ? 'none' : 'block'
            if (congratsModal) congratsModal.style.display = 'none'
        }
    }

    const appendToUI = () => {
        const uiContainer = document.querySelector('#ui-layer > div')
        if (uiContainer) {
            updateUIVisibility()
        } else {
            setTimeout(appendToUI, 100)
        }
    }
    appendToUI()

    scoreBtn.addEventListener('click', () => {
        if (Date.now() - lastModalCloseTime < 300) return
        const scoreModal = document.getElementById('score-modal')
        if (scoreModal) {
            if (scoreModal.style.display === 'none' || !scoreModal.style.display) {
                if (wsConnected && ws) ws.send(JSON.stringify({ type: 'get_scores' }))
                else console.warn('WS not connected')
                scoreModal.innerHTML = '<div style="text-align:center;">Loading...</div>'
                scoreModal.style.display = 'block'
            } else {
                scoreModal.style.display = 'none'
            }
            updateUIVisibility()
        }
    })

    function getJoystickCenter() {
        const rect = joystickContainer.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }

    document.addEventListener('touchstart', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i]
            const joystickRect = joystickContainer.getBoundingClientRect()
            const isOnJoystick = (
                touch.clientX >= joystickRect.left &&
                touch.clientX <= joystickRect.right &&
                touch.clientY >= joystickRect.top &&
                touch.clientY <= joystickRect.bottom
            )
            activeTouches.set(touch.identifier, {
                id: touch.identifier,
                startX: touch.clientX,
                startY: touch.clientY,
                currentX: touch.clientX,
                currentY: touch.clientY,
                isJoystick: isOnJoystick
            })
        }
    }, { passive: false })

    document.addEventListener('touchmove', (e) => {
        e.preventDefault()
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i]
            const state = activeTouches.get(touch.identifier)
            if (state) {
                const prevX = state.currentX
                state.currentX = touch.clientX
                state.currentY = touch.clientY
                if (state.isJoystick) {
                    const center = getJoystickCenter()
                    const maxDelta = 50
                    joystickDeltaX = Math.max(-maxDelta, Math.min(maxDelta, touch.clientX - center.x))
                    joystickDeltaY = Math.max(-maxDelta, Math.min(maxDelta, touch.clientY - center.y))
                    joystickKnob.style.transform = `translate(calc(-50% + ${joystickDeltaX}px), calc(-50% + ${joystickDeltaY}px))`
                } else {
                    const deltaX = touch.clientX - prevX
                    const p = myPlayerId ? players.get(myPlayerId) : null
                    const isActingNow = p?.isActing || false
                    if (currentMode === 'game' && !isActingNow) myRotation -= deltaX * 0.01
                    else if (currentMode === 'character' && charModel) charModel.rotation.y += deltaX * 0.01
                    else if (currentMode === 'spectate' || currentMode === 'front_camera') spectateRotationOffset -= deltaX * 0.01
                }
            }
        }
    }, { passive: false });


    // Define global helpers for Realm UI
    Object.assign(window, {
        toggleRealmReady: () => {
            if (interactBtn.innerText === 'JOIN REALM') {
                isWaitingForRealm = true
            }
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'realm_ready' }))
            }
        },
        leaveRealmLobby: () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'leave_realm_lobby' }))
            }
            isWaitingForRealm = false
            const m = document.getElementById('realm-wait-modal')
            if (m) m.style.display = 'none'
            updateUIVisibility()
        }
    });

    function updateRealmWaitModal() {
        if (!realmWaitModal) {
            realmWaitModal = document.createElement('div')
            realmWaitModal.id = 'realm-wait-modal'
            realmWaitModal.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.95); color: white; padding: 24px; border-radius: 16px;
                width: 90%; max-width: 500px; font-family: system-ui, sans-serif; z-index: 200;
                border: 2px solid #9C27B0; box-shadow: 0 0 30px rgba(156, 39, 176, 0.5);
                display: none;
            `
            document.body.appendChild(realmWaitModal)
        }

        realmWaitModal.style.display = 'block'

        const myP = realmPlayers.find(p => p.id === myPlayerId)
        const AmIReady = myP?.ready

        const listHtml = realmPlayers.map(p => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding: 10px; background: rgba(255,255,255,0.05); margin-bottom: 8px; border-radius: 8px;">
                <div style="font-weight:bold;">${Utils.escapeHtml(p.name || 'Player')}</div>
                <div style="color: ${p.ready ? '#4CAF50' : '#FFC107'}; font-weight:bold;">${p.ready ? 'READY' : 'WAITING'}</div>
            </div>
        `).join('')

        const readyButtonHtml = realmPlayers.length >= 1 ? `
            <button onclick="window.toggleRealmReady()" style="flex:1; padding: 15px; border-radius: 12px; border: none; font-weight: bold; cursor: pointer; font-size: 16px; background: ${AmIReady ? '#C0C0C0' : '#4CAF50'}; color: ${AmIReady ? '#333' : 'white'};">
                ${AmIReady ? 'Ready ✓' : 'Ready'}
            </button>
        ` : ''

        realmWaitModal.innerHTML = `
            <h2 style="margin-top:0; text-align:center; color: #E1BEE7; margin-bottom: 20px;">Realm Lobby</h2>
            <div style="margin-bottom: 20px; max-height: 300px; overflow-y: auto;">
                ${listHtml.length ? listHtml : '<div style="text-align:center; opacity:0.5;">Waiting for players...</div>'}
            </div>
            
             <div style="display:flex; gap: 10px;">
                ${readyButtonHtml}
                 <button onclick="window.leaveRealmLobby()" style="padding: 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: transparent; color: white; cursor: pointer; font-weight:bold;">
                    LEAVE
                </button>
            </div>
            <div style="text-align:center; margin-top:10px; font-size:12px; opacity:0.6;">Min 2 Players • 30s Duration</div>
        `
        updateUIVisibility()
    }

    document.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i]
            const state = activeTouches.get(touch.identifier)
            if (state && state.isJoystick) {
                joystickDeltaX = 0
                joystickDeltaY = 0
                joystickKnob.style.transform = 'translate(-50%, -50%)'
            }
            activeTouches.delete(touch.identifier)
        }
    })

    document.addEventListener('touchcancel', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i]
            const state = activeTouches.get(touch.identifier)
            if (state && state.isJoystick) {
                joystickDeltaX = 0
                joystickDeltaY = 0
                joystickKnob.style.transform = 'translate(-50%, -50%)'
            }
            activeTouches.delete(touch.identifier)
        }
    })

    const keys: Record<string, boolean> = {}
    window.addEventListener('keydown', (e) => keys[e.code] = true)
    window.addEventListener('keyup', (e) => keys[e.code] = false)

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        charCamera.aspect = window.innerWidth / window.innerHeight
        charCamera.updateProjectionMatrix()
        updateCharCamera()
        renderer.setSize(window.innerWidth, window.innerHeight)
    })

    let lastMoveTime = 0
    let lastSentX = -999
    let lastSentZ = -999
    let lastSentRotation = -999

    const bullets = new Map<string, Types.Bullet>()
    const fragments: Types.Fragment[] = []
    const trailParticles: Types.TrailParticle[] = []

    function updateBullets(serverBullets: any[]) {
        const validIds = new Set<string>()
        serverBullets.forEach((sb: any) => {
            validIds.add(sb.id)
            let b = bullets.get(sb.id)
            if (!b) {
                const isDragon = sb.ownerId === 'dragon'
                const mesh = MeshFactories.createBulletMesh(isDragon)
                mesh.position.set(sb.x, 1.5, sb.z)
                scene.add(mesh)
                b = {
                    id: sb.id,
                    x: sb.x,
                    z: sb.z,
                    vx: sb.vx,
                    vz: sb.vz,
                    ownerId: sb.ownerId,
                    mesh: mesh,
                    speed: sb.speed
                }
                bullets.set(sb.id, b)
            } else {
                b.x = sb.x
                b.z = sb.z
            }
        })
        for (const [id, b] of bullets.entries()) {
            if (!validIds.has(id)) {
                scene.remove(b.mesh)
                bullets.delete(id)
            }
        }
    }

    function updatePickups(serverPickups: any[]) {
        const validIds = new Set<string>()
        serverPickups.forEach((sp: any) => {
            validIds.add(sp.id)
            if (!pickups.has(sp.id)) {
                const mesh = MeshFactories.createPickupMesh(sp.weaponType)
                mesh.position.set(sp.x, 1, sp.z)
                scene.add(mesh)
                if (sp.playerId !== myPlayerId) {
                    mesh.visible = false
                    // Also make sure children are hidden if any
                    mesh.traverse((c: any) => {
                        if (c.isMesh) c.visible = false
                    })
                }
                pickups.set(sp.id, {
                    id: sp.id,
                    mesh,
                    weaponType: sp.weaponType,
                    playerId: sp.playerId,
                    x: sp.x,
                    z: sp.z
                })
            }
        })
        for (const [id, p] of pickups.entries()) {
            if (!validIds.has(id)) {
                scene.remove(p.mesh)
                pickups.delete(id)
            }
        }
    }

    function animate() {
        requestAnimationFrame(animate)
        const now = Date.now()
        const delta = (now - lastAnimateTime) / 1000
        lastAnimateTime = now

        const sModal = document.getElementById('score-modal')
        const iModal = document.getElementById('inventory-modal')
        const shModal = document.getElementById('shop-modal')
        const isModalOpen = (sModal && sModal.style.display === 'block') ||
            (iModal && iModal.style.display === 'block') ||
            (shModal && shModal.style.display === 'block')

        if (currentMode === 'character') {
            if (charMixer) charMixer.update(delta)
            renderer.render(charScene, charCamera)
            return
        }

        const speed = Constants.PLAYER_SPEED * delta
        let inputDx = 0
        let inputDz = 0

        if (myPlayerId && (currentMode === 'game' || currentMode === 'spectate')) {
            const p = players.get(myPlayerId)
            const isActingNow = p?.isActing || false

            if (!myIsDead && !isActingNow) {
                if (keys['ArrowUp'] || keys['KeyW']) inputDz -= 1
                if (keys['ArrowDown'] || keys['KeyS']) inputDz += 1
                if (keys['ArrowLeft'] || keys['KeyA']) inputDx -= 1
                if (keys['ArrowRight'] || keys['KeyD']) inputDx += 1
            }
            if (keys['KeyQ'] && !isActingNow) myRotation += 2.0 * delta
            if (keys['KeyE'] && !isActingNow) myRotation -= 2.0 * delta

            if (!myIsDead && !isActingNow && (Math.abs(joystickDeltaX) > 5 || Math.abs(joystickDeltaY) > 5)) {
                // Joystick input is already somewhat proportional, but let's normalize it to 0-1 range based on max radius (50)
                inputDx = joystickDeltaX / 50
                inputDz = joystickDeltaY / 50
            }

            // Normalize input vector if magnitude > 1 to prevent diagonal speed boost
            // and ensure keyboard (1,1) isn't faster than (0,1)
            const len = Math.hypot(inputDx, inputDz)
            if (len > 1.0) {
                inputDx /= len
                inputDz /= len
            }
        }

        const hasInput = (inputDx || 0) !== 0 || (inputDz || 0) !== 0
        const elapsed = now - lastFireTime
        const cooldownCircle = document.getElementById('cooldown-circle')

        if (elapsed < Constants.FIRE_COOLDOWN) {
            shootBtn.style.background = 'rgba(100, 100, 100, 0.8)'
            shootBtn.style.cursor = 'not-allowed'
            if (cooldownCircle) {
                const remaining = Constants.FIRE_COOLDOWN - elapsed
                const progress = remaining / Constants.FIRE_COOLDOWN
                const currentOffset = circumference * (1 - progress)
                cooldownCircle.style.strokeDashoffset = `${currentOffset}px`
            }
        } else {
            shootBtn.style.background = 'rgba(244, 67, 54, 0.8)'
            shootBtn.style.cursor = 'pointer'
            if (cooldownCircle) cooldownCircle.style.strokeDashoffset = `${circumference}px`
        }

        for (const b of bullets.values()) {
            const bulletLerp = 0.3
            b.mesh.position.x = Utils.lerp(b.mesh.position.x, b.x, bulletLerp)
            b.mesh.position.z = Utils.lerp(b.mesh.position.z, b.z, bulletLerp)

            const field = b.mesh.getObjectByName('electricField')
            if (field) {
                field.rotation.z += 0.1
                field.rotation.x += 0.05
                field.scale.setScalar(0.8 + Math.sin(Date.now() * 0.01) * 0.2)
                if (Math.random() > 0.3) {
                    const pGeo = new THREE.SphereGeometry(0.1, 4, 4)
                    const pMat = new THREE.MeshStandardMaterial({
                        color: 0x00FFFF,
                        emissive: 0x00FFFF,
                        emissiveIntensity: 1.0,
                        transparent: true,
                        opacity: 0.8
                    })
                    const pMesh = new THREE.Mesh(pGeo, pMat)
                    pMesh.position.copy(b.mesh.position)
                    scene.add(pMesh)
                    trailParticles.push({ mesh: pMesh, life: 1.0, maxLife: 500 })
                }
            }
        }

        for (let i = trailParticles.length - 1; i >= 0; i--) {
            const tp = trailParticles[i]
            tp.life -= delta * (1000 / tp.maxLife)
            if (tp.life <= 0) {
                scene.remove(tp.mesh)
                trailParticles.splice(i, 1)
            } else {
                tp.mesh.scale.setScalar(tp.life)
                tp.mesh.material.opacity = tp.life
            }
        }

        if (lobbyState) {
            lobbyState.controlPanel.children.forEach((child: any) => {
                if (child.name === 'floatingCylinder') {
                    const phase = child.userData.phase || 0
                    const orbitRadius = child.userData.orbitRadius || 1.2
                    const time = now * 0.001
                    const angle = time + phase
                    child.position.x = Math.cos(angle) * orbitRadius
                    child.position.z = Math.sin(angle) * orbitRadius
                    child.position.y = 1.5 + Math.sin(time * 1.5 + phase * 2) * 0.5
                    child.rotation.x += 0.01
                    child.rotation.z += 0.01
                }
            })
        }

        for (let i = fragments.length - 1; i >= 0; i--) {
            const f = fragments[i]
            f.life -= delta * (1000 / f.maxLife)
            f.mesh.position.x += f.velocity.x
            f.mesh.position.y += f.velocity.y
            f.mesh.position.z += f.velocity.z
            f.velocity.y -= 0.01
            if (f.life <= 0) {
                scene.remove(f.mesh)
                fragments.splice(i, 1)
            } else {
                f.mesh.scale.set(f.life, f.life, f.life)
                f.mesh.material.opacity = f.life
                f.mesh.material.transparent = true
            }
        }

        if (dragon && !dragon.isDead) {
            dragon.currentX = Utils.lerp(dragon.currentX, dragon.targetX, Constants.LERP_SPEED)
            dragon.currentZ = Utils.lerp(dragon.currentZ, dragon.targetZ, Constants.LERP_SPEED)
            dragon.currentRotation = Utils.lerpAngle(dragon.currentRotation, dragon.targetRotation, Constants.ROTATION_LERP_SPEED)
            const now = Date.now()
            let hover = Math.sin(now * 0.002) * 0.5 + 2
            let spawnOpacity = 1
            if (dragon.spawnStartTime) {
                const spawnElapsed = now - dragon.spawnStartTime
                const spawnDuration = 2000
                const spawnT = Math.min(1, spawnElapsed / spawnDuration)
                hover -= (1 - spawnT) * 5
                spawnOpacity = spawnT
                if (spawnT >= 1) dragon.spawnStartTime = undefined
            }
            dragon.mesh.position.set(dragon.currentX, hover, dragon.currentZ)
            dragon.mesh.rotation.y = dragon.currentRotation
            dragon.mesh.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true
                    child.material.opacity = spawnOpacity
                }
            })
            if (dragon.labelGroup) {
                dragon.labelGroup.traverse((child: any) => {
                    if (child.material) {
                        child.material.transparent = true
                        child.material.opacity = spawnOpacity
                    }
                })
            }
            const wingSpeed = 0.005
            const wingAngle = Math.sin(now * wingSpeed) * 0.5
            if (dragon.wings && dragon.wings.length === 2) {
                dragon.wings[0].rotation.z = wingAngle
                dragon.wings[1].rotation.z = -wingAngle
            }
            if (dragon.labelGroup) {
                dragon.labelGroup.position.set(dragon.currentX, hover + 5.0, dragon.currentZ)
                dragon.labelGroup.lookAt(camera.position)
                const dist = camera.position.distanceTo(dragon.labelGroup.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                dragon.labelGroup.scale.set(scaleFactor, scaleFactor, scaleFactor)
            }
            const chargeElapsed = now - (dragon.chargeStartTime || 0)
            const chargeDuration = 1000
            if (chargeElapsed < chargeDuration) {
                if (!dragon.chargingMesh) {
                    dragon.chargingMesh = MeshFactories.createChargingStarMesh()
                    dragon.mesh.add(dragon.chargingMesh)
                    dragon.chargingMesh.position.set(0, 2.6, 4.75)
                }
                const chargeT = chargeElapsed / chargeDuration
                const chargeScale = 0.1 + chargeT * 1.4
                dragon.chargingMesh.scale.set(chargeScale, chargeScale, chargeScale)
                dragon.chargingMesh.rotation.z += 0.2
                dragon.chargingMesh.rotation.y += 0.1
                dragon.chargingMesh.traverse((c: any) => {
                    if (c.material) c.material.emissiveIntensity = 1 + Math.random() * 2
                })
            } else if (dragon.chargingMesh) {
                dragon.mesh.remove(dragon.chargingMesh)
                dragon.chargingMesh = null
            }
            const flinchElapsed = now - (dragon.flinchTime || 0)
            const flinchDuration = 300
            if (flinchElapsed < flinchDuration) {
                const flinchT = flinchElapsed / flinchDuration
                const pulse = 1.0 + Math.sin(flinchT * Math.PI) * 0.1
                dragon.mesh.scale.set(pulse, pulse, pulse)
                dragon.mesh.traverse((c: any) => {
                    if (c.isMesh && c.material && c.material.name !== 'healthBarMat' && c.material.name !== 'eyeMat') {
                        if (c.material.emissive) {
                            c.material.emissive.set(0xff0000)
                            c.material.emissiveIntensity = (1 - flinchT) * 0.5
                        }
                    }
                })
                dragon.mesh.rotation.x = -Math.sin(flinchT * Math.PI) * 0.2
            } else {
                dragon.mesh.scale.set(1, 1, 1)
                dragon.mesh.rotation.x = 0
                dragon.mesh.traverse((c: any) => {
                    if (c.isMesh && c.material && c.material.name !== 'eyeMat' && c.material.name !== 'healthBarMat') {
                        if (c.material.emissive) c.material.emissiveIntensity = 0
                    }
                })
            }
        } else if (dragon && dragon.isDead) {
            const elapsed = Date.now() - (dragon.deathTime || Date.now())
            const duration = 2000
            const t = Math.min(1, elapsed / duration)
            dragon.mesh.position.y = Utils.lerp(dragon.mesh.position.y, 0, 0.05)
            dragon.mesh.rotation.z = t * 0.5
            dragon.mesh.rotation.x = t * 0.2
            const opacity = 1 - t
            dragon.mesh.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true
                    child.material.opacity = opacity
                }
            })
            if (t >= 1) {
                scene.remove(dragon.mesh)
                dragon = null
            }
        }

        let totalX = 0
        let totalZ = 0
        let pickupCount = 0

        for (const [id, p] of pickups.entries()) {
            p.mesh.rotation.y += 0.05 * (delta * 60)
            const bob = Math.sin(Date.now() * 0.005) * 0.2
            p.mesh.position.y = 1 + bob

            totalX += p.x
            totalZ += p.z
            if (p.playerId === myPlayerId) pickupCount++

            if (p.playerId === myPlayerId && !myIsDead) {
                const dx = p.x - myX
                const dz = p.z - myZ
                if (dx * dx + dz * dz < 4.0) {
                    if (wsConnected && ws) {
                        ws.send(JSON.stringify({ type: 'collect_pickup', pickupId: p.id }))
                        scene.remove(p.mesh)
                        pickups.delete(p.id)
                    }
                }
            }
        }

        if (globalPickupIndicator) {
            if (pickupCount > 0) {
                globalPickupIndicator.visible = true
                // We need to re-calculate average position for ONLY user's pickups
                let myTotalX = 0
                let myTotalZ = 0
                let myCount = 0
                for (const pv of pickups.values()) {
                    if (pv.playerId === myPlayerId) {
                        myTotalX += pv.x
                        myTotalZ += pv.z
                        myCount++
                    }
                }

                if (myCount > 0) {
                    globalPickupIndicator.position.x = myTotalX / myCount
                    globalPickupIndicator.position.z = myTotalZ / myCount
                    globalPickupIndicator.position.y = 2 + Math.sin(Date.now() * 0.005) * 1.5
                } else {
                    globalPickupIndicator.visible = false
                }
            } else {
                globalPickupIndicator.visible = false
            }
        }

        // Realm Interaction


        for (const s of sheeps.values()) {
            s.currentX = Utils.lerp(s.currentX, s.targetX, Constants.LERP_SPEED)
            s.currentZ = Utils.lerp(s.currentZ, s.targetZ, Constants.LERP_SPEED)
            s.currentRotation = Utils.lerpAngle(s.currentRotation, s.targetRotation, Constants.ROTATION_LERP_SPEED)
            let hopY = 0
            if (s.isHopping) {
                s.hopPhase += delta * 7.5
                hopY = Math.abs(Math.sin(s.hopPhase)) * 0.4
            } else {
                if (s.hopPhase % Math.PI > 0.1) {
                    s.hopPhase += delta * 7.5
                    hopY = Math.abs(Math.sin(s.hopPhase)) * 0.4
                } else s.hopPhase = 0
            }
            if (s.hopPhase > Math.PI * 2) s.hopPhase -= Math.PI * 2
            s.mesh.position.set(s.currentX, hopY, s.currentZ)
            s.mesh.rotation.y = s.currentRotation
            s.mesh.visible = true // Managers handle removal/add
            if (s.label) {
                s.label.visible = true
                s.label.position.set(s.currentX, hopY + 1.8, s.currentZ)
                const dist = camera.position.distanceTo(s.label.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                s.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            }
        }
        if (lobbyState) {
            if (lobbyState.realmStructure.userData.portalRing) {
                lobbyState.realmStructure.userData.portalRing.rotation.z += delta * 2
                const scale = 1 + Math.sin(now * 0.003) * 0.1
                lobbyState.realmStructure.userData.portalRing.scale.set(scale, scale, scale)
            }
        }

        // Animate Ponds (Ripples)
        pondIndicators.forEach(p => {
            if (p.userData.active) {
                const ripple = p.getObjectByName('ripple')
                if (ripple) {
                    // Simple repeating ripple
                    // Use a time-based phase offset per pond if desired, or just global time
                    const t = (now % 2000) / 2000 // 0 to 1 over 2s
                    const maxScale = 15.0 // Expands to cover pond (radius ~3.5 -> scale ~10+)
                    // Ring geometry is small (0.3), so scale needs to be big or geometry big.
                    // Geometry is 0.1-0.3. To reach 3.0, scale ~15.

                    ripple.scale.setScalar(1 + t * 30)
                    ripple.material.opacity = 0.8 * (1 - t) // Fade out
                }
                // Pulse the outer ring
                const baseRing = p.getObjectByName('baseRing')
                if (baseRing) {
                    const pulse = 1.0 + Math.sin(now * 0.005) * 0.05
                    baseRing.scale.setScalar(pulse)
                    if (baseRing.material) baseRing.material.color.setHex(0x00B0FF) // Blue
                }
            } else {
                const ripple = p.getObjectByName('ripple')
                if (ripple) ripple.material.opacity = 0

                const baseRing = p.getObjectByName('baseRing')
                if (baseRing) {
                    baseRing.scale.setScalar(1.0)
                    // Inactive color provided in updatePondIndicators, ensure consistent
                }
            }
        })

        // Animate wheat swaying
        farmingUI.animateWheat(farmPlotWheat, players, now)

        for (const [id, playerData] of players.entries()) {
            if (id !== myPlayerId) {
                playerData.currentX = Utils.lerp(playerData.currentX, playerData.targetX, Constants.LERP_SPEED)
                playerData.currentZ = Utils.lerp(playerData.currentZ, playerData.targetZ, Constants.LERP_SPEED)
                playerData.currentRotation = Utils.lerpAngle(playerData.currentRotation, playerData.targetRotation, Constants.ROTATION_LERP_SPEED)
                const isMoving = Math.abs(playerData.currentX - playerData.targetX) > 0.05 || Math.abs(playerData.currentZ - playerData.targetZ) > 0.05
                const now = Date.now()
                if (playerData.isDead) {
                    const tx = playerData.deathX ?? playerData.currentX
                    const tz = playerData.deathZ ?? playerData.currentZ
                    playerData.mesh.position.set(tx, 0, tz)
                    playerData.label.position.set(tx, 2.6, tz)
                    const dist = camera.position.distanceTo(playerData.label.position)
                    const scaleFactor = Math.max(0.1, dist / 12)
                    playerData.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
                } else {
                    const bounce = isMoving ? Math.sin(now * 0.015) * 0.1 : 0
                    playerData.mesh.position.set(playerData.currentX, bounce, playerData.currentZ)
                    playerData.mesh.rotation.y = playerData.currentRotation + Math.PI
                    if (playerData.isActing) {
                        playerData.mesh.rotation.x = 0
                        playerData.mesh.rotation.z = 0
                    } else {
                        playerData.mesh.rotation.x = 0
                        playerData.mesh.rotation.z = 0
                    }
                    playerData.label.position.set(playerData.currentX, 3.8, playerData.currentZ)
                    const dist = camera.position.distanceTo(playerData.label.position)
                    const scaleFactor = Math.max(0.1, dist / 12)
                    playerData.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
                    if (playerData.mixer) {
                        playerData.mixer.update(delta)
                        let activeAction: any = null
                        if (playerData.isActing) {
                            activeAction = playerData.actions['character_selection'] || playerData.actions['Interact'] || playerData.actions['idle'] || playerData.actions['Idle']
                            playerData.mixer.timeScale = 0.5
                        } else {
                            const run = playerData.actions['Run'] || playerData.actions['run']
                            const walk = playerData.actions['walking'] || playerData.actions['Walk'] || playerData.actions['walk']

                            // Check if player has the staff_beginner weapon
                            const hasStaffBeginner = playerData.weapon === 'staff_beginner'
                            const idle = hasStaffBeginner
                                ? (playerData.actions['Idle'] || playerData.actions['idle'])
                                : (playerData.actions['idle_noweapon'] || playerData.actions['Idle'] || playerData.actions['idle'])

                            activeAction = (isMoving && (walk || run)) ? (walk || run) : idle
                            playerData.mixer.timeScale = 1.0
                        }
                        if (activeAction) {
                            if (!activeAction.isRunning()) {
                                Object.values(playerData.actions).forEach((act: any) => {
                                    if (act !== activeAction) act.fadeOut(0.2)
                                })
                                activeAction.reset().fadeIn(0.2).play()
                            }
                        }
                    }
                    // Only skip farming tool update if player has realm role (Fisher/Cooker handle their own tools)
                    const hasRealmRole = playerData.role && playerData.role !== 'None'
                    if (!hasRealmRole) {
                        farmingUI.updateToolMeshForPlayer(playerData, THREE)
                    }
                    // Only float/spin weapon if NOT attached to a bone (fallback case)
                    // Check for bone names that exist in this model: hands, leftHand
                    const hasHandBone = playerData.mesh.getObjectByName('hands') ||
                        playerData.mesh.getObjectByName('leftHand') ||
                        playerData.mesh.getObjectByName('hand_R')
                    if (playerData.weaponMesh && !hasHandBone) {
                        playerData.weaponMesh.rotation.y += 0.02
                        playerData.weaponMesh.position.y = 2.0 + Math.sin(now * 0.003) * 0.1
                    }
                }
            }
        }

        if (myPlayerId && !myIsDead) {
            const playerData = players.get(myPlayerId)
            if (playerData && playerData.mixer) {
                playerData.mixer.update(delta)
                let activeAction: any = null
                if (playerData.isActing) {
                    activeAction = playerData.actions['character_selection'] || playerData.actions['Interact'] || playerData.actions['idle'] || playerData.actions['Idle']
                    playerData.mixer.timeScale = 0.5
                } else {
                    const run = playerData.actions['Run'] || playerData.actions['run']
                    const walk = playerData.actions['walking'] || playerData.actions['Walk'] || playerData.actions['walk']

                    // Check if player has the staff_beginner weapon
                    const hasStaffBeginner = playerData.weapon === 'staff_beginner'
                    const idle = hasStaffBeginner
                        ? (playerData.actions['Idle'] || playerData.actions['idle'])
                        : (playerData.actions['idle_noweapon'] || playerData.actions['Idle'] || playerData.actions['idle'])

                    activeAction = (hasInput && (walk || run)) ? (walk || run) : idle
                    playerData.mixer.timeScale = 1.0
                }
                if (activeAction) {
                    if (!activeAction.isRunning()) {
                        Object.values(playerData.actions).forEach((act: any) => {
                            if (act !== activeAction) act.fadeOut(0.2)
                        })
                        activeAction.reset().fadeIn(0.2).play()
                    }
                }
            }
            if (playerData) {
                // Only update farming tool for non-realm players
                const hasRealmRole = playerData.role && playerData.role !== 'None'
                if (!hasRealmRole) {
                    farmingUI.updateToolMeshForPlayer(playerData, THREE)
                }
            }
        }

        const speedVal = Constants.PLAYER_SPEED * delta
        const isTargetedByDragon = dragon && !dragon.isDead && dragon.targetId === myPlayerId
        const localPlayer = myPlayerId ? players.get(myPlayerId) : null

        // Check acting state directly - don't cache it since it can change mid-frame from button clicks
        if (myPlayerId && !myIsDead && currentMode === 'game' && !isModalOpen && !isTargetedByDragon && !localPlayer?.isActing) {
            let nearShop = false
            let nearPlotIndex = -1
            let nearPanel = false
            let nearRealm = false

            if (lobbyState) {
                const dShop = Math.hypot(myX - (-18), myZ - (-18))
                if (dShop < 4) nearShop = true
                lobbyState.farmPlotGroups.forEach((plot, i) => {
                    const d = Math.hypot(myX - plot.position.x, myZ - plot.position.z)
                    if (d < 2.5) nearPlotIndex = i
                })
                const distToPanel = Math.hypot(myX - (-22), myZ - 22)
                const isDragonDead = !dragon || dragon.isDead
                if (distToPanel < 5 && isDragonDead) nearPanel = true

                const dRealm = Math.hypot(myX - 20, myZ - 20)
                if (dRealm < 5) nearRealm = true
            }

            if (nearShop) {
                interactBtn.innerText = 'OPEN SHOP'
                interactBtn.style.display = 'block'
                interactBtn.style.background = '#A7F3D0'
                interactBtn.style.border = '2px solid black'
                interactBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                interactBtn.style.color = 'black'
                interactBtn.style.textShadow = 'none'
                interactBtn.onclick = () => showShopModal()
            } else if (nearRealm) {
                interactBtn.style.display = 'block'
                interactBtn.innerText = 'JOIN REALM'
                interactBtn.style.background = '#E1BEE7'
                interactBtn.style.border = '2px solid black'
                interactBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                interactBtn.style.color = 'black'
                interactBtn.style.textShadow = 'none'
                interactBtn.onclick = () => {
                    isWaitingForRealm = true
                    if (wsConnected && ws) {
                        ws.send(JSON.stringify({ type: 'join_realm_lobby' }))
                    }
                }
            } else {
                // Check Fishing First (Realm)
                let handled = false
                if (fishingUI && localPlayer) {
                    const fishingHandled = fishingUI.checkProximity(
                        myPlayerId,
                        players,
                        pondsState,
                        localPlayer.role,
                        localPlayer.heldItem,
                        myX,
                        myZ
                    )
                    if (fishingHandled) handled = true
                    if (fishingHandled) handled = true
                }

                if (!handled && nearPlotIndex !== -1) {
                    // Handle farm plot proximity
                    farmingUI.checkFarmProximity(myX, myZ, myPlayerId, lobbyState, farmPlotsState, inventory, players, startFarmingAction)
                    handled = true
                }

                if (!handled) {
                    interactBtn.style.display = 'none'
                }
            }
            if (nearPanel) {
                spawnBtn.style.display = 'block'
                spawnBtn.style.background = '#A7F3D0'
                spawnBtn.style.border = '2px solid black'
                spawnBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                spawnBtn.style.color = 'black'
                spawnBtn.style.textShadow = 'none'
            } else {
                spawnBtn.style.display = 'none'
            }
        } else if (!localPlayer?.isActing) {
            interactBtn.style.display = 'none'
            spawnBtn.style.display = 'none'
        }

        if (hasInput && currentMode === 'game') {
            const sin = Math.sin(myRotation)
            const cos = Math.cos(myRotation)
            const fwdX = -sin
            const fwdZ = -cos
            const rightX = cos
            const rightZ = -sin
            let nextX = myX + (fwdX * -inputDz + rightX * inputDx) * speed
            let nextZ = myZ + (fwdZ * -inputDz + rightZ * inputDx) * speed

            if (lobbyState) {
                const obeliskX = -22, obeliskZ = 22
                const obeliskRadius = 1.2
                const distToObelisk = Math.hypot(nextX - obeliskX, nextZ - obeliskZ)
                if (distToObelisk < obeliskRadius) {
                    const angle = Math.atan2(nextZ - obeliskZ, nextX - obeliskX)
                    nextX = obeliskX + Math.cos(angle) * obeliskRadius
                    nextZ = obeliskZ + Math.sin(angle) * obeliskRadius
                }
                const storeX = -18, storeZ = -18
                const storeRadius = 2.8
                const distToStore = Math.hypot(nextX - storeX, nextZ - storeZ)
                if (distToStore < storeRadius) {
                    const angle = Math.atan2(nextZ - storeZ, nextX - storeX)
                    nextX = storeX + Math.cos(angle) * storeRadius
                    nextZ = storeZ + Math.sin(angle) * storeRadius
                }
            }

            if (currentMode === 'game') {
                myX = nextX
                myZ = nextZ
            }
            myX = Math.max(-Constants.BOUNDS, Math.min(Constants.BOUNDS, myX))
            myZ = Math.max(-Constants.BOUNDS, Math.min(Constants.BOUNDS, myZ))
        }

        const playerD = myPlayerId ? players.get(myPlayerId) : null
        if (playerD) {
            const playerData = playerD
            const now = Date.now()
            const isMoving = hasInput
            const bounce = isMoving ? Math.sin(now * 0.015) * 0.1 : 0
            const tx = myIsDead ? (playerData.deathX ?? myX) : myX
            const tz = myIsDead ? (playerData.deathZ ?? myZ) : myZ
            playerData.mesh.position.set(tx, bounce, tz)
            if (!myIsDead) {
                playerData.mesh.rotation.y = myRotation + Math.PI
                if (playerData.isActing) {
                    playerData.mesh.rotation.x = 0
                    playerData.mesh.rotation.z = 0
                } else {
                    playerData.mesh.rotation.x = 0
                    playerData.mesh.rotation.z = 0
                }
            }
            const labelHeight = myIsDead ? 4.3 : 3.8
            playerData.label.position.set(tx, labelHeight, tz)
            const dist = camera.position.distanceTo(playerData.label.position)
            const scaleFactor = Math.max(0.1, dist / 12)
            playerData.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            if (!myIsDead && currentMode === 'game') {
                shootBtn.style.display = (dragon && !dragon.isDead) ? 'flex' : 'none'
            }
            // Only spin/float weapon for non-realm players (realm players have proper bone attachment)
            const hasRealmRole = playerData.role && playerData.role !== 'None'
            if (playerData.weaponMesh && !hasRealmRole) {
                playerData.weaponMesh.rotation.y += 0.02
                playerData.weaponMesh.position.y = 2.0 + Math.sin(now * 0.003) * 0.1
            }
        }

        const nowTime = Date.now()
        if (nowTime - lastMoveTime > Constants.MOVE_THROTTLE && wsConnected && ws) {
            if (Math.abs(myX - lastSentX) > 0.001 ||
                Math.abs(myZ - lastSentZ) > 0.001 ||
                Math.abs(myRotation - lastSentRotation) > 0.001) {
                ws.send(JSON.stringify({ type: 'move', x: myX, z: myZ, rotation: myRotation }))
                lastMoveTime = nowTime
                lastSentX = myX
                lastSentZ = myZ
                lastSentRotation = myRotation
            }
        }

        if (myPlayerId) {
            if (currentMode === 'spectate') {
                const specDist = 4.0
                const specHeight = 1.6
                const angle = myRotation + Math.PI + spectateRotationOffset
                const camX = myX + Math.sin(angle) * specDist
                const camZ = myZ + Math.cos(angle) * specDist
                camera.position.set(camX, specHeight, camZ)
                camera.lookAt(myX, 1.2, myZ)
            } else if (currentMode === 'front_camera') {
                // Front view centered on player with swipe rotation
                const specDist = 3.5
                const specHeight = 1.6
                // Initial front view (PI) + manual rotation offset
                const angle = myRotation + Math.PI + spectateRotationOffset
                const camX = myX + Math.sin(angle) * specDist
                const camZ = myZ + Math.cos(angle) * specDist
                camera.position.set(camX, specHeight, camZ)
                camera.lookAt(myX, 1.4, myZ)
            } else if (currentMode === 'congratulations') {
                const specDist = 3.5
                const specHeight = 1.6
                const angle = myRotation + Math.PI
                const camX = myX + Math.sin(angle) * specDist
                const camZ = myZ + Math.cos(angle) * specDist
                camera.position.set(camX, specHeight, camZ)
                camera.lookAt(myX, 1.4, myZ)
            } else {
                // Game mode
                const playerData = players.get(myPlayerId)

                // Check if fishingUI has animation lock (don't override camera during pass_fish)
                const isFishingAnimationLocked = fishingUI && fishingUI.isAnimationLocked

                if (!isFishingAnimationLocked) {
                    if (playerData && playerData.isActing && playerData.actionType === 'fishing') {
                        // Fishing Side View: Camera to the side of the player, facing them
                        // Find the active pond to position camera looking toward it
                        const activePond = pondsState.find(p => p.active)
                        const camDistance = 4.0
                        const camHeight = 1.8

                        if (activePond) {
                            // Position camera perpendicular to player-pond line
                            const dx = activePond.x - myX
                            const dz = activePond.z - myZ
                            const len = Math.hypot(dx, dz)
                            // Perpendicular vector
                            const perpX = len > 0 ? -dz / len : 1
                            const perpZ = len > 0 ? dx / len : 0

                            const camX = myX + perpX * camDistance
                            const camZ = myZ + perpZ * camDistance
                            camera.position.set(camX, camHeight, camZ)
                            // Look at point between player and pond
                            const midX = (myX + activePond.x) / 2
                            const midZ = (myZ + activePond.z) / 2
                            camera.lookAt(midX, 1.2, midZ)
                        } else {
                            // Fallback: side view of player
                            const sideAngle = myRotation + Math.PI / 2
                            const camX = myX + Math.sin(sideAngle) * camDistance
                            const camZ = myZ + Math.cos(sideAngle) * camDistance
                            camera.position.set(camX, camHeight, camZ)
                            camera.lookAt(myX, 1.2, myZ)
                        }
                    } else if (playerData && playerData.isActing) {
                        // Farming View: Closer to a front view but still slightly off to the side
                        const camDistance = 3.5
                        const camHeight = 1.6
                        const frontSideAngle = myRotation + Math.PI + 0.5

                        const targetCamX = myX + Math.sin(frontSideAngle) * camDistance
                        const targetCamZ = myZ + Math.cos(frontSideAngle) * camDistance
                        camera.position.set(targetCamX, camHeight, targetCamZ)
                        camera.lookAt(myX, 1.5, myZ)
                    } else {
                        // Normal Third Person
                        const camDistance = 7.5
                        const camHeight = 5
                        const camX = myX + Math.sin(myRotation) * camDistance
                        const camZ = myZ + Math.cos(myRotation) * camDistance
                        camera.position.set(camX, camHeight, camZ)
                        camera.lookAt(myX, 2.5, myZ)
                        camera.lookAt(myX, 3.5, myZ)
                    }
                }
                // If animation locked, don't change camera (let fishingUI control it)
            }
        }
        if (lobbyState) {
            [lobbyState.controlPanelLabel, lobbyState.shopLabel, lobbyState.farmLabel, lobbyState.realmLabel].forEach(label => {
                if (label) {
                    const dist = camera.position.distanceTo(label.position)
                    const scaleFactor = Math.max(0.1, dist / 12)
                    label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
                }
            })
        }
        if (currentCountdownLabel) {
            const dist = camera.position.distanceTo(currentCountdownLabel.position)
            const scaleFactor = Math.max(0.1, dist / 12)
            currentCountdownLabel.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
        }
        if (myPlayerId && isInRealm) {
            const farmingInteraction = farmingUI.checkFarmProximity(myX, myZ, myPlayerId, lobbyState, farmPlotsState, inventory, players, (t, id) => startFarmingAction(t, id))

            // If not farming, check fishing
            if (farmingInteraction === -1 && fishingUI) {
                // Assuming my role is available in players map
                const me = players.get(myPlayerId)
                fishingUI.checkProximity(myPlayerId, players, pondsState, me?.role, me?.heldItem, myX, myZ)
            }
        }
        renderer.render(scene, camera)
    }
    // Initialization
    versionInterval = setInterval(checkVersion, 30000)
    checkVersion()
    switchToScene('lobby')

    // If player has active realm, connect immediately
    if (initialActiveRealmId) {
        console.log('[CLIENT] Active realm detected on init, connecting immediately:', initialActiveRealmId)
        connectWebSocket(true)
    }

    animate()
}
