import { createTextSprite } from './uiGenerators'

let THREE: any
let SkeletonUtils: any

export const shirtTextures: { male: any, female: any } = { male: null, female: null }
export const loadedTextures = new Map<string, any>()
export const charFaces = [
    'full_face_default.png',
    'full_face_angry.png',
    'full_face_content.png',
    'full_face_crazy.png',
    'full_face_happy.png'
]
export let baseCharModel: any = null
export let baseAnimations: any[] = []
export let dragHealthMat: any = null
export let staffTexture: any = null

export function initFactories(_THREE: any, _SkeletonUtils: any) {
    THREE = _THREE
    SkeletonUtils = _SkeletonUtils

    const textureLoader = new THREE.TextureLoader()

    shirtTextures.male = textureLoader.load('/static/shirt_plaid.png')
    shirtTextures.female = textureLoader.load('/static/shirt_pink.png')
    shirtTextures.male.flipY = false
    shirtTextures.male.colorSpace = THREE.SRGBColorSpace
    shirtTextures.female.flipY = false
    shirtTextures.female.colorSpace = THREE.SRGBColorSpace

    charFaces.forEach(face => {
        const tex = textureLoader.load(`/static/${face}`)
        tex.flipY = false
        tex.colorSpace = THREE.SRGBColorSpace
        loadedTextures.set(face, tex)
    })

    staffTexture = textureLoader.load('/static/staff_beginner.png')
    staffTexture.flipY = false
    staffTexture.colorSpace = THREE.SRGBColorSpace
    loadedTextures.set('staff_beginner.png', staffTexture)

    const wonderTex = textureLoader.load('/static/wonder.png')
    wonderTex.flipY = false
    wonderTex.colorSpace = THREE.SRGBColorSpace
    loadedTextures.set('wonder.png', wonderTex)

    dragHealthMat = new THREE.MeshBasicMaterial({ color: 0x00FF00, transparent: true, opacity: 1 })
}

export function loadCharacterModel(loader: any, callback: () => void) {
    loader.load('/static/character3.glb', (gltf: any) => {
        baseCharModel = gltf.scene
        baseAnimations = gltf.animations

        baseCharModel.traverse((child: any) => {
            if (child.isMesh) {
                child.visible = false
                child.frustumCulled = false
            }
        })
        callback()
    })
}

export function createPlayerMesh(isMe: boolean, gender: 'male' | 'female', faceIndex: number = 0): { group: any, mixer: any, actions: any } {
    let group: any
    let mixer: any = null
    let actions: any = {}

    if (baseCharModel) {
        group = SkeletonUtils.clone(baseCharModel)

        const showParts = ['head', 'head_1', 'hands', 'pants', 'shirt', 'shoes']
        group.traverse((child: any) => {
            if (showParts.includes(child.name)) {
                child.visible = true
                child.frustumCulled = false
            }
        })

        mixer = new THREE.AnimationMixer(group)
        if (baseAnimations) {
            baseAnimations.forEach((clip: any) => {
                const action = mixer.clipAction(clip)
                actions[clip.name] = action
            })
        }

        // Play idle_noweapon by default (will be switched to 'idle' when player gets weapon)
        const initialIdle = actions['idle_noweapon'] || actions['Idle'] || actions['idle']
        if (initialIdle) initialIdle.play()

        const faceName = charFaces[faceIndex] || charFaces[0]
        const texture = loadedTextures.get(faceName)
        if (texture) {
            group.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    if (child.name === 'custom_head_mesh' || child.name === 'head' || (child.material.name && child.material.name.includes('full_face'))) {
                        const newMat = child.material.clone()
                        newMat.map = texture
                        newMat.color.setHex(0xffffff)
                        child.material = newMat
                    }
                }
            })
        }

        group.traverse((child: any) => {
            if (child.name === 'hair_short') child.visible = (gender === 'male')
            if (child.name === 'hair_long') child.visible = (gender === 'female')

            if (child.name === 'shirt' && child.material) {
                const newMat = child.material.clone()
                newMat.map = (gender === 'male') ? shirtTextures.male : shirtTextures.female
                child.material = newMat
            }
        })

        group.scale.set(0.5, 0.5, 0.5)

    } else {
        console.warn('Base model not loaded, creating empty group')
        group = new THREE.Group()
    }

    return { group, mixer, actions }
}

export function createWeaponMesh(type: string): any {
    const group = new THREE.Group()

    if (type === 'coin') {
        const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16)
        const coinMat = new THREE.MeshStandardMaterial({ color: 0xFFD700, metalness: 0.8, roughness: 0.2 })
        const coin = new THREE.Mesh(coinGeo, coinMat)
        coin.rotation.x = Math.PI / 2
        group.add(coin)
    } else if (type === 'handgun') {
        const slideGeo = new THREE.BoxGeometry(0.12, 0.15, 0.45)
        const slideMat = new THREE.MeshStandardMaterial({ color: 0x212121 })
        const slide = new THREE.Mesh(slideGeo, slideMat)
        slide.position.y = 0.05
        group.add(slide)

        const barrelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.1)
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, metalness: 0.8, roughness: 0.2 })
        const barrel = new THREE.Mesh(barrelGeo, metalMat)
        barrel.position.set(0, 0.05, 0.25)
        group.add(barrel)

        const gripGeo = new THREE.BoxGeometry(0.1, 0.25, 0.12)
        const gripMat = new THREE.MeshStandardMaterial({ color: 0x3E2723 })
        const grip = new THREE.Mesh(gripGeo, gripMat)
        grip.position.set(0, -0.1, -0.1)
        grip.rotation.x = 0.2
        group.add(grip)

    } else if (type === 'rifle') {
        const bodyGeo = new THREE.BoxGeometry(0.15, 0.2, 1.0)
        const metalMat = new THREE.MeshStandardMaterial({ color: 0x212121 })
        const body = new THREE.Mesh(bodyGeo, metalMat)
        group.add(body)

        const barrelGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.8, 8)
        const barrel = new THREE.Mesh(barrelGeo, metalMat)
        barrel.rotation.x = Math.PI / 2
        barrel.position.set(0, 0.05, 0.7)
        group.add(barrel)

        const stockGeo = new THREE.BoxGeometry(0.15, 0.35, 0.4)
        const woodMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 })
        const stock = new THREE.Mesh(stockGeo, woodMat)
        stock.position.set(0, -0.05, -0.6)
        group.add(stock)

        const scopeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8)
        const scope = new THREE.Mesh(scopeGeo, metalMat)
        scope.rotation.x = Math.PI / 2
        scope.position.set(0, 0.2, 0)
        group.add(scope)

        const gripGeo = new THREE.BoxGeometry(0.12, 0.2, 0.12)
        const grip = new THREE.Mesh(gripGeo, metalMat)
        grip.position.set(0, -0.15, -0.1)
        group.add(grip)
    } else if (type === 'staff_beginner') {
        if (baseCharModel) {
            const staff = baseCharModel.getObjectByName('staff_beginner')
            if (staff) {
                const clonedStaff = SkeletonUtils.clone(staff)
                clonedStaff.traverse((child: any) => {
                    child.visible = true
                    child.frustumCulled = false
                    if (child.isMesh && child.material && staffTexture) {
                        child.material = child.material.clone()
                        child.material.map = staffTexture
                        child.material.transparent = false
                        child.material.opacity = 1.0
                        child.material.needsUpdate = true
                    }
                })

                // Force upright orientation (baseline character parts are often tilted)
                clonedStaff.rotation.set(0, 0, 0)

                // Center the staff to prevent "wobble" during rotation
                const box = new THREE.Box3().setFromObject(clonedStaff);
                const center = new THREE.Vector3();
                box.getCenter(center);
                clonedStaff.position.sub(center);

                group.add(clonedStaff)
            }
        }
    }

    return group
}

export function createPickupMesh(type: string): any {
    const group = new THREE.Group()

    const weapon = createWeaponMesh(type)
    if (type === 'staff_beginner') {
        weapon.scale.set(1.8, 1.8, 1.8) // ~60% of original 3.0
    } else {
        weapon.scale.set(3.0, 3.0, 3.0)
    }
    group.add(weapon)

    // Gold rings and individual arrows removed for cleaner look
    return group
}

export function createGlobalIndicatorMesh(): any {
    const arrowGroup = new THREE.Group()
    arrowGroup.name = 'globalPickupIndicator'

    const arrowColor = 0xff0000
    const arrowMat = new THREE.MeshStandardMaterial({
        color: arrowColor,
        emissive: arrowColor,
        emissiveIntensity: 1.0,
        transparent: true,
        opacity: 0.9
    })

    // 3x larger than previous individual arrows
    const headGeo = new THREE.ConeGeometry(0.9, 1.8, 16)
    const head = new THREE.Mesh(headGeo, arrowMat)
    head.rotation.x = Math.PI
    head.position.y = 8.4 // Lowered 30% (from 12.0)
    arrowGroup.add(head)

    const shaftGeo = new THREE.CylinderGeometry(0.3, 0.3, 2.4, 16)
    const shaft = new THREE.Mesh(shaftGeo, arrowMat)
    shaft.position.y = 10.6 // Lowered to maintain gap (from 14.2)
    arrowGroup.add(shaft)

    return arrowGroup
}

export function createSheepMesh(): any {
    const group = new THREE.Group()
    const woolMat = new THREE.MeshStandardMaterial({ color: 0xffffff })
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x222222 })

    const bodyGeo = new THREE.BoxGeometry(0.7, 0.6, 0.9)
    const body = new THREE.Mesh(bodyGeo, woolMat)
    body.position.y = 0.5
    group.add(body)

    const headGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4)
    const head = new THREE.Mesh(headGeo, skinMat)
    head.position.set(0, 0.7, 0.5)
    group.add(head)

    const earGeo = new THREE.BoxGeometry(0.1, 0.2, 0.05)
    const lEar = new THREE.Mesh(earGeo, skinMat)
    lEar.position.set(-0.2, 0.1, 0)
    lEar.rotation.z = 0.3
    head.add(lEar)

    const rEar = new THREE.Mesh(earGeo, skinMat)
    rEar.position.set(0.2, 0.1, 0)
    rEar.rotation.z = -0.3
    head.add(rEar)

    const eyeGeo = new THREE.BoxGeometry(0.05, 0.1, 0.05)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const lEye = new THREE.Mesh(eyeGeo, eyeMat)
    lEye.position.set(-0.1, 0.1, 0.2)
    head.add(lEye)

    const rEye = new THREE.Mesh(eyeGeo, eyeMat)
    rEye.position.set(0.1, 0.1, 0.2)
    head.add(rEye)

    const legGeo = new THREE.BoxGeometry(0.12, 0.35, 0.12)
    const fl = new THREE.Mesh(legGeo, skinMat)
    fl.position.set(-0.2, 0.175, 0.3)
    group.add(fl)

    const fr = new THREE.Mesh(legGeo, skinMat)
    fr.position.set(0.2, 0.175, 0.3)
    group.add(fr)

    const bl = new THREE.Mesh(legGeo, skinMat)
    bl.position.set(-0.2, 0.175, -0.3)
    group.add(bl)

    const br = new THREE.Mesh(legGeo, skinMat)
    br.position.set(0.2, 0.175, -0.3)
    group.add(br)

    return group
}

export function createShopMesh(textureLoader: any): any {
    const group = new THREE.Group()
    const baseGeo = new THREE.BoxGeometry(4, 3, 3)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x8D6E63 })
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.position.y = 1.5
    group.add(base)
    const roofGeo = new THREE.CylinderGeometry(0, 3, 1, 4)
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x4E342E })
    const roof = new THREE.Mesh(roofGeo, roofMat)
    roof.position.y = 3.5
    roof.rotation.y = Math.PI / 4
    group.add(roof)
    const counterGeo = new THREE.BoxGeometry(3.5, 0.2, 0.5)
    const counterMat = new THREE.MeshStandardMaterial({ color: 0xD7CCC8 })
    const counter = new THREE.Mesh(counterGeo, counterMat)
    counter.position.set(0, 1.2, 1.3)
    group.add(counter)

    const iconTexture = textureLoader.load('/static/icons/adventure-game/inventory-bag.svg')
    iconTexture.colorSpace = THREE.SRGBColorSpace
    const iconGeo = new THREE.PlaneGeometry(1.2, 1.2)
    const iconMat = new THREE.MeshStandardMaterial({ map: iconTexture, transparent: true, alphaTest: 0.5 })
    const icon = new THREE.Mesh(iconGeo, iconMat)
    icon.position.set(0, 2.2, 1.51)
    group.add(icon)

    return group
}

export function createFarmPlotMesh(): any {
    const group = new THREE.Group()
    const dirtGeo = new THREE.PlaneGeometry(3.6, 3.6)
    const dirtMat = new THREE.MeshStandardMaterial({ color: 0x5D4037 })
    const dirt = new THREE.Mesh(dirtGeo, dirtMat)
    dirt.rotation.x = -Math.PI / 2
    dirt.position.y = 0.02
    group.add(dirt)
    const fenceGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8)
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xE0E0E0 });
    const postPositions = [[1.8, 1.8], [1.8, -1.8], [-1.8, 1.8], [-1.8, -1.8]];
    postPositions.forEach((pos: number[]) => {
        const post = new THREE.Mesh(fenceGeo, fenceMat);
        post.position.set(pos[0], 0.2, pos[1]);
        group.add(post);
    });
    const railGeo = new THREE.BoxGeometry(3.7, 0.05, 0.05)
    const rail1 = new THREE.Mesh(railGeo, fenceMat); rail1.position.set(0, 0.3, 1.8); group.add(rail1)
    const rail2 = new THREE.Mesh(railGeo, fenceMat); rail2.position.set(0, 0.3, -1.8); group.add(rail2)
    const railSideGeo = new THREE.BoxGeometry(0.05, 0.05, 3.7)
    const rail3 = new THREE.Mesh(railSideGeo, fenceMat); rail3.position.set(1.8, 0.3, 0); group.add(rail3)
    const rail4 = new THREE.Mesh(railSideGeo, fenceMat); rail4.position.set(-1.8, 0.3, 0); group.add(rail4)
    return group
}

export function createWheatMesh(stage: number = 1): any {
    const group = new THREE.Group()
    const wheatColor = stage === 3 ? 0xFFD54F : 0x8BC34A
    const wheatMat = new THREE.MeshStandardMaterial({ color: wheatColor })
    const height = stage === 1 ? 0.2 : (stage === 2 ? 0.5 : 1.2)
    const stalkGeo = new THREE.CylinderGeometry(0.02, 0.02, height, 4)
    const seedGeo = new THREE.SphereGeometry(0.04, 4, 4)
    const numStalks = stage === 1 ? 8 : (stage === 2 ? 15 : 40)
    const spread = 2.0
    for (let i = 0; i < numStalks; i++) {
        const stalkContainer = new THREE.Group()
        const stalk = new THREE.Mesh(stalkGeo, wheatMat)
        stalk.position.y = height / 2
        stalkContainer.add(stalk)

        if (stage === 3) {
            const seed = new THREE.Mesh(seedGeo, wheatMat)
            seed.position.y = height
            seed.scale.set(1, 1.5, 1)
            stalkContainer.add(seed)
        }

        stalkContainer.position.set((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)
        stalkContainer.rotation.z = (Math.random() - 0.5) * 0.1
        stalkContainer.userData = { stage, phase: Math.random() * Math.PI * 2 }
        group.add(stalkContainer)
    }
    group.userData = { stage }
    return group
}

export function createWaterCanMesh(): any {
    const group = new THREE.Group()
    const mat = new THREE.MeshStandardMaterial({ color: 0x4FC3F7 })
    const bodyGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 8)
    const body = new THREE.Mesh(bodyGeo, mat); body.position.y = 0.2; group.add(body)
    const spoutGeo = new THREE.CylinderGeometry(0.05, 0.02, 0.4, 8)
    const spout = new THREE.Mesh(spoutGeo, mat); spout.position.set(0.3, 0.3, 0); spout.rotation.z = -Math.PI / 4; group.add(spout)
    return group
}

export function createTrowelMesh(): any {
    const group = new THREE.Group()
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x795548 })
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x9E9E9E })
    const handleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8)
    const handle = new THREE.Mesh(handleGeo, handleMat); handle.position.y = 0.15; group.add(handle)
    const bladeGeo = new THREE.BoxGeometry(0.15, 0.3, 0.02)
    const blade = new THREE.Mesh(bladeGeo, bladeMat); blade.position.y = 0.45; blade.rotation.x = 0.2; group.add(blade)
    return group
}

export function createTombstoneMesh(): any {
    const group = new THREE.Group()

    const stoneColor = 0x5c5c5c
    const stoneMat = new THREE.MeshStandardMaterial({ color: stoneColor })

    const stoneGeo = new THREE.BoxGeometry(0.8, 1.2, 0.3)
    const stone = new THREE.Mesh(stoneGeo, stoneMat)
    stone.position.y = 0.6
    group.add(stone)

    const topGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16, 1, false, 0, Math.PI)
    const top = new THREE.Mesh(topGeo, stoneMat)
    top.rotation.z = Math.PI / 2
    top.rotation.y = Math.PI / 2
    top.position.y = 1.2
    group.add(top)

    const crossColor = 0x3a3a3a
    const crossMat = new THREE.MeshStandardMaterial({ color: crossColor })

    const crossVGeo = new THREE.BoxGeometry(0.1, 0.5, 0.05)
    const crossV = new THREE.Mesh(crossVGeo, crossMat)
    crossV.position.set(0, 0.7, 0.16)
    group.add(crossV)

    const crossHGeo = new THREE.BoxGeometry(0.3, 0.1, 0.05)
    const crossH = new THREE.Mesh(crossHGeo, crossMat)
    crossH.position.set(0, 0.8, 0.16)
    group.add(crossH)

    const crossVBack = crossV.clone()
    crossVBack.position.set(0, 0.7, -0.16)
    group.add(crossVBack)

    const crossHBack = crossH.clone()
    crossHBack.position.set(0, 0.8, -0.16)
    group.add(crossHBack)

    return group
}

export function createDragonMesh(): { group: any, wings: any[], labelGroup: any, healthBar: any } {
    const group = new THREE.Group()

    const scaleColor = 0x2E7D32
    const bellyColor = 0x81C784
    const wingColor = 0x1B5E20

    const bodyGeo = new THREE.BoxGeometry(2, 2, 4)
    const bodyMat = new THREE.MeshStandardMaterial({ color: scaleColor, transparent: true, opacity: 1 })
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.position.y = 2
    group.add(body)

    const headGeo = new THREE.BoxGeometry(1.5, 1.5, 2)
    const headMat = new THREE.MeshStandardMaterial({ color: scaleColor, transparent: true, opacity: 1 })
    const head = new THREE.Mesh(headGeo, headMat)
    head.position.set(0, 3, 3)
    group.add(head)

    const snoutGeo = new THREE.BoxGeometry(1.5, 0.8, 1.5)
    const snoutMat = new THREE.MeshStandardMaterial({ color: bellyColor, transparent: true, opacity: 1 })
    const snout = new THREE.Mesh(snoutGeo, snoutMat)
    snout.position.set(0, -0.4, 1.75)
    head.add(snout)

    const eyeGeo = new THREE.BoxGeometry(0.3, 0.3, 0.1)
    const eyeMat = new THREE.MeshStandardMaterial({
        color: 0xFF0000,
        emissive: 0xFF0000,
        emissiveIntensity: 2,
        transparent: true,
        opacity: 1,
        name: 'eyeMat'
    })

    const leftEye = new THREE.Mesh(eyeGeo, eyeMat)
    leftEye.position.set(-0.5, 0.3, 1)
    head.add(leftEye)

    const rightEye = new THREE.Mesh(eyeGeo, eyeMat)
    rightEye.position.set(0.5, 0.3, 1)
    head.add(rightEye)

    const wingGeo = new THREE.BoxGeometry(4, 0.2, 2)
    const wingMat = new THREE.MeshStandardMaterial({ color: wingColor, transparent: true, opacity: 1 })

    const leftWingPivot = new THREE.Group()
    leftWingPivot.position.set(-1, 3, 0)
    group.add(leftWingPivot)

    const leftWing = new THREE.Mesh(wingGeo, wingMat)
    leftWing.position.set(-2, 0, 0)
    leftWingPivot.add(leftWing)

    const rightWingPivot = new THREE.Group()
    rightWingPivot.position.set(1, 3, 0)
    group.add(rightWingPivot)

    const rightWing = new THREE.Mesh(wingGeo, wingMat)
    rightWing.position.set(2, 0, 0)
    rightWingPivot.add(rightWing)

    const tailGeo = new THREE.BoxGeometry(1, 1, 4)
    const tailMat = new THREE.MeshStandardMaterial({ color: scaleColor, transparent: true, opacity: 1 })
    const tail = new THREE.Mesh(tailGeo, tailMat)
    tail.position.set(0, 2, -4)
    group.add(tail)

    const labelGroup = new THREE.Group()

    const outlineGeo = new THREE.PlaneGeometry(1, 1)
    const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 })
    const outline = new THREE.Mesh(outlineGeo, outlineMat)
    outline.scale.set(4.2, 0.5, 1)
    outline.position.set(0, 0, -0.01)
    labelGroup.add(outline)

    const barGeo = new THREE.PlaneGeometry(1, 1)
    barGeo.translate(-0.5, 0, 0)
    const healthBarMat = dragHealthMat.clone()
    healthBarMat.name = 'healthBarMat'
    const healthBar = new THREE.Mesh(barGeo, healthBarMat)
    healthBar.position.set(2, 0, 0.01)
    healthBar.scale.set(4, 0.3, 1)
    labelGroup.add(healthBar)

    const nameLabel = createTextSprite(THREE, 'Dragon', false)
    nameLabel.position.set(0, 0.8, 0)
    nameLabel.scale.set(4, 1.0, 1)
    labelGroup.add(nameLabel)

    return { group, wings: [leftWingPivot, rightWingPivot], labelGroup, healthBar }
}

export function createChargingStarMesh(): any {
    const group = new THREE.Group()
    const count = 12
    const color = 0xFF0000
    const mat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 2.0,
        transparent: true,
        opacity: 0.8
    })

    for (let i = 0; i < count; i++) {
        const coneGeo = new THREE.ConeGeometry(0.1, 1.0, 4)
        const cone = new THREE.Mesh(coneGeo, mat)
        const phi = Math.acos(-1 + (2 * i) / count)
        const theta = Math.sqrt(count * Math.PI) * phi
        cone.position.setFromSphericalCoords(0.5, phi, theta)
        cone.lookAt(new THREE.Vector3(0, 0, 0))
        cone.rotateX(Math.PI / 2)
        group.add(cone)
    }

    return group
}

export function createControlPanelMesh(): any {
    const group = new THREE.Group()

    const stoneMat = new THREE.MeshStandardMaterial({
        color: 0x607d8b,
        roughness: 0.9,
        metalness: 0.1
    })

    const pillarGeo = new THREE.CylinderGeometry(0.4, 0.6, 2.5, 4)
    const pillar = new THREE.Mesh(pillarGeo, stoneMat)
    pillar.position.y = 1.25
    pillar.rotation.y = Math.PI / 4
    group.add(pillar)

    const topGeo = new THREE.CylinderGeometry(0, 0.4, 0.5, 4)
    const top = new THREE.Mesh(topGeo, stoneMat)
    top.position.y = 2.5 + 0.25
    top.rotation.y = Math.PI / 4
    group.add(top)

    const runeColor = 0x00e5ff
    const runeMat = new THREE.MeshStandardMaterial({
        color: runeColor,
        emissive: runeColor,
        emissiveIntensity: 2
    })

    for (let i = 0; i < 4; i++) {
        const runeGeo = new THREE.BoxGeometry(0.05, 0.5, 0.05)
        const rune = new THREE.Mesh(runeGeo, runeMat)
        const angle = (i * Math.PI) / 2
        const radius = 0.45
        rune.position.set(Math.cos(angle) * radius, 1.5, Math.sin(angle) * radius)
        group.add(rune)
    }

    const cylinderGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8)
    const cylinderMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1 })
    for (let i = 0; i < 4; i++) {
        const cyl = new THREE.Mesh(cylinderGeo, cylinderMat)
        cyl.name = 'floatingCylinder'
        cyl.userData = { phase: i * (Math.PI / 2), orbitRadius: 1.2 + Math.random() * 0.3 }
        group.add(cyl)
    }

    return group
}

export function createBulletMesh(isDragon: boolean): any {
    const radius = isDragon ? 0.5 : 0.2
    const color = isDragon ? 0xFF5722 : 0xFFEB3B
    const geo = new THREE.SphereGeometry(radius, 8, 8)
    const mat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 1.0
    })
    const mesh = new THREE.Mesh(geo, mat)

    if (isDragon) {
        const fieldGroup = new THREE.Group()
        fieldGroup.name = 'electricField'

        const fieldGeo = new THREE.IcosahedronGeometry(1.0, 0)
        const fieldMat = new THREE.MeshStandardMaterial({
            color: 0x00FFFF,
            emissive: 0x00FFFF,
            emissiveIntensity: 2.0,
            wireframe: true,
            transparent: true,
            opacity: 0.5
        })
        const field = new THREE.Mesh(fieldGeo, fieldMat)
        fieldGroup.add(field)

        const crossGeo = new THREE.BoxGeometry(1.8, 0.05, 0.05)
        const cross1 = new THREE.Mesh(crossGeo, fieldMat)
        fieldGroup.add(cross1)
        const cross2 = new THREE.Mesh(crossGeo, fieldMat)
        cross2.rotation.y = Math.PI / 2
        fieldGroup.add(cross2)

        mesh.add(fieldGroup)
    }

    mesh.position.y = 1.5
    return mesh
}

export function spawnFragments(x: number, y: number, z: number, color: number): any[] {
    const count = 8
    const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1)
    const mat = new THREE.MeshStandardMaterial({
        color: color,
        emissive: color,
        emissiveIntensity: 0.5
    })

    const newFragments = []

    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(x, y, z)

        newFragments.push({
            mesh,
            velocity: {
                x: (Math.random() - 0.5) * 0.2,
                y: Math.random() * 0.2 + 0.1,
                z: (Math.random() - 0.5) * 0.2
            },
            life: 1.0,
            maxLife: 1000 + Math.random() * 500
        })
    }
    return newFragments
}

export function createFishingPoleMesh(): any {
    const group = new THREE.Group()

    // Rod - Centered at grip (approximately bottom)
    const rodGeo = new THREE.CylinderGeometry(0.03, 0.05, 3.0, 8)
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x8D6E63 })
    const rod = new THREE.Mesh(rodGeo, rodMat)

    // We want the handle (bottom of cylinder) to be at the Hand Bone (origin of group).
    // Cylinder is 3.0 high, centered at 0. So bottom is at -1.5.
    // Move up by 1.5 to put bottom at 0.
    rod.position.set(0, 1.5, 0)

    // Rod sticks straight up (Y-axis) from hand. 
    // We will control angle in the attachment logic (index.tsx side).

    group.add(rod)

    // Tip position calculation:
    // Rod is vertical, length 3.0. Top is at (0, 3.0, 0).
    const tipY = 3.0
    const tipZ = 0

    // Line - thin cylinder hanging down from tip
    const lineLength = 1.2
    const lineGeo = new THREE.CylinderGeometry(0.005, 0.005, lineLength, 4)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.6 })
    const line = new THREE.Mesh(lineGeo, lineMat)

    // Position line so its top is at the tip. 
    // Line center y = tipY - length/2
    line.position.set(0, tipY - lineLength / 2, tipZ)
    group.add(line)

    // Bobber - red ball at end of line
    const bobberGeo = new THREE.SphereGeometry(0.1, 8, 8)
    const bobberMat = new THREE.MeshStandardMaterial({ color: 0xFF0000 })
    const bobber = new THREE.Mesh(bobberGeo, bobberMat)
    bobber.position.set(0, tipY - lineLength, tipZ)
    group.add(bobber)

    return group
}

export function createFishMesh(): any {
    const group = new THREE.Group()
    const color = 0x4FC3F7
    const mat = new THREE.MeshStandardMaterial({ color })

    // Body
    const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.6, 4, 8)
    const body = new THREE.Mesh(bodyGeo, mat)
    body.rotation.z = Math.PI / 2
    group.add(body)

    // Tail
    const tailGeo = new THREE.ConeGeometry(0.2, 0.3, 4)
    const tail = new THREE.Mesh(tailGeo, mat)
    tail.rotation.z = -Math.PI / 2
    tail.position.x = -0.5
    group.add(tail)

    return group
}

export function createPondIndicatorMesh(): any {
    const group = new THREE.Group()

    // Water Surface (Always visible)
    const waterGeo = new THREE.CircleGeometry(3.2, 32)
    const waterMat = new THREE.MeshBasicMaterial({
        color: 0x0288D1, // Deep blue
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
    })
    const water = new THREE.Mesh(waterGeo, waterMat)
    water.rotation.x = -Math.PI / 2
    group.add(water)

    // Glowing Ring (Base Ring)
    const ringGeo = new THREE.RingGeometry(3.0, 3.5, 32)
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00B0FF,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.name = 'baseRing'
    group.add(ring)

    // Ripple Ring (For animation)
    const rippleGeo = new THREE.RingGeometry(0.1, 0.3, 32)
    const rippleMat = new THREE.MeshBasicMaterial({
        color: 0xFFFFFF,
        transparent: true,
        opacity: 0.0, // Start invisible
        side: THREE.DoubleSide
    })
    const ripple = new THREE.Mesh(rippleGeo, rippleMat)
    ripple.rotation.x = -Math.PI / 2
    ripple.position.y = 0.05 // Slightly above water
    ripple.name = 'ripple'
    group.add(ripple)

    return group
}
