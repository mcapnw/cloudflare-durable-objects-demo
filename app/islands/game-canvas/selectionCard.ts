/**
 * Selection Card UI - Character customization screen
 * 
 * Creates the character selection card with username input,
 * gender selection, face style selection, and play button.
 */

import * as Utils from './utils'
import * as MeshFactories from './meshFactories'

export interface SelectionCardConfig {
  initialUsername: string
  initialGender: 'male' | 'female'
  initialFaceIndex: number
  isAdmin: boolean
  onGenderChange: (gender: 'male' | 'female') => void
  onFaceChange: (index: number) => void
  onEnterWorld: (username: string, gender: 'male' | 'female', faceIndex: number) => Promise<void>
  onAdminClick?: () => void
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
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 16px;
        display: none;
        flex-direction: column;
        gap: 12px;
        z-index: 100;
        box-shadow: 0 10px 40px rgba(0,0,0,0.5);
      }
      @media (min-width: 769px) {
        #selection-card {
          right: 40px;
          top: 50%;
          transform: translateY(-50%);
          width: 280px;
        }
      }
      @media (max-width: 768px) {
        #selection-card {
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          width: 90%;
          padding: 12px;
          gap: 10px;
        }
      }
      .card-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .card-row-label {
        color: rgba(255,255,255,0.6);
        font-size: 13px;
        font-weight: 500;
        min-width: 70px;
      }
      .card-input-compact {
        flex: 1;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        color: white;
        padding: 10px 12px;
        font-size: 14px;
        box-sizing: border-box;
        font-family: inherit;
        outline: none;
        transition: all 0.2s;
      }
      .card-input-compact:focus {
        border-color: #FFD54F;
        background: rgba(255,255,255,0.12);
      }
      .card-inline-btn {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 8px;
        color: white;
        padding: 10px 14px;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
        font-weight: 500;
        font-family: inherit;
        white-space: nowrap;
      }
      .card-inline-btn:hover { background: rgba(255,255,255,0.15); }
      .card-play-btn {
        background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 14px;
        font-size: 16px;
        font-weight: 700;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(76, 175, 80, 0.4);
        transition: all 0.2s;
        width: 100%;
        text-align: center;
        margin-top: 4px;
        font-family: inherit;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .card-play-btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(76, 175, 80, 0.5); }
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

  // Username Row
  const usernameRow = document.createElement('div')
  usernameRow.className = 'card-row'
  const usernameLabel = document.createElement('span')
  usernameLabel.className = 'card-row-label'
  usernameLabel.innerText = 'Username:'
  usernameRow.appendChild(usernameLabel)

  const usernameInput = document.createElement('input')
  usernameInput.type = 'text'
  usernameInput.placeholder = 'Enter name'
  usernameInput.value = config.initialUsername || ''
  usernameInput.maxLength = 16
  usernameInput.className = 'card-input-compact'
  usernameRow.appendChild(usernameInput)
  usernameInput.addEventListener('input', () => {
    usernameInput.value = usernameInput.value.replace(/[^a-zA-Z0-9 ]/g, '')
  })
  selectionCard.appendChild(usernameRow)

  // Gender & Face Row
  const optionsRow = document.createElement('div')
  optionsRow.className = 'card-row'
  optionsRow.style.justifyContent = 'space-between'

  // Gender Button
  const genderBtn = document.createElement('button')
  genderBtn.className = 'card-inline-btn'
  genderBtn.style.flex = '1'
  const updateGenderBtn = () => {
    const color = currentGender === 'male' ? '#93C5FD' : '#F9A8D4'
    genderBtn.innerHTML = `Gender: <span style="color:${color}">${currentGender.charAt(0).toUpperCase() + currentGender.slice(1)}</span>`
  }
  updateGenderBtn()
  genderBtn.addEventListener('click', () => {
    currentGender = currentGender === 'male' ? 'female' : 'male'
    updateGenderBtn()
    config.onGenderChange(currentGender)
  })
  optionsRow.appendChild(genderBtn)

  // Face Button
  const faceBtn = document.createElement('button')
  faceBtn.className = 'card-inline-btn'
  faceBtn.style.flex = '1'
  const updateFaceBtn = () => {
    faceBtn.innerHTML = `Face: <span style="color:#FFD54F">${Utils.getFaceName(MeshFactories.charFaces[currentFaceIndex])}</span>`
  }
  updateFaceBtn()
  faceBtn.addEventListener('click', () => {
    currentFaceIndex = (currentFaceIndex + 1) % MeshFactories.charFaces.length
    updateFaceBtn()
    config.onFaceChange(currentFaceIndex)
  })
  optionsRow.appendChild(faceBtn)

  selectionCard.appendChild(optionsRow)

  // Play Button
  const playBtn = document.createElement('button')
  playBtn.innerText = 'PLAY'
  playBtn.className = 'card-play-btn'
  selectionCard.appendChild(playBtn)
  playBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim()
    await config.onEnterWorld(username, currentGender, currentFaceIndex)
  })

  document.body.appendChild(selectionCard)

  // Dynamic sizing based on screen height
  function adjustCardSize() {
    // Only apply on mobile (portrait)
    if (window.innerWidth > 768) return

    const screenHeight = window.innerHeight
    const halfScreen = screenHeight / 2
    const cardHeight = selectionCard.offsetHeight
    const cardBottom = 20 // distance from bottom

    // If card would take more than half screen, reduce padding
    if (cardHeight > halfScreen - cardBottom) {
      selectionCard.style.padding = '8px'
      selectionCard.style.gap = '6px'
      selectionCard.style.borderRadius = '12px'
      // Also reduce button padding
      const buttons = selectionCard.querySelectorAll('.card-inline-btn')
      buttons.forEach((btn: any) => {
        btn.style.padding = '8px 10px'
        btn.style.fontSize = '12px'
      })
      const input = selectionCard.querySelector('.card-input-compact') as HTMLElement
      if (input) {
        input.style.padding = '8px 10px'
        input.style.fontSize = '13px'
      }
      const play = selectionCard.querySelector('.card-play-btn') as HTMLElement
      if (play) {
        play.style.padding = '10px'
        play.style.fontSize = '14px'
      }
    } else {
      // Reset to normal sizing
      selectionCard.style.padding = '12px'
      selectionCard.style.gap = '10px'
      selectionCard.style.borderRadius = '16px'
      const buttons = selectionCard.querySelectorAll('.card-inline-btn')
      buttons.forEach((btn: any) => {
        btn.style.padding = '10px 14px'
        btn.style.fontSize = '13px'
      })
      const input = selectionCard.querySelector('.card-input-compact') as HTMLElement
      if (input) {
        input.style.padding = '10px 12px'
        input.style.fontSize = '14px'
      }
      const play = selectionCard.querySelector('.card-play-btn') as HTMLElement
      if (play) {
        play.style.padding = '14px'
        play.style.fontSize = '16px'
      }
    }
  }

  // Initial check after a brief delay to allow rendering
  setTimeout(adjustCardSize, 50)
  // Re-check on resize
  window.addEventListener('resize', adjustCardSize)

  return { card: selectionCard, usernameInput }
}
