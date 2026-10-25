// Offscreen renders of a candidate build for the visual inspection (see critique.ts and inspection.ts). A separate
// WebGLRenderer draws the scene as the export sees it (createThreeScene: no gizmos, grid or selection helpers), so
// the live viewport is never touched.
import * as THREE from "three";
import { createThreeScene } from "../export/gltf";
import { SurfaceTextureStore } from "../materials/textures";
import type { Scene } from "../scene/types";
import type { RenderedView } from "./critique";
import { CORNER_DIRECTIONS, frameFace, frameThreeQuarter, isFace, type ViewName } from "./framing";
import { isolateScene } from "./inspection";

export const SNAPSHOT_SIZE = 640;
const JPEG_QUALITY = 0.8;
/** Texture loading may not hold up an inspection for longer than this. */
const TEXTURE_WAIT_MS = 3_000;
/** Plain backdrop for chunks rendered alone. */
const CHUNK_BACKGROUND = 0x8a909c;

/**
 * Adds the fill, key light and dark floor the editor viewport and HTML export put around every scene, and turns
 * on shadows. Returns the bounds of the scene's own meshes (before the floor was added). Without a floor (a chunk
 * seen from below), the plain backdrop replaces the scene's background.
 */
export function stageForPreview(world: THREE.Scene, scene: Scene, floor = true): THREE.Box3 {
  world.add(new THREE.HemisphereLight(0xe8efff, 0x44404b, scene.settings.ambientLightIntensity + 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 9, 6);
  key.castShadow = true;
  world.add(key);
  world.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
  const bounds = new THREE.Box3();
  world.traverse((object) => { if (object instanceof THREE.Mesh) bounds.expandByObject(object); });
  if (!floor) {
    world.background = new THREE.Color(CHUNK_BACKGROUND);
    return bounds;
  }
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

/** A camera for one view of the bounds. */
export function viewCamera(view: ViewName, bounds: { min: number[]; max: number[] } | null, aspect: number): THREE.Camera {
  if (isFace(view)) {
    const face = frameFace(bounds, view, aspect);
    const camera = new THREE.OrthographicCamera(-face.halfWidth, face.halfWidth, face.halfHeight, -face.halfHeight, face.near, face.far);
    camera.position.set(...face.position);
    camera.up.set(...face.up);
    camera.lookAt(...face.target);
    camera.updateMatrixWorld();
    return camera;
  }
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.05, 2000);
  const framed = frameThreeQuarter(bounds, camera.fov, aspect, CORNER_DIRECTIONS[view]);
  camera.position.set(...framed.position);
  camera.lookAt(...framed.target);
  camera.updateMatrixWorld();
  return camera;
}

/**
 * Renders views of a scene as SNAPSHOT_SIZE px JPEG data URLs: of the whole scene on its floor when `ids` is null,
 * or of the subtrees of `ids` alone on a plain backdrop, lit from each camera as well, so every face is readable.
 */
export async function renderViews(scene: Scene, ids: readonly string[] | null, views: readonly ViewName[]): Promise<RenderedView[]> {
  const subject = ids ? isolateScene(scene, ids) : scene;
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const textures = new SurfaceTextureStore();
  let world = createThreeScene(subject, textures);
  try {
    // An unloaded texture renders black, so if any fails or is slow, draw every surface in its plain color instead.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loaded = await Promise.race([textures.ready().then(() => true, () => false), new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), TEXTURE_WAIT_MS); })]);
    clearTimeout(timer);
    if (!loaded) {
      disposeMeshes(world);
      world = createThreeScene(subject);
    }
    renderer.setPixelRatio(1);
    renderer.setSize(SNAPSHOT_SIZE, SNAPSHOT_SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const bounds = plainBounds(stageForPreview(world, subject, !ids));
    // A light that follows the camera, so back and bottom faces are not left in shadow.
    const headlight = new THREE.DirectionalLight(0xffffff, ids ? 1.4 : 0.6);
    world.add(headlight, headlight.target);
    const rendered: RenderedView[] = [];
    for (const view of views) {
      const camera = viewCamera(view, bounds, 1);
      headlight.position.copy(camera.position);
      headlight.target.position.copy(bounds ? new THREE.Vector3(...bounds.min).add(new THREE.Vector3(...bounds.max)).multiplyScalar(0.5) : new THREE.Vector3());
      headlight.target.updateMatrixWorld();
      renderer.render(world, camera);
      rendered.push({ view, url: canvas.toDataURL("image/jpeg", JPEG_QUALITY) });
    }
    return rendered;
  } finally {
    disposeMeshes(world);
    textures.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
