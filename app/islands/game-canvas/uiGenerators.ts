export function createTextSprite(THREE: any, text: string, isMe: boolean, textColor: string = '#FFFFFF', bgColor: string = 'transparent'): any {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!

    // Set font first to measure text
    const fontSize = 32  // Same as sheep
    context.font = `Bold ${fontSize}px Arial`

    // Measure text and add padding
    const metrics = context.measureText(text)
    const textWidth = metrics.width
    const padding = 40  // 20px padding on each side

    // Set canvas size based on text width
    canvas.width = Math.max(256, Math.ceil(textWidth + padding))  // Minimum 256px like sheep
    canvas.height = 64  // Same as sheep

    if (bgColor !== 'transparent') {
        context.fillStyle = bgColor
        context.fillRect(0, 0, canvas.width, canvas.height)
    }

    // Re-apply font after canvas resize (canvas resize clears context)
    context.font = `Bold ${fontSize}px Arial`
    context.fillStyle = textColor
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // Soft black shadow (only for white text labels)
    if (textColor.toUpperCase() === '#FFFFFF') {
        context.shadowColor = 'rgba(0, 0, 0, 0.9)'
        context.shadowBlur = 6
        context.shadowOffsetX = 0
        context.shadowOffsetY = 0
    }

    context.fillText(text, canvas.width / 2, 32)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(material)

    // Scale proportionally: maintain sheep's ratio but adjust width based on canvas
    // Sheep uses 4x1 for 256x64, so we use (canvas.width/256)*4 x 1
    const scaleX = (canvas.width / 256) * 4
    sprite.scale.set(scaleX, 1.0, 1)

    return sprite
}

export function createSheepTextSprite(THREE: any, text: string): any {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = 256
    canvas.height = 64

    context.font = 'Bold 32px Arial'
    context.fillStyle = '#FFFFFF' // White
    context.textAlign = 'center'
    context.textBaseline = 'middle'

    // Soft black shadow
    context.shadowColor = 'rgba(0, 0, 0, 0.9)'
    context.shadowBlur = 6
    context.shadowOffsetX = 0
    context.shadowOffsetY = 0

    context.fillText(text, 128, 32)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(4, 1.0, 1)
    return sprite
}

export function getItemIcon(name: string) {
    const style = 'width:24px;height:24px;margin-right:10px;vertical-align:middle;'
    if (name === 'coins') return `<svg style="${style}" viewBox="0 0 24 24" fill="#FFD700"><circle cx="12" cy="12" r="10"/><text x="12" y="16" text-anchor="middle" fill="#B8860B" font-size="12" font-weight="bold">$</text></svg>`
    if (name === 'wheat_seeds') return `<svg style="${style}" viewBox="0 0 24 24" fill="#8D6E63"><circle cx="8" cy="12" r="3"/><circle cx="16" cy="12" r="3"/><circle cx="12" cy="8" r="3"/></svg>`
    if (name === 'water_can') return `<svg style="${style}" viewBox="0 0 24 24" fill="#4FC3F7"><path d="M4,16 L20,16 L18,8 L6,8 Z M18,8 L22,4 M6,12 L2,12"/></svg>`
    if (name === 'trowel') return `<svg style="${style}" viewBox="0 0 24 24" fill="#9E9E9E"><path d="M12,2 L15,10 L12,18 L9,10 Z M12,18 L12,22" stroke="#795548" stroke-width="2"/></svg>`
    if (name === 'wheat') return `<svg style="${style}" viewBox="0 0 24 24" stroke="#FFD54F" stroke-width="2" fill="none"><path d="M12,22 C12,22 6,16 6,10 C6,6 12,2 12,2 C12,2 18,6 18,10 C18,16 12,22 12,22 Z M12,2 L12,22"/></svg>`
    return ''
}

export function showUpdateOverlay(liveVersion: string) {
    // Inject style to hide all other UI reliably
    const style = document.createElement('style')
    style.innerHTML = `
        #ui-layer, #joystick-container, #shoot-btn, #score-modal, .top-nav, button, input {
            display: none !important;
        }
        #update-overlay, #update-overlay * {
            display: flex !important;
        }
        #update-overlay {
            flex-direction: column !important;
        }
        #continue-btn {
            display: inline-block !important;
        }
    `
    document.head.appendChild(style)

    const overlay = document.createElement('div')
    overlay.id = 'update-overlay'
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        color: white;
        font-family: system-ui, sans-serif;
        text-align: center;
        padding: 20px;
    `
    overlay.innerHTML = `
        <h1 style="font-size: 32px; color: #FFD54F; margin-bottom: 20px;">New Version Available</h1>
        <p id="update-message" style="font-size: 18px; opacity: 0.8; margin-bottom: 40px;">
            Please wait... <span id="countdown">30</span>
        </p>
        <button id="continue-btn" style="background: #FFD54F; color: black; padding: 12px 30px; border-radius: 8px; font-weight: bold; border: none; cursor: pointer; font-size: 18px; display: none !important;">
            Continue
        </button>
    `
    document.body.appendChild(overlay)

    let secondsLeft = 30
    const countdownEl = document.getElementById('countdown')!
    const messageEl = document.getElementById('update-message')!
    const continueBtn = document.getElementById('continue-btn')!

    const countdownInterval = setInterval(() => {
        secondsLeft--
        if (countdownEl) countdownEl.innerText = String(secondsLeft)

        if (secondsLeft <= 0) {
            clearInterval(countdownInterval)
            messageEl.innerHTML = 'Now that the game has been updated, you must log back in.'
            continueBtn.style.display = 'inline-block'
        }
    }, 1000)

    continueBtn.addEventListener('click', () => {
        // Redirect to logout to destroy session and force re-login with fresh data
        window.location.href = '/auth/logout'
    })
}
