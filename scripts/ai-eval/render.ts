// Browser entry for `npm run ai:eval` screenshots: draws one scene with the editor's own primitives
// and materials (createThreeScene) from a fixed 3/4 angle, then sets window.__rendered.
import * as THREE from "three";
import { createThreeScene } from "../../src/export/gltf";
import type { Scene } from "../../src/scene/types";
import { frameThreeQuarter } from "./report";

declare global {
  interface Window { __scene: Scene; __rendered?: boolean; __renderError?: string }
}

try {
  const scene = window.__scene;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  const world = createThreeScene(scene);
  // The same fill, key light and floor the editor viewport and HTML export add around every scene.
  world.add(new THREE.HemisphereLight(0xe8efff, 0x44404b, scene.settings.ambientLightIntensity + 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(5, 9, 6);
  key.castShadow = true;
  world.add(key);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x242832, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  world.traverse((object) => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });

  const bounds = new THREE.Box3();
  world.traverse((object) => { if (object instanceof THREE.Mesh) bounds.expandByObject(object); });
  world.add(ground);
  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.05, 2000);
  const view = frameThreeQuarter(bounds.isEmpty() ? null : { min: bounds.min.toArray(), max: bounds.max.toArray() }, camera.fov, camera.aspect);
  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.updateMatrixWorld();

  let frames = 0;
  const draw = () => {
    renderer.render(world, camera);
    if (++frames < 3) requestAnimationFrame(draw);
    else window.__rendered = true;
  };
  requestAnimationFrame(draw);
} catch (error) {
  window.__renderError = error instanceof Error ? error.message : String(error);
}
