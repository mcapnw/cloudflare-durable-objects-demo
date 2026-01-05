export interface RealmState {
    // Future realm-specific objects could go here
}

export function setupRealm(scene: any, THREE: any): RealmState {
    // Match lobby sky color per user request
    scene.background = new THREE.Color(0x87ceeb)

    return {}
}

export function cleanupRealm(scene: any, THREE: any) {
    // Ensure background remains lobby color
    scene.background = new THREE.Color(0x87ceeb)
}
