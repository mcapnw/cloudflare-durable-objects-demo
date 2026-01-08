/**
 * UIManager - Manages DOM UI elements, modals, and visibility
 */

import { getGameState } from './GameState'
import * as Utils from '../utils'
import * as Constants from '../constants'

export class UIManager {
    private state = getGameState()

    constructor() {
        this.createUIElements()
        this.setupUIEventListeners()

        // Register callbacks
        this.state.registerCallback('updateUIVisibility', this.updateVisibility.bind(this))
        this.state.registerCallback('updateEconomicUI', this.updateEconomicUI.bind(this))
        this.state.registerCallback('showShopError', this.showShopError.bind(this))
        this.state.registerCallback('showInventoryModal', this.showInventoryModal.bind(this))
        this.state.registerCallback('showShopModal', this.showShopModal.bind(this))
        this.state.registerCallback('updateRealmWaitModal', this.updateRealmWaitModal.bind(this))
        this.state.registerCallback('updateDamageList', this.updateDamageList.bind(this))
    }

    private createUIElements() {
        this.createSelectionCard()
        this.createDamageList()
        this.createScoreModal()
        this.createCongratsModal()
        this.createShootButton()
        this.createSpawnButton()
        this.createInteractButton()
        this.createExitCameraButton()
    }

    private createSelectionCard() {
        // Add CSS styles
        const style = document.createElement('style')
        style.innerHTML = `
        #selection-card {
            position: fixed;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(12px);
            border-radius: 24px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            z-index: 100;
            bottom: 30px;
            left: 50%;
            transform: translateX(-50%);
            min-width: 280px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        @media (max-width: 768px) {
            #selection-card {
                bottom: 30px;
                left: 50%;
                transform: translateX(-50%);
                width: 85%;
                padding: 20px;
            }
        }
        .card-section { display: flex; flex-direction: column; align-items: center; gap: 8px; width: 100%; }
        .card-label { font-size: 11px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 0.5px; }
        .card-input { width: 100%; padding: 10px 14px; border-radius: 10px; border: none; font-size: 15px; background: rgba(255,255,255,0.1); color: white; text-align: center; }
        .card-input::placeholder { color: rgba(255,255,255,0.4); }
        .card-btn-row { display: flex; gap: 8px; justify-content: center; }
        .card-btn { padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; transition: all 0.2s; background: rgba(255,255,255,0.15); color: white; }
        .card-btn.active { background: #4CAF50; color: white; }
        .card-face-btn { padding: 8px 14px; border-radius: 8px; border: none; cursor: pointer; font-weight: 600; background: rgba(255,255,255,0.15); color: white; display: flex; align-items: center; gap: 8px; }
        .card-play-btn { margin-top: 8px; padding: 14px 40px; background: linear-gradient(135deg, #4CAF50, #45a049); color: white; border: none; border-radius: 999px; font-weight: 800; font-size: 16px; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: all 0.2s; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3); }
        .card-play-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(76, 175, 80, 0.5); }
        .card-play-btn:active { transform: translateY(1px); }
        `
        document.head.appendChild(style)

        // Create selection card container
        const selectionCard = document.createElement('div')
        selectionCard.id = 'selection-card'

        // Username Section
        const usernameSection = document.createElement('div')
        usernameSection.className = 'card-section'
        usernameSection.innerHTML = '<span class="card-label">Your Name</span>'
        const usernameInput = document.createElement('input')
        usernameInput.type = 'text'
        usernameInput.className = 'card-input'
        usernameInput.placeholder = 'Enter username...'
        usernameInput.maxLength = 20
        usernameInput.value = this.state.myUsername || ''
        usernameSection.appendChild(usernameInput)
        selectionCard.appendChild(usernameSection)

        // Gender Section
        const genderSection = document.createElement('div')
        genderSection.className = 'card-section'
        genderSection.innerHTML = '<span class="card-label">Gender</span>'
        const genderRow = document.createElement('div')
        genderRow.className = 'card-btn-row'
        const maleBtn = document.createElement('button')
        maleBtn.className = `card-btn ${this.state.charGender === 'male' ? 'active' : ''}`
        maleBtn.innerText = '♂ Male'
        const femaleBtn = document.createElement('button')
        femaleBtn.className = `card-btn ${this.state.charGender === 'female' ? 'active' : ''}`
        femaleBtn.innerText = '♀ Female'

        maleBtn.addEventListener('click', () => {
            this.state.charGender = 'male'
            maleBtn.classList.add('active')
            femaleBtn.classList.remove('active')
            this.state.callbacks.updateCharacterGender?.()
        })
        femaleBtn.addEventListener('click', () => {
            this.state.charGender = 'female'
            maleBtn.classList.remove('active')
            femaleBtn.classList.add('active')
            this.state.callbacks.updateCharacterGender?.()
        })

        genderRow.appendChild(maleBtn)
        genderRow.appendChild(femaleBtn)
        genderSection.appendChild(genderRow)
        selectionCard.appendChild(genderSection)

        // Face Section
        const faceSection = document.createElement('div')
        faceSection.className = 'card-section'
        faceSection.innerHTML = '<span class="card-label">Appearance</span>'
        const faceBtn = document.createElement('button')
        faceBtn.className = 'card-face-btn'

        const getFaceName = (filename: string) => {
            const name = filename.replace('full_face_', '').replace('.png', '').replace(/_/g, ' ')
            return name.charAt(0).toUpperCase() + name.slice(1)
        }

        const updateFaceBtn = () => {
            const faces = ['full_face_default.png', 'full_face_angry.png', 'full_face_content.png', 'full_face_crazy.png', 'full_face_happy.png']
            faceBtn.innerHTML = `<span>Face Style</span> <span style="opacity:0.7">${getFaceName(faces[this.state.currentFaceIndex])}</span>`
        }
        updateFaceBtn()

        faceBtn.addEventListener('click', () => {
            const faces = ['full_face_default.png', 'full_face_angry.png', 'full_face_content.png', 'full_face_crazy.png', 'full_face_happy.png']
            this.state.currentFaceIndex = (this.state.currentFaceIndex + 1) % faces.length
            updateFaceBtn()
            this.state.callbacks.updateCharacterFace?.()
        })

        faceSection.appendChild(faceBtn)
        selectionCard.appendChild(faceSection)

        // Play Button
        const playBtn = document.createElement('button')
        playBtn.innerText = 'ENTER WORLD'
        playBtn.className = 'card-play-btn'
        selectionCard.appendChild(playBtn)

        playBtn.addEventListener('click', async () => {
            this.state.myUsername = usernameInput.value.trim()
            try {
                const resp = await fetch('/api/user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: this.state.myUsername,
                        gender: this.state.charGender,
                        faceIndex: this.state.currentFaceIndex
                    })
                })
                if (resp.ok) {
                    this.state.callbacks.switchToMode?.('game')
                    if (this.state.wsConnected) {
                        this.state.sendMessage({ type: 'change_gender', gender: this.state.charGender })
                    }
                }
            } catch (err) {
                console.error('Failed to save user:', err)
            }
        })

        document.body.appendChild(selectionCard)
    }

    private createDamageList() {
        const el = document.createElement('div')
        el.id = 'dragon-damage-list'
        el.style.cssText = `
            position: fixed;
            top: 100px;
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
        document.body.appendChild(el)
        this.state.damageListEl = el
    }

    private createScoreModal() {
        const modal = document.createElement('div')
        modal.id = 'score-modal'
        modal.style.cssText = `
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
            overflow-y: auto;
            max-height: 80vh;
        `
        document.body.appendChild(modal)
        this.state.scoreModal = modal

        // Click outside to close
        const closeHandler = (e: any) => {
            if (modal.style.display === 'block' && !modal.contains(e.target as Node)) {
                const btn = document.getElementById('scores-btn')
                if (btn && !btn.contains(e.target as Node)) {
                    modal.style.display = 'none'
                    this.state.lastModalCloseTime = Date.now()
                    this.updateVisibility()
                }
            }
        }
        document.addEventListener('mousedown', closeHandler)
        document.addEventListener('touchstart', closeHandler)
    }

    private createCongratsModal() {
        const modal = document.createElement('div')
        modal.id = 'congrats-modal'
        modal.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 24px;
            border-radius: 24px;
            width: 90%;
            max-width: 400px;
            font-family: 'Outfit', 'Inter', system-ui, sans-serif;
            z-index: 1000;
            display: none;
            border: 3px solid #FFD54F;
            box-shadow: 0 0 30px rgba(255, 213, 79, 0.3);
            text-align: center;
            backdrop-filter: blur(8px);
        `
        modal.innerHTML = `
            <h1 style="margin-top:0; color: #FFD54F; font-size: 24px; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">Congratulations!</h1>
            <p style="font-size: 16px; margin: 12px 0; line-height: 1.4; color: #FFF;">You earned the <span style="color: #4CAF50; font-weight: bold; font-size: 18px;">Beginner's Staff</span></p>
            <button id="accept-congrats-btn" style="
                background: #FFD54F;
                color: #000;
                border: none;
                padding: 10px 32px;
                font-size: 16px;
                font-weight: 800;
                border-radius: 999px;
                cursor: pointer;
                transition: transform 0.2s, background 0.2s;
                text-transform: uppercase;
                margin-top: 8px;
            ">Accept</button>
        `
        document.body.appendChild(modal)
        this.state.congratsModal = modal

        const acceptBtn = modal.querySelector('#accept-congrats-btn') as HTMLButtonElement
        if (acceptBtn) {
            acceptBtn.addEventListener('mouseenter', () => {
                acceptBtn.style.background = '#FFCA28'
                acceptBtn.style.transform = 'scale(1.05)'
            })
            acceptBtn.addEventListener('mouseleave', () => {
                acceptBtn.style.background = '#FFD54F'
                acceptBtn.style.transform = 'scale(1)'
            })
            acceptBtn.addEventListener('click', () => {
                this.state.currentMode = 'game'
                this.state.tempFaceOverride = null
                this.state.callbacks.updateCharacterFace?.()
                modal.style.display = 'none'
                this.updateVisibility()
            })
        }
    }

    private createShootButton() {
        const btn = document.createElement('button')
        btn.id = 'shoot-btn'
        btn.style.cssText = `
            position: fixed;
            bottom: 40px;
            right: 40px;
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: rgba(239, 68, 68, 0.9);
            border: 3px solid rgba(255, 255, 255, 0.4);
            font-size: 14px;
            font-weight: bold;
            color: white;
            display: none;
            z-index: 100;
            cursor: pointer;
            transition: transform 0.1s;
            justify-content: center;
            align-items: center;
            font-family: system-ui, sans-serif;
        `

        const size = 80
        const strokeWidth = 6
        const radius = (size - strokeWidth) / 2
        const circumference = 2 * Math.PI * radius

        btn.innerHTML = `
            <span style="z-index:2;position:relative;">SHOOT</span>
            <svg class="progress-ring" width="${size}" height="${size}" style="position:absolute;top:0;left:0;transform:rotate(-90deg);pointer-events:none;">
                <circle stroke="rgba(255,255,255,0.3)" stroke-width="${strokeWidth}" fill="transparent" r="${radius}" cx="${size / 2}" cy="${size / 2}" />
                <circle id="cooldown-circle" stroke="white" stroke-width="${strokeWidth}" fill="transparent" r="${radius}" cx="${size / 2}" cy="${size / 2}" 
                    style="stroke-dasharray: ${circumference} ${circumference}; stroke-dashoffset: ${circumference}; transition: stroke-dashoffset 0.1s linear;" />
            </svg>
        `
        document.body.appendChild(btn)
        this.state.shootBtn = btn
    }

    private createSpawnButton() {
        const btn = document.createElement('button')
        btn.id = 'spawn-dragon-btn'
        btn.innerText = 'ACTIVATE OBELISK'
        btn.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, calc(-50% - 60px));
            padding: 10px 24px; background: #A7F3D0; border: 2px solid black;
            border-radius: 999px; color: black; font-weight: bold; cursor: pointer;
            display: none; z-index: 50; font-size: 16px; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.2);
            pointer-events: auto;
            font-family: system-ui, sans-serif;
            text-transform: uppercase;
        `
        document.body.appendChild(btn)
        this.state.spawnBtn = btn
    }

    private createInteractButton() {
        const btn = document.createElement('button')
        btn.id = 'interact-btn'
        btn.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, calc(-50% - 60px));
            padding: 10px 24px; background: #A7F3D0; border: 2px solid black;
            border-radius: 999px; color: black; font-weight: bold; cursor: pointer;
            display: none; z-index: 50; font-size: 16px; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.2);
            pointer-events: auto;
            font-family: system-ui, sans-serif;
            text-transform: uppercase;
        `
        document.body.appendChild(btn)
        this.state.interactBtn = btn
    }

    private createExitCameraButton() {
        const btn = document.createElement('button')
        btn.innerText = 'EXIT CAMERA'
        btn.style.cssText = `
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
        document.body.appendChild(btn)
        this.state.exitCameraBtn = btn

        btn.addEventListener('click', () => {
            this.state.callbacks.switchToMode?.('game')
        })
    }

    private setupUIEventListeners() {
        // Shoot button
        if (this.state.shootBtn) {
            const handleShoot = () => this.state.callbacks.handleShoot?.()
            this.state.shootBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleShoot() })
            this.state.shootBtn.addEventListener('mousedown', (e) => { e.preventDefault(); handleShoot() })
        }

        // Spawn button
        if (this.state.spawnBtn) {
            const handleSpawn = () => this.state.callbacks.handleSpawnDragon?.()
            this.state.spawnBtn.addEventListener('click', handleSpawn)
            this.state.spawnBtn.addEventListener('touchstart', (e) => { e.preventDefault(); handleSpawn() })
        }

        // Scores button
        const scoreBtn = document.getElementById('scores-btn')
        if (scoreBtn) {
            scoreBtn.addEventListener('click', () => {
                if (Date.now() - this.state.lastModalCloseTime < 300) return
                const modal = this.state.scoreModal
                if (modal) {
                    if (modal.style.display === 'none' || !modal.style.display) {
                        this.state.sendMessage({ type: 'get_scores' })
                        modal.innerHTML = '<div style="text-align:center;">Loading...</div>'
                        modal.style.display = 'block'
                    } else {
                        modal.style.display = 'none'
                    }
                }
                this.updateVisibility()
            })
        }

        // Character button
        const charBtn = document.getElementById('character-btn')
        if (charBtn) {
            charBtn.addEventListener('click', () => {
                if (Date.now() - this.state.lastModalCloseTime < 300) return
                this.state.callbacks.switchToMode?.('character')
            })
        }

        // Camera button
        const cameraBtn = document.getElementById('camera-btn')
        if (cameraBtn) {
            cameraBtn.addEventListener('click', () => {
                if (Date.now() - this.state.lastModalCloseTime < 300) return
                this.state.callbacks.switchToMode?.('spectate')
            })
        }

        // Inventory button
        const invBtn = document.getElementById('inventory-btn')
        if (invBtn) {
            invBtn.addEventListener('click', () => {
                if (Date.now() - this.state.lastModalCloseTime < 300) return
                this.showInventoryModal()
            })
        }

        // Expose for window helpers
        ; (window as any).updateUIVisibility = this.updateVisibility.bind(this)
    }

    updateVisibility() {
        if (this.state.isVersionMismatch) return

        const invBtn = document.getElementById('inventory-btn')
        const scoreBtn = document.getElementById('scores-btn')
        const charNavBtn = document.getElementById('character-btn')
        const cameraNavBtn = document.getElementById('camera-btn')
        const scoreModal = this.state.scoreModal
        const invModal = document.getElementById('inventory-modal')
        const shopModal = document.getElementById('shop-modal')
        const rModal = document.getElementById('realm-wait-modal')

        this.state.isModalOpen = !!(
            (scoreModal && scoreModal.style.display === 'block') ||
            (invModal && invModal.style.display === 'block') ||
            (shopModal && shopModal.style.display === 'block') ||
            (rModal && rModal.style.display === 'block')
        )

        const selectionCard = document.getElementById('selection-card')

        if (this.state.currentMode === 'character') {
            if (selectionCard) selectionCard.style.display = 'flex'
            if (this.state.exitCameraBtn) this.state.exitCameraBtn.style.display = 'none'
            if (this.state.damageListEl) this.state.damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = 'none'
            if (charNavBtn) charNavBtn.style.display = 'none'
            if (cameraNavBtn) cameraNavBtn.style.display = 'none'
            if (this.state.shootBtn) this.state.shootBtn.style.display = 'none'
            if (this.state.joystickContainer) this.state.joystickContainer.style.display = 'none'
            if (this.state.spawnBtn) this.state.spawnBtn.style.display = 'none'
            if (this.state.interactBtn) this.state.interactBtn.style.display = 'none'
            if (invBtn) invBtn.style.display = 'none'
            if (this.state.congratsModal) this.state.congratsModal.style.display = 'none'
        } else if (this.state.currentMode === 'spectate') {
            if (selectionCard) selectionCard.style.display = 'none'
            if (this.state.exitCameraBtn) this.state.exitCameraBtn.style.display = 'block'
            if (this.state.damageListEl) this.state.damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = 'none'
            if (charNavBtn) charNavBtn.style.display = 'none'
            if (cameraNavBtn) cameraNavBtn.style.display = 'none'
            if (this.state.shootBtn) this.state.shootBtn.style.display = 'none'
            if (this.state.joystickContainer) this.state.joystickContainer.style.display = 'none'
            if (this.state.spawnBtn) this.state.spawnBtn.style.display = 'none'
            if (this.state.interactBtn) this.state.interactBtn.style.display = 'none'
            if (invBtn) invBtn.style.display = 'none'
            if (this.state.congratsModal) this.state.congratsModal.style.display = 'none'
        } else if (this.state.currentMode === 'congratulations') {
            if (selectionCard) selectionCard.style.display = 'none'
            if (this.state.exitCameraBtn) this.state.exitCameraBtn.style.display = 'none'
            if (this.state.damageListEl) this.state.damageListEl.style.display = 'none'
            if (scoreBtn) scoreBtn.style.display = 'none'
            if (charNavBtn) charNavBtn.style.display = 'none'
            if (cameraNavBtn) cameraNavBtn.style.display = 'none'
            if (this.state.shootBtn) this.state.shootBtn.style.display = 'none'
            if (this.state.joystickContainer) this.state.joystickContainer.style.display = 'none'
            if (this.state.spawnBtn) this.state.spawnBtn.style.display = 'none'
            if (this.state.interactBtn) this.state.interactBtn.style.display = 'none'
            if (invBtn) invBtn.style.display = 'none'
            if (this.state.congratsModal) this.state.congratsModal.style.display = 'block'
        } else {
            // Game mode
            if (selectionCard) selectionCard.style.display = 'none'
            if (this.state.exitCameraBtn) this.state.exitCameraBtn.style.display = 'none'

            // Dragon damage list
            if (this.state.dragon && !this.state.dragon.isDead &&
                this.state.damageListEl &&
                this.state.damageListEl.innerHTML.includes('Dragon Damage') &&
                !this.state.isModalOpen) {
                this.state.damageListEl.style.display = 'block'
            } else if (this.state.damageListEl) {
                this.state.damageListEl.style.display = 'none'
            }

            if (scoreBtn) scoreBtn.style.display = this.state.isModalOpen ? 'none' : 'block'
            if (charNavBtn) charNavBtn.style.display = this.state.isModalOpen ? 'none' : 'block'
            if (cameraNavBtn) cameraNavBtn.style.display = this.state.isModalOpen ? 'none' : 'block'

            if (this.state.shootBtn) {
                this.state.shootBtn.style.display = (!this.state.isModalOpen && this.state.dragon && !this.state.dragon.isDead && !this.state.myIsDead) ? 'flex' : 'none'
            }

            if (this.state.joystickContainer) {
                this.state.joystickContainer.style.display = (this.state.isModalOpen || this.state.myIsDead) ? 'none' : 'block'
            }

            if (this.state.interactBtn) {
                this.state.interactBtn.style.display = (this.state.isModalOpen || this.state.myIsDead) ? 'none' : this.state.interactBtn.style.display
            }

            if (invBtn) invBtn.style.display = this.state.isModalOpen ? 'none' : 'block'
            if (this.state.congratsModal) this.state.congratsModal.style.display = 'none'
        }
    }

    updateDamageList(list: { name: string, damage: number }[]) {
        if (!this.state.damageListEl) return

        if (!list || list.length === 0) {
            this.state.damageListEl.innerHTML = ''
            this.state.damageListEl.style.display = 'none'
            return
        }

        const sorted = [...list].sort((a, b) => b.damage - a.damage)
        const html = sorted.map(p => `
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span style="font-weight:bold; margin-right: 10px; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${Utils.escapeHtml(p.name)}</span>
                <span style="color: #FFD54F;">${p.damage}</span>
            </div>
        `).join('')

        this.state.damageListEl.innerHTML = `
            <div style="color: #EF5350; font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 4px;">Dragon Damage</div>
            ${html}
        `
        this.updateVisibility()
    }

    updateEconomicUI() {
        const invModal = document.getElementById('inventory-modal')
        if (invModal && invModal.style.display === 'block') this.showInventoryModal()
        const shopCoinsEl = document.getElementById('shop-coins-display')
        if (shopCoinsEl) shopCoinsEl.innerText = this.state.coins.toString()
    }

    showShopError(msg: string) {
        const shopCoinsEl = document.getElementById('shop-coins-display')
        if (shopCoinsEl) {
            const originalColor = '#FFD700'
            shopCoinsEl.innerText = msg
            shopCoinsEl.style.color = '#EF5350'
            setTimeout(() => {
                const currentShopCoinsEl = document.getElementById('shop-coins-display')
                if (currentShopCoinsEl) {
                    currentShopCoinsEl.innerText = this.state.coins.toString()
                    currentShopCoinsEl.style.color = originalColor
                }
            }, 2000)
        }
    }

    showInventoryModal() {
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
                        this.state.lastModalCloseTime = Date.now()
                        this.updateVisibility()
                    }
                }
            }
            document.addEventListener('mousedown', closeHandler)
            document.addEventListener('touchstart', closeHandler)
        }

        const itemCounts: { [k: string]: number } = {}
        this.state.inventory.forEach(item => {
            itemCounts[item] = (itemCounts[item] || 0) + 1
        })

        const itemsHtml = Object.entries(itemCounts).map(([item, count]) => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <span>${Utils.escapeHtml(item.replace(/_/g, ' '))}</span>
                <span style="color:#10B981;">x${count}</span>
            </div>
        `).join('')

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h2 style="margin:0;color:#10B981;">Inventory</h2>
                <span style="color:#FFD700;font-size:18px;font-weight:bold;">💰 ${this.state.coins}</span>
            </div>
            <div style="max-height:300px;overflow-y:auto;">
                ${itemsHtml.length > 0 ? itemsHtml : '<p style="opacity:0.6;text-align:center;">Your inventory is empty</p>'}
            </div>
            <button id="open-shop-btn" style="
                margin-top:16px;width:100%;padding:12px;background:#FFD54F;color:black;border:none;
                border-radius:8px;font-weight:bold;cursor:pointer;font-size:16px;
            ">🛒 Open Shop</button>
            <div style="text-align:center;margin-top:12px;font-size:12px;opacity:0.5;">Click outside to close</div>
        `

        const shopBtn = modal.querySelector('#open-shop-btn')
        if (shopBtn) {
            shopBtn.addEventListener('click', () => {
                modal!.style.display = 'none'
                this.showShopModal()
            })
        }

        modal.style.display = 'block'
        this.updateVisibility()
    }

    showShopModal() {
        let modal = document.getElementById('shop-modal')
        if (!modal) {
            modal = document.createElement('div')
            modal.id = 'shop-modal'
            modal.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9); color: white; padding: 24px; border-radius: 16px;
                width: 80%; max-width: 400px; font-family: system-ui, sans-serif; z-index: 200;
                border: 2px solid #FFD54F; box-shadow: 0 0 20px rgba(0,0,0,0.8);
            `
            document.body.appendChild(modal)

            const closeHandler = (e: any) => {
                if (modal!.style.display === 'block' && !modal!.contains(e.target as Node)) {
                    modal!.style.display = 'none'
                    this.state.lastModalCloseTime = Date.now()
                    this.updateVisibility()
                }
            }
            document.addEventListener('mousedown', closeHandler)
            document.addEventListener('touchstart', closeHandler)
        }

        const shopItems = [
            { id: 'wheat_seeds', name: 'Wheat Seeds', cost: 1, desc: 'Plant in farm plots' },
            { id: 'water_can', name: 'Water Can', cost: 5, desc: 'Water your crops' },
            { id: 'trowel', name: 'Trowel', cost: 5, desc: 'Required for planting' }
        ]

        const itemsHtml = shopItems.map(item => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div>
                    <div style="font-weight:bold;">${item.name}</div>
                    <div style="font-size:12px;opacity:0.7;">${item.desc}</div>
                </div>
                <button class="buy-btn" data-item="${item.id}" style="
                    padding:8px 16px;background:#FFD54F;color:black;border:none;
                    border-radius:8px;font-weight:bold;cursor:pointer;
                ">💰 ${item.cost}</button>
            </div>
        `).join('')

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h2 style="margin:0;color:#FFD54F;">Shop</h2>
                <span id="shop-coins-display" style="color:#FFD700;font-size:18px;font-weight:bold;">${this.state.coins}</span>
            </div>
            <div style="max-height:300px;overflow-y:auto;">
                ${itemsHtml}
            </div>
            <div style="text-align:center;margin-top:12px;font-size:12px;opacity:0.5;">Click outside to close</div>
        `

        modal.querySelectorAll('.buy-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const itemId = (e.target as HTMLElement).dataset.item
                if (itemId) {
                    this.state.sendMessage({ type: 'buy_item', itemId })
                }
            })
        })

        modal.style.display = 'block'
        this.updateVisibility()
    }

    updateRealmWaitModal() {
        if (!this.state.realmWaitModal) {
            const modal = document.createElement('div')
            modal.id = 'realm-wait-modal'
            modal.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.95); color: white; padding: 24px; border-radius: 16px;
                width: 80%; max-width: 400px; font-family: system-ui, sans-serif; z-index: 200;
                border: 2px solid #8B5CF6; box-shadow: 0 0 20px rgba(139, 92, 246, 0.5);
            `
            document.body.appendChild(modal)
            this.state.realmWaitModal = modal
        }

        const playersHtml = this.state.realmPlayers.map(p => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <span>${Utils.escapeHtml(p.name)}</span>
                <span style="color:${p.ready ? '#10B981' : '#EF5350'};">${p.ready ? '✓ Ready' : 'Waiting...'}</span>
            </div>
        `).join('')

        const myData = this.state.realmPlayers.find(p => p.id === this.state.myPlayerId)
        const isReady = myData?.ready || false

        this.state.realmWaitModal.innerHTML = `
            <h2 style="margin:0 0 16px 0;color:#8B5CF6;text-align:center;">Realm Lobby</h2>
            <div style="max-height:200px;overflow-y:auto;margin-bottom:16px;">
                ${playersHtml || '<p style="text-align:center;opacity:0.6;">Waiting for players...</p>'}
            </div>
            <div style="display:flex;gap:8px;">
                <button id="realm-ready-btn" style="
                    flex:1;padding:12px;background:${isReady ? '#10B981' : '#8B5CF6'};color:white;border:none;
                    border-radius:8px;font-weight:bold;cursor:pointer;font-size:14px;
                ">${isReady ? '✓ READY' : 'READY UP'}</button>
                <button id="realm-leave-btn" style="
                    padding:12px 24px;background:#EF5350;color:white;border:none;
                    border-radius:8px;font-weight:bold;cursor:pointer;font-size:14px;
                ">LEAVE</button>
            </div>
        `

        const readyBtn = this.state.realmWaitModal.querySelector('#realm-ready-btn')
        const leaveBtn = this.state.realmWaitModal.querySelector('#realm-leave-btn')

        if (readyBtn) {
            readyBtn.addEventListener('click', () => {
                this.state.sendMessage({ type: 'realm_ready', ready: !isReady })
            })
        }

        if (leaveBtn) {
            leaveBtn.addEventListener('click', () => {
                this.state.sendMessage({ type: 'leave_realm_lobby' })
                this.state.isWaitingForRealm = false
                this.state.realmWaitModal!.style.display = 'none'
                this.updateVisibility()
            })
        }

        this.state.realmWaitModal.style.display = 'block'
        this.updateVisibility()
    }
}
