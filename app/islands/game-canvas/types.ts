export interface GameCanvasProps {
    userId?: string
    firstName?: string
    username?: string
    email?: string
    gender?: 'male' | 'female'
    faceIndex?: number
    initialCoins?: number
    initialInventory?: string[]
    tutorialComplete?: boolean
    serverVersion?: string
}

export interface PlayerData {
    mesh: any // THREE.Group or similar
    label: any // THREE.Sprite
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
    currentActionName?: string
    // Death state
    isDead: boolean
    deathX?: number
    deathZ?: number
    weapon: string | null
    weaponMesh?: any
    // Realm Role State
    role?: 'Fisher' | 'Cooker' | 'None'
    heldItem?: string | null
    // Action state
    isActing?: boolean
    actionType?: 'planting' | 'watering' | 'harvesting' | 'fishing' | null
    actionPlotId?: number | null
    actingPlotId?: number | null
    actingStartTime?: number
    temporaryToolMesh?: any
    // Fishing Rod Animation
    fishingRodMesh?: any
    fishingRodMixer?: any
    fishingRodActions?: { [key: string]: any }
}

export interface PickupData {
    id: string
    mesh: any
    weaponType: string
    playerId: string
    x: number
    z: number
}

export interface DragonData {
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

export interface SheepData {
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

export interface Bullet {
    id: string
    x: number
    z: number
    vx: number
    vz: number
    ownerId: string
    mesh: any
    speed: number
}

export interface Fragment {
    mesh: any
    velocity: { x: number, y: number, z: number }
    life: number
    maxLife: number
}

export interface TrailParticle {
    mesh: any
    life: number
    maxLife: number
}

export interface TouchState {
    id: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    isJoystick: boolean
}
