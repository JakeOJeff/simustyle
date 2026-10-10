import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Scene, Entity, Vec3 } from "../scene/types";
import { AnimatorRuntime } from "../runtime/animator";
import { ScriptRuntime, scriptOps } from "../runtime/scripts";
import { applyOps } from "../scene/applyOps";
import { keyName } from "../lang/vocabulary";

type PlayController = { state: "playing" | "paused" | "stopped"; play(scene: Scene): Promise<string[]>; advance(scene: Scene, elapsed: number): Scene; stop(): Scene | null; setScriptParameter(entityId: string, name: string, value: unknown): boolean; pressKey(key: string): void; releaseKey(key: string): void; readonly initialScene: Scene | null };

function record(entity: Entity, key: string): Record<string, unknown> {
  return entity.components[key] ?? {};
}

function vector(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value as Vec3 : fallback;
}

function meshFor(entity: Entity): THREE.Mesh | null {
  const mesh = record(entity, "Mesh");
  if (!entity.components.Mesh) return null;
  const radius = typeof mesh.radius === "number" ? mesh.radius : 0.5;
  const height = typeof mesh.height === "number" ? mesh.height : 1;
  let geometry: THREE.BufferGeometry;
  switch (mesh.shape) {
    case "sphere": geometry = new THREE.SphereGeometry(radius, 24, 16); break;
    case "cylinder": geometry = new THREE.CylinderGeometry(radius, radius, height, 24); break;
    case "capsule": geometry = new THREE.CapsuleGeometry(radius, Math.max(0.01, height - 2 * radius), 4, 12); break;
    case "plane": geometry = new THREE.PlaneGeometry(radius * 2, radius * 2); break;
    case "cone": geometry = new THREE.ConeGeometry(radius, height, 24); break;
    default: geometry = new THREE.BoxGeometry(radius * 2, height, radius * 2);
  }
  const material = record(entity, "Material");
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: typeof material.color === "string" ? material.color : "#ffffff",
    metalness: typeof material.metalness === "number" ? material.metalness : 0,
    roughness: typeof material.roughness === "number" ? material.roughness : 0.6,
    emissive: typeof material.emissive === "string" ? material.emissive : "#000000",
    emissiveIntensity: typeof material.emissiveIntensity === "number" ? material.emissiveIntensity : 0,
    transparent: typeof material.opacity === "number" && material.opacity < 1,
    opacity: typeof material.opacity === "number" ? material.opacity : 1
  }));
}

function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Entry called by the inlined HTML bundle. It uses the editor's ScriptRuntime,
 * AnimatorRuntime, and SimulationController modules directly. */
export async function startStandalone(sceneInput: Scene): Promise<void> {
  let scene = structuredClone(sceneInput);
  const hostElement = document.querySelector<HTMLElement>("#scene");
  const statusElement = document.querySelector<HTMLElement>("#status");
  const playButtonElement = document.querySelector<HTMLButtonElement>("#play");
  const stopButtonElement = document.querySelector<HTMLButtonElement>("#stop");
  const controlsElement = document.querySelector<HTMLElement>("#controls");
  if (!hostElement || !statusElement || !playButtonElement || !stopButtonElement || !controlsElement) throw new Error("Standalone scene host is incomplete.");
  const host = hostElement;
  const status = statusElement;
  const playButton = playButtonElement;
  const stopButton = stopButtonElement;
  const controlsHost = controlsElement;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.domElement.className = "scene-canvas";
  host.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  world.background = new THREE.Color(scene.settings.background);
  const cameraEntity = scene.entities.find((entity) => record(entity, "Camera").isActive === true);
  const cameraTransform = record(cameraEntity ?? ({ components: {} } as Entity), "Transform");
  const camera = new THREE.PerspectiveCamera(
    typeof record(cameraEntity ?? ({ components: {} } as Entity), "Camera").fov === "number" ? record(cameraEntity ?? ({ components: {} } as Entity), "Camera").fov as number : 50,
    1, 0.1, 1000
  );
  const initialCameraPosition = vector(cameraTransform.position, [7, 6, 9]);
  camera.position.set(...initialCameraPosition);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.target.set(0, 0.8, 0);
  world.add(new THREE.HemisphereLight(0xe8efff, 0x44404b, scene.settings.ambientLightIntensity + 0.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(5, 9, 6);
  keyLight.castShadow = true;
  world.add(keyLight);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x242832, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  world.add(ground);

  const groups = new Map<string, THREE.Group>();
  const meshes = new Map<string, THREE.Mesh>();
  const lights = new Map<string, THREE.Light>();
  const makeLight = (entity: Entity): THREE.Light | null => {
    const values = record(entity, "Light");
    if (!entity.components.Light) return null;
    const color = typeof values.color === "string" ? values.color : "#ffffff";
    const intensity = typeof values.intensity === "number" ? values.intensity : 1;
    if (values.type !== "directional" && values.type !== "spot") return new THREE.PointLight(color, intensity);
    // Same as the editor viewport: aimed along the entity's local -Y.
    const light = values.type === "directional" ? new THREE.DirectionalLight(color, intensity) : new THREE.SpotLight(color, intensity, 0, Math.PI / 6, 0.3);
    light.target.position.set(0, -1, 0);
    light.add(light.target);
    return light;
  };

  function syncScene(): void {
    const ids = new Set(scene.entities.map((entity) => entity.id));
    for (const [id, group] of groups) {
      if (ids.has(id)) continue;
      group.removeFromParent();
      meshes.get(id)?.geometry.dispose();
      (meshes.get(id)?.material as THREE.Material | undefined)?.dispose();
      groups.delete(id); meshes.delete(id);
      lights.get(id)?.removeFromParent(); lights.delete(id);
    }
    for (const entity of scene.entities) {
      let group = groups.get(entity.id);
      if (!group) { group = new THREE.Group(); groups.set(entity.id, group); }
      const parent = entity.parent ? groups.get(entity.parent) : undefined;
      (parent ?? world).add(group);
      const transform = record(entity, "Transform");
      group.position.set(...vector(transform.position, [0, 0, 0]));
      const rotation = vector(transform.rotation, [0, 0, 0]);
      group.rotation.set(THREE.MathUtils.degToRad(rotation[0]), THREE.MathUtils.degToRad(rotation[1]), THREE.MathUtils.degToRad(rotation[2]));
      group.scale.set(...vector(transform.scale, [1, 1, 1]));
      if (!meshes.has(entity.id)) {
        const mesh = meshFor(entity);
        if (mesh) { mesh.castShadow = true; mesh.receiveShadow = true; meshes.set(entity.id, mesh); group.add(mesh); }
      }
      const meshObject = meshes.get(entity.id);
      if (meshObject) {
        const material = meshObject.material as THREE.MeshStandardMaterial;
        const materialData = record(entity, "Material");
        material.color.set(typeof materialData.color === "string" ? materialData.color : "#ffffff");
        material.metalness = typeof materialData.metalness === "number" ? materialData.metalness : 0;
        material.roughness = typeof materialData.roughness === "number" ? materialData.roughness : 0.6;
        material.emissive.set(typeof materialData.emissive === "string" ? materialData.emissive : "#000000");
        material.emissiveIntensity = typeof materialData.emissiveIntensity === "number" ? materialData.emissiveIntensity : 0;
        material.opacity = typeof materialData.opacity === "number" ? materialData.opacity : 1;
        material.transparent = material.opacity < 1;
        material.needsUpdate = true;
      }
      if (!lights.has(entity.id)) {
        const light = makeLight(entity);
        if (light) { lights.set(entity.id, light); group.add(light); }
      }
      const entityLight = lights.get(entity.id);
      if (entityLight) {
        const lightData = record(entity, "Light");
        entityLight.color.set(typeof lightData.color === "string" ? lightData.color : "#ffffff");
        entityLight.intensity = typeof lightData.intensity === "number" ? lightData.intensity : 1;
      }
    }
    world.background = new THREE.Color(scene.settings.background);
  }

  syncScene();
  let controller: PlayController | null = null;
  let scripts: ScriptRuntime | null = null;
  const animator = new AnimatorRuntime();
  let playing = false;
  let snapshot: Scene | null = null;
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  const hasBodies = scene.entities.some((entity) => Boolean(entity.components.RigidBody));
  const query = new URLSearchParams(location.search);
  if (query.get("controls") === "1") {
    for (const entity of scene.entities) {
      const source = entity.components.Script?.source;
      if (typeof source !== "string") continue;
      try {
        const { parseScript } = await import("../lang/parser");
        const program = parseScript(source);
        for (const param of program.params) {
          if (param.type !== "float" && param.type !== "int") continue;
          const label = document.createElement("label");
          label.textContent = `${entity.name} · ${param.name}`;
          const input = document.createElement("input");
          input.type = "range";
          input.min = String(param.min ?? 0);
          input.max = String(param.max ?? 100);
          input.step = param.type === "int" ? "1" : "any";
          input.value = String((entity.components.Script?.parameters as Record<string, unknown> | undefined)?.[param.name] ?? param.defaultValue);
          input.oninput = () => { controller?.setScriptParameter(entity.id, param.name, Number(input.value)); scripts?.setParameter(entity.id, param.name, Number(input.value)); };
          label.append(input);
          controlsHost.append(label);
        }
      } catch { /* Invalid scripts are reported by the shared runtime when Play starts. */ }
    }
  }

  async function start(): Promise<void> {
    if (playing) return;
    snapshot = structuredClone(scene);
    playing = true; elapsed = 0; lastTime = performance.now(); animator.reset();
    if (hasBodies) {
      const { SimulationController } = await import("../runtime/physics");
      controller = new SimulationController();
      const warnings = await controller.play(scene);
      if (controller.state !== "playing") throw new Error(warnings.join(" · ") || "Could not start scene physics.");
      scene = controller.initialScene ?? scene;
      if (warnings.length) status.textContent = warnings.join(" · ");
    } else {
      scripts = new ScriptRuntime(scene);
      const started = scripts.start();
      const operations = scriptOps(scene, started);
      scene = operations.length ? applyOps(scene, operations).scene : started;
    }
    playButton.disabled = true;
    stopButton.disabled = false;
    status.textContent = status.textContent || "Playing";
    frame = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    if (!playing) return;
    const delta = Math.max(0, Math.min(0.1, (now - lastTime) / 1000));
    lastTime = now; elapsed += delta;
    if (controller) scene = controller.advance(scene, delta);
    else {
      if (scripts) {
        scripts.setScene(scene);
        const before = scene;
        const next = scripts.advance(delta);
        const operations = scriptOps(before, next);
        scene = operations.length ? applyOps(before, operations).scene : next;
      }
      scene = animator.advance(scene, delta).scene;
    }
    syncScene();
    orbit.update();
    renderer.render(world, camera);
    frame = requestAnimationFrame(tick);
  }

  function stop(): void {
    playing = false;
    cancelAnimationFrame(frame);
    if (controller) scene = controller.stop() ?? scene;
    else if (snapshot) scene = structuredClone(snapshot);
    snapshot = null;
    controller = null; scripts = null; animator.reset();
    syncScene();
    playButton.disabled = false;
    stopButton.disabled = true;
    status.textContent = "Stopped";
  }

  playButton.addEventListener("click", () => { void start().catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); }); });
  stopButton.addEventListener("click", stop);
  // Keyboard input for "when space is pressed" and "key left is pressed".
  addEventListener("keydown", (event) => { if (!event.repeat) { controller?.pressKey(keyName(event.key)); scripts?.pressKey(keyName(event.key)); } });
  addEventListener("keyup", (event) => { controller?.releaseKey(keyName(event.key)); scripts?.releaseKey(keyName(event.key)); });
  function resize(): void {
    const width = host.clientWidth || innerWidth;
    const height = host.clientHeight || innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  addEventListener("resize", resize);
  resize();
  renderer.render(world, camera);
  status.textContent = query.get("controls") === "1" ? "Playing · controls enabled" : "Playing";
  void start().catch((error: unknown) => { status.textContent = error instanceof Error ? error.message : String(error); });
}

export { downloadText };
