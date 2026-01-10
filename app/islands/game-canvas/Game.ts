/**
 * Game - Main coordinator class
 * 
 * This class coordinates all managers and runs the main game loop.
 */

import { getGameState, resetGameState } from './managers/GameState'
import { NetworkManager } from './managers/NetworkManager'
import { InputManager } from './managers/InputManager'
import { EntityManager } from './managers/EntityManager'
import { UIManager } from './managers/UIManager'
import * as MeshFactories from './meshFactories'
import * as UIGenerators from './uiGenerators'
import * as LobbyManager from './lobbyManager'
import * as RealmManager from './realmManager'
import * as Constants from './constants'

export class Game {
    private state = getGameState()
    private networkManager!: NetworkManager
    private inputManager!: InputManager
    private entityManager!: EntityManager
    private uiManager!: UIManager

    private animationFrameId: number | null = null

    constructor(
        THREE: any,
        LOADERS: { GLTFLoader: any, SkeletonUtils: any },
        container: HTMLElement,
        userId: string,
        firstName: string,
        username?: string,
        gender?: 'male' | 'female',
        faceIndex?: number,
        initialCoins: number = 0,
        initialInventory: string[] = [],
        tutorialComplete: boolean = false
    ) {
        // Store THREE.js references
        this.state.THREE = THREE
        this.state.SkeletonUtils = LOADERS.SkeletonUtils
        this.state.textureLoader = new THREE.TextureLoader()
        this.state.gltfLoader = new LOADERS.GLTFLoader()

        // Initialize player state
        this.state.myUserId = userId
        this.state.myFirstName = firstName
        this.state.myUsername = username || ''
        this.state.myGender = gender || 'male'
        this.state.charGender = gender || 'male'
        this.state.currentFaceIndex = faceIndex || 0
        this.state.coins = initialCoins
        this.state.inventory = initialInventory
        this.state.tutorialStarted = tutorialComplete

        // Initialize MeshFactories
        MeshFactories.initFactories(THREE, LOADERS.SkeletonUtils)

        // Setup scenes
        this.setupMainScene(THREE, container)
        this.setupCharacterScene(THREE)

        // Initialize managers
        this.uiManager = new UIManager()
        this.inputManager = new InputManager()
        this.entityManager = new EntityManager()
        this.networkManager = new NetworkManager()

        // Register additional callbacks
        this.registerCallbacks()

        // Load character model
        this.loadCharacterModel()

        // Setup lobby scene by default
        this.switchToScene('lobby')

        // Start version checking
        this.startVersionCheck()

        // Connect to WebSocket
        this.networkManager.connect(true)

        // Start render loop
        this.startRenderLoop()
    }

    private setupMainScene(THREE: any, container: HTMLElement) {
        // Create scene
        this.state.scene = new THREE.Scene()
        this.state.scene.background = new THREE.Color(0x87ceeb)

        // Create pickup indicator
        this.state.globalPickupIndicator = MeshFactories.createGlobalIndicatorMesh()
        this.state.globalPickupIndicator.visible = false
        this.state.scene.add(this.state.globalPickupIndicator)

        // Camera
        this.state.camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 500)
        this.state.camera.position.set(0, 8, 12)
        this.state.camera.lookAt(0, 0, 0)

        // Renderer
        this.state.renderer = new THREE.WebGLRenderer({ antialias: true })
        this.state.renderer.setSize(window.innerWidth, window.innerHeight)
        this.state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        this.state.renderer.outputColorSpace = THREE.SRGBColorSpace
        this.state.renderer.toneMapping = THREE.ACESFilmicToneMapping
        this.state.renderer.toneMappingExposure = 1.4
        container.appendChild(this.state.renderer.domElement)

        // Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 1.5)
        this.state.scene.add(ambientLight)

        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3a5a40, 1.5)
        hemiLight.position.set(0, 50, 0)
        this.state.scene.add(hemiLight)

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2)
        dirLight1.position.set(10, 20, 10)
        this.state.scene.add(dirLight1)

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.9)
        dirLight2.position.set(-10, 20, -10)
        this.state.scene.add(dirLight2)

        // Ground
        const groundGeo = new THREE.PlaneGeometry(50, 50)
        const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a5a40 })
        const ground = new THREE.Mesh(groundGeo, groundMat)
        ground.rotation.x = -Math.PI / 2
        this.state.scene.add(ground)

        const gridHelper = new THREE.GridHelper(50, 25, 0x588157, 0x588157)
        gridHelper.position.y = 0.01
        this.state.scene.add(gridHelper)

        // Boundary walls
        const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4033, transparent: true, opacity: 0.7 })
        const wallHeight = 0.5
        const wallThickness = 0.3
        const wallGeo = new THREE.BoxGeometry(50, wallHeight, wallThickness)
        const wallGeoSide = new THREE.BoxGeometry(wallThickness, wallHeight, 50)

        const wallN = new THREE.Mesh(wallGeo, wallMaterial)
        wallN.position.set(0, wallHeight / 2, -25)
        this.state.scene.add(wallN)

        const wallS = new THREE.Mesh(wallGeo, wallMaterial)
        wallS.position.set(0, wallHeight / 2, 25)
        this.state.scene.add(wallS)

        const wallE = new THREE.Mesh(wallGeoSide, wallMaterial)
        wallE.position.set(25, wallHeight / 2, 0)
        this.state.scene.add(wallE)

        const wallW = new THREE.Mesh(wallGeoSide, wallMaterial)
        wallW.position.set(-25, wallHeight / 2, 0)
        this.state.scene.add(wallW)

        // Handle resize
        window.addEventListener('resize', () => {
            this.state.camera.aspect = window.innerWidth / window.innerHeight
            this.state.camera.updateProjectionMatrix()
            this.state.renderer.setSize(window.innerWidth, window.innerHeight)
            this.updateCharCamera()
        })
    }

    private setupCharacterScene(THREE: any) {
        this.state.charScene = new THREE.Scene()
        this.state.charScene.background = new THREE.Color(0x222222)

        this.state.charCamera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
        this.updateCharCamera()

        // Lighting
        const charAmbient = new THREE.AmbientLight(0xffffff, 1.8)
        this.state.charScene.add(charAmbient)

        const charHemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.8)
        this.state.charScene.add(charHemi)

        const charFill1 = new THREE.DirectionalLight(0xffffff, 1.5)
        charFill1.position.set(5, 5, 5)
        this.state.charScene.add(charFill1)

        const charFill2 = new THREE.DirectionalLight(0xffffff, 1.0)
        charFill2.position.set(-5, 5, -5)
        this.state.charScene.add(charFill2)
    }

    private updateCharCamera() {
        const isMobile = window.innerWidth <= 768
        const targetY = isMobile ? -1.2 : 0
        const targetZ = isMobile ? 9.0 : 7
        this.state.charCamera.position.set(0, targetY, targetZ)
        this.state.charCamera.lookAt(0, targetY, 0)
    }

    private loadCharacterModel() {
        MeshFactories.loadCharacterModel(this.state.gltfLoader, () => {
            this.state.charModel = this.state.SkeletonUtils.clone(MeshFactories.baseCharModel)
            this.state.charScene.add(this.state.charModel)
            this.state.charModel.position.y = -1.0
            this.state.charModel.scale.set(0.525, 0.525, 0.525)

            const showParts = ['head', 'head_1', 'hands', 'pants', 'shirt', 'shoes', 'hair_short']
            this.state.charModel.traverse((child: any) => {
                if (showParts.includes(child.name)) child.visible = true
            })

            if (MeshFactories.baseAnimations && MeshFactories.baseAnimations.length > 0) {
                this.state.charMixer = new this.state.THREE.AnimationMixer(this.state.charModel)
                const clip = this.state.THREE.AnimationClip.findByName(MeshFactories.baseAnimations, 'character_selection') || MeshFactories.baseAnimations[0]
                if (clip) {
                    const action = this.state.charMixer.clipAction(clip)
                    action.play()
                }
            }

            this.updateCharacterFace()
            this.updateCharacterGender()
        })
    }

    private registerCallbacks() {
        this.state.registerCallback('connectWebSocket', (isInitial: boolean, bypass?: boolean) => {
            this.networkManager.connect(isInitial, bypass)
        })

        this.state.registerCallback('switchToScene', this.switchToScene.bind(this))
        this.state.registerCallback('switchToMode', this.switchToMode.bind(this))
        this.state.registerCallback('updateCharacterFace', this.updateCharacterFace.bind(this))
        this.state.registerCallback('updateCharacterGender', this.updateCharacterGender.bind(this))
        this.state.registerCallback('checkVersion', this.checkVersion.bind(this))

        this.state.registerCallback('updateFarmPlots', this.updateFarmPlots.bind(this))

        this.state.registerCallback('handleShoot', () => {
            if (this.state.myIsDead) return
            const now = Date.now()
            if (now - this.state.lastFireTime < Constants.FIRE_COOLDOWN) return
            this.networkManager.sendShoot()
            this.state.lastFireTime = now
            if (this.state.shootBtn) {
                this.state.shootBtn.style.transform = 'scale(0.95)'
                setTimeout(() => {
                    if (this.state.shootBtn) this.state.shootBtn.style.transform = 'scale(1)'
                }, 100)
            }
        })

        this.state.registerCallback('handleSpawnDragon', () => {
            this.networkManager.sendSpawnDragon()
            if (this.state.spawnBtn) this.state.spawnBtn.style.display = 'none'
            const dx = 0 - this.state.myX
            const dz = 0 - this.state.myZ
            this.state.myRotation = Math.atan2(dx, dz) + Math.PI
        })
    }

    private switchToScene(type: 'lobby' | 'realm') {
        if (type === 'realm') {
            if (this.state.lobbyState) {
                LobbyManager.cleanupLobby(this.state.scene, this.state.lobbyState)
                this.state.lobbyState = null
                this.state.sheeps.forEach(s => {
                    if (s.mesh) this.state.scene.remove(s.mesh)
                    if (s.label) this.state.scene.remove(s.label)
                })
                this.state.sheeps.clear()
            }
            if (!this.state.realmState) {
                this.state.realmState = RealmManager.setupRealm(this.state.scene, this.state.THREE)
                this.state.isInRealm = true
            }
        } else {
            if (this.state.realmState) {
                RealmManager.cleanupRealm(this.state.scene, this.state.THREE)
                this.state.realmState = null
            }
            if (!this.state.lobbyState) {
                this.state.lobbyState = LobbyManager.setupLobby(
                    this.state.scene,
                    this.state.THREE,
                    this.state.textureLoader,
                    MeshFactories,
                    UIGenerators
                )
                this.state.isInRealm = false
            }
        }
        this.state.callbacks.updateUIVisibility?.()
    }

    private switchToMode(mode: 'game' | 'character' | 'spectate' | 'congratulations') {
        this.state.currentMode = mode
        this.state.callbacks.updateUIVisibility?.()

        if (mode === 'game' && !this.state.wsConnected) {
            this.networkManager.connect(true, true)
        }
    }

    private updateCharacterFace() {
        const faceName = this.state.tempFaceOverride || MeshFactories.charFaces[this.state.currentFaceIndex]
        const texture = MeshFactories.loadedTextures.get(faceName)
        if (!texture) return

        // Update character scene model
        if (this.state.charModel) {
            this.state.charModel.traverse((child: any) => {
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

        // Update game scene player model
        if (this.state.myPlayerId) {
            const p = this.state.players.get(this.state.myPlayerId)
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

    private updateCharacterGender() {
        if (!this.state.charModel) return
        this.state.charModel.traverse((child: any) => {
            if (child.name === 'hair_short') child.visible = (this.state.charGender === 'male')
            if (child.name === 'hair_long') child.visible = (this.state.charGender === 'female')
            if (child.name === 'shirt' && child.material) {
                child.material.map = (this.state.charGender === 'male')
                    ? MeshFactories.shirtTextures.male
                    : MeshFactories.shirtTextures.female
                child.material.needsUpdate = true
            }
        })
    }

    private updateFarmPlots(plots: any[]) {
        this.state.farmPlotsState = plots
        if (!this.state.lobbyState) return

        plots.forEach((plot: any, index: number) => {
            if (index >= this.state.lobbyState!.farmPlotGroups.length) return
            const group = this.state.lobbyState!.farmPlotGroups[index]
            const growthStage = plot.growthStage || 0

            if (growthStage === 0) {
                if (this.state.farmPlotWheat[index]) {
                    group.remove(this.state.farmPlotWheat[index])
                    this.state.farmPlotWheat[index] = null
                }
            } else {
                let needsUpdate = false
                if (!this.state.farmPlotWheat[index]) needsUpdate = true
                else if (this.state.farmPlotWheat[index].userData.stage !== growthStage) {
                    group.remove(this.state.farmPlotWheat[index])
                    needsUpdate = true
                }
                if (needsUpdate) {
                    const wheat = MeshFactories.createWheatMesh(growthStage)
                    wheat.userData.stage = growthStage
                    group.add(wheat)
                    this.state.farmPlotWheat[index] = wheat
                }
            }
        })
    }

    private startVersionCheck() {
        this.checkVersion()
        this.state.versionInterval = setInterval(() => this.checkVersion(), 60000)
    }

    private async checkVersion() {
        try {
            const resp = await fetch('/api/version')
            const data = (await resp.json()) as { version?: string }
            if (data.version && data.version !== Constants.CLIENT_VERSION) {
                this.state.isVersionMismatch = true
                if (this.state.versionInterval) clearInterval(this.state.versionInterval)
                UIGenerators.showUpdateOverlay(data.version)
            }
        } catch (err) {
            console.error('Failed to check version:', err)
        }
    }

    private startRenderLoop() {
        const animate = () => {
            this.animationFrameId = requestAnimationFrame(animate)

            const now = Date.now()
            const deltaTime = (now - this.state.lastAnimateTime) / 1000
            this.state.lastAnimateTime = now

            // Update character mixer
            if (this.state.charMixer) {
                this.state.charMixer.update(deltaTime)
            }

            // Update character rotation
            if (this.state.charModel) {
                this.state.charModel.rotation.y = this.state.charRotation
            }

            // Render appropriate scene
            if (this.state.currentMode === 'character') {
                this.state.renderer.render(this.state.charScene, this.state.charCamera)
            } else {
                this.updateGameLoop(deltaTime)
                this.state.renderer.render(this.state.scene, this.state.camera)
            }
        }

        animate()
    }

    private updateGameLoop(deltaTime: number) {
        // Handle movement
        if (!this.state.myIsDead && this.state.currentMode === 'game') {
            const input = this.inputManager.getMovementInput()
            if (this.inputManager.hasMovementInput()) {
                const SPEED = 18
                const dx = input.x * SPEED * deltaTime
                const dz = input.y * SPEED * deltaTime

                // Calculate new position
                const newX = this.state.myX + dx
                const newZ = this.state.myZ + dz

                // Client-side collision detection with other players - sliding
                const PLAYER_RADIUS = 0.8
                const COLLISION_RADIUS = 0.6
                let finalX = newX
                let finalZ = newZ

                for (const [playerId, playerData] of this.state.players) {
                    if (playerId === this.state.myPlayerId) continue // Skip self
                    if (playerData.isDead) continue // Skip dead players

                    const distX = finalX - playerData.currentX
                    const distZ = finalZ - playerData.currentZ
                    const distance = Math.sqrt(distX * distX + distZ * distZ)
                    const minDist = PLAYER_RADIUS + COLLISION_RADIUS

                    if (distance < minDist && distance > 0.01) {
                        const angle = Math.atan2(distZ, distX)
                        finalX = playerData.currentX + Math.cos(angle) * minDist
                        finalZ = playerData.currentZ + Math.sin(angle) * minDist
                    }
                }

                this.state.myX = finalX
                this.state.myZ = finalZ

                // Clamp to world bounds
                this.state.myX = Math.max(-Constants.BOUNDS, Math.min(Constants.BOUNDS, this.state.myX))
                this.state.myZ = Math.max(-Constants.BOUNDS, Math.min(Constants.BOUNDS, this.state.myZ))

                // Calculate rotation
                this.state.myRotation = Math.atan2(-input.x, -input.y)

                // Send to server
                this.networkManager.sendMove(this.state.myX, this.state.myZ, this.state.myRotation)
            }
        }

        // Update my player mesh
        const myPlayer = this.state.players.get(this.state.myPlayerId || '')
        if (myPlayer) {
            myPlayer.mesh.position.set(this.state.myX, 0, this.state.myZ)
            myPlayer.mesh.rotation.y = this.state.myRotation + Math.PI
            myPlayer.label.position.set(this.state.myX, 2.5, this.state.myZ)
            if (myPlayer.mixer) {
                myPlayer.mixer.update(deltaTime)

                // Animation switching
                if (myPlayer.actions) {
                    const hasInput = this.inputManager.hasMovementInput()
                    const run = myPlayer.actions['Run'] || myPlayer.actions['run']
                    const walk = myPlayer.actions['walking'] || myPlayer.actions['Walk'] || myPlayer.actions['walk']

                    // Check if player has the staff_beginner weapon
                    const hasStaffBeginner = myPlayer.weapon === 'staff_beginner'
                    const idle = hasStaffBeginner
                        ? (myPlayer.actions['Idle'] || myPlayer.actions['idle'])
                        : (myPlayer.actions['idle_noweapon'] || myPlayer.actions['Idle'] || myPlayer.actions['idle'])

                    const activeAction = (hasInput && (walk || run)) ? (walk || run) : idle

                    if (activeAction && !activeAction.isRunning()) {
                        // Stop all other animations to prevent blending issues
                        Object.values(myPlayer.actions).forEach((act: any) => {
                            if (act !== activeAction) act.fadeOut(0.2)
                        })

                        activeAction.reset().fadeIn(0.2).play()
                    }
                }
            }
        }

        // Interpolate entities
        this.entityManager.interpolateEntities(deltaTime)

        // Update camera
        this.updateCamera()

        // Animate dragon wings
        this.animateDragonWings(deltaTime)

        // Animate pickups
        this.animatePickups(deltaTime)

        // Update cooldown circle
        this.updateCooldownCircle()

        // Check proximity for interactions
        this.checkProximity()
    }

    private updateCamera() {
        if (!this.state.camera) return

        if (this.state.currentMode === 'spectate') {
            this.state.spectateRotationOffset += 0.003
            const radius = 30
            const x = Math.sin(this.state.spectateRotationOffset) * radius
            const z = Math.cos(this.state.spectateRotationOffset) * radius
            this.state.camera.position.set(x, 15, z)
            this.state.camera.lookAt(0, 0, 0)
        } else if (this.state.currentMode === 'game' || this.state.currentMode === 'congratulations') {
            // Follow player camera
            const targetX = this.state.myX
            const targetZ = this.state.myZ + 12
            this.state.camera.position.x += (targetX - this.state.camera.position.x) * 0.1
            this.state.camera.position.z += (targetZ - this.state.camera.position.z) * 0.1
            this.state.camera.position.y = 8
            this.state.camera.lookAt(this.state.myX, 0, this.state.myZ)
        }
    }

    private animateDragonWings(deltaTime: number) {
        if (this.state.dragon && !this.state.dragon.isDead && this.state.dragon.wings) {
            const time = Date.now() * 0.005
            this.state.dragon.wings.forEach((wing: any, i: number) => {
                const baseAngle = (i === 0) ? -0.3 : 0.3
                const flapAngle = Math.sin(time) * 0.4
                wing.rotation.z = baseAngle + flapAngle
            })
        }
    }

    private animatePickups(deltaTime: number) {
        const time = Date.now() * 0.003
        this.state.pickups.forEach(pickup => {
            if (pickup.mesh) {
                pickup.mesh.position.y = 0.5 + Math.sin(time) * 0.2
                pickup.mesh.rotation.y += deltaTime * 2
            }
        })
    }

    private updateCooldownCircle() {
        const circle = document.getElementById('cooldown-circle')
        if (circle) {
            const now = Date.now()
            const elapsed = now - this.state.lastFireTime
            const progress = Math.min(1, elapsed / Constants.FIRE_COOLDOWN)
            const size = 80
            const strokeWidth = 6
            const radius = (size - strokeWidth) / 2
            const circumference = 2 * Math.PI * radius
            circle.style.strokeDashoffset = (circumference * (1 - progress)).toString()
        }
    }

    private checkProximity() {
        // Check for obelisk/control panel proximity
        if (this.state.lobbyState?.controlPanel && this.state.dragon?.isDead) {
            const cpPos = this.state.lobbyState.controlPanel.position
            const dist = Math.sqrt(
                Math.pow(this.state.myX - cpPos.x, 2) +
                Math.pow(this.state.myZ - cpPos.z, 2)
            )
            if (this.state.spawnBtn) {
                this.state.spawnBtn.style.display = (dist < 3 && !this.state.isModalOpen) ? 'block' : 'none'
            }
        } else if (this.state.spawnBtn) {
            this.state.spawnBtn.style.display = 'none'
        }

        // Check for pickup proximity
        this.state.pickups.forEach((pickup, id) => {
            if (pickup.playerId !== this.state.myPlayerId) return
            const dist = Math.sqrt(
                Math.pow(this.state.myX - pickup.x, 2) +
                Math.pow(this.state.myZ - pickup.z, 2)
            )
            if (dist < 2) {
                this.networkManager.sendCollectPickup(id)
            }
        })

        // Update pickup indicator
        if (this.state.globalPickupIndicator) {
            let hasPickup = false
            let pickupX = 0, pickupZ = 0
            this.state.pickups.forEach(p => {
                if (p.playerId === this.state.myPlayerId) {
                    hasPickup = true
                    pickupX = p.x
                    pickupZ = p.z
                }
            })
            this.state.globalPickupIndicator.visible = hasPickup
            if (hasPickup) {
                this.state.globalPickupIndicator.position.set(pickupX, 3, pickupZ)
            }
        }
    }

    public destroy() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId)
        }
        if (this.state.versionInterval) {
            clearInterval(this.state.versionInterval)
        }
        if (this.state.ws) {
            this.state.ws.close()
        }
        resetGameState()
    }
}
