/**
 * GameState - Central state container for the game
 * 
 * This class holds all shared state that was previously in closure variables.
 * Managers access state through this object instead of closures.
 */

import * as Types from '../types'
import * as LobbyManager from '../lobbyManager'
import * as RealmManager from '../realmManager'

export class GameState {
    // Three.js core
    THREE: any = null
    scene: any = null
    camera: any = null
    renderer: any = null
    charScene: any = null
    charCamera: any = null
    charModel: any = null
    charMixer: any = null

    // Loaders
    gltfLoader: any = null
    textureLoader: any = null
    SkeletonUtils: any = null

    // Entity collections
    players: Map<string, Types.PlayerData> = new Map()
    pickups: Map<string, Types.PickupData> = new Map()
    sheeps: Map<string, Types.SheepData> = new Map()
    bullets: Types.Bullet[] = []
    fragments: Types.Fragment[] = []
    trailParticles: Types.TrailParticle[] = []
    dragon: Types.DragonData | null = null

    // Player identity
    myPlayerId: string | null = null
    myUserId: string = ''
    myFirstName: string = ''
    myUsername: string = ''
    myGender: 'male' | 'female' = 'male'
    myX: number = 0
    myZ: number = 0
    myRotation: number = 0
    myIsDead: boolean = false
    currentFaceIndex: number = 0
    charGender: 'male' | 'female' = 'male'

    // Economy
    coins: number = 0
    inventory: string[] = []

    // WebSocket
    ws: WebSocket | null = null
    wsConnected: boolean = false
    wsUrl: string = ''
    currentRoomId: string | null = null

    // Game mode
    currentMode: 'game' | 'character' | 'spectate' | 'congratulations' = 'character'
    tutorialStarted: boolean = false
    isVersionMismatch: boolean = false

    // Scene state
    isInRealm: boolean = false
    lobbyState: LobbyManager.LobbyState | null = null
    realmState: RealmManager.RealmState | null = null
    farmPlotsState: any[] = []
    farmPlotWheat: (any | null)[] = new Array(9).fill(null)
    pondsState: any[] = []
    pondIndicators: any[] = []

    // UI Managers
    farmingUI: any = null
    fishingUI: any = null

    // Realm waiting
    isWaitingForRealm: boolean = false
    realmPlayers: any[] = []
    realmTime: number = 0
    realmWaitModal: HTMLDivElement | null = null

    // UI state
    isModalOpen: boolean = false
    isInventoryOpen: boolean = false
    isShopOpen: boolean = false
    isScoreboardOpen: boolean = false
    isCharacterCustomizing: boolean = true
    lastModalCloseTime: number = 0
    tempFaceOverride: string | null = null

    // Input state
    activeTouches: Map<number, Types.TouchState> = new Map()
    joystickDeltaX: number = 0
    joystickDeltaY: number = 0
    isDraggingChar: boolean = false
    previousMouseX: number = 0
    charRotation: number = 0
    spectateRotationOffset: number = 0

    // Timing
    lastAnimateTime: number = Date.now()
    lastFireTime: number = 0
    versionInterval: any = null

    // UI Elements (references to DOM elements created by UIManager)
    globalPickupIndicator: any = null
    reconnectOverlay: HTMLDivElement | null = null
    reconnectText: HTMLDivElement | null = null
    joystickContainer: HTMLDivElement | null = null
    joystickKnob: HTMLDivElement | null = null
    shootBtn: HTMLButtonElement | null = null
    spawnBtn: HTMLButtonElement | null = null
    interactBtn: HTMLButtonElement | null = null
    exitCameraBtn: HTMLButtonElement | null = null
    scoreModal: HTMLDivElement | null = null
    damageListEl: HTMLDivElement | null = null
    congratsModal: HTMLDivElement | null = null

    // Callbacks for cross-manager communication
    callbacks: {
        updateUIVisibility?: () => void
        updateCharacterFace?: () => void
        updateCharacterGender?: () => void
        switchToScene?: (type: 'lobby' | 'realm') => void
        switchToMode?: (mode: 'game' | 'character' | 'spectate' | 'congratulations') => void
        connectWebSocket?: (isInitial: boolean, bypassCharacterCheck?: boolean) => void
        updatePlayer?: (data: any, isMe: boolean) => void
        removePlayer?: (id: string) => void
        clearAllPlayers?: () => void
        updateDragonState?: (data: any) => void
        updateSheeps?: (data: any[]) => void
        updatePickups?: (serverPickups: any[]) => void
        updateBullets?: (serverBullets: any[]) => void
        updateFarmPlots?: (plots: any[]) => void
        updateEconomicUI?: () => void
        showShopError?: (msg: string) => void
        showInventoryModal?: () => void
        showShopModal?: () => void
        updateRealmWaitModal?: () => void
        updateDamageList?: (list: { name: string, damage: number }[]) => void
        handlePlayerDeath?: (playerId: string, firstName: string, username?: string | null) => void
        handlePlayerRespawn?: (data: any) => void
        handleShoot?: () => void
        handleSpawnDragon?: () => void
        checkVersion?: () => Promise<void>
        updatePondIndicators?: () => void
        startFarmingAction?: (type: 'planting' | 'watering' | 'harvesting', plotId: number) => void
    } = {}

    constructor() {
        // Protocol detection
        const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        const host = typeof window !== 'undefined' ? window.location.host : 'localhost:5173'
        this.wsUrl = `${protocol}//${host}/game`
    }

    /**
     * Register a callback for cross-manager communication
     */
    registerCallback<K extends keyof GameState['callbacks']>(
        name: K,
        fn: NonNullable<GameState['callbacks'][K]>
    ) {
        this.callbacks[name] = fn as any
    }

    /**
     * Send a WebSocket message if connected
     */
    sendMessage(message: object) {
        if (this.wsConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message))
        }
    }
}

// Singleton instance
let instance: GameState | null = null

export function getGameState(): GameState {
    if (!instance) {
        instance = new GameState()
    }
    return instance
}

export function resetGameState(): void {
    instance = null
}
