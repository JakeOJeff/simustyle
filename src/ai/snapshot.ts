// Offscreen renders of a candidate build for the visual critique (see critique.ts). A separate WebGLRenderer
// draws the scene as the export sees it (createThreeScene: no gizmos, grid or selection helpers), so the live
// viewport is never touched.
import * as THREE from "three";
import { createThreeScene } from "../export/gltf";
import { SurfaceTextureStore } from "../materials/textures";
import type { Scene } from "../scene/types";
import type { CritiqueImages } from "./critique";
import { frameThreeQuarter, frameTopDown } from "./framing";

export const SNAPSHOT_SIZE = 512;
const JPEG_QUALITY = 0.7;
/** Texture loading may not hold up a critique for longer than this. */
const TEXTURE_WAIT_MS = 3_000;

/**
 * Adds the fill, key light and dark floor the editor viewport and HTML export put around every scene, and turns
 * on shadows. Returns the bounds of the scene's own meshes (before the floor was added).
 */
export function stageForPreview(world: THREE.Scene, scene: Scene): THREE.Box3 {
  world.add(new THREE.HemisphereLight(0xe8efff, 0x44404b, scene.settings.ambientLightIntensity + 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 9, 6);
  key.castShadow = true;
  world.add(key);
  world.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  const bounds = new THREE.Box3();
  world.traverse((object) => { if (object instanceof THREE.Mesh) bounds.expandByObject(object); });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x242832, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  world.add(ground);
  return bounds;
}

function disposeMeshes(world: THREE.Object3D): void {
  world.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
}

const plainBounds = (bounds: THREE.Box3) => bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() };

/** The 3/4 and top-down renders of a scene as 512 px JPEG data URLs. */
export async function renderCritiqueImages(scene: Scene): Promise<CritiqueImages> {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const textures = new SurfaceTextureStore();
  let world = createThreeScene(scene, textures);
  try {
    // An unloaded texture renders black, so if any fails or is slow, draw every surface in its plain color instead.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loaded = await Promise.race([textures.ready().then(() => true, () => false), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), TEXTURE_WAIT_MS); })]);
    clearTimeout(timer);
    if (!loaded) {
      disposeMeshes(world);
      world = createThreeScene(scene);
    }
    renderer.setPixelRatio(1);
    renderer.setSize(SNAPSHOT_SIZE, SNAPSHOT_SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const bounds = plainBounds(stageForPreview(world, scene));

    const perspective = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    const view = frameThreeQuarter(bounds, perspective.fov, perspective.aspect);
    perspective.position.set(...view.position);
    perspective.lookAt(...view.target);
    perspective.updateMatrixWorld();
    renderer.render(world, perspective);
    const threeQuarter = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

    const top = frameTopDown(bounds, 1);
    const ortho = new THREE.OrthographicCamera(-top.halfWidth, top.halfWidth, top.halfHeight, -top.halfHeight, 0.05, top.height);
    ortho.position.set(...top.center);
    // Looking down with -z up the image puts the scene's front (+z) at the bottom.
    ortho.up.set(0, 0, -1);
    ortho.lookAt(top.center[0], top.center[1] - 1, top.center[2]);
    ortho.updateMatrixWorld();
    renderer.render(world, ortho);
    const topDown = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { threeQuarter, topDown };
  } finally {
    disposeMeshes(world);
    textures.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
