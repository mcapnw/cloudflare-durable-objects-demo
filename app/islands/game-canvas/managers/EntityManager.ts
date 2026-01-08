/**
 * EntityManager - Manages players, dragon, sheep, pickups, bullets
 */

import { getGameState } from './GameState'
import * as Types from '../types'
import * as MeshFactories from '../meshFactories'
import * as UIGenerators from '../uiGenerators'

export class EntityManager {
    private state = getGameState()

    constructor() {
        // Register callbacks for cross-manager communication
        this.state.registerCallback('updatePlayer', this.updatePlayer.bind(this))
        this.state.registerCallback('removePlayer', this.removePlayer.bind(this))
        this.state.registerCallback('clearAllPlayers', this.clearAllPlayers.bind(this))
        this.state.registerCallback('updateDragonState', this.updateDragonState.bind(this))
        this.state.registerCallback('updateSheeps', this.updateSheeps.bind(this))
        this.state.registerCallback('updatePickups', this.updatePickups.bind(this))
        this.state.registerCallback('updateBullets', this.updateBullets.bind(this))
        this.state.registerCallback('handlePlayerDeath', this.handlePlayerDeath.bind(this))
        this.state.registerCallback('handlePlayerRespawn', this.handlePlayerRespawn.bind(this))
    }

    updatePlayer(data: any, isMe: boolean) {
        const THREE = this.state.THREE
        if (!THREE || !this.state.scene) return

        let playerData = this.state.players.get(data.id)
        let isNew = false

        if (!playerData) {
            isNew = true
            const gender = data.gender || 'male'
            const faceIndex = data.faceIndex || 0
            const { group: mesh, mixer, actions } = MeshFactories.createPlayerMesh(isMe, gender, faceIndex)
            const displayName = (data.username && data.username !== 'null' && data.username.trim() !== '')
                ? data.username
                : (data.firstName || 'Player')
            const label = UIGenerators.createTextSprite(THREE, displayName, isMe)

            this.state.scene.add(mesh)
            this.state.scene.add(label)

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
            this.state.players.set(data.id, playerData)
            this.updatePlayerWeapon(playerData, data.weapon || null)
        }

        if (!playerData) return

        // Update action state
        if (data.isActing !== undefined) {
            playerData.isActing = data.isActing
            playerData.actionType = data.actionType
            playerData.actingPlotId = data.actionPlotId
        }

        // Update display name if changed
        const currentDisplayName = (playerData.username && playerData.username.trim() !== '')
            ? playerData.username
            : (playerData.firstName || 'Player')
        const newDisplayName = (data.username !== undefined)
            ? ((data.username && data.username.trim() !== '') ? data.username : (data.firstName || playerData.firstName))
            : ((data.firstName && data.firstName !== playerData.firstName) ? data.firstName : currentDisplayName)

        if (newDisplayName !== currentDisplayName) {
            this.state.scene.remove(playerData.label)
            playerData.firstName = data.firstName ?? playerData.firstName
            playerData.username = data.username !== undefined ? data.username : playerData.username
            playerData.label = UIGenerators.createTextSprite(THREE, newDisplayName, isMe)
            this.state.scene.add(playerData.label)
        }

        // Recreate mesh if face or gender changed
        if (data.faceIndex !== undefined && playerData.faceIndex !== data.faceIndex ||
            data.gender !== undefined && playerData.gender !== data.gender) {
            this.state.scene.remove(playerData.mesh)
            const newFace = data.faceIndex ?? playerData.faceIndex ?? 0
            const newGender = data.gender ?? playerData.gender
            const { group: mesh, mixer, actions } = MeshFactories.createPlayerMesh(isMe, newGender, newFace)
            mesh.position.set(playerData.currentX, 0, playerData.currentZ)
            mesh.rotation.y = playerData.currentRotation + (isMe ? Math.PI : 0)
            this.state.scene.add(mesh)
            playerData.mesh = mesh
            playerData.mixer = mixer
            playerData.actions = actions
            playerData.gender = newGender
            playerData.faceIndex = newFace
            this.updatePlayerWeapon(playerData, playerData.weapon)
        }

        // Update weapon if changed
        const weaponChanged = playerData.weapon !== (data.weapon || null)
        const needsExternalMesh = playerData.weapon && playerData.weapon !== 'staff_beginner' && !playerData.weaponMesh
        if (weaponChanged || needsExternalMesh) {
            this.updatePlayerWeapon(playerData, data.weapon || null)
        }

        // Update target position
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

        // Trigger congratulations screen if player just got staff_beginner
        if (isMe && weaponChanged && data.weapon === 'staff_beginner') {
            this.state.currentMode = 'congratulations'
            this.state.tempFaceOverride = 'wonder.png'
            this.state.callbacks.updateCharacterFace?.()
            if (this.state.congratsModal) this.state.congratsModal.style.display = 'block'
            this.state.callbacks.updateUIVisibility?.()
        }
    }

    private updatePlayerWeapon(playerData: Types.PlayerData, newWeapon: string | null) {
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

    removePlayer(id: string) {
        const playerData = this.state.players.get(id)
        if (playerData && this.state.scene) {
            this.state.scene.remove(playerData.mesh)
            this.state.scene.remove(playerData.label)
            this.state.players.delete(id)
        }
    }

    clearAllPlayers() {
        this.state.players.forEach((p, id) => {
            if (p.mesh && this.state.scene) this.state.scene.remove(p.mesh)
            if (p.label && this.state.scene) this.state.scene.remove(p.label)
            if (p.weaponMesh && this.state.scene) this.state.scene.remove(p.weaponMesh)
        })
        this.state.players.clear()
    }

    updateDragonState(data: any) {
        const THREE = this.state.THREE
        if (!THREE || !this.state.scene) return

        if (data.damageList) this.state.callbacks.updateDamageList?.(data.damageList)

        if (!this.state.dragon) {
            if (data.isDead) return
            const { group, wings, labelGroup, healthBar } = MeshFactories.createDragonMesh()
            this.state.scene.add(group)
            this.state.scene.add(labelGroup)
            this.state.dragon = {
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
                if (!this.state.dragon.isDead) {
                    this.state.dragon.isDead = true
                    this.state.dragon.deathTime = Date.now()
                    this.state.dragon.spawnStartTime = undefined
                    if (this.state.dragon.labelGroup) this.state.scene.remove(this.state.dragon.labelGroup)
                    this.state.callbacks.updateUIVisibility?.()
                }
                return
            }
            if (this.state.dragon.isDead) {
                this.state.dragon.isDead = false
                this.state.dragon.spawnStartTime = Date.now()
                if (this.state.dragon.labelGroup) this.state.scene.add(this.state.dragon.labelGroup)
                this.state.dragon.mesh.traverse((child: any) => {
                    if (child.isMesh && child.material) {
                        child.material.transparent = true
                        child.material.opacity = 0
                    }
                })
            }
            this.state.dragon.targetX = data.x
            this.state.dragon.targetZ = data.z
            this.state.dragon.targetRotation = data.rotation
            this.state.dragon.health = data.health
            this.state.dragon.targetId = data.targetId || null
            if (this.state.dragon.healthBar) {
                const scale = Math.max(0, this.state.dragon.health / 10)
                this.state.dragon.healthBar.scale.x = scale * 4
                const r = 1 - scale
                const g = scale
                MeshFactories.dragHealthMat.color.setRGB(r, g, 0)
            }
        }
        this.state.callbacks.updateUIVisibility?.()
    }

    updateSheeps(data: any[]) {
        if (!this.state.scene) return

        data.forEach(s => {
            let sheep = this.state.sheeps.get(s.id)
            if (!sheep) {
                const mesh = MeshFactories.createSheepMesh()
                this.state.scene.add(mesh)
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
                this.state.sheeps.set(s.id, sheep)
            }
            sheep.mesh.visible = (this.state.lobbyState !== null)
            sheep.targetX = s.x
            sheep.targetZ = s.z
            sheep.targetRotation = s.rotation
            if (sheep.isHopping !== s.isHopping) sheep.isHopping = s.isHopping
            if (s.text !== sheep.lastText) {
                if (sheep.label) {
                    this.state.scene.remove(sheep.label)
                    sheep.label = null
                }
                if (s.text) {
                    sheep.label = UIGenerators.createSheepTextSprite(this.state.THREE, s.text)
                    this.state.scene.add(sheep.label)
                    sheep.label.visible = (this.state.lobbyState !== null)
                }
                sheep.lastText = s.text
            }
        })
    }

    updatePickups(serverPickups: any[]) {
        if (!this.state.scene) return

        const currentIds = new Set(serverPickups.map(p => p.id))

        // Remove old pickups
        for (const [id, pickup] of this.state.pickups.entries()) {
            if (!currentIds.has(id)) {
                this.state.scene.remove(pickup.mesh)
                this.state.pickups.delete(id)
            }
        }

        // Add/update pickups
        for (const p of serverPickups) {
            if (!this.state.pickups.has(p.id)) {
                const mesh = MeshFactories.createPickupMesh(p.weaponType)
                mesh.position.set(p.x, 0.5, p.z)
                this.state.scene.add(mesh)
                this.state.pickups.set(p.id, {
                    id: p.id,
                    mesh,
                    weaponType: p.weaponType,
                    playerId: p.playerId,
                    x: p.x,
                    z: p.z
                })
            }
        }
    }

    updateBullets(serverBullets: any[]) {
        if (!this.state.scene) return

        const currentIds = new Set(serverBullets.map(b => b.id))

        // Remove old bullets
        this.state.bullets = this.state.bullets.filter(b => {
            if (!currentIds.has(b.id)) {
                this.state.scene.remove(b.mesh)
                return false
            }
            return true
        })

        // Add/update bullets
        for (const b of serverBullets) {
            let existing = this.state.bullets.find(eb => eb.id === b.id)
            if (!existing) {
                const isDragon = b.ownerId === 'dragon'
                const mesh = MeshFactories.createBulletMesh(isDragon)
                mesh.position.set(b.x, 1.5, b.z)
                this.state.scene.add(mesh)
                this.state.bullets.push({
                    id: b.id,
                    x: b.x,
                    z: b.z,
                    vx: b.vx,
                    vz: b.vz,
                    ownerId: b.ownerId,
                    mesh,
                    speed: b.speed
                })
            } else {
                existing.x = b.x
                existing.z = b.z
                existing.mesh.position.set(b.x, 1.5, b.z)
            }
        }
    }

    handlePlayerDeath(playerId: string, firstName: string, username?: string | null) {
        const playerData = this.state.players.get(playerId)
        if (!playerData) return

        playerData.isDead = true
        playerData.deathX = playerData.currentX
        playerData.deathZ = playerData.currentZ

        // Hide player mesh
        playerData.mesh.visible = false

        // Create tombstone
        const tombstone = MeshFactories.createTombstoneMesh()
        tombstone.position.set(playerData.currentX, 0, playerData.currentZ)
        this.state.scene.add(tombstone)
        playerData.mesh.userData.tombstone = tombstone

        if (playerId === this.state.myPlayerId) {
            this.state.myIsDead = true
            this.state.callbacks.updateUIVisibility?.()
        }
    }

    handlePlayerRespawn(data: any) {
        const playerData = this.state.players.get(data.id)
        if (!playerData) return

        playerData.isDead = false
        playerData.mesh.visible = true

        // Remove tombstone
        if (playerData.mesh.userData.tombstone) {
            this.state.scene.remove(playerData.mesh.userData.tombstone)
            delete playerData.mesh.userData.tombstone
        }

        // Set new position
        playerData.currentX = data.x
        playerData.currentZ = data.z
        playerData.targetX = data.x
        playerData.targetZ = data.z
        playerData.mesh.position.set(data.x, 0, data.z)

        if (data.id === this.state.myPlayerId) {
            this.state.myIsDead = false
            this.state.myX = data.x
            this.state.myZ = data.z
            this.state.callbacks.updateUIVisibility?.()
        }
    }

    /**
     * Interpolate entities towards their target positions
     */
    interpolateEntities(deltaTime: number) {
        const lerpFactor = Math.min(1, deltaTime * 10)

        // Interpolate players
        this.state.players.forEach((p, id) => {
            if (id === this.state.myPlayerId) return // My player is controlled directly
            if (p.isDead) return

            p.currentX += (p.targetX - p.currentX) * lerpFactor
            p.currentZ += (p.targetZ - p.currentZ) * lerpFactor

            // Smooth rotation
            let rotDiff = p.targetRotation - p.currentRotation
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
            p.currentRotation += rotDiff * lerpFactor

            p.mesh.position.set(p.currentX, 0, p.currentZ)
            p.mesh.rotation.y = p.currentRotation
            p.label.position.set(p.currentX, 2.5, p.currentZ)

            // Update mixer
            if (p.mixer) p.mixer.update(deltaTime)
        })

        // Interpolate dragon
        if (this.state.dragon && !this.state.dragon.isDead) {
            this.state.dragon.currentX += (this.state.dragon.targetX - this.state.dragon.currentX) * lerpFactor
            this.state.dragon.currentZ += (this.state.dragon.targetZ - this.state.dragon.currentZ) * lerpFactor

            let rotDiff = this.state.dragon.targetRotation - this.state.dragon.currentRotation
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
            this.state.dragon.currentRotation += rotDiff * lerpFactor

            this.state.dragon.mesh.position.set(this.state.dragon.currentX, 0, this.state.dragon.currentZ)
            this.state.dragon.mesh.rotation.y = this.state.dragon.currentRotation
            this.state.dragon.labelGroup.position.set(this.state.dragon.currentX, 4, this.state.dragon.currentZ)
        }

        // Interpolate sheep
        this.state.sheeps.forEach(sheep => {
            sheep.currentX += (sheep.targetX - sheep.currentX) * lerpFactor
            sheep.currentZ += (sheep.targetZ - sheep.currentZ) * lerpFactor

            let rotDiff = sheep.targetRotation - sheep.currentRotation
            while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
            while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
            sheep.currentRotation += rotDiff * lerpFactor

            sheep.mesh.position.set(sheep.currentX, 0, sheep.currentZ)
            sheep.mesh.rotation.y = sheep.currentRotation

            if (sheep.label) {
                sheep.label.position.set(sheep.currentX, 1.5, sheep.currentZ)
            }
        })
    }
}
