/**
 * NetworkManager - Handles WebSocket connections and message routing
 */

import { getGameState } from './GameState'
import * as Constants from '../constants'
import * as Utils from '../utils'
import * as UIGenerators from '../uiGenerators'

export class NetworkManager {
    private state = getGameState()

    constructor() {
        this.createReconnectOverlay()
    }

    private createReconnectOverlay() {
        const overlay = document.createElement('div')
        overlay.id = 'reconnect-overlay'
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0, 0, 0, 0.7); color: white; display: none;
            flex-direction: column; justify-content: center; align-items: center;
            z-index: 9999; font-family: system-ui, sans-serif; pointer-events: auto;
        `
        const text = document.createElement('div')
        text.style.cssText = 'font-size: 24px; font-weight: bold; color: #FFD54F; text-align: center; padding: 0 40px; max-width: 600px;'
        overlay.appendChild(text)
        document.body.appendChild(overlay)

        this.state.reconnectOverlay = overlay
        this.state.reconnectText = text
    }

    connect(isInitial: boolean = false, bypassCharacterCheck: boolean = false) {
        if (this.state.isVersionMismatch) return
        if (this.state.currentMode === 'character' && !bypassCharacterCheck) return
        if (this.state.ws && (this.state.ws.readyState === WebSocket.OPEN || this.state.ws.readyState === WebSocket.CONNECTING)) return

        if (this.state.reconnectText) {
            this.state.reconnectText.innerText = isInitial ? 'Connecting...' : 'Attempting to re-establish connection...'
        }
        if (this.state.reconnectOverlay) {
            this.state.reconnectOverlay.style.display = 'flex'
        }

        const params = new URLSearchParams()
        params.append('faceIndex', this.state.currentFaceIndex.toString())
        params.append('gender', this.state.charGender)
        params.append('username', this.state.myUsername || '')
        params.append('firstName', this.state.myFirstName || '')
        if (this.state.currentRoomId) params.append('room', this.state.currentRoomId)

        this.state.ws = new WebSocket(`${this.state.wsUrl}?${params.toString()}`)

        this.state.ws.onopen = () => this.handleOpen()
        this.state.ws.onclose = () => this.handleClose()
        this.state.ws.onerror = (error) => this.handleError(error)
        this.state.ws.onmessage = (event) => this.handleMessage(event)
    }

    private handleOpen() {
        this.state.wsConnected = true
        console.log('WebSocket connected')
        if (this.state.reconnectOverlay) {
            this.state.reconnectOverlay.style.display = 'none'
        }
        this.state.callbacks.checkVersion?.()

        // Query if player has an active realm session
        if (!this.state.currentRoomId && this.state.ws) {
            this.state.sendMessage({ type: 'get_player_realm' })
        }
    }

    private handleClose() {
        this.state.wsConnected = false
        if (this.state.reconnectText) {
            this.state.reconnectText.innerText = 'Attempting to re-establish connection...'
        }
        if (this.state.reconnectOverlay) {
            this.state.reconnectOverlay.style.display = 'flex'
        }
        setTimeout(() => this.connect(false), 2000)
    }

    private handleError(error: any) {
        console.error('WebSocket error:', error)
        if (this.state.reconnectText) {
            this.state.reconnectText.innerText = 'Attempting to re-establish connection...'
        }
        if (this.state.reconnectOverlay) {
            this.state.reconnectOverlay.style.display = 'flex'
        }
    }

    private handleMessage(event: MessageEvent) {
        const data = JSON.parse(event.data)

        switch (data.type) {
            case 'scores':
                this.handleScores(data)
                break
            case 'buy_success':
                this.state.coins = data.coins
                this.state.inventory = data.inventory
                this.state.callbacks.updateEconomicUI?.()
                break
            case 'inventory_update':
                this.state.inventory = data.inventory
                this.state.callbacks.updateEconomicUI?.()
                break
            case 'coins_earned':
                this.state.coins += data.amount
                this.state.callbacks.updateEconomicUI?.()
                break
            case 'farm_update':
                this.state.callbacks.updateFarmPlots?.(data.farmPlots)
                break
            case 'welcome':
                this.handleWelcome(data)
                break
            case 'init':
                data.players.forEach((p: any) => this.state.callbacks.updatePlayer?.(p, p.id === this.state.myPlayerId))
                break
            case 'join':
                this.state.callbacks.updatePlayer?.(data, false)
                break
            case 'leave':
                this.state.callbacks.removePlayer?.(data.id)
                break
            case 'update':
                this.handlePlayerUpdate(data)
                break
            case 'dragon_update':
                this.state.callbacks.updateDragonState?.(data)
                break
            case 'dragon_hit':
                this.handleDragonHit(data)
                break
            case 'dragon_death':
                this.state.callbacks.updateDragonState?.({ isDead: true })
                this.state.callbacks.updateDamageList?.([])
                break
            case 'dragon_respawn':
                // No specific action needed
                break
            case 'dragon_charging':
                if (this.state.dragon) this.state.dragon.chargeStartTime = Date.now()
                break
            case 'player_death':
                this.state.callbacks.handlePlayerDeath?.(data.id, data.firstName, data.username)
                break
            case 'player_respawn':
                this.state.callbacks.handlePlayerRespawn?.(data)
                break
            case 'world_update':
                this.handleWorldUpdate(data)
                break
            case 'pickup_spawned':
                this.handlePickupSpawned(data)
                break
            case 'weapon_update':
                this.state.callbacks.updatePlayer?.(data, data.id === this.state.myPlayerId)
                break
            case 'error':
                if (data.message === 'Not enough coins') {
                    this.state.callbacks.showShopError?.('Not Enough Coins')
                }
                break
            case 'realm_lobby_update':
                this.state.realmPlayers = data.players
                if (this.state.isWaitingForRealm) {
                    this.state.callbacks.updateRealmWaitModal?.()
                }
                break
            case 'start_realm':
                this.handleStartRealm(data)
                break
            case 'realm_init':
                this.handleRealmInit()
                break
            case 'realm_expired':
                this.handleRealmExpired()
                break
            case 'player_realm_info':
                this.handlePlayerRealmInfo(data)
                break
        }
    }

    private handleScores(data: any) {
        const list = data.scores.map((s: any, i: number) => {
            const displayName = (s.username && s.username !== 'null' && s.username.trim() !== '')
                ? s.username
                : (s.first_name || 'Anonymous')
            return `
                <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                    <span>${i + 1}. ${Utils.escapeHtml(displayName)}</span>
                    <span style="color:#FFD54F;font-weight:bold;">${s.dragon_kills} Kills | ${s.deaths || 0} Deaths</span>
                </div>
            `
        }).join('')

        if (this.state.scoreModal) {
            this.state.scoreModal.innerHTML = `
                <h2 style="margin-top:0;text-align:center;color:#FFD54F;">Dragon Slayers</h2>
                <div style="margin-top:16px;">
                    ${list.length > 0 ? list : '<div style="text-align:center;opacity:0.7;">No kills yet...</div>'}
                </div>
                <div style="text-align:center;margin-top:24px;font-size:12px;opacity:0.5;">Click outside to close</div>
            `
        }
    }

    private handleWelcome(data: any) {
        this.state.myPlayerId = data.id
        this.state.myX = data.x || 0
        this.state.myZ = data.z || 0
        this.state.myRotation = data.rotation || 0
        this.state.myGender = data.gender || 'male'

        this.state.callbacks.updatePlayer?.({
            ...data,
            firstName: data.firstName || this.state.myFirstName,
            username: data.username || this.state.myUsername
        }, true)

        if (data.farmPlots) this.state.callbacks.updateFarmPlots?.(data.farmPlots)
        if (data.dragon) this.state.callbacks.updateDragonState?.(data.dragon)

        // Trigger Tutorial if needed
        if (!this.state.tutorialStarted) {
            this.state.tutorialStarted = true
            import('../tutorial').then(m => m.startTutorial())
        }
    }

    private handlePlayerUpdate(data: any) {
        if (data.id !== this.state.myPlayerId) {
            const playerData = this.state.players.get(data.id)
            if (playerData && data.gender && playerData.gender !== data.gender) {
                // Gender change requires mesh recreation - handled by EntityManager
                this.state.callbacks.updatePlayer?.(data, false)
            } else {
                // Simple position update
                if (playerData) {
                    playerData.targetX = data.x
                    playerData.targetZ = data.z
                    playerData.targetRotation = data.rotation ?? playerData.targetRotation
                }
            }
        }
    }

    private handleDragonHit(data: any) {
        if (data.damageList) this.state.callbacks.updateDamageList?.(data.damageList)
        if (this.state.dragon) {
            this.state.dragon.health = data.health
            this.state.dragon.flinchTime = Date.now()
            // Fragment spawning is handled by EntityManager
        }
    }

    private handleWorldUpdate(data: any) {
        if (data.dragon) this.state.callbacks.updateDragonState?.(data.dragon)
        if (data.bullets) this.state.callbacks.updateBullets?.(data.bullets)
        if (data.pickups) this.state.callbacks.updatePickups?.(data.pickups)
        if (data.sheeps) this.state.callbacks.updateSheeps?.(data.sheeps)
        if (data.farmPlots) this.state.callbacks.updateFarmPlots?.(data.farmPlots)
        if (data.players) data.players.forEach((p: any) => this.state.callbacks.updatePlayer?.(p, p.id === this.state.myPlayerId))

        // Handle realm time display
        if (data.realmTime !== undefined) {
            this.state.realmTime = data.realmTime
            this.updateRealmTimerUI(data)
        } else {
            this.hideRealmTimerUI()
        }
    }

    private updateRealmTimerUI(data: any) {
        let timerEl = document.getElementById('realm-timer')
        if (!timerEl) {
            timerEl = document.createElement('div')
            timerEl.id = 'realm-timer'
            timerEl.style.cssText = `
                position: fixed; top: 90px; left: 50%; transform: translateX(-50%);
                color: #000000; font-family: 'Outfit', 'Inter', system-ui, sans-serif; 
                font-size: 20px; font-weight: 400; 
                z-index: 10000; text-align: center;
                pointer-events: none; white-space: nowrap;
            `
            document.body.appendChild(timerEl)
        }
        const minutes = Math.floor(this.state.realmTime / 60)
        const seconds = this.state.realmTime % 60
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`
        timerEl.innerText = `Remaining Time in Realm: ${timeStr}`
        timerEl.style.display = 'block'

        // Instance ID display
        let instanceEl = document.getElementById('realm-instance-id')
        if (!instanceEl) {
            instanceEl = document.createElement('div')
            instanceEl.id = 'realm-instance-id'
            instanceEl.style.cssText = `
                position: fixed; top: 115px; left: 50%; transform: translateX(-50%);
                color: #666666; font-family: 'Outfit', 'Inter', system-ui, sans-serif; 
                font-size: 12px; font-weight: 400; 
                z-index: 10000; text-align: center;
                pointer-events: none; white-space: nowrap;
            `
            document.body.appendChild(instanceEl)
        }
        if (this.state.currentRoomId) {
            instanceEl.innerText = `Instance ${this.state.currentRoomId}`
            instanceEl.style.display = 'block'
        }

        // Active realms count
        if (data.activeRealmCount !== undefined) {
            let activeCountEl = document.getElementById('active-realms-count')
            if (!activeCountEl) {
                activeCountEl = document.createElement('div')
                activeCountEl.id = 'active-realms-count'
                activeCountEl.style.cssText = `
                    position: fixed; top: 135px; left: 50%; transform: translateX(-50%);
                    color: #888888; font-family: 'Outfit', 'Inter', system-ui, sans-serif; 
                    font-size: 11px; font-weight: 400; 
                    z-index: 10000; text-align: center;
                    pointer-events: none; white-space: nowrap;
                `
                document.body.appendChild(activeCountEl)
            }
            activeCountEl.innerText = `Active Realms: ${data.activeRealmCount}`
            activeCountEl.style.display = 'block'
        }
    }

    private hideRealmTimerUI() {
        const t = document.getElementById('realm-timer')
        if (t) t.style.display = 'none'
        const i = document.getElementById('realm-instance-id')
        if (i) i.style.display = 'none'
        const a = document.getElementById('active-realms-count')
        if (a) a.style.display = 'none'
    }

    private handlePickupSpawned(data: any) {
        const currentPickups = Array.from(this.state.pickups.values())
        this.state.callbacks.updatePickups?.([...currentPickups, data])
    }

    private handleStartRealm(data: any) {
        this.state.isWaitingForRealm = false
        if (this.state.realmWaitModal) this.state.realmWaitModal.style.display = 'none'
        this.state.callbacks.updateUIVisibility?.()

        if (this.state.ws) this.state.ws.close()
        this.state.ws = null
        this.state.wsConnected = false
        this.state.isInRealm = true
        console.log('Joining Realm Instance:', data.realmId)

        this.state.currentRoomId = data.realmId
        this.state.callbacks.clearAllPlayers?.()

        setTimeout(() => this.connect(true), 500)
    }

    private handleRealmInit() {
        this.state.isWaitingForRealm = false
        if (this.state.realmWaitModal) this.state.realmWaitModal.style.display = 'none'
        this.state.callbacks.switchToScene?.('realm')
        if (this.state.damageListEl) this.state.damageListEl.style.display = 'none'
    }

    private handleRealmExpired() {
        this.state.currentRoomId = null
        this.state.callbacks.switchToScene?.('lobby')
        if (this.state.ws) this.state.ws.close()
        this.state.ws = null
        this.state.wsConnected = false

        const t = document.getElementById('realm-timer')
        if (t) t.remove()
        const i = document.getElementById('realm-instance-id')
        if (i) i.remove()
        const a = document.getElementById('active-realms-count')
        if (a) a.remove()

        this.state.callbacks.clearAllPlayers?.()
        setTimeout(() => this.connect(true), 500)
    }

    private handlePlayerRealmInfo(data: any) {
        console.log('Received player_realm_info:', data, 'currentMode:', this.state.currentMode)
        if (data.realmId && this.state.currentMode === 'character') {
            console.log('Reconnecting to active realm:', data.realmId)
            this.state.currentRoomId = data.realmId
            this.state.isInRealm = true
            this.state.currentMode = 'game'
            this.state.callbacks.updateUIVisibility?.()

            if (this.state.ws) this.state.ws.close()
            this.state.ws = null
            this.state.wsConnected = false
            setTimeout(() => this.connect(true), 500)
        }
    }

    // Public methods for sending messages
    sendMove(x: number, z: number, rotation: number) {
        this.state.sendMessage({ type: 'move', x, z, rotation })
    }

    sendShoot() {
        this.state.sendMessage({ type: 'shoot' })
    }

    sendSpawnDragon() {
        this.state.sendMessage({ type: 'spawn_dragon' })
    }

    sendGetScores() {
        this.state.sendMessage({ type: 'get_scores' })
    }

    sendBuyItem(itemId: string) {
        this.state.sendMessage({ type: 'buy_item', itemId })
    }

    sendCollectPickup(pickupId: string) {
        this.state.sendMessage({ type: 'collect_pickup', pickupId })
    }

    sendJoinRealmLobby() {
        this.state.sendMessage({ type: 'join_realm_lobby' })
    }

    sendRealmReady(ready: boolean) {
        this.state.sendMessage({ type: 'realm_ready', ready })
    }

    sendLeaveRealmLobby() {
        this.state.sendMessage({ type: 'leave_realm_lobby' })
    }

    sendChangeGender(gender: 'male' | 'female') {
        this.state.sendMessage({ type: 'change_gender', gender })
    }

    sendPlantSeeds(plotId: number) {
        this.state.sendMessage({ type: 'plant_seeds', plotId })
    }

    sendWaterWheat(plotId: number) {
        this.state.sendMessage({ type: 'water_wheat', plotId })
    }

    sendHarvestWheat(plotId: number) {
        this.state.sendMessage({ type: 'harvest_wheat', plotId })
    }
}
