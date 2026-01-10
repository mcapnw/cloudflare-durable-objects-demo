/**
 * FarmingUI - Manages farm plot visualization and farming interactions
 * 
 * Handles:
 * - Farm plot growth stage visualization
 * - Proximity detection to farm plots
 * - Interact button updates for farming actions
 * - Farming action animations (planting, watering, harvesting)
 * - Tool mesh creation and management
 */

import * as MeshFactories from './meshFactories'

export interface FarmingUIConfig {
    interactBtn: HTMLButtonElement
    onSendMessage: (msg: any) => void
    setJoystickVisible: (visible: boolean) => void
}

export class FarmingUI {
    private config: FarmingUIConfig

    constructor(config: FarmingUIConfig) {
        this.config = config
    }

    /**
     * Update farm plot visualization based on server state
     */
    updateFarmPlots(
        plots: any[],
        lobbyState: any,
        farmPlotWheat: (any | null)[],
        players: Map<string, any>
    ): void {
        if (!lobbyState) return

        plots.forEach((plot: any, index: number) => {
            if (index >= lobbyState.farmPlotGroups.length) return
            const group = lobbyState.farmPlotGroups[index]
            const growthStage = plot.growthStage || 0

            if (growthStage === 0) {
                // Remove wheat if plot is empty
                // Remove wheat if plot is empty, UNLESS someone is currently harvesting it
                const isBeingHarvested = Array.from(players.values()).some(
                    p => p.isActing && p.actionType === 'harvesting' && p.actingPlotId === index
                )

                if (farmPlotWheat[index] && !isBeingHarvested) {
                    group.remove(farmPlotWheat[index])
                    farmPlotWheat[index] = null
                }
            } else {
                // Check if wheat mesh needs updating
                let needsUpdate = false
                if (!farmPlotWheat[index]) {
                    needsUpdate = true
                } else if (farmPlotWheat[index].userData.stage !== growthStage) {
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

    /**
     * Check proximity to farm plots and update interact button
     */
    checkFarmProximity(
        myX: number,
        myZ: number,
        myPlayerId: string | null,
        lobbyState: any,
        farmPlotsState: any[],
        inventory: string[],
        players: Map<string, any>,
        onStartAction: (type: 'planting' | 'watering' | 'harvesting', plotId: number) => void
    ): number {
        if (!lobbyState) return -1

        // CRITICAL: If local player is currently acting, don't update the button at all
        // The startFarmingAction handles the button during the action period
        const localPlayer = myPlayerId ? players.get(myPlayerId) : null
        if (localPlayer?.isActing) return -1

        let nearPlotIndex = -1

        // Check proximity to each farm plot
        lobbyState.farmPlotGroups.forEach((plot: any, i: number) => {
            const d = Math.hypot(myX - plot.position.x, myZ - plot.position.z)
            if (d < 2.5) nearPlotIndex = i
        })

        if (nearPlotIndex !== -1) {
            // FIRST: Check if anyone is performing an action on this plot
            const actingPlayer = Array.from(players.values()).find(
                p => p.isActing && p.actingPlotId === nearPlotIndex
            )

            if (actingPlayer) {
                // Someone is performing an action - show status and don't allow interaction
                const actionText = actingPlayer.actionType === 'planting' ? 'Planting' :
                    actingPlayer.actionType === 'watering' ? 'Watering' :
                        'Harvesting'

                if (actingPlayer === players.get(myPlayerId!)) {
                    // It's the local player
                    this.setInteractButton(`${actionText}...`, '#9CA3AF', 'white', false)
                } else {
                    // It's another player - show their name
                    const playerName = actingPlayer.username || actingPlayer.firstName || 'Someone'
                    this.setInteractButton(`${playerName} is ${actionText.toLowerCase()}...`, '#9CA3AF', 'white', false)
                }
                return nearPlotIndex
            }

            // No action in progress, show normal interaction options
            const plotData = farmPlotsState[nearPlotIndex]
            const stage = plotData?.growthStage || 0

            if (stage === 0) {
                // Empty plot - check for planting
                const hasSeeds = inventory.includes('wheat_seeds')
                const hasTrowel = inventory.includes('trowel')

                if (!hasSeeds) {
                    this.setInteractButton('Need seeds', '#9CA3AF', '#4B5563', false)
                } else if (!hasTrowel) {
                    this.setInteractButton('Need trowel', '#9CA3AF', '#4B5563', false)
                } else {
                    this.setInteractButton('PLANT WHEAT', '#A7F3D0', 'black', true, () => {
                        onStartAction('planting', nearPlotIndex)
                    })
                }
            } else if (stage === 1) {
                // Stage 1 - needs watering
                const hasWaterCan = inventory.includes('water_can')

                if (!hasWaterCan) {
                    this.setInteractButton('Need water can', '#9CA3AF', '#4B5563', false)
                } else {
                    this.setInteractButton('WATER WHEAT', '#A7F3D0', 'black', true, () => {
                        onStartAction('watering', nearPlotIndex)
                    })
                }
            } else if (stage === 2) {
                // Stage 2 - growing with timer display
                const GROWTH_TIME = 5 * 60 * 1000
                const elapsed = Date.now() - (plotData.wateredAt || 0)
                const remaining = Math.max(0, GROWTH_TIME - elapsed)
                const minutes = Math.floor(remaining / 60000)
                const seconds = Math.floor((remaining % 60000) / 1000)
                const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
                this.setInteractButton(`GROWING... (${timeStr})`, '#9CA3AF', 'white', false)
            } else if (stage === 3) {
                // Stage 3 - ready to harvest
                this.setInteractButton('HARVEST WHEAT', '#A7F3D0', 'black', true, () => {
                    onStartAction('harvesting', nearPlotIndex)
                })
            }
        }

        return nearPlotIndex
    }

    /**
     * Set interact button style and text
     */
    private setInteractButton(
        text: string,
        bgColor: string,
        textColor: string,
        enabled: boolean,
        onClick?: () => void
    ): void {
        const btn = this.config.interactBtn
        btn.innerText = text
        btn.style.display = 'block'
        btn.style.background = bgColor
        btn.style.color = textColor

        if (enabled) {
            btn.style.border = '2px solid black'
            btn.style.boxShadow = 'inset 0 -3px 0 rgba(0,0,0,0.2)'
            btn.style.textShadow = 'none'
            btn.onclick = onClick || null
        } else {
            btn.style.border = `2px solid ${textColor}`
            btn.style.boxShadow = 'none'
            btn.style.textShadow = 'none'
            btn.onclick = null
        }
    }

    /**
     * Start a farming action (planting, watering, harvesting)
     */
    startFarmingAction(
        type: 'planting' | 'watering' | 'harvesting',
        plotId: number,
        myPlayerId: string | null,
        players: Map<string, any>,
        updateUIVisibility: () => void
    ): void {
        if (!myPlayerId) return
        const p = players.get(myPlayerId)
        if (!p || p.isActing) return

        // Set player acting state
        p.isActing = true
        p.actionType = type
        p.actingPlotId = plotId
        p.actingStartTime = Date.now()

        // Update interact button to show action in progress using consistent method
        const actionText = type.charAt(0).toUpperCase() + type.slice(1)
        this.setInteractButton(`${actionText}...`, '#9CA3AF', 'white', false)

        // Move button to bottom of screen for visibility during action (local player only)
        const btn = this.config.interactBtn
        btn.style.top = 'auto'
        btn.style.bottom = '100px'
        btn.style.transform = 'translate(-50%, 0)'


        // Send start signal first
        this.config.onSendMessage({ type: 'start_farming', action: type, plotId })
        this.config.setJoystickVisible(false)

        // Wait 4 seconds then finalize
        setTimeout(() => {
            const currentP = players.get(myPlayerId!)
            // Send finalization message
            const serverType = type === 'planting' ? 'plant_seeds' :
                (type === 'watering' ? 'water_wheat' : 'harvest_wheat')
            this.config.onSendMessage({ type: serverType, plotId })

            if (currentP && currentP.isActing && currentP.actionType === type) {
                // Restore button position
                const btn = this.config.interactBtn
                btn.style.top = '50%'
                btn.style.bottom = 'auto'
                btn.style.transform = 'translate(-50%, calc(-50% - 60px))'

                currentP.isActing = false
                currentP.actionType = null
                currentP.actingPlotId = null

                // Remove temporary tool mesh
                if (currentP.temporaryToolMesh) {
                    if (currentP.temporaryToolMesh.parent) {
                        currentP.temporaryToolMesh.parent.remove(currentP.temporaryToolMesh)
                    }
                    currentP.temporaryToolMesh = null
                }

                // Restore weapon visibility
                if (currentP.weaponMesh) currentP.weaponMesh.visible = true
                // Only restore staff if player is NOT in Realm (has no role)
                const hasRealmRole = currentP.role && currentP.role !== 'None'
                if (!hasRealmRole) {
                    currentP.mesh.traverse((child: any) => {
                        if (child.name === 'staff_beginner' && currentP.weapon === 'staff_beginner') {
                            child.visible = true
                        }
                    })
                }

                updateUIVisibility()
                this.config.setJoystickVisible(true)
            }
        }, 4000)
    }

    /**
     * Update tool meshes for players performing farming actions
     */
    updateToolMeshForPlayer(playerData: any, THREE: any): void {
        if (playerData.isActing) {
            // Hide weapon during farming
            if (playerData.weaponMesh) playerData.weaponMesh.visible = false
            playerData.mesh.traverse((child: any) => {
                if (child.name === 'staff_beginner') child.visible = false
            })

            // Calculate arm bobbing
            const now = Date.now()
            const bob = Math.sin(now * 0.0075) * 0.5 // Speed halved (was 0.015)

            // Create temporary tool mesh if needed
            if (!playerData.temporaryToolMesh) {
                let tool: any
                if (playerData.actionType === 'watering') {
                    tool = MeshFactories.createWaterCanMesh()
                } else {
                    tool = MeshFactories.createTrowelMesh()
                }
                tool.scale.set(3, 3, 3)

                const handBone = playerData.mesh.getObjectByName('leftHand')
                if (handBone) {
                    tool.rotation.set(0, Math.PI / 2, Math.PI / 2)
                    handBone.add(tool)
                } else {
                    tool.position.set(-0.5, 1.5, 0.5)
                    playerData.mesh.add(tool)
                }
                playerData.temporaryToolMesh = tool
            }

            // Animate tool and "arm" (rotation)
            if (playerData.temporaryToolMesh) {
                // Find arm bone for "whole arm swing"
                // Try common names: mixamorigLeftArm, LeftArm, arm.L, etc.
                const armBone = playerData.mesh.getObjectByName('mixamorigLeftArm') ||
                    playerData.mesh.getObjectByName('LeftArm') ||
                    playerData.mesh.getObjectByName('arm_l')

                if (armBone) {
                    // Swing arm forward and backward (Pitch on X usually)
                    // Bob range -0.5 to 0.5. 
                    // Arm needs to swing forward (negative X?) and back.
                    // Let's bias it forward slightly for farming.
                    armBone.rotation.x += bob * 0.8
                } else {
                    // Fallback to hand rotation if arm not found
                    const handBone = playerData.mesh.getObjectByName('leftHand')
                    if (handBone) {
                        handBone.rotation.z += bob * 0.5
                    }
                }

                // Also rotate the tool itself slightly for extra effect
                if (playerData.actionType === 'watering') {
                    // "Move it up by 45 degree" -> Was -PI/4 (down), now 0 (level), user wants UP 45?
                    // "Up by 45 degree" -> If level is 0, Up is +PI/4? 
                    // Original was -PI/4 (down). Previous step removed it (0).
                    // If user wants "up by 45 degrees" relative to "level", that's PI/4.
                    playerData.temporaryToolMesh.rotation.x = Math.PI / 4 + bob * 0.2
                } else if (playerData.actionType === 'planting' || playerData.actionType === 'harvesting') {
                    // "Point downward at a 45 degree angle" -> Set to -PI/4
                    // Digging/Cutting motion
                    playerData.temporaryToolMesh.rotation.x = -Math.PI / 4 + bob * 0.5
                }
            }
        } else {
            // Restore weapon visibility
            if (playerData.weaponMesh) playerData.weaponMesh.visible = true
            // Only restore staff if player is NOT in Realm (has no role)
            const hasRealmRole = playerData.role && playerData.role !== 'None'
            if (!hasRealmRole) {
                playerData.mesh.traverse((child: any) => {
                    if (child.name === 'staff_beginner' && playerData.weapon === 'staff_beginner') {
                        child.visible = true
                    }
                })
            }

            // Remove temporary tool
            if (playerData.temporaryToolMesh) {
                if (playerData.temporaryToolMesh.parent) {
                    playerData.temporaryToolMesh.parent.remove(playerData.temporaryToolMesh)
                }
                playerData.temporaryToolMesh = null
            }
        }
    }

    /**
     * Animate wheat swaying based on harvesting state
     */
    animateWheat(
        farmPlotWheat: (any | null)[],
        players: Map<string, any>,
        now: number
    ): void {
        farmPlotWheat.forEach((group, index) => {
            if (group && group.userData.stage === 3) {
                // Determine sway intensity - just normal wind, no extra thrashing during harvest
                const intensity = 0.05
                const speedMult = 1

                group.children.forEach((stalkContainer: any) => {
                    const phase = stalkContainer.userData.phase || 0
                    stalkContainer.rotation.x = Math.sin(now * 0.002 * speedMult + phase) * intensity
                    stalkContainer.rotation.z = Math.cos(now * 0.0015 * speedMult + phase) * intensity
                })
            }
        })
    }
}
