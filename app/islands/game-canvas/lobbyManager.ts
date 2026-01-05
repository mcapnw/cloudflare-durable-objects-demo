import * as Types from './types'

export interface LobbyState {
    controlPanel: any;
    shop: any;
    farmPlotGroups: any[];
    controlPanelLabel: any;
    shopLabel: any;
    farmLabel: any;
    realmStructure: any;
    realmLabel: any;
}

export function setupLobby(
    scene: any,
    THREE: any,
    textureLoader: any,
    MeshFactories: any,
    UIGenerators: any
): LobbyState {
    const controlPanel = MeshFactories.createControlPanelMesh()
    controlPanel.position.set(-22, 0, 22)
    controlPanel.scale.set(1.5, 1.5, 1.5)
    scene.add(controlPanel)

    const shop = MeshFactories.createShopMesh(textureLoader)
    shop.position.set(-18, 0, -18)
    shop.rotation.y = Math.PI / 4
    scene.add(shop)

    const farmPlotGroups: any[] = []
    const farmStartX = 11, farmStartZ = -5
    for (let i = 0; i < 9; i++) {
        const x = farmStartX + (i % 3) * 5.0
        const z = farmStartZ + Math.floor(i / 3) * 5.0
        const plot = MeshFactories.createFarmPlotMesh()
        plot.position.set(x, 0, z)
        scene.add(plot)
        farmPlotGroups.push(plot)
    }

    const controlPanelLabel = UIGenerators.createTextSprite(THREE, 'Obelisk', false, '#000000', 'transparent')
    controlPanelLabel.position.set(-22, 5.5, 22)
    scene.add(controlPanelLabel)

    const shopLabel = UIGenerators.createTextSprite(THREE, 'Store', false, '#000000', 'transparent')
    shopLabel.position.set(-18, 6, -18)
    scene.add(shopLabel)

    const farmLabel = UIGenerators.createTextSprite(THREE, 'Farm', false, '#000000', 'transparent')
    farmLabel.position.set(16, 5, 0)
    scene.add(farmLabel)

    // Realm Structure
    const realmGeo = new THREE.CylinderGeometry(3, 3, 0.5, 32)
    const realmMat = new THREE.MeshStandardMaterial({ color: 0x9C27B0, emissive: 0x4A148C, emissiveIntensity: 0.5, transparent: true, opacity: 0.8 })
    const realmStructure = new THREE.Mesh(realmGeo, realmMat)
    realmStructure.position.set(20, 0.25, 20)
    scene.add(realmStructure)

    // Realm Portal Effect
    const portalGeo = new THREE.TorusGeometry(2, 0.2, 16, 100)
    const portalMat = new THREE.MeshStandardMaterial({ color: 0xE1BEE7, emissive: 0xFFFFFF, emissiveIntensity: 1 })
    const portalRing = new THREE.Mesh(portalGeo, portalMat)
    portalRing.rotation.x = Math.PI / 2
    portalRing.position.y = 1
    realmStructure.add(portalRing)
    realmStructure.userData.portalRing = portalRing

    const realmLabel = UIGenerators.createTextSprite(THREE, 'Realm', false, '#000000', 'transparent')
    realmLabel.position.set(20, 5, 20)
    realmLabel.scale.set(2, 2, 2)
    scene.add(realmLabel)

    return {
        controlPanel,
        shop,
        farmPlotGroups,
        controlPanelLabel,
        shopLabel,
        farmLabel,
        realmStructure,
        realmLabel
    }
}

export function cleanupLobby(scene: any, state: LobbyState | null) {
    if (!state) return
    scene.remove(state.controlPanel)
    scene.remove(state.shop)
    state.farmPlotGroups.forEach(plot => scene.remove(plot))
    scene.remove(state.controlPanelLabel)
    scene.remove(state.shopLabel)
    scene.remove(state.farmLabel)
    scene.remove(state.realmStructure)
    scene.remove(state.realmLabel)
}
