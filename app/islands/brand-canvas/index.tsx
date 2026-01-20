import { useEffect, useRef } from 'hono/jsx'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { initFactories, loadCharacterModel, createPlayerMesh } from '../game-canvas/meshFactories'

// Boy: Face 4 is typically the happy/crazy one, need to check faces. 
// Based on file list: full_face_happy.png is index 4 if 0-indexed? 
// charFaces = [default, angry, content, crazy, happy] -> 0, 1, 2, 3, 4.
// So 4 is happy.

export default function BrandCanvas() {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!containerRef.current) return

        // 1. Setup Scene
        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0x87CEEB) // Fallback

        // Load Background Texture
        const textureLoader = new THREE.TextureLoader()
        let bgMesh: THREE.Mesh | null = null // Declare bgMesh here to be accessible by handlePointerMove
        textureLoader.load('/static/brand_sky_clean.png', (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace
            texture.wrapS = THREE.RepeatWrapping // Enable texture repeating for horizontal offset
            texture.wrapT = THREE.RepeatWrapping
            const aspect = texture.image.width / texture.image.height
            // Scale up background to cover view
            const bgGeo = new THREE.PlaneGeometry(25 * aspect, 25)
            const bgMat = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false })
            bgMesh = new THREE.Mesh(bgGeo, bgMat) // Assign to the declared variable
            bgMesh.position.set(0, 2, -10)
            scene.add(bgMesh)
        })

        // 2. Camera: Moved back to zoom out
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100)
        camera.position.set(0, 0, 8.5)
        camera.lookAt(0, 0, 0)

        // 3. Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setSize(window.innerWidth, window.innerHeight)
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
        renderer.toneMappingExposure = 1.4
        containerRef.current.appendChild(renderer.domElement)

        // 4. Lighting (Matched to Main Game but reduced intensity)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
        scene.add(ambientLight)
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x3a5a40, 0.9)
        hemiLight.position.set(0, 50, 0)
        scene.add(hemiLight)
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8)
        dirLight1.position.set(10, 20, 10)
        scene.add(dirLight1)
        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4)
        dirLight2.position.set(-10, 20, -10)
        scene.add(dirLight2)

        // 5. Ground REMOVED as requested

        // Clouds (Simple spheres to mimic the style if needed, but background has them)
        // We'll skip extra 3D clouds for now to keep it clean as requested.

        // 6. Characters Group
        const characterGroup = new THREE.Group()
        scene.add(characterGroup)

        const clock = new THREE.Clock()
        const mixers: any[] = []

        // Init factories and load model
        initFactories(THREE, SkeletonUtils)

        loadCharacterModel(new GLTFLoader(), () => {
            // GIRL (Left)
            const girl = createPlayerMesh(false, 'female', 0)
            // Reduce scale slightly, move further left. Moved UP to -2.0 -> Now down to -2.5
            girl.group.position.set(-1.3, -2.5, 0)
            girl.group.rotation.y = 0.3
            girl.group.scale.set(0.78, 0.78, 0.78)
            characterGroup.add(girl.group)

            // Re-enable animation (createPlayerMesh plays idle_noweapon by default)
            if (girl.mixer) mixers.push(girl.mixer)

            // BOY (Right)
            const boy = createPlayerMesh(false, 'male', 2)
            // Reduce scale, move further right. Moved UP to -2.0 -> Now down to -2.5
            boy.group.position.set(1.3, -2.5, 0)
            boy.group.rotation.y = -0.3
            // Reset Z rotation (no tipping)
            boy.group.rotation.z = 0
            boy.group.scale.set(0.78, 0.78, 0.78)
            characterGroup.add(boy.group)

            // Re-enable animation
            if (boy.mixer) mixers.push(boy.mixer)
        })


        // Animation Loop
        const animate = () => {
            requestAnimationFrame(animate)
            const dt = clock.getDelta()
            mixers.forEach(m => m.update(dt))
            renderer.render(scene, camera)
        }
        animate()

        // Interaction: Swipe/Drag to rotate characters and pan skybox
        let isDragging = false
        let previousX = 0

        const handlePointerDown = (e: PointerEvent) => {
            isDragging = true
            previousX = e.clientX
        }

        const handlePointerMove = (e: PointerEvent) => {
            if (!isDragging) return
            const deltaX = e.clientX - previousX
            characterGroup.rotation.y += deltaX * 0.005

            // Rotate bgMesh (pan texture)
            if (bgMesh && bgMesh.material instanceof THREE.MeshBasicMaterial && bgMesh.material.map) {
                // Adjust for desired skybox "rotation" speed.
                // Move texture offset to simulate rotation (wrapping must be enabled)
                bgMesh.material.map.offset.x -= deltaX * 0.0005
            }
            previousX = e.clientX
        }

        const handlePointerUp = () => {
            isDragging = false
        }

        const domEl = containerRef.current
        domEl.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', handlePointerUp)

        // Handle Resize
        const handleResize = () => {
            if (!containerRef.current) return
            camera.aspect = window.innerWidth / window.innerHeight
            camera.updateProjectionMatrix()
            renderer.setSize(window.innerWidth, window.innerHeight)
        }
        window.addEventListener('resize', handleResize)

        return () => {
            window.removeEventListener('resize', handleResize)
            domEl.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', handlePointerUp)
            if (containerRef.current) containerRef.current.innerHTML = ''
        }

    }, [])

    return (
        <div ref={containerRef} style={{ width: '100vw', height: '100vh', position: 'absolute', top: 0, left: 0, zIndex: 0 }} />
    )
}

