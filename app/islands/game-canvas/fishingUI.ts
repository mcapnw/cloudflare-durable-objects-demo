
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
    public isAnimationLocked: boolean = false

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

    /**
     * Show fishing in progress button - moves button to bottom and disables it
     */
    showFishingInProgress() {
        const btn = this.config.interactBtn
        btn.innerText = 'Fishing...'
        btn.style.display = 'block'
        btn.style.background = '#9CA3AF'
        btn.style.color = 'white'
        btn.style.border = '2px solid white'
        btn.style.boxShadow = 'none'
        btn.onclick = null

        // Move button to bottom of screen for visibility during fishing
        btn.style.top = 'auto'
        btn.style.bottom = '100px'
        btn.style.transform = 'translate(-50%, 0)'

        // Hide joystick during fishing
        this.config.setJoystickVisible(false)
    }

    /**
     * Restore button position after fishing ends
     */
    restoreButtonPosition() {
        const btn = this.config.interactBtn
        btn.style.top = '50%'
        btn.style.bottom = 'auto'
        btn.style.transform = 'translate(-50%, calc(-50% - 60px))'

        // Restore joystick 
        this.config.setJoystickVisible(true)
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
            // 1. Face each other using direct angle calculation (more reliable than lookAt)
            const angle = Math.atan2(
                cooker.currentX - fisher.currentX,
                cooker.currentZ - fisher.currentZ
            )
            fisher.mesh.rotation.y = angle
            cooker.mesh.rotation.y = angle + Math.PI // Face opposite direction

            // Override target rotation to prevent snap-back from updates
            fisher.targetRotation = angle
            cooker.targetRotation = angle + Math.PI

            // 2. Arm reaching animation - find arm/hand bones
            const fisherArm = fisher.mesh.getObjectByName('hands') ||
                fisher.mesh.getObjectByName('leftHand')
            const cookerArm = cooker.mesh.getObjectByName('hands') ||
                cooker.mesh.getObjectByName('leftHand')

            // Store original rotations to restore later
            const fisherArmOriginalRot = fisherArm ? { x: fisherArm.rotation.x, y: fisherArm.rotation.y, z: fisherArm.rotation.z } : null
            const cookerArmOriginalRot = cookerArm ? { x: cookerArm.rotation.x, y: cookerArm.rotation.y, z: cookerArm.rotation.z } : null

            // Animate arms reaching out
            if (fisherArm) {
                fisherArm.rotation.x = -Math.PI / 4 // Reach forward
                fisherArm.rotation.z = -Math.PI / 6 // Extend outward
            }
            if (cookerArm) {
                cookerArm.rotation.x = -Math.PI / 4 // Reach forward  
                cookerArm.rotation.z = Math.PI / 6 // Extend outward (opposite direction)
            }

            // 3. Camera Side View - consistent with Fishing view (centered on ME or interaction)
            // User requested "same side view as the one we are fixing for fishing".
            // The fishing view is: 6.5 dist, 2.2 height, perpendicular.

            const camDistance = 6.5
            const camHeight = 2.2

            // Vector from Cooker to Fisher (or vice versa)
            let dirX = fisher.currentX - cooker.currentX
            let dirZ = fisher.currentZ - cooker.currentZ
            const distBetweenPlayers = Math.hypot(dirX, dirZ)

            // Normalize direction vector
            if (distBetweenPlayers > 0.001) {
                dirX /= distBetweenPlayers
                dirZ /= distBetweenPlayers
            } else {
                dirX = 0
                dirZ = 1
            }

            // Perpendicular (Side) vector: (-z, x) corresponds to -90 deg rotation (Right side)
            // We want a consistent side view.
            const sideX = -dirZ
            const sideZ = dirX

            // Calculate midpoint
            const midX = (fisher.currentX + cooker.currentX) / 2
            const midZ = (fisher.currentZ + cooker.currentZ) / 2

            // Position camera at midpoint + side offset * distance
            const camX = midX + sideX * camDistance
            const camZ = midZ + sideZ * camDistance

            // Set camera position and look at midpoint between players
            this.config.camera.position.set(camX, camHeight, camZ)
            this.config.camera.lookAt(midX, 1.2, midZ)

            // 4. Restore after duration
            setTimeout(() => {
                this.isAnimationLocked = false
                this.config.setControlsEnabled(true)
                this.config.setJoystickVisible(true)

                // Restore arm rotations
                if (fisherArm && fisherArmOriginalRot) {
                    fisherArm.rotation.set(fisherArmOriginalRot.x, fisherArmOriginalRot.y, fisherArmOriginalRot.z)
                }
                if (cookerArm && cookerArmOriginalRot) {
                    cookerArm.rotation.set(cookerArmOriginalRot.x, cookerArmOriginalRot.y, cookerArmOriginalRot.z)
                }
                // Camera will snap back to follow player mechanism in next frame
            }, duration)
        } else {
            // Fallback if players missing
            this.isAnimationLocked = false
            this.config.setControlsEnabled(true)
            this.config.setJoystickVisible(true)
        }
    }
}
