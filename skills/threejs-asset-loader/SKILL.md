---
name: threejs-asset-loader
description: Manages Three.js .glb and .gltf asset loading, pathing, and model optimization. Use when the user wants to add, load, or switch 3D models in the scene.
---

# Three.js Asset Loading Skill

When working with 3D assets in this project:

1. **Asset Location**: All binary assets (.glb, .gltf) are stored in `/public/static/`. Do not try to read their content; they are ignored by the indexer.
2. **Loading Pattern**: Always use the `GLTFLoader` with the `DRACOLoader` extension if available.
3. **Reference Method**: Refer to assets by their path string. If an asset is missing, ask the user to confirm the filename in the `/public` directory.
4. **Common Models**:
   - `character2.glb`: The main player character.

## Example Code Snippet:
```javascript
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

const loader = new GLTFLoader();
loader.load('/static/character2.glb', (gltf) => {
    scene.add(gltf.scene);
});