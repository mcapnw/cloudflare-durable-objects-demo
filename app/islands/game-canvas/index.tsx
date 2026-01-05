import { useEffect, useRef } from 'hono/jsx'
import * as Types from './types'
import * as Constants from './constants'
import * as Utils from './utils'
import * as MeshFactories from './meshFactories'
import * as UIGenerators from './uiGenerators'

export default function GameCanvas({ userId, firstName, username, gender, faceIndex, initialCoins, initialInventory }: Types.GameCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current) return
        Promise.all([
            import('three'),
            import('three/examples/jsm/loaders/GLTFLoader.js'),
            import('three/examples/jsm/utils/SkeletonUtils.js')
        ]).then(([THREE, { GLTFLoader }, SkeletonUtils]) => {
            initGame(THREE, { GLTFLoader, SkeletonUtils }, containerRef.current!, userId || 'anonymous', firstName || 'Player', username, gender, faceIndex, initialCoins, initialInventory)
        })
    }, [])

    return (
        <div ref={containerRef} id="game-container" style="width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; touch-action: none;"></div>
    )
}

function initGame(THREE: any, LOADERS: { GLTFLoader: any, SkeletonUtils: any }, container: HTMLElement, myUserId: string, myFirstName: string, initialUsername?: string, initialGender?: 'male' | 'female', initialFaceIndex?: number, initialCoins: number = 0, initialInventory: string[] = []) {
    // Initialize Factories
    MeshFactories.initFactories(THREE, LOADERS.SkeletonUtils)

    const { GLTFLoader, SkeletonUtils } = LOADERS
    const textureLoader = new THREE.TextureLoader()
    const gltfLoader = new GLTFLoader()

    // Version Check
    let isVersionMismatch = false
    async function checkVersion() {
        try {
            const resp = await fetch('/api/version')
            const data = (await resp.json()) as { version?: string }
            if (data.version && data.version !== Constants.CLIENT_VERSION) {
                isVersionMismatch = true
                clearInterval(versionInterval)
                UIGenerators.showUpdateOverlay(data.version)
            }
        } catch (err) {
            console.error('Failed to check version:', err)
        }
    }
    checkVersion()
    const versionInterval = setInterval(checkVersion, 30000)

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

    // Scene Modes
    let currentMode: 'game' | 'character' | 'spectate' = 'character'
    let spectateRotationOffset = 0
    let myUsername = initialUsername || ''
    let myGender: 'male' | 'female' = initialGender || 'male'

    // WebSocket vars
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/game`
    let ws: WebSocket | null = null
    let wsConnected = false
    let currentCountdownLabel: any = null

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87ceeb)

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
    `
    document.body.appendChild(scoreModal)

    // Dragon Damage List UI
    const damageListEl = document.createElement('div')
    damageListEl.id = 'dragon-damage-list'
    damageListEl.style.cssText = `
        position: fixed;
        top: 60px;
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

    function updateDamageList(list: { name: string, damage: number }[]) {
        if (!list || list.length === 0) {
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

    const controlPanel = MeshFactories.createControlPanelMesh()
    controlPanel.position.set(-22, 0, 22)
    controlPanel.scale.set(1.5, 1.5, 1.5)
    scene.add(controlPanel)

    const shop = MeshFactories.createShopMesh(textureLoader)
    shop.position.set(-18, 0, -18)
    shop.rotation.y = Math.PI / 4
    scene.add(shop)

    const farmPlotGroups: any[] = []
    const farmPlotWheat: (any | null)[] = new Array(9).fill(null)
    const farmStartX = 11, farmStartZ = -5
    for (let i = 0; i < 9; i++) {
        const x = farmStartX + (i % 3) * 5.0
        const z = farmStartZ + Math.floor(i / 3) * 5.0
        const plot = MeshFactories.createFarmPlotMesh()
        plot.position.set(x, 0, z)
        scene.add(plot)
        farmPlotGroups.push(plot)
    }

    const controlPanelLabel = UIGenerators.createTextSprite(THREE, 'Obelisk', false, '#000000', 'transparent')
    controlPanelLabel.position.set(-22, 5.5, 22)
    scene.add(controlPanelLabel)
    const shopLabel = UIGenerators.createTextSprite(THREE, 'Store', false, '#000000', 'transparent')
    shopLabel.position.set(-18, 6, -18)
    scene.add(shopLabel)
    const farmLabel = UIGenerators.createTextSprite(THREE, 'Farm', false, '#000000', 'transparent')
    farmLabel.position.set(16, 5, 0)
    scene.add(farmLabel)

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
        if (!charModel) return
        const faceName = MeshFactories.charFaces[currentFaceIndex]
        const texture = MeshFactories.loadedTextures.get(faceName)
        if (!texture) return
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

    const players = new Map<string, Types.PlayerData>()
    const pickups = new Map<string, Types.PickupData>()
    let dragon: Types.DragonData | null = null
    const sheeps = new Map<string, Types.SheepData>()
    let coins = initialCoins
    let inventory = initialInventory
    let farmPlotsState: any[] = []

    let myPlayerId: string | null = null
    let myX = 0
    let myZ = 0
    let myRotation = 0
    let myIsDead = false

    let lastAnimateTime = Date.now()
    let lastModalCloseTime = 0
    let lastFireTime = 0

    const reconnectOverlay = document.createElement('div')
    reconnectOverlay.id = 'reconnect-overlay'
    reconnectOverlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.7); color: white; display: none;
        flex-direction: column; justify-content: center; align-items: center;
        z-index: 9999; font-family: system-ui, sans-serif; pointer-events: auto;
    `
    const reconnectText = document.createElement('div')
    reconnectText.style.cssText = 'font-size: 24px; font-weight: bold; color: #FFD54F;'
    reconnectOverlay.appendChild(reconnectText)
    document.body.appendChild(reconnectOverlay)

    function connectWebSocket(isInitial: boolean = false) {
        if (isVersionMismatch) return
        if (currentMode === 'character') return
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return

        reconnectText.innerText = isInitial ? 'Connecting...' : 'Attempting to re-establish connection...'
        reconnectOverlay.style.display = 'flex'

        const params = new URLSearchParams()
        params.append('faceIndex', currentFaceIndex.toString())
        params.append('gender', charGender)
        params.append('username', myUsername || '')
        params.append('firstName', myFirstName || '')

        ws = new WebSocket(`${wsUrl}?${params.toString()}`)

        ws.onopen = () => {
            wsConnected = true
            console.log('WebSocket connected')
            reconnectOverlay.style.display = 'none'
            checkVersion()
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
                myPlayerId = data.id
                myX = data.x || 0
                myZ = data.z || 0
                myRotation = data.rotation || 0
                myGender = data.gender || 'male'
                updatePlayer({ ...data, firstName: data.firstName || myFirstName, username: data.username || myUsername }, true)
                if (data.farmPlots) updateFarmPlots(data.farmPlots)
                if (data.dragon) updateDragonState(data.dragon)
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
                if (data.players) data.players.forEach((p: any) => updatePlayer(p, p.id === myPlayerId))
            } else if (data.type === 'pickup_spawned') {
                updatePickups([...Array.from(pickups.values()), data])
            } else if (data.type === 'weapon_update') {
                updatePlayer(data, data.id === myPlayerId)
            } else if (data.type === 'error') {
                if (data.message === 'Not enough coins') showShopError('Not Enough Coins')
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
        plots.forEach((plot: any, index: number) => {
            if (index >= farmPlotGroups.length) return
            const group = farmPlotGroups[index]
            const growthStage = plot.growthStage || 0
            if (growthStage === 0) {
                if (farmPlotWheat[index]) {
                    group.remove(farmPlotWheat[index])
                    farmPlotWheat[index] = null
                }
            } else {
                let needsUpdate = false
                if (!farmPlotWheat[index]) needsUpdate = true
                else if (farmPlotWheat[index].userData.stage !== growthStage) {
                    group.remove(farmPlotWheat[index])
                    needsUpdate = true
                }
                if (needsUpdate) {
                    const wheat = MeshFactories.createWheatMesh(growthStage)
                    wheat.userData.stage = growthStage
                    group.add(wheat)
                    farmPlotWheat[index] = wheat
                }
            }
        })
    }

    function updatePlayerWeapon(playerData: Types.PlayerData, newWeapon: string | null) {
        playerData.weapon = newWeapon
        playerData.mesh.traverse((child: any) => {
            if (child.name === 'staff_beginner') {
                child.visible = (newWeapon === 'staff_beginner')
                if (child.visible) child.frustumCulled = false
            }
        })
        if (playerData.weaponMesh) {
            const handBone = playerData.mesh.getObjectByName('hand_R')
            if (handBone) handBone.remove(playerData.weaponMesh)
            else playerData.mesh.remove(playerData.weaponMesh)
            playerData.weaponMesh = null
        }
        if (newWeapon && newWeapon !== 'staff_beginner') {
            const wMesh = MeshFactories.createWeaponMesh(newWeapon)
            const handBone = playerData.mesh.getObjectByName('hand_R')
            if (handBone) {
                wMesh.position.set(0, 0, 0)
                wMesh.scale.set(3, 3, 3)
                wMesh.rotation.set(0, -Math.PI / 2, Math.PI / 2)
                handBone.add(wMesh)
            } else {
                wMesh.position.set(-0.5, 1.5, 0.5)
                wMesh.scale.set(2.0, 2.0, 2.0)
                playerData.mesh.add(wMesh)
            }
            playerData.weaponMesh = wMesh
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
            playerData.isActing = data.isActing
            playerData.actionType = data.actionType
            playerData.actingPlotId = data.actionPlotId
        }

        const currentDisplayName = (playerData.username && playerData.username.trim() !== '') ? playerData.username : (playerData.firstName || 'Player')
        const newDisplayName = (data.username !== undefined)
            ? ((data.username && data.username.trim() !== '') ? data.username : (data.firstName || playerData.firstName))
            : ((data.firstName && data.firstName !== playerData.firstName) ? data.firstName : currentDisplayName)

        if (newDisplayName !== currentDisplayName) {
            scene.remove(playerData.label)
            playerData.firstName = data.firstName ?? playerData.firstName
            playerData.username = data.username !== undefined ? data.username : playerData.username
            playerData.label = UIGenerators.createTextSprite(THREE, newDisplayName, isMe)
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
        const needsExternalMesh = playerData.weapon && playerData.weapon !== 'staff_beginner' && !playerData.weaponMesh
        if (weaponChanged || needsExternalMesh) {
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

    function updatePlayerTarget(data: any) {
        const playerData = players.get(data.id)
        if (playerData) {
            playerData.targetX = data.x
            playerData.targetZ = data.z
            playerData.targetRotation = data.rotation ?? playerData.targetRotation
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

    // UI Styling
    const style = document.createElement('style')
    style.innerHTML = `
      #selection-card {
        position: fixed;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        padding: 24px;
        display: none;
        flex-direction: column;
        gap: 16px;
        z-index: 100;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      }
      @media (min-width: 769px) {
        #selection-card {
          right: 60px;
          top: 50%;
          transform: translateY(-50%);
          width: 320px;
        }
      }
      @media (max-width: 768px) {
        #selection-card {
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%);
          width: 85%;
          max-width: 380px;
        }
      }
      .card-section { display: flex; flex-direction: column; gap: 8px; }
      .card-label {
        color: rgba(255,255,255,0.5);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        font-weight: 700;
        margin-left: 4px;
      }
      .card-input {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        color: white;
        padding: 14px 16px;
        font-size: 16px;
        width: 100%;
        box-sizing: border-box;
        font-family: inherit;
        outline: none;
        transition: all 0.2s;
      }
      .card-input:focus {
        border-color: #FFD54F;
        background: rgba(255,255,255,0.1);
      }
      .card-btn {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        color: white;
        padding: 14px 16px;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s;
        font-weight: 500;
        width: 100%;
        text-align: left;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: inherit;
      }
      .card-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); }
      .card-play-btn {
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        color: white;
        border: none;
        border-radius: 14px;
        padding: 18px;
        font-size: 18px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(76, 175, 80, 0.4);
        transition: all 0.2s;
        width: 100%;
        text-align: center;
        margin-top: 8px;
        font-family: inherit;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .card-play-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(76, 175, 80, 0.5); }
      .card-play-btn:active { transform: translateY(1px); }
    `
    document.head.appendChild(style)

    const selectionCard = document.createElement('div')
    selectionCard.id = 'selection-card'
    document.body.appendChild(selectionCard)

    // Name Section
    const nameSection = document.createElement('div')
    nameSection.className = 'card-section'
    nameSection.innerHTML = '<span class="card-label">Identity</span>'
    selectionCard.appendChild(nameSection)

    // Gender Section
    const genderSection = document.createElement('div')
    genderSection.className = 'card-section'
    genderSection.innerHTML = '<span class="card-label">Physique</span>'
    selectionCard.appendChild(genderSection)

    // Face Section
    const faceSection = document.createElement('div')
    faceSection.className = 'card-section'
    faceSection.innerHTML = '<span class="card-label">Appearance</span>'
    selectionCard.appendChild(faceSection)

    const faceBtn = document.createElement('button')
    faceBtn.className = 'card-btn'
    faceBtn.innerHTML = `<span>Face Style</span> <span style="opacity:0.7">${Utils.getFaceName(MeshFactories.charFaces[currentFaceIndex])}</span>`
    faceSection.appendChild(faceBtn)

    function switchToMode(mode: 'game' | 'character' | 'spectate') {
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
        if (!myPlayerId) return
        const p = players.get(myPlayerId)
        if (!p || p.isActing) return
        p.isActing = true
        p.actionType = type
        p.actingPlotId = plotId
        p.actingStartTime = Date.now()
        interactBtn.innerText = type.charAt(0).toUpperCase() + type.slice(1) + '...'
        interactBtn.style.background = 'transparent'
        interactBtn.style.border = 'none'
        interactBtn.style.boxShadow = 'none'
        interactBtn.style.color = 'white'
        interactBtn.style.textShadow = '0 0 4px black'
        interactBtn.onclick = null
        if (wsConnected && ws) {
            const serverType = type === 'planting' ? 'plant_seeds' : (type === 'watering' ? 'water_wheat' : 'harvest_wheat')
            ws.send(JSON.stringify({ type: serverType, plotId }))
        }
        setTimeout(() => {
            const currentP = players.get(myPlayerId!)
            if (currentP && currentP.isActing && currentP.actionType === type) {
                currentP.isActing = false
                currentP.actionType = null
                currentP.actingPlotId = null
                if (currentP.temporaryToolMesh) {
                    if (currentP.temporaryToolMesh.parent) currentP.temporaryToolMesh.parent.remove(currentP.temporaryToolMesh)
                    currentP.temporaryToolMesh = null
                }
                if (currentP.weaponMesh) currentP.weaponMesh.visible = true
                currentP.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner' && currentP.weapon === 'staff_beginner') child.visible = true
                })
                updateUIVisibility()
            }
        }, 2000)
    }

    faceBtn.addEventListener('click', () => {
        currentFaceIndex = (currentFaceIndex + 1) % MeshFactories.charFaces.length
        faceBtn.innerHTML = `<span>Face Style</span> <span style="opacity:0.7">${Utils.getFaceName(MeshFactories.charFaces[currentFaceIndex])}</span>`
        updateCharacterFace()
    })

    const usernameInput = document.createElement('input')
    usernameInput.type = 'text'
    usernameInput.placeholder = 'Enter Username'
    usernameInput.value = myUsername || myFirstName || ''
    usernameInput.maxLength = 16
    usernameInput.className = 'card-input'
    nameSection.appendChild(usernameInput)
    usernameInput.addEventListener('input', () => {
        usernameInput.value = usernameInput.value.replace(/[^a-zA-Z0-9 ]/g, '')
    })

    const playBtn = document.createElement('button')
    playBtn.innerText = 'ENTER WORLD'
    playBtn.className = 'card-play-btn'
    selectionCard.appendChild(playBtn)
    playBtn.addEventListener('click', async () => {
        myUsername = usernameInput.value.trim()
        try {
            const resp = await fetch('/api/user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: myUsername,
                    gender: charGender,
                    faceIndex: currentFaceIndex
                })
            })
            if (!resp.ok) console.error('Failed to sync user data')
            const nameLabel = document.getElementById('player-name-label')
            if (nameLabel) nameLabel.innerText = myUsername || myFirstName
        } catch (err) {
            console.error('Error syncing user data:', err)
        }
        currentMode = 'game'
        updateUIVisibility()
        connectWebSocket(true)
    })

    const charGenderBtn = document.createElement('button')
    charGenderBtn.className = 'card-btn'
    charGenderBtn.innerHTML = `<span>Gender</span> <span style="opacity:0.7; color:${charGender === 'male' ? '#93C5FD' : '#F9A8D4'}">${charGender.toUpperCase()}</span>`
    genderSection.appendChild(charGenderBtn)
    charGenderBtn.addEventListener('click', () => {
        charGender = charGender === 'male' ? 'female' : 'male'
        myGender = charGender
        charGenderBtn.innerHTML = `<span>Gender</span> <span style="opacity:0.7; color:${charGender === 'male' ? '#93C5FD' : '#F9A8D4'}">${charGender.toUpperCase()}</span>`
        updateCharacterGender()
    })

    const activeTouches = new Map<number, Types.TouchState>()
    let joystickDeltaX = 0
    let joystickDeltaY = 0

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
            switchToMode('spectate')
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

    function updateUIVisibility() {
        if (isVersionMismatch) return
        const invBtn = document.getElementById('inventory-btn')
        const scoreModal = document.getElementById('score-modal')
        const invModal = document.getElementById('inventory-modal')
        const shopModal = document.getElementById('shop-modal')
        const isModalOpen = (scoreModal && scoreModal.style.display === 'block') ||
            (invModal && invModal.style.display === 'block') ||
            (shopModal && shopModal.style.display === 'block')

        if (currentMode === 'character') {
            const selectionCard = document.getElementById('selection-card')
            if (selectionCard) selectionCard.style.display = 'flex'

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
        } else if (currentMode === 'spectate') {
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
        } else {
            const selectionCard = document.getElementById('selection-card')
            if (selectionCard) selectionCard.style.display = 'none'

            exitCameraBtn.style.display = 'none'
            if (damageListEl.innerHTML.includes('Dragon Damage') && !isModalOpen) damageListEl.style.display = 'block'
            else damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = isModalOpen ? 'none' : 'block'
            if (charNavBtn) charNavBtn.style.display = isModalOpen ? 'none' : 'block'
            if (cameraNavBtn) cameraNavBtn.style.display = isModalOpen ? 'none' : 'block'
            shootBtn.style.display = (!isModalOpen && dragon && !dragon.isDead && !myIsDead) ? 'flex' : 'none'
            joystickContainer.style.display = (isModalOpen || myIsDead) ? 'none' : 'block'
            interactBtn.style.display = (isModalOpen || myIsDead) ? 'none' : interactBtn.style.display
            if (invBtn) invBtn.style.display = isModalOpen ? 'none' : 'block'
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
                    else if (currentMode === 'spectate') spectateRotationOffset -= deltaX * 0.01
                }
            }
        }
    }, { passive: false })

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
                    mesh.traverse((c: any) => {
                        if (c.isMesh && c.material) {
                            c.material.transparent = true
                            c.material.opacity = 0.3
                        }
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

        const speed = 0.15
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
            if (keys['KeyQ'] && !isActingNow) myRotation += 0.03
            if (keys['KeyE'] && !isActingNow) myRotation -= 0.03

            if (!myIsDead && !isActingNow && (Math.abs(joystickDeltaX) > 5 || Math.abs(joystickDeltaY) > 5)) {
                inputDx = joystickDeltaX / 50
                inputDz = joystickDeltaY / 50
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

        if (controlPanel) {
            controlPanel.children.forEach((child: any) => {
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

        for (const [id, p] of pickups.entries()) {
            p.mesh.rotation.y += 0.05
            const bob = Math.sin(Date.now() * 0.005) * 0.2
            p.mesh.position.y = 1 + bob
            const arrow = p.mesh.getObjectByName('arrow')
            if (arrow) arrow.position.y = Math.sin(Date.now() * 0.01) * 0.3
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
            if (s.label) {
                s.label.position.set(s.currentX, hopY + 1.8, s.currentZ)
                const dist = camera.position.distanceTo(s.label.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                s.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            }
        }

        farmPlotWheat.forEach((group, index) => {
            if (group && group.userData.stage === 3) {
                const isBeingHarvested = Array.from(players.values()).some(p => p.isActing && p.actionType === 'harvesting' && p.actingPlotId === index)
                const intensity = isBeingHarvested ? 0.3 : 0.05
                const speedMult = isBeingHarvested ? 4 : 1
                group.children.forEach((stalkContainer: any) => {
                    const phase = stalkContainer.userData.phase || 0
                    stalkContainer.rotation.x = Math.sin(now * 0.002 * speedMult + phase) * intensity
                    stalkContainer.rotation.z = Math.cos(now * 0.0015 * speedMult + phase) * intensity
                })
            }
        })

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
                            const idle = playerData.actions['idle'] || playerData.actions['Idle']
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
                    if (playerData.isActing) {
                        playerData.mesh.rotation.x = 0
                        if (playerData.weaponMesh) playerData.weaponMesh.visible = false
                        playerData.mesh.traverse((child: any) => {
                            if (child.name === 'staff_beginner') child.visible = false
                        })
                        if (!playerData.temporaryToolMesh) {
                            let tool: any
                            if (playerData.actionType === 'watering') tool = MeshFactories.createWaterCanMesh()
                            else tool = MeshFactories.createTrowelMesh()
                            tool.scale.set(3, 3, 3)
                            const handBone = playerData.mesh.getObjectByName('leftHand')
                            if (handBone) {
                                tool.rotation.set(0, -Math.PI / 2, Math.PI / 2)
                                handBone.add(tool)
                            } else {
                                tool.position.set(-0.5, 1.5, 0.5)
                                playerData.mesh.add(tool)
                            }
                            playerData.temporaryToolMesh = tool
                        }
                        if (playerData.actionType === 'watering' && playerData.temporaryToolMesh) {
                            playerData.temporaryToolMesh.rotation.x = -Math.PI / 4
                        }
                    } else {
                        playerData.mesh.rotation.x = 0
                        if (playerData.weaponMesh) playerData.weaponMesh.visible = true
                        playerData.mesh.traverse((child: any) => {
                            if (child.name === 'staff_beginner' && playerData.weapon === 'staff_beginner') child.visible = true
                        })
                        if (playerData.temporaryToolMesh) {
                            if (playerData.temporaryToolMesh.parent) playerData.temporaryToolMesh.parent.remove(playerData.temporaryToolMesh)
                            playerData.temporaryToolMesh = null
                        }
                    }
                    if (playerData.weaponMesh && !playerData.mesh.getObjectByName('hand_R')) {
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
                    const idle = playerData.actions['idle'] || playerData.actions['Idle']
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
            if (playerData && playerData.isActing) {
                playerData.mesh.rotation.x = 0
                if (playerData.weaponMesh) playerData.weaponMesh.visible = false
                playerData.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner') child.visible = false
                })
                if (!playerData.temporaryToolMesh) {
                    let tool: any
                    if (playerData.actionType === 'watering') tool = MeshFactories.createWaterCanMesh()
                    else tool = MeshFactories.createTrowelMesh()
                    tool.scale.set(3, 3, 3)
                    const handBone = playerData.mesh.getObjectByName('leftHand')
                    if (handBone) {
                        tool.rotation.set(0, -Math.PI / 2, Math.PI / 2)
                        handBone.add(tool)
                    } else {
                        tool.position.set(-0.5, 1.5, 0.5)
                        playerData.mesh.add(tool)
                    }
                    playerData.temporaryToolMesh = tool
                }
                if (playerData.actionType === 'watering' && playerData.temporaryToolMesh) {
                    playerData.temporaryToolMesh.rotation.x = -Math.PI / 4
                }
            } else if (playerData) {
                playerData.mesh.rotation.x = 0
                if (playerData.weaponMesh) playerData.weaponMesh.visible = true
                playerData.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner' && playerData.weapon === 'staff_beginner') child.visible = true
                })
                if (playerData.temporaryToolMesh) {
                    if (playerData.temporaryToolMesh.parent) playerData.temporaryToolMesh.parent.remove(playerData.temporaryToolMesh)
                    playerData.temporaryToolMesh = null
                }
            }
        }

        const speedVal = 0.15
        const isTargetedByDragon = dragon && !dragon.isDead && dragon.targetId === myPlayerId
        const localPlayer = myPlayerId ? players.get(myPlayerId) : null
        const isActing = localPlayer?.isActing || false

        if (myPlayerId && !myIsDead && currentMode === 'game' && !isModalOpen && !isTargetedByDragon && !isActing) {
            let nearShop = false
            let nearPlotIndex = -1
            let nearPanel = false
            const dShop = Math.hypot(myX - (-18), myZ - (-18))
            if (dShop < 4) nearShop = true
            farmPlotGroups.forEach((plot, i) => {
                const d = Math.hypot(myX - plot.position.x, myZ - plot.position.z)
                if (d < 2.5) nearPlotIndex = i
            })
            const distToPanel = Math.hypot(myX - (-22), myZ - 22)
            const isDragonDead = !dragon || dragon.isDead
            if (distToPanel < 5 && isDragonDead) nearPanel = true

            if (nearShop) {
                interactBtn.innerText = 'OPEN SHOP'
                interactBtn.style.display = 'block'
                interactBtn.style.background = '#A7F3D0'
                interactBtn.style.border = '2px solid black'
                interactBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                interactBtn.style.color = 'black'
                interactBtn.style.textShadow = 'none'
                interactBtn.onclick = () => showShopModal()
            } else if (nearPlotIndex !== -1) {
                const plotData = farmPlotsState[nearPlotIndex]
                const stage = plotData?.growthStage || 0
                interactBtn.style.display = 'block'
                if (stage === 0) {
                    const hasSeeds = inventory.includes('wheat_seeds')
                    const hasTrowel = inventory.includes('trowel')
                    if (!hasSeeds) {
                        interactBtn.innerText = 'Need seeds'
                        interactBtn.style.background = '#9CA3AF'
                        interactBtn.style.border = '2px solid #4B5563'
                        interactBtn.style.boxShadow = 'none'
                        interactBtn.style.color = 'white'
                        interactBtn.style.textShadow = 'none'
                        interactBtn.onclick = null
                    } else if (!hasTrowel) {
                        interactBtn.innerText = 'Need trowel'
                        interactBtn.style.background = '#9CA3AF'
                        interactBtn.style.border = '2px solid #4B5563'
                        interactBtn.style.boxShadow = 'none'
                        interactBtn.style.color = 'white'
                        interactBtn.style.textShadow = 'none'
                        interactBtn.onclick = null
                    } else {
                        interactBtn.innerText = 'PLANT WHEAT'
                        interactBtn.style.background = '#A7F3D0'
                        interactBtn.style.border = '2px solid black'
                        interactBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                        interactBtn.style.color = 'black'
                        interactBtn.style.textShadow = 'none'
                        interactBtn.onclick = () => startFarmingAction('planting', nearPlotIndex)
                    }
                } else if (stage === 1) {
                    const hasWaterCan = inventory.includes('water_can')
                    if (!hasWaterCan) {
                        interactBtn.innerText = 'Need water can'
                        interactBtn.style.background = '#9CA3AF'
                        interactBtn.style.border = '2px solid #4B5563'
                        interactBtn.style.boxShadow = 'none'
                        interactBtn.style.color = 'white'
                        interactBtn.style.textShadow = 'none'
                        interactBtn.onclick = null
                    } else {
                        interactBtn.innerText = 'WATER WHEAT'
                        interactBtn.style.background = '#A7F3D0'
                        interactBtn.style.border = '2px solid black'
                        interactBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                        interactBtn.style.color = 'black'
                        interactBtn.style.textShadow = 'none'
                        interactBtn.onclick = () => startFarmingAction('watering', nearPlotIndex)
                    }
                } else if (stage === 2) {
                    const GROWTH_TIME = 5 * 60 * 1000
                    const elapsed = Date.now() - (plotData.wateredAt || 0)
                    const remaining = Math.max(0, GROWTH_TIME - elapsed)
                    const minutes = Math.floor(remaining / 60000)
                    const seconds = Math.floor((remaining % 60000) / 1000)
                    const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
                    interactBtn.innerText = `GROWING... (${timeStr})`
                    interactBtn.style.background = '#9CA3AF'
                    interactBtn.style.border = '2px solid #4B5563'
                    interactBtn.style.boxShadow = 'none'
                    interactBtn.style.color = 'white'
                    interactBtn.style.textShadow = 'none'
                    interactBtn.onclick = null
                } else if (stage === 3) {
                    interactBtn.innerText = 'HARVEST WHEAT'
                    interactBtn.style.background = '#A7F3D0'
                    interactBtn.style.border = '2px solid black'
                    interactBtn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
                    interactBtn.style.color = 'black'
                    interactBtn.style.textShadow = 'none'
                    interactBtn.onclick = () => startFarmingAction('harvesting', nearPlotIndex)
                } else {
                    interactBtn.style.display = 'none'
                }
            } else {
                interactBtn.style.display = 'none'
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
        } else if (!isActing) {
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
            if (playerData.weaponMesh) {
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
            } else {
                const camDistance = 7.5
                const camHeight = 5
                const camX = myX + Math.sin(myRotation) * camDistance
                const camZ = myZ + Math.cos(myRotation) * camDistance
                camera.position.set(camX, camHeight, camZ)
                camera.lookAt(myX, 4, myZ)
            }
            [controlPanelLabel, shopLabel, farmLabel].forEach(label => {
                const dist = camera.position.distanceTo(label.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            })
            if (currentCountdownLabel) {
                const dist = camera.position.distanceTo(currentCountdownLabel.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                currentCountdownLabel.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            }
            renderer.render(scene, camera)
        }
    }
    animate()
}
