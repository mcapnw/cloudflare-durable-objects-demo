/**
 * Selection Card UI - Character customization screen
 * 
 * Creates the character selection card with username input,
 * gender selection, face style selection, and enter world button.
 */

import * as Utils from './utils'
import * as MeshFactories from './meshFactories'

export interface SelectionCardConfig {
    initialUsername: string
    initialGender: 'male' | 'female'
    initialFaceIndex: number
    onGenderChange: (gender: 'male' | 'female') => void
    onFaceChange: (index: number) => void
    onEnterWorld: (username: string, gender: 'male' | 'female', faceIndex: number) => Promise<void>
}

export interface SelectionCardElements {
    card: HTMLDivElement
    usernameInput: HTMLInputElement
}

/**
 * Injects the required CSS styles for the selection card
 */
export function injectStyles(): void {
    if (document.getElementById('selection-card-styles')) return

    const style = document.createElement('style')
    style.id = 'selection-card-styles'
    style.innerHTML = `
      #selection-card {
        position: fixed;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        padding: 24px;
        display: none;
        flex-direction: column;
        gap: 16px;
        z-index: 100;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      }
      @media (min-width: 769px) {
        #selection-card {
          right: 60px;
          top: 50%;
          transform: translateY(-50%);
          width: 320px;
        }
      }
      @media (max-width: 768px) {
        #selection-card {
          bottom: 30px;
          left: 50%;
          transform: translateX(-50%);
          width: 85%;
          max-width: 380px;
        }
      }
      .card-section { display: flex; flex-direction: column; gap: 8px; }
      .card-label {
        color: rgba(255,255,255,0.5);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        font-weight: 700;
        margin-left: 4px;
      }
      .card-input {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        color: white;
        padding: 14px 16px;
        font-size: 16px;
        width: 100%;
        box-sizing: border-box;
        font-family: inherit;
        outline: none;
        transition: all 0.2s;
      }
      .card-input:focus {
        border-color: #FFD54F;
        background: rgba(255,255,255,0.1);
      }
      .card-btn {
        background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        color: white;
        padding: 14px 16px;
        font-size: 16px;
        cursor: pointer;
        transition: all 0.2s;
        font-weight: 500;
        width: 100%;
        text-align: left;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-family: inherit;
      }
      .card-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.2); }
      .card-play-btn {
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        color: white;
        border: none;
        border-radius: 14px;
        padding: 18px;
        font-size: 18px;
        font-weight: 800;
        cursor: pointer;
        box-shadow: 0 4px 20px rgba(76, 175, 80, 0.4);
        transition: all 0.2s;
        width: 100%;
        text-align: center;
        margin-top: 8px;
        font-family: inherit;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .card-play-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(76, 175, 80, 0.5); }
      .card-play-btn:active { transform: translateY(1px); }
    `
    document.head.appendChild(style)
}

/**
 * Creates the selection card UI and attaches it to the document body
 */
export function createSelectionCard(config: SelectionCardConfig): SelectionCardElements {
    injectStyles()

    let currentGender = config.initialGender
    let currentFaceIndex = config.initialFaceIndex

    // Create main card container
    const selectionCard = document.createElement('div')
    selectionCard.id = 'selection-card'

    // Name Section
    const nameSection = document.createElement('div')
    nameSection.className = 'card-section'
    nameSection.innerHTML = '<span class="card-label">Identity</span>'
    selectionCard.appendChild(nameSection)

    const usernameInput = document.createElement('input')
    usernameInput.type = 'text'
    usernameInput.placeholder = 'Enter Username'
    usernameInput.value = config.initialUsername || ''
    usernameInput.maxLength = 16
    usernameInput.className = 'card-input'
    nameSection.appendChild(usernameInput)
    usernameInput.addEventListener('input', () => {
        usernameInput.value = usernameInput.value.replace(/[^a-zA-Z0-9 ]/g, '')
    })

    // Gender Section
    const genderSection = document.createElement('div')
    genderSection.className = 'card-section'
    genderSection.innerHTML = '<span class="card-label">Physique</span>'
    selectionCard.appendChild(genderSection)

    const charGenderBtn = document.createElement('button')
    charGenderBtn.className = 'card-btn'
    const updateGenderBtn = () => {
        charGenderBtn.innerHTML = `<span>Gender</span> <span style="opacity:0.7; color:${currentGender === 'male' ? '#93C5FD' : '#F9A8D4'}">${currentGender.toUpperCase()}</span>`
    }
    updateGenderBtn()
    genderSection.appendChild(charGenderBtn)
    charGenderBtn.addEventListener('click', () => {
        currentGender = currentGender === 'male' ? 'female' : 'male'
        updateGenderBtn()
        config.onGenderChange(currentGender)
    })

    // Face Section
    const faceSection = document.createElement('div')
    faceSection.className = 'card-section'
    faceSection.innerHTML = '<span class="card-label">Appearance</span>'
    selectionCard.appendChild(faceSection)

    const faceBtn = document.createElement('button')
    faceBtn.className = 'card-btn'
    const updateFaceBtn = () => {
        faceBtn.innerHTML = `<span>Face Style</span> <span style="opacity:0.7">${Utils.getFaceName(MeshFactories.charFaces[currentFaceIndex])}</span>`
    }
    updateFaceBtn()
    faceSection.appendChild(faceBtn)
    faceBtn.addEventListener('click', () => {
        currentFaceIndex = (currentFaceIndex + 1) % MeshFactories.charFaces.length
        updateFaceBtn()
        config.onFaceChange(currentFaceIndex)
    })

    // Play Button
    const playBtn = document.createElement('button')
    playBtn.innerText = 'ENTER WORLD'
    playBtn.className = 'card-play-btn'
    selectionCard.appendChild(playBtn)
    playBtn.addEventListener('click', async () => {
        const username = usernameInput.value.trim()
        await config.onEnterWorld(username, currentGender, currentFaceIndex)
    })

    document.body.appendChild(selectionCard)

    return { card: selectionCard, usernameInput }
}
