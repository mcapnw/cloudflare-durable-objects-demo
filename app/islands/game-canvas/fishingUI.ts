
import * as THREE from 'three'
import { PlayerData } from './types'

export interface FishingUIConfig {
    interactBtn: HTMLButtonElement
    onSendMessage: (msg: any) => void
    setControlsEnabled: (enabled: boolean) => void
    camera: THREE.Camera
    setJoystickVisible: (visible: boolean) => void
}

export class FishingUI {
    private config: FishingUIConfig
    private isAnimationLocked: boolean = false

    constructor(config: FishingUIConfig) {
        this.config = config
    }

    checkProximity(
        myPlayerId: string,
        players: Map<string, PlayerData>,
        ponds: { x: number, z: number, active: boolean }[],
        myRole: string | undefined, // 'Fisher' | 'Cooker'
        myHeldItem: string | null | undefined,
        myX: number, // Added: actual local player X position
        myZ: number  // Added: actual local player Z position
    ): boolean {
        if (this.isAnimationLocked) return false

        // 1. FISHER Logic
        if (myRole === 'Fisher') {
            if (myHeldItem === 'fish') {
                // Look for Cooker
                let nearCooker = false
                players.forEach((p, id) => {
                    if (p.role === 'Cooker' && id !== myPlayerId) {
                        const dist = Math.hypot(myX - p.currentX, myZ - p.currentZ)
                        if (dist < 2.5) {
                            nearCooker = true
                        }
                    }
                })

                if (nearCooker) {
                    this.showButton('PASS FISH', '#60A5FA', 'white', () => {
                        this.config.onSendMessage({ type: 'pass_fish' })
                    })
                    return true
                }
            } else {
                // Look for Active Pond
                const activePond = ponds.find(p => p.active)
                if (activePond) {
                    const dist = Math.hypot(myX - activePond.x, myZ - activePond.z)
                    if (dist < 5.0) {
                        this.showButton('START FISHING', '#60A5FA', 'white', () => {
                            console.log('[FishingUI] Clicked START FISHING')
                            this.config.onSendMessage({ type: 'start_fishing' })
                        })
                        return true
                    }
                }
            }
        }

        return false
    }

    showButton(text: string, bg: string, color: string, onClick: () => void) {
        const btn = this.config.interactBtn
        btn.innerText = text
        btn.style.display = 'block'
        btn.style.background = bg
        btn.style.color = color
        btn.style.border = '2px solid black'
        btn.onclick = onClick
    }

    handlePassFishAnimation(
        fisherId: string,
        cookerId: string,
        duration: number,
        players: Map<string, PlayerData>
    ) {
        this.isAnimationLocked = true
        this.config.setControlsEnabled(false)
        this.config.setJoystickVisible(false)
        const btn = this.config.interactBtn
        btn.style.display = 'none'

        const fisher = players.get(fisherId)
        const cooker = players.get(cookerId)

        if (fisher && cooker) {
            // 1. Face each other
            fisher.mesh.lookAt(cooker.currentX, 0, cooker.currentZ)
            cooker.mesh.lookAt(fisher.currentX, 0, fisher.currentZ)

            // Override target rotation to prevent immediate snap-back if update comes
            fisher.targetRotation = fisher.mesh.rotation.y
            cooker.targetRotation = cooker.mesh.rotation.y

            // 2. Camera Side View
            const midX = (fisher.currentX + cooker.currentX) / 2
            const midZ = (fisher.currentZ + cooker.currentZ) / 2

            const dx = fisher.currentX - cooker.currentX
            const dz = fisher.currentZ - cooker.currentZ
            // Perpendicular vector (-dz, dx)
            const len = Math.hypot(dx, dz)
            const pX = -dz / len
            const pZ = dx / len

            // Position camera 5 units away perpendicular
            const camX = midX + pX * 5
            const camZ = midZ + pZ * 5

            // Tween approach (simplified here to direct set for prototype)
            // In a real app we'd lerp.
            const originalPos = this.config.camera.position.clone()
            const originalRot = this.config.camera.rotation.clone()

            this.config.camera.position.set(camX, 2, camZ)
            this.config.camera.lookAt(midX, 1.0, midZ)

            // 3. Restore after duration
            setTimeout(() => {
                this.isAnimationLocked = false
                this.config.setControlsEnabled(true)
                this.config.setJoystickVisible(true)
                // Camera will snap back to follow player mechanism in next frame of main loop
            }, duration)
        } else {
            // Fallback if players missing
            this.isAnimationLocked = false
            this.config.setControlsEnabled(true)
            this.config.setJoystickVisible(true)
        }
    }
}
