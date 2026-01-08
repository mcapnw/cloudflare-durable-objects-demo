/**
 * InputManager - Handles touch and keyboard input
 */

import { getGameState } from './GameState'
import * as Constants from '../constants'
import * as Types from '../types'

export class InputManager {
    private state = getGameState()
    private joystickBaseX: number = 0
    private joystickBaseY: number = 0

    constructor() {
        this.createJoystick()
        this.setupTouchHandlers()
        this.setupKeyboardHandlers()
        this.setupCharacterDragHandlers()
    }

    private createJoystick() {
        const container = document.createElement('div')
        container.id = 'joystick-container'
        container.style.cssText = `
            position: fixed;
            bottom: 40px;
            left: 40px;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.3);
            border: 2px solid rgba(255, 255, 255, 0.3);
            z-index: 100;
            touch-action: none;
            display: none;
        `

        const knob = document.createElement('div')
        knob.id = 'joystick-knob'
        knob.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.7);
            pointer-events: none;
        `

        container.appendChild(knob)
        document.body.appendChild(container)

        this.state.joystickContainer = container
        this.state.joystickKnob = knob
    }

    private getJoystickCenter(): { x: number, y: number } {
        if (!this.state.joystickContainer) return { x: 0, y: 0 }
        const rect = this.state.joystickContainer.getBoundingClientRect()
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        }
    }

    private setupTouchHandlers() {
        const container = this.state.joystickContainer
        if (!container) return

        container.addEventListener('touchstart', (e: TouchEvent) => {
            e.preventDefault()
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i]
                const center = this.getJoystickCenter()
                this.state.activeTouches.set(touch.identifier, {
                    id: touch.identifier,
                    startX: touch.clientX,
                    startY: touch.clientY,
                    currentX: touch.clientX,
                    currentY: touch.clientY,
                    isJoystick: true
                })
                this.joystickBaseX = center.x
                this.joystickBaseY = center.y
            }
        })

        container.addEventListener('touchmove', (e: TouchEvent) => {
            e.preventDefault()
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i]
                const touchState = this.state.activeTouches.get(touch.identifier)
                if (touchState && touchState.isJoystick) {
                    touchState.currentX = touch.clientX
                    touchState.currentY = touch.clientY

                    const dx = touch.clientX - this.joystickBaseX
                    const dy = touch.clientY - this.joystickBaseY
                    const maxRadius = 60
                    const distance = Math.sqrt(dx * dx + dy * dy)
                    const clampedDistance = Math.min(distance, maxRadius)
                    const angle = Math.atan2(dy, dx)

                    this.state.joystickDeltaX = (Math.cos(angle) * clampedDistance) / maxRadius
                    this.state.joystickDeltaY = (Math.sin(angle) * clampedDistance) / maxRadius

                    if (this.state.joystickKnob) {
                        const knobX = Math.cos(angle) * clampedDistance
                        const knobY = Math.sin(angle) * clampedDistance
                        this.state.joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`
                    }
                }
            }
        })

        const handleTouchEnd = (e: TouchEvent) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                const touch = e.changedTouches[i]
                const touchState = this.state.activeTouches.get(touch.identifier)
                if (touchState && touchState.isJoystick) {
                    this.state.joystickDeltaX = 0
                    this.state.joystickDeltaY = 0
                    if (this.state.joystickKnob) {
                        this.state.joystickKnob.style.transform = 'translate(-50%, -50%)'
                    }
                }
                this.state.activeTouches.delete(touch.identifier)
            }
        }

        container.addEventListener('touchend', handleTouchEnd)
        container.addEventListener('touchcancel', handleTouchEnd)
    }

    private setupKeyboardHandlers() {
        const keyState: { [key: string]: boolean } = {}

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            keyState[e.code] = true
            this.updateKeyboardInput(keyState)

            if (e.code === 'Space') {
                this.state.callbacks.handleShoot?.()
            }
        })

        window.addEventListener('keyup', (e: KeyboardEvent) => {
            keyState[e.code] = false
            this.updateKeyboardInput(keyState)
        })
    }

    private updateKeyboardInput(keyState: { [key: string]: boolean }) {
        let dx = 0
        let dy = 0

        if (keyState['KeyW'] || keyState['ArrowUp']) dy -= 1
        if (keyState['KeyS'] || keyState['ArrowDown']) dy += 1
        if (keyState['KeyA'] || keyState['ArrowLeft']) dx -= 1
        if (keyState['KeyD'] || keyState['ArrowRight']) dx += 1

        // Normalize diagonal movement
        if (dx !== 0 && dy !== 0) {
            const length = Math.sqrt(dx * dx + dy * dy)
            dx /= length
            dy /= length
        }

        // Only override joystick if keyboard is being used
        if (dx !== 0 || dy !== 0) {
            this.state.joystickDeltaX = dx
            this.state.joystickDeltaY = dy
        } else if (this.state.activeTouches.size === 0) {
            // Reset if no touch and no keyboard
            this.state.joystickDeltaX = 0
            this.state.joystickDeltaY = 0
        }
    }

    private setupCharacterDragHandlers() {
        // This handles character rotation in the character customization screen
        window.addEventListener('mousedown', (e: MouseEvent) => {
            if (this.state.currentMode !== 'character') return
            this.state.isDraggingChar = true
            this.state.previousMouseX = e.clientX
        })

        window.addEventListener('mousemove', (e: MouseEvent) => {
            if (this.state.currentMode !== 'character' || !this.state.isDraggingChar) return
            const deltaX = e.clientX - this.state.previousMouseX
            this.state.charRotation += deltaX * 0.01
            this.state.previousMouseX = e.clientX
        })

        window.addEventListener('mouseup', () => {
            this.state.isDraggingChar = false
        })

        // Touch equivalents for character rotation
        window.addEventListener('touchstart', (e: TouchEvent) => {
            if (this.state.currentMode !== 'character') return
            // Ignore if touching joystick area
            if (e.target === this.state.joystickContainer ||
                (e.target as HTMLElement)?.closest?.('#joystick-container')) return

            this.state.isDraggingChar = true
            this.state.previousMouseX = e.touches[0].clientX
        })

        window.addEventListener('touchmove', (e: TouchEvent) => {
            if (this.state.currentMode !== 'character' || !this.state.isDraggingChar) return
            const deltaX = e.touches[0].clientX - this.state.previousMouseX
            this.state.charRotation += deltaX * 0.01
            this.state.previousMouseX = e.touches[0].clientX
        })

        window.addEventListener('touchend', () => {
            this.state.isDraggingChar = false
        })
    }

    /**
     * Get the current movement input (normalized -1 to 1)
     */
    getMovementInput(): { x: number, y: number } {
        return {
            x: this.state.joystickDeltaX,
            y: this.state.joystickDeltaY
        }
    }

    /**
     * Check if there's any movement input
     */
    hasMovementInput(): boolean {
        return Math.abs(this.state.joystickDeltaX) > 0.05 || Math.abs(this.state.joystickDeltaY) > 0.05
    }
}
