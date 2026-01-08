export interface Player {
    id: string
    firstName: string // Google name/First name
    username: string | null // Custom username
    x: number
    z: number
    rotation: number
    gender: 'male' | 'female'
    faceIndex: number
    isDead: boolean
    deathTime: number
    weapon: string | null
    // Action State
    isActing?: boolean
    actionType?: string | null
    actionPlotId?: number | null
    actionStartTime?: number
}

export interface Pickup {
    id: string
    x: number
    z: number
    weaponType: string
    coinAmount?: number
    playerId: string // Intended recipient
    createdAt: number
}

export interface Sheep {
    id: string
    x: number
    z: number
    rotation: number
    isHopping: boolean
    state: 'roaming' | 'stopped' | 'fleeing'
    lastStateChange: number
    targetAngle: number
    lastFleeTime: number // Cooldown for flee state triggering
    text?: string
    textClearTime?: number
}

export interface FarmPlot {
    id: number
    planted: boolean
    watered: boolean
    growthStage: number // 0: empty, 1: planted, 2: watered/growing, 3: ready
    wateredAt: number // timestamp
    planterId: string | null
}

export interface Bullet {
    id: string
    x: number
    z: number
    vx: number
    vz: number
    ownerId: string // 'dragon' or playerId
    createdAt: number
    speed: number
}

export interface Dragon {
    x: number
    z: number
    rotation: number
    health: number
    targetId: string | null
    attackers: Set<string>
    lastFireTime: number
    isDead: boolean
    damageMap: Map<string, { name: string, damage: number }>
    isCharging: boolean
    chargeStartTime: number
}
