import { useEffect, useRef } from 'hono/jsx'

interface GameCanvasProps {
    userId?: string
    firstName?: string
    username?: string
    gender?: 'male' | 'female'
    faceIndex?: number
    initialCoins?: number
    initialInventory?: string[]
}

export default function GameCanvas({ userId, firstName, username, gender, faceIndex, initialCoins, initialInventory }: GameCanvasProps) {
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

const CLIENT_VERSION = '1.1.4'

function initGame(THREE: any, LOADERS: { GLTFLoader: any, SkeletonUtils: any }, container: HTMLElement, myUserId: string, myFirstName: string, initialUsername?: string, initialGender?: 'male' | 'female', initialFaceIndex?: number, initialCoins: number = 0, initialInventory: string[] = []) {
    const { GLTFLoader, SkeletonUtils } = LOADERS
    const textureLoader = new THREE.TextureLoader()
    const gltfLoader = new GLTFLoader()

    // Version Check
    let isVersionMismatch = false
    async function checkVersion() {
        try {
            const resp = await fetch('/api/version')
            const data = (await resp.json()) as { version?: string }
            if (data.version && data.version !== CLIENT_VERSION) {
                isVersionMismatch = true
                clearInterval(versionInterval)
                showUpdateOverlay(data.version)
            }
        } catch (err) {
            console.error('Failed to check version:', err)
        }
    }
    checkVersion()
    // Check version every 30 seconds aggressively
    const versionInterval = setInterval(checkVersion, 30000)


    function showUpdateOverlay(liveVersion: string) {
        // Inject style to hide all other UI reliably
        const style = document.createElement('style')
        style.innerHTML = `
            #ui-layer, #joystick-container, #shoot-btn, #score-modal, .top-nav, button, input {
                display: none !important;
            }
            #update-overlay, #update-overlay * {
                display: flex !important;
            }
            #update-overlay {
                flex-direction: column !important;
            }
            #refresh-btn {
                display: inline-block !important;
            }
        `
        document.head.appendChild(style)

        const overlay = document.createElement('div')
        overlay.id = 'update-overlay'
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 10000;
            color: white;
            font-family: system-ui, sans-serif;
            text-align: center;
            padding: 20px;
        `
        overlay.innerHTML = `
            <h1 style="font-size: 32px; color: #FFD54F; margin-bottom: 20px;">New Version Available</h1>
            <p style="font-size: 18px; opacity: 0.8; margin-bottom: 40px;">
                Please update to the latest version to continue.
            </p>
            <button id="refresh-btn" style="background: #FFD54F; color: black; padding: 12px 30px; border-radius: 8px; font-weight: bold; border: none; cursor: pointer; font-size: 18px;">
                REFRESH NOW
            </button>
        `
        document.body.appendChild(overlay)

        document.getElementById('refresh-btn')?.addEventListener('click', () => {
            window.location.reload()
        })
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

    // Scene Modes
    let currentMode: 'game' | 'character' | 'spectate' = 'character' // Start in Character Scene
    let spectateRotationOffset = 0
    let myUsername = initialUsername || ''
    let myGender: 'male' | 'female' = initialGender || 'male' // Declare early

    // Game bounds
    // Game bounds
    const BOUNDS = 24 // Half-size of play area (total 48x48)

    // WebSocket vars (hoisted for scope)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/game`
    let ws: WebSocket | null = null
    let wsConnected = false
    let currentCountdownLabel: any = null

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87ceeb)
    // No fog for better visibility

    // Scoreboard UI (Modal and State)
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

        // Sort by damage desc
        const sorted = [...list].sort((a, b) => b.damage - a.damage)

        const html = sorted.map(p => `
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span style="font-weight:bold; margin-right: 10px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.name}</span>
                <span style="color: #FFD54F;">${p.damage}</span>
            </div>
        `).join('')

        damageListEl.innerHTML = `
            <div style="color: #EF5350; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px;">Dragon Damage</div>
            ${html}
        `
        updateUIVisibility()
    }


    // Close on click outside
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


    // Wider FOV for better view
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

    // Global Lighting System (Uniform illumination)
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

    // Ground (smaller, 50x50)
    const groundGeo = new THREE.PlaneGeometry(50, 50)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a5a40 })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    // Grid helper (smaller)
    const gridHelper = new THREE.GridHelper(50, 25, 0x588157, 0x588157)
    gridHelper.position.y = 0.01
    scene.add(gridHelper)

    // Boundary walls (visual indicator)
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4033, transparent: true, opacity: 0.7 })
    const wallHeight = 0.5
    const wallThickness = 0.3
    const wallGeo = new THREE.BoxGeometry(50, wallHeight, wallThickness)
    const wallGeoSide = new THREE.BoxGeometry(wallThickness, wallHeight, 50)

    const wallN = new THREE.Mesh(wallGeo, wallMaterial)
    wallN.position.set(0, wallHeight / 2, -25)
    scene.add(wallN)

    const wallS = new THREE.Mesh(wallGeo, wallMaterial)
    wallS.position.set(0, wallHeight / 2, 25)
    scene.add(wallS)

    const wallE = new THREE.Mesh(wallGeoSide, wallMaterial)
    wallE.position.set(25, wallHeight / 2, 0)
    scene.add(wallE)

    const wallW = new THREE.Mesh(wallGeoSide, wallMaterial)
    wallW.position.set(-25, wallHeight / 2, 0)
    scene.add(wallW)

    const controlPanel = createControlPanelMesh()
    controlPanel.position.set(-22, 0, 22) // Moved to North-West corner
    controlPanel.scale.set(1.5, 1.5, 1.5) // Half size (from 3)
    scene.add(controlPanel)

    // Shop
    const shop = createShopMesh()
    shop.position.set(-18, 0, -18)
    shop.rotation.y = Math.PI / 4
    scene.add(shop)

    // Farm Plots (3x3 grid)
    const farmPlotGroups: any[] = []
    const farmPlotWheat: (any | null)[] = new Array(9).fill(null)
    const farmStartX = 11, farmStartZ = -5
    for (let i = 0; i < 9; i++) {
        const x = farmStartX + (i % 3) * 5.0
        const z = farmStartZ + Math.floor(i / 3) * 5.0
        const plot = createFarmPlotMesh()
        plot.position.set(x, 0, z)
        scene.add(plot)
        farmPlotGroups.push(plot)
    }

    // Static World Labels
    const controlPanelLabel = createTextSprite('Obelisk', false, '#000000', 'transparent')
    controlPanelLabel.position.set(-22, 5.5, 22) // Adjusted height for half-scale
    scene.add(controlPanelLabel)

    const shopLabel = createTextSprite('Store', false, '#000000', 'transparent')
    shopLabel.position.set(-18, 6, -18)
    scene.add(shopLabel)

    const farmLabel = createTextSprite('Farm', false, '#000000', 'transparent')
    farmLabel.position.set(16, 5, 0)
    scene.add(farmLabel)

    // CHARACTER SCENE SETUP
    const charScene = new THREE.Scene()
    charScene.background = new THREE.Color(0x222222)

    const charCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
    charCamera.position.set(0, 0, 7) // Lowered Y to center character
    charCamera.lookAt(0, 0, 0)

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

    // Character Customization State
    let charModel: any = null
    let charMixer: any = null
    const charFaces = [
        'full_face_default.png',
        'full_face_angry.png',
        'full_face_content.png',
        'full_face_crazy.png',
        'full_face_happy.png'
    ]

    // Pre-load textures
    const loadedTextures = new Map<string, any>()
    charFaces.forEach(face => {
        const tex = textureLoader.load(`/static/${face}`)
        tex.flipY = false
        tex.colorSpace = THREE.SRGBColorSpace
        loadedTextures.set(face, tex)
    })

    let currentFaceIndex = (initialFaceIndex !== undefined) ? initialFaceIndex : 0
    let charGender: 'male' | 'female' = initialGender || 'male'
    myGender = charGender

    // Swipe to Rotate State
    let isDraggingChar = false
    let previousMouseX = 0
    let charRotation = 0

    // Base Character Template (for cloning)
    let baseCharModel: any = null
    let baseAnimations: any[] = []
    let staffTemplate: any = null

    // Load Character Model
    gltfLoader.load('/static/character2.glb', (gltf: any) => {
        baseCharModel = gltf.scene
        baseAnimations = gltf.animations

        // Hide all parts initially
        baseCharModel.traverse((child: any) => {
            if (child.name === 'staff_beginner') {
                staffTemplate = child
            }
            if (child.isMesh) {
                child.visible = false
                child.frustumCulled = false
            }
        })

        // --- INSTANTIATE CHARACTER SCENE MODEL ---
        // Clone for the customization scene
        charModel = SkeletonUtils.clone(baseCharModel)
        charScene.add(charModel)

        // Reset scale/position for Char Scene
        charModel.position.y = -1.0
        charModel.scale.set(0.525, 0.525, 0.525)

        // Show parts for Char Scene
        const showParts = ['head', 'head_1', 'hands', 'pants', 'shirt', 'shoes', 'hair_short']
        charModel.traverse((child: any) => {
            if (showParts.includes(child.name)) {
                child.visible = true
            }
        })

        // Animations for Char Scene (Selection Animation)
        if (baseAnimations && baseAnimations.length > 0) {
            charMixer = new THREE.AnimationMixer(charModel)
            const clip = THREE.AnimationClip.findByName(baseAnimations, 'character_selection') || baseAnimations[0]
            if (clip) {
                const action = charMixer.clipAction(clip)
                action.play()
            }
        }

        // Apply initial face/gender to Char Scene Model
        updateCharacterFace()
        updateCharacterGender() // Ensure correct initial state
    })

    function updateCharacterFace() {
        if (!charModel) return
        const faceName = charFaces[currentFaceIndex]
        const texture = loadedTextures.get(faceName)

        if (!texture) return

        // Update the new custom mesh AND the original (just in case)
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
                child.material.map = (charGender === 'male') ? shirtTextures.male : shirtTextures.female
                child.material.needsUpdate = true
            }
        })
    }

    // Player data with target positions for interpolation
    interface PlayerData {
        mesh: any
        label: any
        firstName: string
        username: string | null
        // Current (rendered) values
        currentX: number
        currentZ: number
        currentRotation: number
        faceIndex?: number
        // Target values from network
        targetX: number
        targetZ: number
        targetRotation: number
        gender: 'male' | 'female'
        // Animation parts
        mixer: any
        actions: { [key: string]: any }
        // Death state
        isDead: boolean
        deathX?: number
        deathZ?: number
        weapon: string | null
        weaponMesh?: any
        // Action state
        isActing?: boolean
        actionType?: 'planting' | 'watering' | 'harvesting' | null
        actionPlotId?: number | null
        actingPlotId?: number | null
        actingStartTime?: number
        temporaryToolMesh?: any
    }
    const players = new Map<string, PlayerData>()

    interface PickupData {
        id: string
        mesh: any
        weaponType: string
        playerId: string
        x: number
        z: number
    }
    const pickups = new Map<string, PickupData>()

    // Dragon Data
    interface DragonData {
        mesh: any
        wings: any[]
        currentX: number
        currentZ: number
        currentRotation: number
        targetX: number
        targetZ: number
        targetRotation: number
        health: number
        labelGroup: any // Group holding Name and Health Bar
        healthBar: any // Reference to Health Bar mesh (inside group)
        isDead: boolean
        targetId: string | null
        deathTime?: number // Track when death started for animation
        flinchTime?: number // Track when hit for animation
        chargeStartTime?: number // Track when charging for animation
        chargingMesh?: any // Star mesh for charging
        spawnStartTime?: number // Track when spawn started for animation
    }
    let dragon: DragonData | null = null

    interface SheepData {
        mesh: any
        currentX: number
        currentZ: number
        currentRotation: number
        targetX: number
        targetZ: number
        targetRotation: number
        isHopping: boolean
        hopPhase: number
        label?: any
        lastText?: string
    }
    const sheeps = new Map<string, SheepData>()
    let coins = initialCoins
    let inventory = initialInventory
    let farmPlotsState: any[] = []

    let myPlayerId: string | null = null
    let myX = 0
    let myZ = 0
    let myRotation = 0
    let myIsDead = false

    // Interpolation speed (higher = faster, 1 = instant)
    const LERP_SPEED = 0.15
    const ROTATION_LERP_SPEED = 0.2
    let lastAnimateTime = Date.now()
    let lastModalCloseTime = 0

    // Cooldown
    const FIRE_COOLDOWN = 1500
    let lastFireTime = 0

    // Lerp helper
    function lerp(start: number, end: number, t: number): number {
        if (!Number.isFinite(start) || !Number.isFinite(end)) return end || 0
        return start + (end - start) * t
    }

    // Lerp angle (handles wraparound)
    function lerpAngle(start: number, end: number, t: number): number {
        if (!Number.isFinite(start) || !Number.isFinite(end)) return end || 0
        let diff = end - start
        // Normalize to -PI to PI robustly using atan2(sin, cos) to avoid infinite loops
        diff = Math.atan2(Math.sin(diff), Math.cos(diff))
        return start + diff * t
    }

    // Create text sprite for player name
    function createTextSprite(text: string, isMe: boolean, textColor: string = '#FFFFFF', bgColor: string = 'transparent'): any {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')!
        canvas.width = 256
        canvas.height = 64

        if (bgColor !== 'transparent') {
            context.fillStyle = bgColor
            context.fillRect(0, 0, canvas.width, canvas.height)
        }

        context.font = 'Bold 32px Arial'
        context.fillStyle = textColor
        context.textAlign = 'center'
        context.textBaseline = 'middle'

        // Soft black shadow (only for white text labels)
        if (textColor.toUpperCase() === '#FFFFFF') {
            context.shadowColor = 'rgba(0, 0, 0, 0.9)'
            context.shadowBlur = 6
            context.shadowOffsetX = 0
            context.shadowOffsetY = 0
        }

        context.fillText(text, 128, 32)

        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ map: texture })
        const sprite = new THREE.Sprite(material)
        // Standard base scale consistent with Dragon (Double size -> 4 width, 1 height)
        sprite.scale.set(4, 1.0, 1)

        return sprite
    }



    // Create player mesh (Humanoid with Eyes/Hair)
    // Pre-load shirt textures
    const shirtTextures = {
        male: textureLoader.load('/static/shirt_plaid.png'),
        female: textureLoader.load('/static/shirt_pink.png')
    }
    shirtTextures.male.flipY = false
    shirtTextures.male.colorSpace = THREE.SRGBColorSpace
    shirtTextures.female.flipY = false
    shirtTextures.female.colorSpace = THREE.SRGBColorSpace

    // Create player mesh (Humanoid with Eyes/Hair)
    function createPlayerMesh(isMe: boolean, gender: 'male' | 'female', faceIndex: number = 0): { group: any, mixer: any, actions: any } {
        // Use base model if available, otherwise fallback to empty group (or primitive if loading failed)
        let group: any
        let mixer: any = null
        let actions: any = {}

        if (baseCharModel) {
            group = SkeletonUtils.clone(baseCharModel)

            // Show standard body parts (Fix for missing body)
            const showParts = ['head', 'head_1', 'hands', 'pants', 'shirt', 'shoes']
            group.traverse((child: any) => {
                if (showParts.includes(child.name)) {
                    child.visible = true
                    child.frustumCulled = false
                }
            })

            // Setup Animation
            mixer = new THREE.AnimationMixer(group)
            if (baseAnimations) {
                baseAnimations.forEach((clip: any) => {
                    const action = mixer.clipAction(clip)
                    actions[clip.name] = action
                })
            }
            // Default animation: Idle (or whatever is available)
            const idleAction = actions['Idle'] || actions['idle']
            if (idleAction) idleAction.play()

            // Customization
            // 1. Face
            const faceName = charFaces[faceIndex] || charFaces[0]
            const texture = loadedTextures.get(faceName)
            if (texture) {
                group.traverse((child: any) => {
                    if (child.isMesh && child.material) {
                        // Apply to HEAD meshes (custom_head_mesh is the fixed one)
                        // Use looser matching for "face" materials
                        if (child.name === 'custom_head_mesh' || child.name === 'head' || (child.material.name && child.material.name.includes('full_face'))) {
                            const newMat = child.material.clone()
                            newMat.map = texture
                            newMat.color.setHex(0xffffff)
                            child.material = newMat
                        }
                    }
                })
            }

            // 2. Gender (Hair/Clothes)
            group.traverse((child: any) => {
                if (child.name === 'hair_short') child.visible = (gender === 'male')
                if (child.name === 'hair_long') child.visible = (gender === 'female')

                if (child.name === 'shirt' && child.material) {
                    const newMat = child.material.clone()
                    newMat.map = (gender === 'male') ? shirtTextures.male : shirtTextures.female
                    child.material = newMat
                }
            })

            // Scale and Positioning
            // Fix: User reported too large. Reduce scale further.
            group.scale.set(0.5, 0.5, 0.5)

        } else {
            // Fallback if model not loaded
            console.warn('Base model not loaded, creating empty group')
            group = new THREE.Group()
        }

        return { group, mixer, actions }
    }


    // Create weapon mesh
    function createWeaponMesh(type: string): any {
        const group = new THREE.Group()

        if (type === 'coin') {
            const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16)
            const coinMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.8, roughness: 0.2 })
            const coin = new THREE.Mesh(coinGeo, coinMat)
            coin.rotation.x = Math.PI / 2
            group.add(coin)
        } else if (type === 'handgun') {
            // Slide (Top part)
            const slideGeo = new THREE.BoxGeometry(0.12, 0.15, 0.45)
            const slideMat = new THREE.MeshStandardMaterial({ color: 0x212121 }) // Dark Black
            const slide = new THREE.Mesh(slideGeo, slideMat)
            slide.position.y = 0.05
            group.add(slide)

            // Barrel (Metallic front)
            const barrelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.1)
            const metalMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, metalness: 0.8, roughness: 0.2 })
            const barrel = new THREE.Mesh(barrelGeo, metalMat)
            barrel.position.set(0, 0.05, 0.25)
            group.add(barrel)

            // Grip (Handle)
            const gripGeo = new THREE.BoxGeometry(0.1, 0.25, 0.12)
            const gripMat = new THREE.MeshStandardMaterial({ color: 0x3E2723 }) // Wood/Brown
            const grip = new THREE.Mesh(gripGeo, gripMat)
            grip.position.set(0, -0.1, -0.1)
            grip.rotation.x = 0.2 // Slight tilt
            group.add(grip)

        } else if (type === 'rifle') {
            // Main Body (Metal)
            const bodyGeo = new THREE.BoxGeometry(0.15, 0.2, 1.0)
            const metalMat = new THREE.MeshStandardMaterial({ color: 0x212121 })
            const body = new THREE.Mesh(bodyGeo, metalMat)
            group.add(body)

            // Barrel (Longer, thin)
            const barrelGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8)
            const barrel = new THREE.Mesh(barrelGeo, metalMat)
            barrel.rotation.x = Math.PI / 2
            barrel.position.set(0, 0.05, 0.7)
            group.add(barrel)

            // Stock (Wooden rear)
            const stockGeo = new THREE.BoxGeometry(0.15, 0.35, 0.4)
            const woodMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 }) // Brown Wood
            const stock = new THREE.Mesh(stockGeo, woodMat)
            stock.position.set(0, -0.05, -0.6)
            group.add(stock)

            // Scope (Detail on top)
            const scopeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8)
            const scope = new THREE.Mesh(scopeGeo, metalMat)
            scope.rotation.x = Math.PI / 2
            scope.position.set(0, 0.2, 0)
            group.add(scope)

            // Grip (Middle)
            const gripGeo = new THREE.BoxGeometry(0.12, 0.2, 0.12)
            const grip = new THREE.Mesh(gripGeo, metalMat)
            grip.position.set(0, -0.15, -0.1)
            group.add(grip)
        }

        return group
    }

    function createPickupMesh(type: string): any {
        const group = new THREE.Group()

        // Weapon visual
        const weapon = createWeaponMesh(type)
        if (type === 'staff_beginner') {
            weapon.scale.set(1.5, 1.5, 1.5)
        } else {
            weapon.scale.set(3.0, 3.0, 3.0)
        }
        group.add(weapon)

        // Glow ring
        const ringGeo = new THREE.RingGeometry(0.8, 1.0, 32)
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd54f, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
        const ring = new THREE.Mesh(ringGeo, ringMat)
        ring.rotation.x = Math.PI / 2
        group.add(ring)

        // RED ARROW
        const arrowGroup = new THREE.Group()
        arrowGroup.name = 'arrow'

        const arrowColor = 0xff0000
        const arrowMat = new THREE.MeshStandardMaterial({ color: arrowColor, emissive: arrowColor, emissiveIntensity: 0.5 })

        // Arrow head (Cone)
        const headGeo = new THREE.ConeGeometry(0.3, 0.6, 16)
        const head = new THREE.Mesh(headGeo, arrowMat)
        head.rotation.x = Math.PI // Point down
        head.position.y = 1.5
        arrowGroup.add(head)

        // Arrow shaft (Cylinder)
        const shaftGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 16)
        const shaft = new THREE.Mesh(shaftGeo, arrowMat)
        shaft.position.y = 2.1
        arrowGroup.add(shaft)

        group.add(arrowGroup)

        return group
    }

    function createSheepMesh(): any {
        const group = new THREE.Group()
        const woolMat = new THREE.MeshStandardMaterial({ color: 0xffffff })
        const skinMat = new THREE.MeshStandardMaterial({ color: 0x222222 })

        // 1. Body (Woolly)
        const bodyGeo = new THREE.BoxGeometry(0.7, 0.6, 0.9)
        const body = new THREE.Mesh(bodyGeo, woolMat)
        body.position.y = 0.5
        group.add(body)

        // 2. Head
        const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4)
        const head = new THREE.Mesh(headGeo, skinMat)
        head.position.set(0, 0.7, 0.5)
        group.add(head)

        // 3. Ears
        const earGeo = new THREE.BoxGeometry(0.1, 0.2, 0.05)
        const lEar = new THREE.Mesh(earGeo, skinMat)
        lEar.position.set(-0.2, 0.1, 0)
        lEar.rotation.z = 0.3
        head.add(lEar)

        const rEar = new THREE.Mesh(earGeo, skinMat)
        rEar.position.set(0.2, 0.1, 0)
        rEar.rotation.z = -0.3
        head.add(rEar)

        // 4. Eyes (White dots)
        const eyeGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05)
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
        const lEye = new THREE.Mesh(eyeGeo, eyeMat)
        lEye.position.set(-0.1, 0.1, 0.2)
        head.add(lEye)

        const rEye = new THREE.Mesh(eyeGeo, eyeMat)
        rEye.position.set(0.1, 0.1, 0.2)
        head.add(rEye)

        // 5. Legs
        const legGeo = new THREE.BoxGeometry(0.12, 0.35, 0.12)
        const fl = new THREE.Mesh(legGeo, skinMat)
        fl.position.set(-0.2, 0.175, 0.3)
        group.add(fl)

        const fr = new THREE.Mesh(legGeo, skinMat)
        fr.position.set(0.2, 0.175, 0.3)
        group.add(fr)

        const bl = new THREE.Mesh(legGeo, skinMat)
        bl.position.set(-0.2, 0.175, -0.3)
        group.add(bl)

        const br = new THREE.Mesh(legGeo, skinMat)
        br.position.set(0.2, 0.175, -0.3)
        group.add(br)

        return group
    }

    function createShopMesh(): any {
        const group = new THREE.Group()
        const baseGeo = new THREE.BoxGeometry(4, 3, 3)
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x8D6E63 })
        const base = new THREE.Mesh(baseGeo, baseMat)
        base.position.y = 1.5
        group.add(base)
        const roofGeo = new THREE.CylinderGeometry(0, 3, 1, 4)
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x4E342E })
        const roof = new THREE.Mesh(roofGeo, roofMat)
        roof.position.y = 3.5
        roof.rotation.y = Math.PI / 4
        group.add(roof)
        const counterGeo = new THREE.BoxGeometry(3.5, 0.2, 0.5)
        const counterMat = new THREE.MeshStandardMaterial({ color: 0xD7CCC8 })
        const counter = new THREE.Mesh(counterGeo, counterMat)
        counter.position.set(0, 1.2, 1.3)
        group.add(counter)

        // Add Store Icon to Shop
        const iconTexture = textureLoader.load('/static/icons/adventure-game/inventory-bag.svg')
        iconTexture.colorSpace = THREE.SRGBColorSpace
        const iconGeo = new THREE.PlaneGeometry(1.2, 1.2)
        const iconMat = new THREE.MeshStandardMaterial({ map: iconTexture, transparent: true, alphaTest: 0.5 })
        const icon = new THREE.Mesh(iconGeo, iconMat)
        icon.position.set(0, 2.2, 1.51) // Slightly in front of the wall
        group.add(icon)

        return group
    }

    function createFarmPlotMesh(): any {
        const group = new THREE.Group()
        const dirtGeo = new THREE.PlaneGeometry(3.6, 3.6)
        const dirtMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 })
        const dirt = new THREE.Mesh(dirtGeo, dirtMat)
        dirt.rotation.x = -Math.PI / 2
        dirt.position.y = 0.02
        group.add(dirt)
        const fenceGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8)
        const fenceMat = new THREE.MeshStandardMaterial({ color: 0xE0E0E0 });
        const postPositions = [[1.8, 1.8], [1.8, -1.8], [-1.8, 1.8], [-1.8, -1.8]];
        postPositions.forEach((pos: number[]) => {
            const post = new THREE.Mesh(fenceGeo, fenceMat);
            post.position.set(pos[0], 0.2, pos[1]);
            group.add(post);
        });
        const railGeo = new THREE.BoxGeometry(3.7, 0.05, 0.05)
        const rail1 = new THREE.Mesh(railGeo, fenceMat); rail1.position.set(0, 0.3, 1.8); group.add(rail1)
        const rail2 = new THREE.Mesh(railGeo, fenceMat); rail2.position.set(0, 0.3, -1.8); group.add(rail2)
        const railSideGeo = new THREE.BoxGeometry(0.05, 0.05, 3.7)
        const rail3 = new THREE.Mesh(railSideGeo, fenceMat); rail3.position.set(1.8, 0.3, 0); group.add(rail3)
        const rail4 = new THREE.Mesh(railSideGeo, fenceMat); rail4.position.set(-1.8, 0.3, 0); group.add(rail4)
        return group
    }

    function createWheatMesh(stage: number = 1): any {
        const group = new THREE.Group()
        const wheatColor = stage === 3 ? 0xFFD54F : 0x8BC34A
        const wheatMat = new THREE.MeshStandardMaterial({ color: wheatColor })
        const height = stage === 1 ? 0.2 : (stage === 2 ? 0.5 : 1.2)
        const stalkGeo = new THREE.CylinderGeometry(0.02, 0.02, height, 4)
        const seedGeo = new THREE.SphereGeometry(0.04, 4, 4)
        const numStalks = stage === 1 ? 8 : (stage === 2 ? 15 : 40)
        const spread = 2.0
        for (let i = 0; i < numStalks; i++) {
            const stalkContainer = new THREE.Group()
            const stalk = new THREE.Mesh(stalkGeo, wheatMat)
            stalk.position.y = height / 2
            stalkContainer.add(stalk)

            if (stage === 3) {
                const seed = new THREE.Mesh(seedGeo, wheatMat)
                seed.position.y = height
                seed.scale.set(1, 1.5, 1)
                stalkContainer.add(seed)
            }

            stalkContainer.position.set((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)
            stalkContainer.rotation.z = (Math.random() - 0.5) * 0.1
            stalkContainer.userData = { stage, phase: Math.random() * Math.PI * 2 }
            group.add(stalkContainer)
        }
        group.userData = { stage }
        return group
    }

    function createWaterCanMesh(): any {
        const group = new THREE.Group()
        const mat = new THREE.MeshStandardMaterial({ color: 0x4FC3F7 })
        const bodyGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8)
        const body = new THREE.Mesh(bodyGeo, mat); body.position.y = 0.2; group.add(body)
        const spoutGeo = new THREE.CylinderGeometry(0.05, 0.02, 0.4, 8)
        const spout = new THREE.Mesh(spoutGeo, mat); spout.position.set(0.3, 0.3, 0); spout.rotation.z = -Math.PI / 4; group.add(spout)
        return group
    }

    function createTrowelMesh(): any {
        const group = new THREE.Group()
        const handleMat = new THREE.MeshStandardMaterial({ color: 0x795548 })
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9E9E9E })
        const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8)
        const handle = new THREE.Mesh(handleGeo, handleMat); handle.position.y = 0.15; group.add(handle)
        const bladeGeo = new THREE.BoxGeometry(0.15, 0.3, 0.02)
        const blade = new THREE.Mesh(bladeGeo, bladeMat); blade.position.y = 0.45; blade.rotation.x = 0.2; group.add(blade)
        return group
    }

    // Create tombstone mesh for dead players
    function createTombstoneMesh(): any {
        const group = new THREE.Group()

        // Tombstone base
        const stoneColor = 0x5c5c5c
        const stoneMat = new THREE.MeshStandardMaterial({ color: stoneColor })

        // Main tombstone (rounded rectangle shape approximation)
        const stoneGeo = new THREE.BoxGeometry(0.8, 1.2, 0.3)
        const stone = new THREE.Mesh(stoneGeo, stoneMat)
        stone.position.y = 0.6
        group.add(stone)

        // Rounded top (semi-circle approximation using a smaller box)
        const topGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16, 1, false, 0, Math.PI)
        const top = new THREE.Mesh(topGeo, stoneMat)
        top.rotation.z = Math.PI / 2
        top.rotation.y = Math.PI / 2
        top.position.y = 1.2
        group.add(top)

        // Cross on face (optional simple RIP text impression)
        const crossColor = 0x3a3a3a
        const crossMat = new THREE.MeshStandardMaterial({ color: crossColor })

        // Vertical line of cross
        const crossVGeo = new THREE.BoxGeometry(0.1, 0.5, 0.05)
        const crossV = new THREE.Mesh(crossVGeo, crossMat)
        crossV.position.set(0, 0.7, 0.16)
        group.add(crossV)

        // Horizontal line of cross
        const crossHGeo = new THREE.BoxGeometry(0.3, 0.1, 0.05)
        const crossH = new THREE.Mesh(crossHGeo, crossMat)
        crossH.position.set(0, 0.8, 0.16)
        group.add(crossH)

        // Cross on back
        const crossVBack = crossV.clone()
        crossVBack.position.set(0, 0.7, -0.16)
        group.add(crossVBack)

        const crossHBack = crossH.clone()
        crossHBack.position.set(0, 0.8, -0.16)
        group.add(crossHBack)

        return group
    }

    // Reconnection Overlay
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

    // WebSocket connection
    function connectWebSocket(isInitial: boolean = false) {
        if (isVersionMismatch) return // Block connection if version mismatch
        // Allow connection in both 'game' and 'spectate' modes
        if (currentMode === 'character') return

        // If already connected or connecting, don't start a new one
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            return
        }

        reconnectText.innerText = isInitial ? 'Connecting...' : 'Attempting to re-establish connection...'
        reconnectOverlay.style.display = 'flex'

        // Append customization to URL
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
            checkVersion() // Check version on every connection
        }

        ws.onclose = () => {
            wsConnected = false
            console.log('WebSocket disconnected, reconnecting...')
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
                        <span>${i + 1}. ${displayName}</span>
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
                // Show floating text? " +5 Coins "
            } else if (data.type === 'farm_update') {
                updateFarmPlots(data.farmPlots)
            } else if (data.type === 'welcome') {
                myPlayerId = data.id
                myX = data.x || 0
                myZ = data.z || 0
                myRotation = data.rotation || 0
                myGender = data.gender || 'male'
                updatePlayer({ ...data, firstName: data.firstName || myFirstName, username: data.username || myUsername }, true)
                // updateGenderUI() // Removed

                // Init Dragon
                if (data.farmPlots) updateFarmPlots(data.farmPlots)
                if (data.dragon) {
                    updateDragonState(data.dragon)
                }

            } else if (data.type === 'init') {
                data.players.forEach((p: any) => updatePlayer(p, p.id === myPlayerId))
            } else if (data.type === 'join') {
                updatePlayer(data, false)
            } else if (data.type === 'leave') {
                removePlayer(data.id)
            } else if (data.type === 'update') {
                // Only update target for other players (not self)
                if (data.id !== myPlayerId) {
                    // Update gender if changed
                    const playerData = players.get(data.id)
                    if (playerData && data.gender && playerData.gender !== data.gender) {
                        // Recreate mesh if gender changed
                        scene.remove(playerData.mesh)
                        // Use existing faceIndex if not provided? Or default 0.
                        const fIndex = (data.faceIndex !== undefined) ? data.faceIndex : (playerData['faceIndex'] || 0) // We didn't store faceIndex in PlayerData explicitly? We should.
                        // Wait, I didn't add faceIndex to PlayerData interface. I should have. 
                        // I'll add faceIndex to PlayerData interface later if needed. For now assume data has it or default.
                        const { group, mixer, actions } = createPlayerMesh(false, data.gender, fIndex)
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

                // Visual feedback
                if (dragon) {
                    dragon.health = data.health
                    dragon.flinchTime = Date.now()

                    // Spawn fragments at impact point
                    if (data.x !== undefined && data.z !== undefined) {
                        spawnFragments(data.x, 1.5, data.z, 0xFFEB3B) // Yellow bullet color
                    }
                }
            } else if (data.type === 'dragon_death') {
                updateDragonState({ isDead: true })
                updateDamageList([])
            } else if (data.type === 'dragon_respawn') {
                // Will be handled by next update or we can query?
                // Actually server loop sends updates. But if it was dead, we might need a force update.
                // For now, dragon_update should handle respawn if it starts sending data again.
            } else if (data.type === 'dragon_charging') {
                if (dragon) {
                    dragon.chargeStartTime = Date.now()
                }
            } else if (data.type === 'dragon_attack') {
                // RED FLASH REMOVED
            } else if (data.type === 'player_death') {
                // Handle player death
                handlePlayerDeath(data.id, data.firstName, data.username)
            } else if (data.type === 'player_respawn') {
                // Handle player respawn
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
                if (data.message === 'Not enough coins') {
                    showShopError('Not Enough Coins')
                }
            }
        }
    }

    function updateEconomicUI() {
        // Update Inventory Modal content if open
        const invModal = document.getElementById('inventory-modal')
        if (invModal && invModal.style.display === 'block') {
            showInventoryModal()
        }

        // Update Shop Coin Display if open
        const shopCoinsEl = document.getElementById('shop-coins-display')
        if (shopCoinsEl) {
            shopCoinsEl.innerText = coins.toString()
        }
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

    function getItemIcon(name: string) {
        const style = 'width:24px;height:24px;margin-right:10px;vertical-align:middle;'
        if (name === 'coins') return `<svg style="${style}" viewBox="0 0 24 24" fill="#FFD700"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="#B8860B" font-size="12" font-weight="bold">$</text></svg>`
        if (name === 'wheat_seeds') return `<svg style="${style}" viewBox="0 0 24 24" fill="#8D6E63"><circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><circle cx="12" cy="8" r="3"/></svg>`
        if (name === 'water_can') return `<svg style="${style}" viewBox="0 0 24 24" fill="#4FC3F7"><path d="M4,16 L20,16 L18,8 L6,8 Z M18,8 L22,4 M6,12 L2,12"/></svg>`
        if (name === 'trowel') return `<svg style="${style}" viewBox="0 0 24 24" fill="#9E9E9E"><path d="M12,2 L15,10 L12,18 L9,10 Z M12,18 L12,22" stroke="#795548" stroke-width="2"/></svg>`
        if (name === 'wheat') return `<svg style="${style}" viewBox="0 0 24 24" stroke="#FFD54F" stroke-width="2" fill="none"><path d="M12,22 C12,22 6,16 6,10 C6,6 12,2 12,2 C12,2 18,6 18,10 C18,16 12,22 12,22 Z M12,2 L12,22"/></svg>`
        return ''
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
                <div style="display:flex;align-items:center;">${getItemIcon('coins')} <span style="font-size:18px;">Coins</span></div>
                <span style="color:#FFD700; font-weight:bold; font-size:18px;">${coins}</span>
            </div>
        `

        const itemsList = Object.entries(counts).map(([name, count]) => `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex;align-items:center;">
                    ${getItemIcon(name)}
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
                    ${getItemIcon(item.id)}
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

    // Expose buyItem to global scope for button onclick
    (window as any).buyItem = (itemId: string, btnElement?: HTMLButtonElement) => {
        if (wsConnected && ws) {
            ws.send(JSON.stringify({ type: 'buy_item', itemId }))

            // Visual cooldown
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
                if (!farmPlotWheat[index]) {
                    needsUpdate = true
                } else if (farmPlotWheat[index].userData.stage !== growthStage) {
                    group.remove(farmPlotWheat[index])
                    needsUpdate = true
                }

                if (needsUpdate) {
                    const wheat = createWheatMesh(growthStage)
                    wheat.userData.stage = growthStage
                    group.add(wheat)
                    farmPlotWheat[index] = wheat
                }
            }
        })
    }

    function updatePlayerWeapon(playerData: PlayerData, newWeapon: string | null) {
        playerData.weapon = newWeapon

        // 1. Toggle internal weapons (already in character GLB)
        playerData.mesh.traverse((child: any) => {
            if (child.name === 'staff_beginner') {
                child.visible = (newWeapon === 'staff_beginner')
                if (child.visible) child.frustumCulled = false
            }
        })

        // 2. Handle external weapons (like guns, if they still exist in database)
        if (playerData.weaponMesh) {
            const handBone = playerData.mesh.getObjectByName('hand_R')
            if (handBone) {
                handBone.remove(playerData.weaponMesh)
            } else {
                playerData.mesh.remove(playerData.weaponMesh)
            }
            playerData.weaponMesh = null
        }

        if (newWeapon && newWeapon !== 'staff_beginner') {
            const wMesh = createWeaponMesh(newWeapon)
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

    function updatePlayer(data: { id: string; x: number; z: number; rotation?: number; firstName?: string; username?: string | null; gender?: 'male' | 'female'; faceIndex?: number; weapon?: string | null; isActing?: boolean; actionType?: any; actionPlotId?: number | null }, isMe: boolean) {
        let playerData = players.get(data.id)
        let isNew = false

        if (!playerData) {
            isNew = true
            const gender = data.gender || 'male'
            const faceIndex = data.faceIndex || 0
            const { group: mesh, mixer, actions } = createPlayerMesh(isMe, gender, faceIndex)
            const displayName = (data.username && data.username !== 'null' && data.username.trim() !== '') ? data.username : (data.firstName || 'Player')
            const label = createTextSprite(displayName, isMe)

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
                mixer, // Add mixer
                actions, // Add actions
                isDead: false,
                weapon: data.weapon || null
            }
            players.set(data.id, playerData)
            updatePlayerWeapon(playerData, data.weapon || null)
        }

        if (!playerData) return

        // Update acting state from server (for remote players especially)
        if (data.isActing !== undefined) {
            playerData.isActing = data.isActing
            playerData.actionType = data.actionType
            playerData.actingPlotId = data.actionPlotId
        }

        // Update name label if changed
        const currentDisplayName = (playerData.username && playerData.username.trim() !== '') ? playerData.username : (playerData.firstName || 'Player')
        const newDisplayName = (data.username !== undefined)
            ? ((data.username && data.username.trim() !== '') ? data.username : (data.firstName || playerData.firstName))
            : ((data.firstName && data.firstName !== playerData.firstName) ? data.firstName : currentDisplayName)

        if (newDisplayName !== currentDisplayName) {
            scene.remove(playerData.label)
            playerData.firstName = data.firstName ?? playerData.firstName
            playerData.username = data.username !== undefined ? data.username : playerData.username
            playerData.label = createTextSprite(newDisplayName, isMe)
            scene.add(playerData.label)
        }

        // Update face/gender if changed (including for local player)
        if (data.faceIndex !== undefined && playerData.faceIndex !== data.faceIndex ||
            data.gender !== undefined && playerData.gender !== data.gender) {

            scene.remove(playerData.mesh)
            const newFace = data.faceIndex ?? playerData.faceIndex ?? 0
            const newGender = data.gender ?? playerData.gender
            const { group: mesh, mixer, actions } = createPlayerMesh(isMe, newGender, newFace)

            // Sync current position/rotation to new mesh
            mesh.position.set(playerData.currentX, 0, playerData.currentZ)
            mesh.rotation.y = playerData.currentRotation + (isMe ? Math.PI : 0)

            scene.add(mesh)
            playerData.mesh = mesh
            playerData.mixer = mixer
            playerData.actions = actions
            playerData.gender = newGender
            playerData.faceIndex = newFace

            // Sync weapon to new mesh
            updatePlayerWeapon(playerData, playerData.weapon)
        }

        // Update weapon if changed OR if external mesh is missing (for non-staves)
        const weaponChanged = playerData.weapon !== (data.weapon || null)
        const needsExternalMesh = playerData.weapon && playerData.weapon !== 'staff_beginner' && !playerData.weaponMesh

        if (weaponChanged || needsExternalMesh) {
            updatePlayerWeapon(playerData, data.weapon || null)
        }

        // Update position/rotation ONLY if provided (avoid disappearing on partial updates)
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
        if (data.damageList) {
            updateDamageList(data.damageList)
        }

        if (!dragon) {
            // Create
            if (data.isDead) return // Don't create if dead

            const { group, wings, labelGroup, healthBar } = createDragonMesh()
            scene.add(group)
            scene.add(labelGroup) // Add label group to scene

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

            // Initialize opacity for spawn animation
            group.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    child.material.transparent = true
                    child.material.opacity = 0
                }
            })
        } else {
            // Update
            if (data.isDead) {
                if (!dragon.isDead) {
                    dragon.isDead = true
                    dragon.deathTime = Date.now()
                    dragon.spawnStartTime = undefined // Clear spawn animation
                    // Remove label group immediately, but keep mesh for animation
                    if (dragon.labelGroup) scene.remove(dragon.labelGroup)
                    updateUIVisibility() // Hide shoot button
                }
                return
            }

            // If respawning (was null, but logic handled above), or just moving
            if (dragon.isDead) {
                dragon.isDead = false
                dragon.spawnStartTime = Date.now() // Start spawn animation
                if (dragon.labelGroup) scene.add(dragon.labelGroup)

                // Initialize opacity for spawn animation
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

            // Update Health Bar Scale
            if (dragon.healthBar) {
                const scale = Math.max(0, dragon.health / 10)
                dragon.healthBar.scale.x = scale * 4

                // Color shift? Green -> Red
                const r = 1 - scale
                const g = scale
                dragHealthMat.color.setRGB(r, g, 0)
            }
        }
        updateUIVisibility() // Ensure UI is updated
    }

    function updatePlayerTarget(data: { id: string; x: number; z: number; rotation?: number }) {
        const playerData = players.get(data.id)
        if (playerData) {
            // Only update target - animation loop will interpolate
            playerData.targetX = data.x
            playerData.targetZ = data.z
            playerData.targetRotation = data.rotation ?? playerData.targetRotation
        }
    }

    function updateSheeps(data: any[]) {
        data.forEach(s => {
            let sheep = sheeps.get(s.id)
            if (!sheep) {
                const mesh = createSheepMesh()
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
            if (sheep.isHopping !== s.isHopping) {
                sheep.isHopping = s.isHopping
            }

            // Update Label Text
            if (s.text !== sheep.lastText) {
                if (sheep.label) {
                    scene.remove(sheep.label)
                    sheep.label = null
                }
                if (s.text) {
                    sheep.label = createSheepTextSprite(s.text)
                    scene.add(sheep.label)
                }
                sheep.lastText = s.text
            }
        })
    }

    function createSheepTextSprite(text: string): any {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')!
        canvas.width = 256
        canvas.height = 64

        context.font = 'Bold 32px Arial'
        context.fillStyle = '#FFFFFF' // White
        context.textAlign = 'center'
        context.textBaseline = 'middle'

        // Soft black shadow
        context.shadowColor = 'rgba(0, 0, 0, 0.9)'
        context.shadowBlur = 6
        context.shadowOffsetX = 0
        context.shadowOffsetY = 0

        context.fillText(text, 128, 32)

        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ map: texture })
        const sprite = new THREE.Sprite(material)
        sprite.scale.set(4, 1.0, 1)
        return sprite
    }

    function removePlayer(id: string) {
        const playerData = players.get(id)
        if (playerData) {
            scene.remove(playerData.mesh)
            scene.remove(playerData.label)
            players.delete(id)
        }
    }

    // Handle player death - swap to tombstone and show death message
    function handlePlayerDeath(playerId: string, firstName: string, username?: string | null) {
        const playerData = players.get(playerId)
        if (!playerData) return

        const isMe = playerId === myPlayerId
        playerData.isDead = true

        // Store original mesh for later restoration hint
        const originalMesh = playerData.mesh
        scene.remove(originalMesh)

        // Create tombstone and position it
        const tombstone = createTombstoneMesh()
        const tX = isMe ? myX : playerData.currentX
        const tZ = isMe ? myZ : playerData.currentZ

        playerData.deathX = tX
        playerData.deathZ = tZ

        tombstone.position.set(tX, 0, tZ)
        scene.add(tombstone)
        playerData.mesh = tombstone
        // Reset legs and weaponMesh for tombstone
        playerData.mixer = null // No animation for tombstone
        playerData.actions = {}
        playerData.weaponMesh = null // Old weapon mesh was attached to old mesh

        scene.remove(playerData.label)
        const deadName = (username && username.trim() !== '') ? username : (firstName || 'Player')
        const deathLabel = createTextSprite(isMe ? 'You died' : `${deadName} died`, false)
        deathLabel.position.set(tX, 2.5, tZ)
        scene.add(deathLabel)
        playerData.label = deathLabel

        // Update local state for own player
        if (isMe) {
            myIsDead = true
            // Ensure myX/myZ are exactly where the tombstone is
            myX = tX
            myZ = tZ

            // Create explicit countdown labels for local player
            let timeLeft = 10

            // 1. Top Label: "You died"
            if (playerData.label) scene.remove(playerData.label)
            const topLabel = createTextSprite('You died', false)
            topLabel.scale.set(3, 0.75, 1)
            topLabel.position.set(tX, 4.7, tZ) // Higher up
            scene.add(topLabel)
            playerData.label = topLabel

            // 2. Bottom Label: "Respawning in 10..."
            if (currentCountdownLabel) scene.remove(currentCountdownLabel)
            currentCountdownLabel = createTextSprite(`Respawning in ${timeLeft}...`, false)
            currentCountdownLabel.scale.set(4, 1, 1) // Larger size than "You died"
            currentCountdownLabel.position.set(tX, 3.7, tZ) // Above stone, below "You died"
            scene.add(currentCountdownLabel)

            const timerInterval = setInterval(() => {
                timeLeft--
                if (timeLeft > 0) {
                    // Update countdown label
                    if (currentCountdownLabel) scene.remove(currentCountdownLabel)
                    currentCountdownLabel = createTextSprite(`Respawning in ${timeLeft}...`, false)
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



    // Handle player respawn - restore player mesh and position
    function handlePlayerRespawn(data: { id: string; x: number; z: number; rotation: number; firstName: string; username?: string | null; gender: 'male' | 'female'; faceIndex?: number; weapon?: string | null }) {
        const playerData = players.get(data.id)
        const isMe = data.id === myPlayerId

        if (playerData) {
            // Remove tombstone
            scene.remove(playerData.mesh)
            scene.remove(playerData.label)
            if (playerData.weaponMesh) {
                playerData.mesh.remove(playerData.weaponMesh)
                playerData.weaponMesh = null
            }

            // Create new player mesh
            const { group: mesh, mixer, actions } = createPlayerMesh(isMe, data.gender, data.faceIndex || 0)
            mesh.position.set(data.x, 0, data.z)
            mesh.rotation.y = data.rotation + Math.PI
            scene.add(mesh)

            const respawnName = (data.username && data.username !== 'null' && data.username.trim() !== '') ? data.username : (data.firstName || 'Player')
            const label = createTextSprite(respawnName, isMe)
            label.position.set(data.x, 4.2, data.z)
            scene.add(label)

            // Update player data
            playerData.mesh = mesh
            playerData.label = label
            playerData.firstName = data.firstName
            playerData.username = data.username || null
            playerData.mixer = mixer
            playerData.actions = actions
            playerData.isDead = false
            playerData.weaponMesh = null // Ensure it gets recreated by next updatePlayer call
            playerData.currentX = data.x
            playerData.currentZ = data.z
            playerData.targetX = data.x
            playerData.targetZ = data.z
            playerData.currentRotation = data.rotation
            playerData.targetRotation = data.rotation
            playerData.weapon = data.weapon !== undefined ? data.weapon : playerData.weapon

            // Restore weapon visuals
            updatePlayerWeapon(playerData, playerData.weapon)
        }

        // Update local state for own player
        if (isMe) {
            myIsDead = false
            myX = data.x
            myZ = data.z
            myRotation = data.rotation

            // Remove death overlay
            const overlay = document.getElementById('death-overlay')
            if (overlay) overlay.remove()
            updateUIVisibility()
        }
    }

    // CHARACTER UI ELEMENTS
    const charOverlay = document.createElement('div')
    charOverlay.id = 'char-overlay'
    charOverlay.style.cssText = `
        position: fixed;
        top: 20px;
        left: 0;
        width: 100%;
        display: none;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        pointer-events: none;
        z-index: 100;
    `
    document.body.appendChild(charOverlay)

    const charControls = document.createElement('div')
    charControls.style.cssText = `
        display: flex;
        gap: 10px;
        pointer-events: auto;
    `
    charOverlay.appendChild(charControls)

    const faceBtn = document.createElement('button')
    const getFaceName = (filename: string) => {
        const name = filename.replace('full_face_', '').replace('.png', '')
        return name.charAt(0).toUpperCase() + name.slice(1)
    }
    faceBtn.innerText = `Face: ${getFaceName(charFaces[currentFaceIndex])}`
    faceBtn.style.cssText = `
        position: fixed;
        bottom: 28%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 10px 20px;
        font-size: 16px;
        background: rgba(0,0,0,0.8);
        color: white;
        border-radius: 8px;
        border: 2px solid #FFD54F;
        font-family: system-ui, sans-serif;
        cursor: pointer;
        font-weight: bold;
        z-index: 100;
        display: none;
    `
    // charControls.appendChild(faceBtn) - Removed, appended to body later

    const backBtn = document.createElement('button')
    backBtn.innerText = 'PLAY'
    backBtn.style.cssText = `
        position: fixed;
        bottom: 40px;
        left: 50%;
        transform: translateX(-50%);
        color: white;
        background: rgba(76, 175, 80, 0.9);
        padding: 15px 30px;
        border-radius: 12px;
        border: none;
        cursor: pointer;
        font-weight: 900;
        font-size: 18px;
        pointer-events: auto;
        z-index: 100;
        display: none;
    `
    document.body.appendChild(backBtn)

    function switchToMode(mode: 'game' | 'character' | 'spectate') {
        currentMode = mode
        if (mode === 'character') {
            // Disconnect from game if connected
            if (ws) {
                ws.onclose = null
                ws.close()
                ws = null
                wsConnected = false
            }
            // Re-sync customization preview
            if (charModel) {
                updateCharacterFace()
                updateCharacterGender()
            }
        } else {
            // Reconnect to game
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

        // UI Feedback
        interactBtn.innerText = type.charAt(0).toUpperCase() + type.slice(1) + '...'
        interactBtn.style.background = 'transparent'
        interactBtn.style.border = 'none'
        interactBtn.style.boxShadow = 'none'
        interactBtn.style.color = 'white'
        interactBtn.style.textShadow = '0 0 4px black'
        interactBtn.onclick = null

        // Send to server
        if (wsConnected && ws) {
            const serverType = type === 'planting' ? 'plant_seeds' : (type === 'watering' ? 'water_wheat' : 'harvest_wheat')
            ws.send(JSON.stringify({ type: serverType, plotId }))
        }

        // Action duration (matches animation feel)
        setTimeout(() => {
            const currentP = players.get(myPlayerId!)
            if (currentP && currentP.isActing && currentP.actionType === type) {
                currentP.isActing = false
                currentP.actionType = null
                currentP.actingPlotId = null
                
                // Final thorough cleanup of temporary objects
                if (currentP.temporaryToolMesh) {
                    if (currentP.temporaryToolMesh.parent) {
                        currentP.temporaryToolMesh.parent.remove(currentP.temporaryToolMesh)
                    }
                    currentP.temporaryToolMesh = null
                }

                // Show weapon again
                if (currentP.weaponMesh) currentP.weaponMesh.visible = true
                currentP.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner' && currentP.weapon === 'staff_beginner') {
                        child.visible = true
                    }
                })
                
                updateUIVisibility()
            }
        }, 2000)
    }

    faceBtn.addEventListener('click', () => {
        currentFaceIndex = (currentFaceIndex + 1) % charFaces.length
        faceBtn.innerText = `Face: ${getFaceName(charFaces[currentFaceIndex])}`
        updateCharacterFace()
    })

    // --- UI ELEMENTS ---

    // ============================
    // 1. CHARACTER SCENE UI
    // ============================

    // Username Input
    const usernameInput = document.createElement('input')
    usernameInput.type = 'text'
    usernameInput.placeholder = 'Enter Username (Max 20)'
    usernameInput.value = myUsername || myFirstName || ''
    usernameInput.maxLength = 20
    usernameInput.style.cssText = `
        position: fixed;
        top: 10%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 12px 20px;
        font-size: 18px;
        border-radius: 8px;
        border: 2px solid #FFD54F;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        text-align: center;
        font-family: system-ui, sans-serif;
        z-index: 100;
        width: 80%;
        max-width: 300px;
        display: none;
    `
    usernameInput.addEventListener('input', () => {
        usernameInput.value = usernameInput.value.replace(/[^a-zA-Z0-9 ]/g, '')
    })

    // Play Button
    const playBtn = document.createElement('button')
    playBtn.innerText = 'PLAY'
    playBtn.style.cssText = `
        position: fixed;
        bottom: 5%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 16px 40px;
        font-size: 24px;
        font-weight: bold;
        border-radius: 12px;
        border: none;
        background: #4CAF50;
        color: white;
        font-family: system-ui, sans-serif;
        z-index: 100;
        cursor: pointer;
        box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        display: none;
    `
    playBtn.addEventListener('click', async () => {
        myUsername = usernameInput.value.trim()

        // Sync to Database
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

            // Update top nav label
            const nameLabel = document.getElementById('player-name-label')
            if (nameLabel) nameLabel.innerText = myUsername || myFirstName
        } catch (err) {
            console.error('Error syncing user data:', err)
        }

        currentMode = 'game'
        updateUIVisibility()
        connectWebSocket(true)
    })

    // Character Gender Toggle
    const charGenderBtn = document.createElement('button')
    charGenderBtn.innerText = `Gender: ${charGender.charAt(0).toUpperCase() + charGender.slice(1)}`
    charGenderBtn.style.background = charGender === 'male' ? 'rgba(33, 150, 243, 0.8)' : 'rgba(233, 30, 99, 0.8)'
    charGenderBtn.style.cssText = `
        position: fixed;
        bottom: 20%;
        left: 50%;
        transform: translate(-50%, -50%);
        padding: 10px 20px;
        font-size: 16px;
        background: rgba(33, 150, 243, 0.8);
        color: white;
        border: none;
        border-radius: 8px;
        font-family: system-ui, sans-serif;
        cursor: pointer;
        z-index: 100;
        display: none;
    `
    charGenderBtn.addEventListener('click', () => {
        charGender = charGender === 'male' ? 'female' : 'male'
        myGender = charGender
        charGenderBtn.innerText = `Gender: ${charGender.charAt(0).toUpperCase() + charGender.slice(1)}`
        charGenderBtn.style.background = charGender === 'male' ? 'rgba(33, 150, 243, 0.8)' : 'rgba(233, 30, 99, 0.8)'
        updateCharacterGender()
    })

    // ============================
    // 2. GAME SCENE UI
    // ============================

    // Joystick State & UI
    interface TouchState {
        id: number
        startX: number
        startY: number
        currentX: number
        currentY: number
        isJoystick: boolean
    }
    const activeTouches = new Map<number, TouchState>()
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

    // Shoot Button
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

    // Spawn Dragon Button
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

            // Make player face (0,0) where dragon spawns
            // Direction from (myX, myZ) to (0,0)
            const dx = 0 - myX
            const dz = 0 - myZ
            // Math.atan2(dx, dz) gives the angle relative to (0,0,1)
            // Adding Math.PI to flip it if facing away
            myRotation = Math.atan2(dx, dz) + Math.PI
        }
    }
    spawnBtn.addEventListener('click', handleSpawnDragon)
    spawnBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleSpawnDragon() })

    // Shoot Logic
    const handleShoot = () => {
        if (myIsDead) return
        const now = Date.now()
        if (now - lastFireTime < FIRE_COOLDOWN) return

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

    // Top Navigation Buttons (Hooking into existing elements in index.tsx)
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

    // UI Visibility Management
    function updateUIVisibility() {
        if (isVersionMismatch) return // Keep update overlay visible

        const invBtn = document.getElementById('inventory-btn')
        const scoreModal = document.getElementById('score-modal')
        const invModal = document.getElementById('inventory-modal')
        const shopModal = document.getElementById('shop-modal')

        const isModalOpen = (scoreModal && scoreModal.style.display === 'block') ||
            (invModal && invModal.style.display === 'block') ||
            (shopModal && shopModal.style.display === 'block')

        if (currentMode === 'character') {
            usernameInput.style.display = 'block'
            playBtn.style.display = 'block'
            charGenderBtn.style.display = 'block'
            faceBtn.style.display = 'block'
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
            usernameInput.style.display = 'none'
            playBtn.style.display = 'none'
            charGenderBtn.style.display = 'none'
            faceBtn.style.display = 'none'
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
            usernameInput.style.display = 'none'
            playBtn.style.display = 'none'
            charGenderBtn.style.display = 'none'
            faceBtn.style.display = 'none'
            exitCameraBtn.style.display = 'none'
            
            // Show damage list only if it has content and no modal is open
            if (damageListEl.innerHTML.includes('Dragon Damage') && !isModalOpen) {
                damageListEl.style.display = 'block'
            } else {
                damageListEl.style.display = 'none'
            }

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
            // uiContainer.appendChild(scoreBtn) // Already in index.tsx
            document.body.appendChild(usernameInput)
            document.body.appendChild(playBtn)
            document.body.appendChild(charGenderBtn)
            document.body.appendChild(faceBtn)
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
                if (wsConnected && ws) {
                    ws.send(JSON.stringify({ type: 'get_scores' }))
                } else {
                    console.warn('WS not connected')
                }
                scoreModal.innerHTML = '<div style="text-align:center;">Loading...</div>'
                scoreModal.style.display = 'block'
            } else {
                scoreModal.style.display = 'none'
            }
            updateUIVisibility()
        }
    })


    // Get joystick center
    function getJoystickCenter() {
        const rect = joystickContainer.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }

    // Global touch handlers for multitouch
    document.addEventListener('touchstart', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i]
            const joystickRect = joystickContainer.getBoundingClientRect()

            // Check if touch is on joystick
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
                    // Handle joystick (Game Mode)
                    const center = getJoystickCenter()
                    const maxDelta = 50

                    joystickDeltaX = Math.max(-maxDelta, Math.min(maxDelta, touch.clientX - center.x))
                    joystickDeltaY = Math.max(-maxDelta, Math.min(maxDelta, touch.clientY - center.y))

                    joystickKnob.style.transform = `translate(calc(-50% + ${joystickDeltaX}px), calc(-50% + ${joystickDeltaY}px))`
                } else {
                    // Handle rotation swipe
                    const deltaX = touch.clientX - prevX
                    const p = myPlayerId ? players.get(myPlayerId) : null
                    const isActingNow = p?.isActing || false

                    if (currentMode === 'game' && !isActingNow) {
                        myRotation -= deltaX * 0.01
                    } else if (currentMode === 'character' && charModel) {
                        // Character Scene Rotation
                        charModel.rotation.y += deltaX * 0.01
                    } else if (currentMode === 'spectate') {
                        spectateRotationOffset -= deltaX * 0.01
                    }
                }
            }
        }
    }, { passive: false })

    document.addEventListener('touchend', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i]
            const state = activeTouches.get(touch.identifier)

            if (state && state.isJoystick) {
                // Reset joystick
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

    // Keyboard controls (for desktop)
    const keys: Record<string, boolean> = {}
    window.addEventListener('keydown', (e) => keys[e.code] = true)
    window.addEventListener('keyup', (e) => keys[e.code] = false)

    // Handle window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        charCamera.aspect = window.innerWidth / window.innerHeight
        charCamera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)
    })

    // Movement throttling
    let lastMoveTime = 0
    const MOVE_THROTTLE = 50 // ms
    let lastSentX = -999
    let lastSentZ = -999
    let lastSentRotation = -999

    interface Bullet {
        id: string
        x: number
        z: number
        vx: number // optional for client?
        vz: number // optional for client?
        ownerId: string
        mesh: any
        speed: number // to color code
    }
    const bullets = new Map<string, Bullet>()

    // Impact Fragments
    interface Fragment {
        mesh: any
        velocity: { x: number, y: number, z: number }
        life: number // 1.0 to 0.0
        maxLife: number
    }
    const fragments: Fragment[] = []

    // Bullet Trail Particles
    interface TrailParticle {
        mesh: any
        life: number
        maxLife: number
    }
    const trailParticles: TrailParticle[] = []

    // Create Bullet Mesh
    function createBulletMesh(isDragon: boolean): any {
        const radius = isDragon ? 0.5 : 0.2
        const color = isDragon ? 0xFF5722 : 0xFFEB3B // Orange vs Yellow
        const geo = new THREE.SphereGeometry(radius, 8, 8)
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 1.0
        })
        const mesh = new THREE.Mesh(geo, mat)

        if (isDragon) {
            // Add "Electric" Field
            const fieldGroup = new THREE.Group()
            fieldGroup.name = 'electricField'

            const fieldGeo = new THREE.IcosahedronGeometry(1.0, 0)
            const fieldMat = new THREE.MeshStandardMaterial({
                color: 0x00FFFF, // Cyan electric
                emissive: 0x00FFFF,
                emissiveIntensity: 2.0,
                wireframe: true,
                transparent: true,
                opacity: 0.5
            })
            const field = new THREE.Mesh(fieldGeo, fieldMat)
            fieldGroup.add(field)

            // Add inner rotating cross
            const crossGeo = new THREE.BoxGeometry(1.8, 0.05, 0.05)
            const cross1 = new THREE.Mesh(crossGeo, fieldMat)
            fieldGroup.add(cross1)
            const cross2 = new THREE.Mesh(crossGeo, fieldMat)
            cross2.rotation.y = Math.PI / 2
            fieldGroup.add(cross2)

            mesh.add(fieldGroup)
        }

        mesh.position.y = 1.5 // Height
        return mesh
    }

    // Shared Health Bar Material (global to function to update color)
    const dragHealthMat = new THREE.MeshBasicMaterial({ color: 0x00FF00, transparent: true, opacity: 1 })

    function spawnFragments(x: number, y: number, z: number, color: number) {
        const count = 8
        const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 0.5
        })

        for (let i = 0; i < count; i++) {
            const mesh = new THREE.Mesh(geo, mat)
            mesh.position.set(x, y, z)
            scene.add(mesh)

            fragments.push({
                mesh,
                velocity: {
                    x: (Math.random() - 0.5) * 0.2,
                    y: Math.random() * 0.2 + 0.1,
                    z: (Math.random() - 0.5) * 0.2
                },
                life: 1.0,
                maxLife: 1000 + Math.random() * 500 // 1-1.5 seconds
            })
        }
    }

    function createDragonMesh(): { group: any, wings: any[], labelGroup: any, healthBar: any } {
        const group = new THREE.Group()

        // Colors
        const scaleColor = 0x2E7D32 // Green
        const bellyColor = 0x81C784 // Light Green
        const wingColor = 0x1B5E20 // Dark Green
        const spikeColor = 0xFFD54F // Gold

        // 1. Main Body (Torso)
        const bodyGeo = new THREE.BoxGeometry(2, 2, 4)
        const bodyMat = new THREE.MeshStandardMaterial({ color: scaleColor, transparent: true, opacity: 1 })
        const body = new THREE.Mesh(bodyGeo, bodyMat)
        body.position.y = 2 // Hovering
        group.add(body)

        // 2. Head
        const headGeo = new THREE.BoxGeometry(1.5, 1.5, 2)
        const headMat = new THREE.MeshStandardMaterial({ color: scaleColor, transparent: true, opacity: 1 })
        const head = new THREE.Mesh(headGeo, headMat)
        head.position.set(0, 3, 3)
        group.add(head)

        // Jaw/Snout
        const snoutGeo = new THREE.BoxGeometry(1.5, 0.8, 1.5)
        const snoutMat = new THREE.MeshStandardMaterial({ color: bellyColor, transparent: true, opacity: 1 })
        const snout = new THREE.Mesh(snoutGeo, snoutMat)
        snout.position.set(0, -0.4, 1.75) // Front of head, adjusted to reduce overlap
        head.add(snout)

        // Eyes (Glowing)
        const eyeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.1)
        const eyeMat = new THREE.MeshStandardMaterial({
            color: 0xFF0000,
            emissive: 0xFF0000,
            emissiveIntensity: 2,
            transparent: true,
            opacity: 1,
            name: 'eyeMat'
        })

        const leftEye = new THREE.Mesh(eyeGeo, eyeMat)
        leftEye.position.set(-0.5, 0.3, 1)
        head.add(leftEye)

        const rightEye = new THREE.Mesh(eyeGeo, eyeMat)
        rightEye.position.set(0.5, 0.3, 1)
        head.add(rightEye)

        // 3. Wings
        const wingGeo = new THREE.BoxGeometry(4, 0.2, 2)
        const wingMat = new THREE.MeshStandardMaterial({ color: wingColor, transparent: true, opacity: 1 })

        // Left Wing Pivot
        const leftWingPivot = new THREE.Group()
        leftWingPivot.position.set(-1, 3, 0) // Attach to left side of body
        group.add(leftWingPivot)

        const leftWing = new THREE.Mesh(wingGeo, wingMat)
        leftWing.position.set(-2, 0, 0) // Offset so the pivot is at the wing's edge
        leftWingPivot.add(leftWing)

        // Right Wing Pivot
        const rightWingPivot = new THREE.Group()
        rightWingPivot.position.set(1, 3, 0) // Attach to right side of body
        group.add(rightWingPivot)

        const rightWing = new THREE.Mesh(wingGeo, wingMat)
        rightWing.position.set(2, 0, 0) // Offset so the pivot is at the wing's edge
        rightWingPivot.add(rightWing)

        // 4. Tail
        const tailGeo = new THREE.BoxGeometry(1, 1, 4)
        const tailMat = new THREE.MeshStandardMaterial({ color: scaleColor, transparent: true, opacity: 1 })
        const tail = new THREE.Mesh(tailGeo, tailMat)
        tail.position.set(0, 2, -4)
        group.add(tail)

        // 5. Labels (Name + Health Bar)
        const labelGroup = new THREE.Group()

        // Health Bar Background (Outline)
        const outlineGeo = new THREE.PlaneGeometry(1, 1)
        const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })
        const outline = new THREE.Mesh(outlineGeo, outlineMat)
        outline.scale.set(4.2, 0.5, 1) // Slightly larger than bar
        outline.position.set(0, 0, -0.01) // Behind bar
        labelGroup.add(outline)

        // Health Bar (Bottom)
        const barGeo = new THREE.PlaneGeometry(1, 1)
        barGeo.translate(-0.5, 0, 0) // Shift origin to right edge
        const healthBarMat = dragHealthMat.clone()
        healthBarMat.name = 'healthBarMat'
        const healthBar = new THREE.Mesh(barGeo, healthBarMat)
        healthBar.position.set(2, 0, 0.01) // Right edge at X=2, slightly in front of outline
        healthBar.scale.set(4, 0.3, 1)
        labelGroup.add(healthBar)

        // Name Label (Top)
        const nameLabel = createTextSprite('Dragon', false)
        // Position above health bar
        nameLabel.position.set(0, 0.8, 0)
        // Base scale for Name (Double size -> 4 width, 1 height)
        nameLabel.scale.set(4, 1.0, 1)
        labelGroup.add(nameLabel)

        return { group, wings: [leftWingPivot, rightWingPivot], labelGroup, healthBar }
    }

    function createChargingStarMesh(): any {
        const group = new THREE.Group()
        const count = 12
        const color = 0xFF0000 // Deep Red
        const mat = new THREE.MeshStandardMaterial({
            color: color,
            emissive: color,
            emissiveIntensity: 2.0,
            transparent: true,
            opacity: 0.8
        })

        for (let i = 0; i < count; i++) {
            const coneGeo = new THREE.ConeGeometry(0.1, 1.0, 4)
            const cone = new THREE.Mesh(coneGeo, mat)

            // Distribute cones in a star burst
            const phi = Math.acos(-1 + (2 * i) / count)
            const theta = Math.sqrt(count * Math.PI) * phi

            cone.position.setFromSphericalCoords(0.5, phi, theta)
            cone.lookAt(new THREE.Vector3(0, 0, 0))
            cone.rotateX(Math.PI / 2)

            group.add(cone)
        }

        return group
    }

    function createControlPanelMesh(): any {
        const group = new THREE.Group()

        // Stone material for the obelisk
        const stoneMat = new THREE.MeshStandardMaterial({
            color: 0x607d8b, // Blue-grey stone
            roughness: 0.9,
            metalness: 0.1
        })

        // Main pillar (tapered)
        // Top radius 0.4, bottom 0.6, height 2.5, 4 segments for square base
        const pillarGeo = new THREE.CylinderGeometry(0.4, 0.6, 2.5, 4)
        const pillar = new THREE.Mesh(pillarGeo, stoneMat)
        pillar.position.y = 1.25
        pillar.rotation.y = Math.PI / 4 // Align faces with axes
        group.add(pillar)

        // Top pyramid (Pyramidion)
        const topGeo = new THREE.CylinderGeometry(0, 0.4, 0.5, 4)
        const top = new THREE.Mesh(topGeo, stoneMat)
        top.position.y = 2.5 + 0.25 // Top of pillar + half height of pyramid
        top.rotation.y = Math.PI / 4
        group.add(top)

        // Add some glowing runes for flavor
        const runeColor = 0x00e5ff
        const runeMat = new THREE.MeshStandardMaterial({
            color: runeColor,
            emissive: runeColor,
            emissiveIntensity: 2
        })

        for (let i = 0; i < 4; i++) {
            const runeGeo = new THREE.BoxGeometry(0.05, 0.5, 0.05)
            const rune = new THREE.Mesh(runeGeo, runeMat)
            const angle = (i * Math.PI) / 2
            const radius = 0.45
            rune.position.set(Math.cos(angle) * radius, 1.5, Math.sin(angle) * radius)
            group.add(rune)
        }

        // Add orbiting cylinders
        const cylinderGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8)
        const cylinderMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1 })
        for (let i = 0; i < 4; i++) {
            const cyl = new THREE.Mesh(cylinderGeo, cylinderMat)
            cyl.name = 'floatingCylinder'
            cyl.userData = { phase: i * (Math.PI / 2), orbitRadius: 1.2 + Math.random() * 0.3 }
            group.add(cyl)
        }

        return group
    }

    // Update Bullets with Smoothing
    function updateBullets(serverBullets: any[]) {
        const validIds = new Set<string>()

        serverBullets.forEach((sb: any) => {
            validIds.add(sb.id)
            let b = bullets.get(sb.id)
            if (!b) {
                const isDragon = sb.ownerId === 'dragon'
                const mesh = createBulletMesh(isDragon)
                mesh.position.set(sb.x, 1.5, sb.z)
                scene.add(mesh)

                b = {
                    id: sb.id,
                    x: sb.x, // Target X
                    z: sb.z, // Target Z
                    vx: sb.vx,
                    vz: sb.vz,
                    ownerId: sb.ownerId,
                    mesh: mesh,
                    speed: sb.speed
                }
                bullets.set(sb.id, b)
            } else {
                // Update Target Pos
                b.x = sb.x
                b.z = sb.z
                // We don't snap mesh pos here anymore, wait for animate
                // But if lag is large, maybe snap? For now linear interpolate in animate
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
                // Only show if it's for me or if we want generic visibility?
                // Requirements say: "only the intended player can collect them".
                // Let's show all, but maybe highlight own?
                const mesh = createPickupMesh(sp.weaponType)
                mesh.position.set(sp.x, 1, sp.z)
                scene.add(mesh)

                // If not for me, make it semi-transparent
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
        const delta = (now - lastAnimateTime) / 1000 // Seconds since last frame
        lastAnimateTime = now

        const sModal = document.getElementById('score-modal')
        const iModal = document.getElementById('inventory-modal')
        const shModal = document.getElementById('shop-modal')
        const isModalOpen = (sModal && sModal.style.display === 'block') ||
            (iModal && iModal.style.display === 'block') ||
            (shModal && shModal.style.display === 'block')

        if (currentMode === 'character') {
            if (charMixer) charMixer.update(delta)
            if (charModel) {
                // Subtle rotation for flair
                // charModel.rotation.y += 0.005
            }
            renderer.render(charScene, charCamera)
            return
        }

        // --- GAME MODE LOGIC ---

        const speed = 0.15
        let inputDx = 0
        let inputDz = 0

        if (myPlayerId && (currentMode === 'game' || currentMode === 'spectate')) {
            const p = players.get(myPlayerId)
            const isActingNow = p?.isActing || false

            // Keyboard input (Only if not acting)
            if (!myIsDead && !isActingNow) {
                if (keys['ArrowUp'] || keys['KeyW']) inputDz -= 1
                if (keys['ArrowDown'] || keys['KeyS']) inputDz += 1
                if (keys['ArrowLeft'] || keys['KeyA']) inputDx -= 1
                if (keys['ArrowRight'] || keys['KeyD']) inputDx += 1
            }
            if (keys['KeyQ'] && !isActingNow) myRotation += 0.03
            if (keys['KeyE'] && !isActingNow) myRotation -= 0.03

            // Joystick input (Only if not acting)
            if (!myIsDead && !isActingNow && (Math.abs(joystickDeltaX) > 5 || Math.abs(joystickDeltaY) > 5)) {
                inputDx = joystickDeltaX / 50
                inputDz = joystickDeltaY / 50
            }
        }

        // Normalize input if diagonal (rough)
        const hasInput = (inputDx || 0) !== 0 || (inputDz || 0) !== 0

        // UI Updates (Cooldown)
        const elapsed = now - lastFireTime
        const cooldownCircle = document.getElementById('cooldown-circle')

        if (elapsed < FIRE_COOLDOWN) {
            // On Cooldown
            shootBtn.style.background = 'rgba(100, 100, 100, 0.8)'
            shootBtn.style.cursor = 'not-allowed'

            if (cooldownCircle) {
                const remaining = FIRE_COOLDOWN - elapsed
                const progress = remaining / FIRE_COOLDOWN // 1.0 -> 0.0
                const offset = circumference * (1 - progress) // Full offset (hidden) -> 0 (Full visible)
                // Actually we want it to "fill up" or "empty"? 
                // "Show how long until cooldown ends" -> Usually a full circle shrinking to empty?
                // Let's do shrinking.
                // At start (progress 1.0), offset should be 0 (Full circle).
                // At end (progress 0.0), offset should be C (Empty).

                // stroke-dashoffset: C * (1 - progress) => C * (1 - 1) = 0. C * (1 - 0) = C.
                // Wait, if dashoffset = 0, line is full. If dashoffset = C, line is empty.
                // We want full -> empty.
                const currentOffset = circumference * (1 - progress)
                // Wait, progress goes 1 -> 0.
                // If progress 1, offset = 0 (Full).
                // If progress 0, offset = C (Empty).
                // Correct.

                cooldownCircle.style.strokeDashoffset = `${currentOffset}px`
            }
        } else {
            // Ready
            shootBtn.style.background = 'rgba(244, 67, 54, 0.8)'
            shootBtn.style.cursor = 'pointer'
            if (cooldownCircle) {
                cooldownCircle.style.strokeDashoffset = `${circumference}px` // Hide it (Empty)
            }
        }

        // Interpolate Bullets
        for (const b of bullets.values()) {
            // LERP for smooth visual updates 
            // Current pos -> Target pos (b.x, b.z)
            // Bullet speed is high, 0.15 might be too slow?
            const bulletLerp = 0.3
            b.mesh.position.x = lerp(b.mesh.position.x, b.x, bulletLerp)
            b.mesh.position.z = lerp(b.mesh.position.z, b.z, bulletLerp)

            // Animate local electric field if dragon bullet
            const field = b.mesh.getObjectByName('electricField')
            if (field) {
                field.rotation.z += 0.1
                field.rotation.x += 0.05
                field.scale.setScalar(0.8 + Math.sin(Date.now() * 0.01) * 0.2)

                // Spawn trail particle
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
                    trailParticles.push({
                        mesh: pMesh,
                        life: 1.0,
                        maxLife: 500
                    })
                }
            }
        }

        // Update Trail Particles
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

        // --- OBELISK ANIMATION ---
        if (controlPanel) {
            controlPanel.children.forEach((child: any) => {
                if (child.name === 'floatingCylinder') {
                    const phase = child.userData.phase || 0
                    const orbitRadius = child.userData.orbitRadius || 1.2
                    const time = now * 0.001

                    // Orbit around Y axis
                    const angle = time + phase
                    child.position.x = Math.cos(angle) * orbitRadius
                    child.position.z = Math.sin(angle) * orbitRadius

                    // Up and down asynchronously
                    child.position.y = 1.5 + Math.sin(time * 1.5 + phase * 2) * 0.5

                    // Gentle rotation
                    child.rotation.x += 0.01
                    child.rotation.z += 0.01
                }
            })
        }

        // Update Fragments
        for (let i = fragments.length - 1; i >= 0; i--) {
            const f = fragments[i]
            f.life -= delta * (1000 / f.maxLife)

            f.mesh.position.x += f.velocity.x
            f.mesh.position.y += f.velocity.y
            f.mesh.position.z += f.velocity.z
            f.velocity.y -= 0.01 // Simple gravity

            if (f.life <= 0) {
                scene.remove(f.mesh)
                fragments.splice(i, 1)
            } else {
                f.mesh.scale.set(f.life, f.life, f.life)
                f.mesh.material.opacity = f.life
                f.mesh.material.transparent = true
            }
        }


        // Update Dragon
        if (dragon && !dragon.isDead) {
            dragon.currentX = lerp(dragon.currentX, dragon.targetX, LERP_SPEED)
            dragon.currentZ = lerp(dragon.currentZ, dragon.targetZ, LERP_SPEED)
            dragon.currentRotation = lerpAngle(dragon.currentRotation, dragon.targetRotation, ROTATION_LERP_SPEED)

            // Hover animation
            const now = Date.now()
            let hover = Math.sin(now * 0.002) * 0.5 + 2 // Base height 2

            // SPAWN ANIMATION (Rising and Fading)
            let spawnOpacity = 1
            if (dragon.spawnStartTime) {
                const spawnElapsed = now - dragon.spawnStartTime
                const spawnDuration = 2000
                const spawnT = Math.min(1, spawnElapsed / spawnDuration)

                // Rise from below
                hover -= (1 - spawnT) * 5
                spawnOpacity = spawnT

                if (spawnT >= 1) {
                    dragon.spawnStartTime = undefined
                }
            }

            dragon.mesh.position.set(dragon.currentX, hover, dragon.currentZ)
            dragon.mesh.rotation.y = dragon.currentRotation // Face forward

            // Apply Opacity
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

            // Wing flapping (alive only)
            const wingSpeed = 0.005
            const wingAngle = Math.sin(now * wingSpeed) * 0.5
            if (dragon.wings && dragon.wings.length === 2) {
                dragon.wings[0].rotation.z = wingAngle
                dragon.wings[1].rotation.z = -wingAngle
            }

            // Update Label Group (Position, Rotation, Scale)
            if (dragon.labelGroup) {
                dragon.labelGroup.position.set(dragon.currentX, hover + 5.0, dragon.currentZ)
                dragon.labelGroup.lookAt(camera.position)

                const dist = camera.position.distanceTo(dragon.labelGroup.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                dragon.labelGroup.scale.set(scaleFactor, scaleFactor, scaleFactor)
            }

            // CHARGING EFFECT
            const chargeElapsed = now - (dragon.chargeStartTime || 0)
            const chargeDuration = 1000
            if (chargeElapsed < chargeDuration) {
                if (!dragon.chargingMesh) {
                    dragon.chargingMesh = createChargingStarMesh()
                    dragon.mesh.add(dragon.chargingMesh)
                    // Position at snout: (0, 2.6, 4.75) relative to group
                    dragon.chargingMesh.position.set(0, 2.6, 4.75)
                }
                const chargeT = chargeElapsed / chargeDuration // 0 to 1
                const chargeScale = 0.1 + chargeT * 1.4 // 0.1 to 1.5
                dragon.chargingMesh.scale.set(chargeScale, chargeScale, chargeScale)
                dragon.chargingMesh.rotation.z += 0.2
                dragon.chargingMesh.rotation.y += 0.1

                // Flicker emissivity
                dragon.chargingMesh.traverse((c: any) => {
                    if (c.material) c.material.emissiveIntensity = 1 + Math.random() * 2
                })
            } else if (dragon.chargingMesh) {
                dragon.mesh.remove(dragon.chargingMesh)
                dragon.chargingMesh = null
            }

            // FLINCH EFFECT
            const flinchElapsed = now - (dragon.flinchTime || 0)
            const flinchDuration = 300 // 0.3s
            if (flinchElapsed < flinchDuration) {
                const flinchT = flinchElapsed / flinchDuration
                // Pulse scale
                const pulse = 1.0 + Math.sin(flinchT * Math.PI) * 0.1
                dragon.mesh.scale.set(pulse, pulse, pulse)
                // Color flash red
                dragon.mesh.traverse((c: any) => {
                    if (c.isMesh && c.material && c.material.name !== 'healthBarMat' && c.material.name !== 'eyeMat') {
                        if (c.material.emissive) {
                            c.material.emissive.set(0xff0000)
                            c.material.emissiveIntensity = (1 - flinchT) * 0.5
                        }
                    }
                })
                // Tilt back
                dragon.mesh.rotation.x = -Math.sin(flinchT * Math.PI) * 0.2
            } else {
                dragon.mesh.scale.set(1, 1, 1)
                dragon.mesh.rotation.x = 0
                dragon.mesh.traverse((c: any) => {
                    if (c.isMesh && c.material && c.material.name !== 'eyeMat' && c.material.name !== 'healthBarMat') {
                        if (c.material.emissive) {
                            c.material.emissiveIntensity = 0
                        }
                    }
                })
            }
        } else if (dragon && dragon.isDead) {
            // DRAGON DEATH ANIMATION
            const elapsed = Date.now() - (dragon.deathTime || Date.now())
            const duration = 2000 // 2 seconds to fade/fall
            const t = Math.min(1, elapsed / duration)

            // 1. Fall to ground (ease towards y=0)
            dragon.mesh.position.y = lerp(dragon.mesh.position.y, 0, 0.05)
            // Gently rotate as falling
            dragon.mesh.rotation.z = t * 0.5
            dragon.mesh.rotation.x = t * 0.2

            // 2. Fade out
            const opacity = 1 - t
            dragon.mesh.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    // Clone material for unique opacity if needed, or just set it
                    child.material.transparent = true
                    child.material.opacity = opacity
                }
            })

            // 3. Remove after duration
            if (t >= 1) {
                scene.remove(dragon.mesh)
                dragon = null
            }
        }

        // Update Pickups
        for (const [id, p] of pickups.entries()) {
            p.mesh.rotation.y += 0.05
            const bob = Math.sin(Date.now() * 0.005) * 0.2
            p.mesh.position.y = 1 + bob

            // Bob the arrow specifically
            const arrow = p.mesh.getObjectByName('arrow')
            if (arrow) {
                arrow.position.y = Math.sin(Date.now() * 0.01) * 0.3 // Faster bob for prominence
            }

            // If it's for me, check distance
            if (p.playerId === myPlayerId && !myIsDead) {
                const dx = p.x - myX
                const dz = p.z - myZ
                if (dx * dx + dz * dz < 4.0) { // 2 units radius
                    if (wsConnected && ws) {
                        ws.send(JSON.stringify({ type: 'collect_pickup', pickupId: p.id }))
                        // Optimistically remove
                        scene.remove(p.mesh)
                        pickups.delete(p.id)
                    }
                }
            }
        }

        // Update Sheeps
        for (const s of sheeps.values()) {
            s.currentX = lerp(s.currentX, s.targetX, LERP_SPEED)
            s.currentZ = lerp(s.currentZ, s.targetZ, LERP_SPEED)
            s.currentRotation = lerpAngle(s.currentRotation, s.targetRotation, ROTATION_LERP_SPEED)

            let hopY = 0
            if (s.isHopping) {
                // Slower constant hop speed (e.g. 7.5 radians per second)
                s.hopPhase += delta * 7.5
                hopY = Math.abs(Math.sin(s.hopPhase)) * 0.4
            } else {
                // If not hopping, slowly finish the current hop pulse if any
                if (s.hopPhase % Math.PI > 0.1) {
                    s.hopPhase += delta * 7.5
                    hopY = Math.abs(Math.sin(s.hopPhase)) * 0.4
                } else {
                    s.hopPhase = 0
                }
            }

            // Keep hopPhase in range to avoid float overflow over time
            if (s.hopPhase > Math.PI * 2) {
                s.hopPhase -= Math.PI * 2
            }

            s.mesh.position.set(s.currentX, hopY, s.currentZ)
            s.mesh.rotation.y = s.currentRotation

            if (s.label) {
                s.label.position.set(s.currentX, hopY + 1.8, s.currentZ)
                // Scale based on camera distance
                const dist = camera.position.distanceTo(s.label.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                s.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            }
        }

        // --- WHEAT BREEZE ANIMATION ---
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

        // Update other players
        for (const [id, playerData] of players.entries()) {
            if (id !== myPlayerId) {
                // Smooth interpolation to target
                playerData.currentX = lerp(playerData.currentX, playerData.targetX, LERP_SPEED)
                playerData.currentZ = lerp(playerData.currentZ, playerData.targetZ, LERP_SPEED)
                playerData.currentRotation = lerpAngle(playerData.currentRotation, playerData.targetRotation, ROTATION_LERP_SPEED)

                const isMoving = Math.abs(playerData.currentX - playerData.targetX) > 0.05 || Math.abs(playerData.currentZ - playerData.targetZ) > 0.05
                const now = Date.now()

                if (playerData.isDead) {
                    const tx = playerData.deathX ?? playerData.currentX
                    const tz = playerData.deathZ ?? playerData.currentZ
                    playerData.mesh.position.set(tx, 0, tz)
                    // Tombstones should not rotate
                    playerData.label.position.set(tx, 2.6, tz)

                    // Scale based on camera distance (Match Dragon formula)
                    const dist = camera.position.distanceTo(playerData.label.position)
                    const scaleFactor = Math.max(0.1, dist / 12)
                    playerData.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
                } else {
                    const bounce = isMoving ? Math.sin(now * 0.015) * 0.1 : 0
                    playerData.mesh.position.set(playerData.currentX, bounce, playerData.currentZ)
                    // ROTATION FIX: Rotate mesh 180 degrees
                    playerData.mesh.rotation.y = playerData.currentRotation + Math.PI
                    
                    // Strictly reset lean/tilt during acting
                    if (playerData.isActing) {
                        playerData.mesh.rotation.x = 0
                        playerData.mesh.rotation.z = 0
                    } else {
                        playerData.mesh.rotation.x = 0
                        playerData.mesh.rotation.z = 0
                    }

                    playerData.label.position.set(playerData.currentX, 3.8, playerData.currentZ)

                    // Scale based on camera distance (Match Dragon formula)
                    const dist = camera.position.distanceTo(playerData.label.position)
                    const scaleFactor = Math.max(0.1, dist / 12)
                    playerData.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)

                    // Leg Animation (Remote) -> Mixer Animation
                    if (playerData.mixer) {
                        playerData.mixer.update(delta)
                        
                        let activeAction: any = null
                        if (playerData.isActing) {
                            activeAction = playerData.actions['character_selection'] || playerData.actions['Interact'] || playerData.actions['idle'] || playerData.actions['Idle']
                            playerData.mixer.timeScale = 0.5 // Slower arm/body movements during action
                        } else {
                            const run = playerData.actions['Run'] || playerData.actions['run']
                            const walk = playerData.actions['walking'] || playerData.actions['Walk'] || playerData.actions['walk']
                            const idle = playerData.actions['idle'] || playerData.actions['Idle']
                            activeAction = (isMoving && (walk || run)) ? (walk || run) : idle
                            playerData.mixer.timeScale = 1.0 // Normal speed
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

                    // Handling tools and weapon visibility for acting state
                    if (playerData.isActing) {
                        // No Lean, only arms
                        playerData.mesh.rotation.x = 0

                        // Hide weapon
                        if (playerData.weaponMesh) playerData.weaponMesh.visible = false
                        playerData.mesh.traverse((child: any) => {
                            if (child.name === 'staff_beginner') child.visible = false
                        })

                        // Show tool
                        if (!playerData.temporaryToolMesh) {
                            let tool: any
                            if (playerData.actionType === 'watering') tool = createWaterCanMesh()
                            else tool = createTrowelMesh()
                            
                            // Reduced scale
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
                        
                        // Pouring animation tilt
                        if (playerData.actionType === 'watering' && playerData.temporaryToolMesh) {
                            playerData.temporaryToolMesh.rotation.x = -Math.PI / 4
                        }
                    } else {
                        // Reset tilt
                        playerData.mesh.rotation.x = 0

                        // Restore weapon visibility
                        if (playerData.weaponMesh) playerData.weaponMesh.visible = true
                        playerData.mesh.traverse((child: any) => {
                            if (child.name === 'staff_beginner' && playerData.weapon === 'staff_beginner') {
                                child.visible = true
                            }
                        })
                        // Tool cleanup
                        if (playerData.temporaryToolMesh) {
                            if (playerData.temporaryToolMesh.parent) {
                                playerData.temporaryToolMesh.parent.remove(playerData.temporaryToolMesh)
                            }
                            playerData.temporaryToolMesh = null
                        }
                    }

                    // Floating Weapon Animation (Remote Fallback)
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
                    playerData.mixer.timeScale = 0.5 // Slow down arm movements
                } else {
                    const run = playerData.actions['Run'] || playerData.actions['run']
                    const walk = playerData.actions['walking'] || playerData.actions['Walk'] || playerData.actions['walk']
                    const idle = playerData.actions['idle'] || playerData.actions['Idle']
                    activeAction = (hasInput && (walk || run)) ? (walk || run) : idle
                    playerData.mixer.timeScale = 1.0 // Reset to normal
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

            // Handling tools and weapon visibility for acting state (Local)
            if (playerData && playerData.isActing) {
                // No Lean, only arms
                playerData.mesh.rotation.x = 0

                // Hide weapon
                if (playerData.weaponMesh) playerData.weaponMesh.visible = false
                playerData.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner') child.visible = false
                })

                // Show tool
                if (!playerData.temporaryToolMesh) {
                    let tool: any
                    if (playerData.actionType === 'watering') tool = createWaterCanMesh()
                    else tool = createTrowelMesh()
                    
                    // Reduced scale
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
                
                // Pouring animation tilt
                if (playerData.actionType === 'watering' && playerData.temporaryToolMesh) {
                    playerData.temporaryToolMesh.rotation.x = -Math.PI / 4
                }
            } else if (playerData) {
                // Reset tilt
                playerData.mesh.rotation.x = 0

                // Restore weapon visibility
                if (playerData.weaponMesh) playerData.weaponMesh.visible = true
                playerData.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner' && playerData.weapon === 'staff_beginner') {
                        child.visible = true
                    }
                })
                // Tool cleanup
                if (playerData.temporaryToolMesh) {
                    if (playerData.temporaryToolMesh.parent) {
                        playerData.temporaryToolMesh.parent.remove(playerData.temporaryToolMesh)
                    }
                    playerData.temporaryToolMesh = null
                }
            }
        }

        const speedVal = 0.15 // Local copy for movement if needed, though we already have it at top of loop

        // PROXIMITY CHECKS (only in game mode)
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



        // Apply rotation to movement (CONTROLS FIX)
        // Basis vectors relative to Camera/Player Rotation
        // Forward: (-sin(rot), -cos(rot)) [Away from Camera]
        // Right: (cos(rot), -sin(rot)) [Right of Camera]

        if (hasInput && currentMode === 'game') {
            const sin = Math.sin(myRotation)
            const cos = Math.cos(myRotation)

            // Rotation Matrix derived from basis vectors:
            // Move = Forward * (-inputDz) + Right * (inputDx)
            // Note: inputDz is -1 for Forward (Up), so we negate it to get +Forward
            // Joystick Up (Negative Y/Z) -> Should mean Forward movement

            // Basis Vectors (verified):
            // Forward (Away from Cam): (-sin, -cos)
            // Right (Right of Cam): (cos, -sin)

            const fwdX = -sin
            const fwdZ = -cos
            const rightX = cos
            const rightZ = -sin

            let nextX = myX + (fwdX * -inputDz + rightX * inputDx) * speed
            let nextZ = myZ + (fwdZ * -inputDz + rightZ * inputDx) * speed

            // COLLISION CHECK: Obelisk
            // Position: (-22, 0, 22), Scale: 1.5x.
            const obeliskX = -22, obeliskZ = 22
            const obeliskRadius = 1.2 // Roughly 0.7 base + 0.5 margin
            const distToObelisk = Math.hypot(nextX - obeliskX, nextZ - obeliskZ)

            if (distToObelisk < obeliskRadius) {
                // SLIDING COLLISION: Push back to the edge of the circle
                const angle = Math.atan2(nextZ - obeliskZ, nextX - obeliskX)
                nextX = obeliskX + Math.cos(angle) * obeliskRadius
                nextZ = obeliskZ + Math.sin(angle) * obeliskRadius
            }

            // COLLISION CHECK: Store
            // Position: (-18, 0, -18), Size: 4x3 (rotated)
            const storeX = -18, storeZ = -18
            const storeRadius = 2.8 // Roughly 2.3 radius + 0.5 margin
            const distToStore = Math.hypot(nextX - storeX, nextZ - storeZ)

            if (distToStore < storeRadius) {
                // SLIDING COLLISION: Push back to the edge of the circle
                const angle = Math.atan2(nextZ - storeZ, nextX - storeX)
                nextX = storeX + Math.cos(angle) * storeRadius
                nextZ = storeZ + Math.sin(angle) * storeRadius
            }

            if (currentMode === 'game') {
                myX = nextX
                myZ = nextZ
            }

            // Clamp to bounds
            myX = Math.max(-BOUNDS, Math.min(BOUNDS, myX))
            myZ = Math.max(-BOUNDS, Math.min(BOUNDS, myZ))
        }

        // Update local mesh (always update) with bounce
        const playerD = myPlayerId ? players.get(myPlayerId) : null
        if (playerD) {
            const playerData = playerD
            const now = Date.now()
            // Simple check if keys are pressed or joystick is active for bounce
            const isMoving = hasInput

            const bounce = isMoving ? Math.sin(now * 0.015) * 0.1 : 0

            const tx = myIsDead ? (playerData.deathX ?? myX) : myX
            const tz = myIsDead ? (playerData.deathZ ?? myZ) : myZ

            playerData.mesh.position.set(tx, bounce, tz)
            // ROTATION FIX: Rotate mesh 180 degrees (Only if NOT dead, tombstone stays fixed)
            if (!myIsDead) {
                playerData.mesh.rotation.y = myRotation + Math.PI
                
                // Strictly reset lean/tilt during acting
                if (playerData.isActing) {
                    playerData.mesh.rotation.x = 0
                    playerData.mesh.rotation.z = 0
                } else {
                    playerData.mesh.rotation.x = 0
                    playerData.mesh.rotation.z = 0
                }
            }

            // Position label lower if dead (No bounce on labels)
            const labelHeight = myIsDead ? 4.3 : 3.8
            playerData.label.position.set(tx, labelHeight, tz)

            // Scale based on camera distance (Match Dragon formula)
            const dist = camera.position.distanceTo(playerData.label.position)
            const scaleFactor = Math.max(0.1, dist / 12)
            playerData.label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)

            // Update shoot button visibility based on dragon state (every frame as fallback)
            if (!myIsDead && currentMode === 'game') {
                shootBtn.style.display = (dragon && !dragon.isDead) ? 'flex' : 'none'
            }

            // Leg Animation (Local) -> Already updated above animator loop if present
            if (playerData.mixer) {
                const run = playerData.actions['Run'] || playerData.actions['run']
                const walk = playerData.actions['walking'] || playerData.actions['Walk'] || playerData.actions['walk']
                const idle = playerData.actions['idle'] || playerData.actions['Idle']

                const activeAction = (isMoving && (walk || run)) ? (walk || run) : idle

                if (activeAction) {
                    if (!activeAction.isRunning()) {
                        Object.values(playerData.actions).forEach((act: any) => {
                            if (act !== activeAction) act.fadeOut(0.2)
                        })
                        activeAction.reset().fadeIn(0.2).play()
                    }
                }
            }

            // Floating Weapon Animation (Local)
            if (playerData.weaponMesh) {
                playerData.weaponMesh.rotation.y += 0.02
                playerData.weaponMesh.position.y = 2.0 + Math.sin(now * 0.003) * 0.1
            }
        }

        // Send update (throttled)
        const nowTime = Date.now()
        if (nowTime - lastMoveTime > MOVE_THROTTLE && wsConnected && ws) {
            // Only send if position/rotation changed significantly
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

        // Update camera to follow player (even when dead)
        if (myPlayerId) {
            // CAMERA mode logic
            if (currentMode === 'spectate') {
                const specDist = 4.0
                const specHeight = 1.6
                // Front view: myRotation + Math.PI (because mesh is rotated by Math.PI from its front)
                // Plus the swipe offset
                const angle = myRotation + Math.PI + spectateRotationOffset
                const camX = myX + Math.sin(angle) * specDist
                const camZ = myZ + Math.cos(angle) * specDist
                camera.position.set(camX, specHeight, camZ)
                camera.lookAt(myX, 1.2, myZ)
            } else {
                // CAMERA FIX: Sync Rotation Direction (CCW)
                // Use sin(rot) instead of -sin(rot) to match mesh CCW rotation
                const camDistance = 7.5 // Zoomed in 2x (from 15)
                const camHeight = 5    // Adjusted height (from 10)

                // X: myX + sin(rot) * dist
                // Z: myZ + cos(rot) * dist
                const camX = myX + Math.sin(myRotation) * camDistance
                const camZ = myZ + Math.cos(myRotation) * camDistance

                camera.position.set(camX, camHeight, camZ)
                camera.lookAt(myX, 4, myZ) // Look higher to push character to lower 4th
            }

            // Update static world labels scale
            [controlPanelLabel, shopLabel, farmLabel].forEach(label => {
                const dist = camera.position.distanceTo(label.position)
                const scaleFactor = Math.max(0.1, dist / 12)
                label.scale.set(4 * scaleFactor, 1 * scaleFactor, 1)
            })

            // Update countdown label scale
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

