<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { TransformControls } from "three/addons/controls/TransformControls.js";
  import { ChevronDown, Focus, House } from "@lucide/svelte";
  import { easeProgress } from "../runtime/easing";
  import { CameraRig, activeCamera } from "../runtime/camera";
  import { CameraInput } from "../runtime/cameraInput";
  import { SurfaceTextureStore } from "../materials/textures";
  import { applySurfaceMapping } from "../materials/mapping";
  import { meshGeometry, meshGeometryKey } from "../scene/meshGeometry";
  import { emitTutorial } from "./tutorial/tutorialState.svelte";
  import type { Entity, Scene, SceneOp, Vec3 } from "../scene/types";

  /** "select" picks objects without showing a transform gizmo. */
  type TransformMode = "select" | "translate" | "rotate" | "scale";
  type ViewPreset = "perspective" | "home" | "top" | "bottom" | "front" | "right" | "back" | "left";
  type Shading = "shaded" | "wireframe";
  type AxisMark = { key: string; label: string; color: string; positive: boolean; view: ViewPreset; x: number; y: number; depth: number };
  type TransformPhase = "start" | "change" | "end";
  type TransformPatch = { position?: Vec3; rotation?: Vec3; scale?: Vec3 };

  interface Props {
    /** Current editor scene. Changes are reflected in the viewport. */
    scene: Scene;
    /** ID of the selected entity, or null when nothing is selected. */
    selectedId: string | null;
    selectedIds: string[];
    /** Active transform gizmo mode. */
    mode: TransformMode;
    /** Request selection; the host owns and updates selection state. */
    onSelect: (id: string | null) => void;
    onSelectMany: (ids: string[]) => void;
    /** Request a Transform update; the host should apply it through applyOps. */
    onTransform: (id: string, transform: TransformPatch, phase: TransformPhase) => void;
    onModeChange: (mode: TransformMode) => void;
    onContextMenu: (id: string | null, x: number, y: number, position: Vec3 | null) => void;
    frameToken: number;
    focusToken: number;
    gridVisible: boolean;
    /** Gizmo axes follow the world or the object's own rotation. */
    space: "world" | "local";
    /** Snap moves to 0.5 m, turns to 15°, and scaling to 0.1 steps. */
    snap: boolean;
    /** Press-and-drag objects to slide them across surfaces (off during Play). */
    canDrag?: boolean;
    playState?: "stopped" | "playing" | "paused";
    onCameraInput?: (ops: SceneOp[]) => void;
    /** Extra floating controls drawn over the canvas (tool rail, create shelf). */
    overlay?: Snippet;
  }

  let { scene, selectedId, selectedIds, mode, onSelect, onSelectMany, onTransform, onModeChange, onContextMenu, frameToken, focusToken, gridVisible, space, snap, canDrag = true, playState = "stopped", onCameraInput, overlay }: Props = $props();
  let cameraPreview = $state(false);
  const sceneView = $derived(playState !== "stopped" || cameraPreview);
  const sceneCameraName = $derived(activeCamera(scene)?.name ?? "No scene camera");
  let host: HTMLDivElement;
  let marquee: { left: number; top: number; width: number; height: number } | null = $state(null);
  let viewControls: { setView(view: ViewPreset): void; frame(): void } | null = null;
  /** The view preset the camera is in, or null after the user orbits freely. */
  let activeView = $state<ViewPreset | null>("perspective");
  const viewOptions: { view: ViewPreset; label: string }[] = [
    { view: "perspective", label: "Perspective" },
    { view: "top", label: "Top" },
    { view: "bottom", label: "Bottom" },
    { view: "front", label: "Front" },
    { view: "back", label: "Back" },
    { view: "right", label: "Right" },
    { view: "left", label: "Left" }
  ];
  const shadingOptions: { value: Shading; label: string }[] = [
    { value: "shaded", label: "Shaded" },
    { value: "wireframe", label: "Wireframe" }
  ];
  let shading = $state<Shading>("shaded");
  let openMenu = $state<"view" | "shading" | null>(null);
  /** Axis gizmo marks in screen space, back-to-front so nearer marks draw on top. */
  let axisMarks = $state<AxisMark[]>([]);
  const viewLabel = $derived(viewOptions.find((item) => item.view === activeView)?.label ?? "Perspective");
  const shadingLabel = $derived(shadingOptions.find((item) => item.value === shading)?.label ?? "Shaded");

  function closeMenuOutside(event: PointerEvent) {
    if (openMenu && !(event.target as Element | null)?.closest?.(".view-menu")) openMenu = null;
  }

  function component(entity: Entity, name: string): Record<string, unknown> {
    return entity.components[name] ?? {};
  }

  function vec3(value: unknown, fallback: Vec3): Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
      ? [value[0], value[1], value[2]] as Vec3
      : fallback;
  }

  onMount(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const world = new THREE.Scene();
    world.background = new THREE.Color(scene.settings.background);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    let renderCamera: THREE.Camera = camera;
    const cameraRig = new CameraRig();
    const cameraInput = new CameraInput(renderer.domElement, () => playState === "playing" && activeCamera(scene)?.components.Camera?.controls === "fly");
    camera.position.set(7, 6, 9);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.8, 0);
    orbit.mouseButtons.LEFT = null;
    orbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;

    // Matches the standalone export: the scene's ambient setting plus a fixed base fill.
    const ambient = new THREE.HemisphereLight(0xe8efff, 0x44404b, scene.settings.ambientLightIntensity + 0.7);
    world.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 9, 6);
    keyLight.castShadow = true;
    world.add(keyLight);
    const grid = new THREE.GridHelper(40, 40, 0x7e8493, 0x414652);
    world.add(grid);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const gizmo = new TransformControls(camera, renderer.domElement);
    if (mode !== "select") gizmo.setMode(mode);
    world.add(gizmo.getHelper());
    const entityObjects = new Map<string, THREE.Object3D>();
    const surfaceTextures = new SurfaceTextureStore();
    const lightObjects = new Map<string, THREE.Light>();
    const markerObjects = new Map<string, THREE.Mesh>();
    const selectionHelpers = new Map<string, THREE.BoxHelper>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    const rightClickMaxMs = 250;
    const rightClickSlop = 4;
    let rightPress: { pointerId: number; x: number; y: number; startedAt: number; moved: boolean } | null = null;
    let marqueeStart: { x: number; y: number; pointerId: number } | null = null;
    let orbitWasEnabled = true;
    let frame = 0;
    let disposed = false;
    let cameraTween: { fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number; seconds: number } | null = null;

    function currentEntity(): Entity | undefined {
      return scene.entities.find((entity) => entity.id === selectedId);
    }

    function emitTransform(phase: TransformPhase) {
      const entity = currentEntity();
      const object = entity && entityObjects.get(entity.id);
      if (!entity || !object) return;
      const rotation = object.rotation;
      onTransform(entity.id, {
        position: [object.position.x, object.position.y, object.position.z],
        rotation: [THREE.MathUtils.radToDeg(rotation.x), THREE.MathUtils.radToDeg(rotation.y), THREE.MathUtils.radToDeg(rotation.z)],
        scale: [object.scale.x, object.scale.y, object.scale.z]
      }, phase);
    }

    const onObjectChange = () => emitTransform("change");
    const onDraggingChanged = (event: { value: unknown }) => {
      // TransformControls and OrbitControls share the canvas; only one should own a drag.
      const dragging = event.value === true;
      orbit.enabled = !dragging;
      emitTransform(dragging ? "start" : "end");
    };
    gizmo.addEventListener("objectChange", onObjectChange);
    gizmo.addEventListener("dragging-changed", onDraggingChanged);

    function resize() {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    function setPointer(event: { clientX: number; clientY: number }) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    }
    /** The entity under the pointer: a visible shape, or the marker of a light or camera. */
    function pickEntity(): string | undefined {
      const pickables = [...[...entityObjects.values()].filter((object) => object instanceof THREE.Mesh), ...markerObjects.values()];
      const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
      return hit?.userData.markerFor ?? hit?.userData.entityId;
    }
    function pick(event: PointerEvent) {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, renderCamera);
      const entity = pickEntity();
      onSelect(entity ?? null);
    }
    function pickContextMenu(event: MouseEvent) {
      setPointer(event);
      raycaster.setFromCamera(pointer, renderCamera);
      const pickables = [...[...entityObjects.values()].filter((object) => object instanceof THREE.Mesh), ...markerObjects.values()];
      const hit = raycaster.intersectObjects(pickables, false)[0];
      const entity = hit?.object.userData.markerFor ?? hit?.object.userData.entityId;
      event.preventDefault();
      if (entity) onSelect(entity);
      const groundHit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
      const placement = hit?.point ?? groundHit;
      onContextMenu(entity ?? null, event.clientX, event.clientY, placement ? [placement.x, placement.y, placement.z] : null);
    }
    function contextMenu(event: MouseEvent) {
      // Browsers may fire this on press or release. Mouse menus are decided on
      // pointer-up so a held RMB can orbit without opening a menu mid-gesture.
      event.preventDefault();
      if (event.button !== 2 && !rightPress) pickContextMenu(event);
    }
    // Viewport controls sit above the canvas, so the canvas listener alone cannot
    // suppress the browser menu for every right-click in the 3D work area.
    const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    host.addEventListener("contextmenu", preventNativeContextMenu, { capture: true });
    function updateMarquee(event: PointerEvent) {
      if (!marqueeStart) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      marquee = {
        left: Math.min(marqueeStart.x, x),
        top: Math.min(marqueeStart.y, y),
        width: Math.abs(x - marqueeStart.x),
        height: Math.abs(y - marqueeStart.y)
      };
    }
    function finishMarquee(event: PointerEvent) {
      if (!marqueeStart) return;
      updateMarquee(event);
      const rect = renderer.domElement.getBoundingClientRect();
      const selection = marquee;
      const ids: string[] = [];
      if (selection && (selection.width > 4 || selection.height > 4)) {
        camera.updateMatrixWorld();
        for (const [id, object] of entityObjects) {
          // Box selection picks visible objects; groups are chosen in the Hierarchy.
          if (!(object instanceof THREE.Mesh)) continue;
          const bounds = new THREE.Box3().setFromObject(object);
          if (bounds.isEmpty()) continue;
          const screenPoints: THREE.Vector2[] = [];
          for (let mask = 0; mask < 8; mask += 1) {
            const point = new THREE.Vector3(
              mask & 1 ? bounds.max.x : bounds.min.x,
              mask & 2 ? bounds.max.y : bounds.min.y,
              mask & 4 ? bounds.max.z : bounds.min.z
            ).project(camera);
            if (point.z < -1 || point.z > 1) continue;
            screenPoints.push(new THREE.Vector2(((point.x + 1) / 2) * rect.width, ((1 - point.y) / 2) * rect.height));
          }
          if (!screenPoints.length) continue;
          const minX = Math.min(...screenPoints.map((point) => point.x));
          const maxX = Math.max(...screenPoints.map((point) => point.x));
          const minY = Math.min(...screenPoints.map((point) => point.y));
          const maxY = Math.max(...screenPoints.map((point) => point.y));
          if (maxX >= selection.left && minX <= selection.left + selection.width && maxY >= selection.top && minY <= selection.top + selection.height) ids.push(id);
        }
      }
      marqueeStart = null;
      marquee = null;
      orbit.enabled = orbitWasEnabled;
      onSelectMany(ids);
    }
    /** Glides the camera to a new view with an eased move instead of jumping. */
    function flyTo(position: THREE.Vector3, target: THREE.Vector3, seconds = 0.45) {
      cameraTween = { fromPosition: camera.position.clone(), toPosition: position, fromTarget: orbit.target.clone(), toTarget: target, start: performance.now(), seconds };
    }
    function stepCameraTween(now: number) {
      if (!cameraTween) return;
      const amount = Math.min(1, (now - cameraTween.start) / 1000 / cameraTween.seconds);
      const eased = easeProgress("ease-in-out-cubic", amount);
      camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
      orbit.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
      if (amount >= 1) cameraTween = null;
    }
    function focusSelected() {
      const entity = currentEntity();
      const object = entity && entityObjects.get(entity.id);
      if (!object) return;
      emitTutorial("frame");
      const box = new THREE.Box3().setFromObject(object);
      const target = box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
      const direction = camera.position.clone().sub(orbit.target).normalize();
      flyTo(target.clone().add(direction.multiplyScalar(Math.max(2, size * 1.8))), target);
    }
    /** Unity-style view presets that keep the current orbit distance and target. */
    function setView(view: ViewPreset) {
      const distance = Math.max(3, camera.position.distanceTo(orbit.target));
      const target = view === "home" ? new THREE.Vector3(0, 0.8, 0) : orbit.target.clone();
      const directions: Record<ViewPreset, THREE.Vector3> = {
        perspective: new THREE.Vector3(7, 6, 9), home: new THREE.Vector3(7, 6, 9),
        // A hair of z keeps OrbitControls from flipping when looking straight down.
        top: new THREE.Vector3(0, 1, 0.0001), bottom: new THREE.Vector3(0, -1, 0.0001), front: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, -1), left: new THREE.Vector3(-1, 0, 0)
      };
      const reach = view === "home" ? Math.hypot(7, 5.2, 9) : distance;
      flyTo(target.clone().add(directions[view].normalize().multiplyScalar(reach)), target);
      activeView = view === "home" ? "perspective" : view;
    }
    viewControls = { setView, frame: focusSelected };
    orbit.addEventListener("start", () => { cameraTween = null; activeView = null; cameraGesture = null; });
    // Report finished camera gestures to the tutorials: right-drag orbits, middle-drag pans, the wheel zooms.
    let pointerButton: number | null = null;
    let cameraGesture: string | null = null;
    orbit.addEventListener("change", () => { cameraGesture ??= pointerButton === 2 ? "camera-orbit" : pointerButton === 1 ? "camera-pan" : pointerButton === null ? "camera-zoom" : null; });
    orbit.addEventListener("end", () => { if (cameraGesture) emitTutorial(cameraGesture); cameraGesture = null; });
    // Roblox-style dragging: press on an object and move the mouse to slide it across the
    // ground and the tops of other objects. A press without movement still just selects.
    type ObjectDrag = { id: string; pointerId: number; object: THREE.Object3D; started: boolean; offset: THREE.Vector3; bottom: number; halfSize: THREE.Vector3; ignore: Set<THREE.Object3D> };
    let objectDrag: ObjectDrag | null = null;
    let hoverQueued = false;
    let lastHover: PointerEvent | null = null;
    const up = new THREE.Vector3(0, 1, 0);

    function setCursor(cursor: string) {
      if (renderer.domElement.style.cursor !== cursor) renderer.domElement.style.cursor = cursor;
    }
    function pickableMeshes(): THREE.Object3D[] {
      return [...[...entityObjects.values()].filter((object) => object instanceof THREE.Mesh), ...markerObjects.values()];
    }
    /** The open hand shows over anything that can be dragged. */
    function updateHoverCursor() {
      hoverQueued = false;
      if (!lastHover || objectDrag?.started || marqueeStart || gizmo.dragging) return;
      if (!canDrag || gizmo.axis !== null || lastHover.buttons !== 0) { setCursor(""); return; }
      setPointer(lastHover);
      raycaster.setFromCamera(pointer, camera);
      setCursor(pickEntity() ? "grab" : "");
    }
    function beginObjectDrag(event: PointerEvent): boolean {
      if (!canDrag || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || gizmo.dragging || gizmo.axis !== null) return false;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickableMeshes(), false)[0];
      const id: string | undefined = hit?.object.userData.markerFor ?? hit?.object.userData.entityId;
      const object = id ? entityObjects.get(id) : undefined;
      if (!hit || !id || !object) return false;
      object.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(object);
      const origin = object.getWorldPosition(new THREE.Vector3());
      const size = bounds.isEmpty() ? new THREE.Vector3(0.5, 0.5, 0.5) : bounds.getSize(new THREE.Vector3());
      const ignore = new Set<THREE.Object3D>();
      object.traverse((child) => { ignore.add(child); });
      objectDrag = {
        id, pointerId: event.pointerId, object, started: false,
        offset: new THREE.Vector3(origin.x - hit.point.x, 0, origin.z - hit.point.z),
        bottom: bounds.isEmpty() ? 0 : origin.y - bounds.min.y,
        halfSize: size.multiplyScalar(0.5),
        ignore
      };
      // Keep the camera still: a left-drag that starts on an object moves the object instead.
      orbitWasEnabled = orbit.enabled;
      orbit.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      return true;
    }
    /** Where the dragged object should go: resting on the surface under the cursor. */
    function dragTarget(drag: ObjectDrag): THREE.Vector3 | null {
      raycaster.setFromCamera(pointer, camera);
      const surfaces = pickableMeshes().filter((object) => !drag.ignore.has(object) && !object.userData.markerFor);
      const hit = raycaster.intersectObjects(surfaces, false)[0];
      let point: THREE.Vector3 | null;
      let normal = up.clone();
      if (hit) {
        point = hit.point.clone();
        if (hit.face) normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      } else point = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
      if (!point) return null;
      if (normal.y > 0.5) {
        // Tops and the ground: keep the grab offset and sit the object's base on the surface.
        return new THREE.Vector3(point.x + drag.offset.x, point.y + drag.bottom, point.z + drag.offset.z);
      }
      // Side faces: push the object out from the face so it stands beside it, never below the floor.
      const out = new THREE.Vector3(normal.x, 0, normal.z).normalize();
      const reach = Math.abs(out.x) * drag.halfSize.x + Math.abs(out.z) * drag.halfSize.z;
      return new THREE.Vector3(point.x + out.x * reach, Math.max(drag.bottom, point.y - drag.halfSize.y + drag.bottom), point.z + out.z * reach);
    }
    function emitDrag(drag: ObjectDrag, phase: TransformPhase) {
      const { position, rotation, scale } = drag.object;
      onTransform(drag.id, {
        position: [position.x, position.y, position.z],
        rotation: [THREE.MathUtils.radToDeg(rotation.x), THREE.MathUtils.radToDeg(rotation.y), THREE.MathUtils.radToDeg(rotation.z)],
        scale: [scale.x, scale.y, scale.z]
      }, phase);
    }
    function moveObjectDrag(event: PointerEvent) {
      const drag = objectDrag!;
      if (!drag.started) {
        if (Math.hypot(event.clientX - downX, event.clientY - downY) <= 4) return;
        drag.started = true;
        if (selectedId !== drag.id) onSelect(drag.id);
        emitDrag(drag, "start");
        setCursor("grabbing");
      }
      setPointer(event);
      const target = dragTarget(drag);
      if (!target) return;
      if (snap) {
        target.x = Math.round(target.x / 0.5) * 0.5;
        target.z = Math.round(target.z / 0.5) * 0.5;
      }
      const parent = drag.object.parent ?? world;
      parent.updateWorldMatrix(true, false);
      drag.object.position.copy(parent.worldToLocal(target));
      emitDrag(drag, "change");
    }
    function endObjectDrag(commit: boolean) {
      const drag = objectDrag;
      objectDrag = null;
      orbit.enabled = orbitWasEnabled;
      if (drag?.started) {
        if (commit) emitDrag(drag, "end");
        setCursor("grab");
      }
      return drag?.started ?? false;
    }

    const pointerDown = (event: PointerEvent) => {
      pointerButton = event.button;
      downX = event.clientX;
      downY = event.clientY;
      rightPress = event.button === 2 ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY, startedAt: performance.now(), moved: false } : null;
      if (sceneView) return;
      if (beginObjectDrag(event)) return;
      if (event.button === 0 && event.ctrlKey && !gizmo.dragging) {
        event.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        marqueeStart = { x: event.clientX - rect.left, y: event.clientY - rect.top, pointerId: event.pointerId };
        orbitWasEnabled = orbit.enabled;
        orbit.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
      }
    };
    const pointerMove = (event: PointerEvent) => {
      if (rightPress?.pointerId === event.pointerId) {
        if (!(event.buttons & 2)) rightPress = null;
        else if (Math.hypot(event.clientX - rightPress.x, event.clientY - rightPress.y) > rightClickSlop) rightPress.moved = true;
      }
      if (objectDrag?.pointerId === event.pointerId) { moveObjectDrag(event); return; }
      updateMarquee(event);
      lastHover = event;
      if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(updateHoverCursor); }
    };
    const pointerUp = (event: PointerEvent) => {
      pointerButton = null;
      const press = rightPress;
      rightPress = null;
      if (event.button === 2) {
        const rect = renderer.domElement.getBoundingClientRect();
        if (press?.pointerId === event.pointerId && !press.moved && performance.now() - press.startedAt < rightClickMaxMs
          && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= rightClickSlop
          && event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom) pickContextMenu(event);
        return;
      }
      if (objectDrag?.pointerId === event.pointerId && endObjectDrag(true)) return;
      if (marqueeStart?.pointerId === event.pointerId) { finishMarquee(event); return; }
      if (event.button === 0) pick(event);
    };
    const pointerLeave = () => { lastHover = null; if (!objectDrag) setCursor(""); };
    const pointerCancel = () => {
      pointerButton = null;
      rightPress = null;
      if (objectDrag) endObjectDrag(true);
      if (!marqueeStart) return;
      marqueeStart = null;
      marquee = null;
      orbit.enabled = orbitWasEnabled;
    };
    // Capture phase, so a press on an object disables orbiting before OrbitControls sees it.
    renderer.domElement.addEventListener("pointerdown", pointerDown, { capture: true });
    renderer.domElement.addEventListener("pointerleave", pointerLeave);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);
    renderer.domElement.addEventListener("contextmenu", contextMenu);
    const cancelRightPress = () => { rightPress = null; };
    renderer.domElement.addEventListener("lostpointercapture", cancelRightPress);
    window.addEventListener("blur", cancelRightPress);

    function onKey(event: KeyboardEvent) {
      if (sceneView || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
      if (event.key.toLowerCase() === "q") onModeChange("select");
      else if (event.key.toLowerCase() === "w") onModeChange("translate");
      else if (event.key.toLowerCase() === "e") onModeChange("scale");
      else if (event.key.toLowerCase() === "r") onModeChange("rotate");
      else if (event.key.toLowerCase() === "f") focusSelected();
    }
    window.addEventListener("keydown", onKey);

    function disposeObject(object: THREE.Object3D) {
      object.removeFromParent();
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        for (const item of Array.isArray(material) ? material : [material]) {
          if (item instanceof THREE.MeshStandardMaterial) surfaceTextures.release(item);
          item.dispose();
        }
      }
    }

    function applyTransform(object: THREE.Object3D, entity: Entity) {
      const transform = component(entity, "Transform");
      object.position.fromArray(vec3(transform.position, [0, 0, 0]));
      const rotation = vec3(transform.rotation, [0, 0, 0]);
      object.rotation.set(THREE.MathUtils.degToRad(rotation[0]), THREE.MathUtils.degToRad(rotation[1]), THREE.MathUtils.degToRad(rotation[2]));
      object.scale.fromArray(vec3(transform.scale, [1, 1, 1]));
      object.name = entity.name;
    }

    /** Directional and spot lights shine along the entity's local -Y, so rotating the entity aims them. */
    function makeLight(type: string): THREE.Light {
      const light = type === "directional" ? new THREE.DirectionalLight() : type === "spot" ? new THREE.SpotLight(0xffffff, 1, 0, Math.PI / 6, 0.3) : new THREE.PointLight();
      if (light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight) {
        light.target.position.set(0, -1, 0);
        light.add(light.target);
      }
      light.userData.type = type;
      return light;
    }

    function syncLight(entity: Entity, object: THREE.Object3D) {
      const data = entity.components.Light;
      const type = typeof data?.type === "string" ? data.type : "point";
      let light = lightObjects.get(entity.id);
      if (light && (!data || light.userData.type !== type)) {
        light.removeFromParent();
        light.dispose();
        lightObjects.delete(entity.id);
        light = undefined;
      }
      if (!data) return;
      if (!light) {
        light = makeLight(type);
        lightObjects.set(entity.id, light);
      }
      if (light.parent !== object) object.add(light);
      light.color.set(typeof data.color === "string" ? data.color : "#ffffff");
      light.intensity = typeof data.intensity === "number" ? data.intensity : 1;
      light.castShadow = data.castShadow !== false;
    }

    /** A small pickable marker for lights and cameras that have no visible shape. */
    function syncMarker(entity: Entity, object: THREE.Object3D) {
      const kind = entity.components.Mesh ? null : entity.components.Light ? "light" : entity.components.Camera ? "camera" : null;
      let marker = markerObjects.get(entity.id);
      if (marker && marker.userData.kind !== kind) {
        disposeObject(marker);
        markerObjects.delete(entity.id);
        marker = undefined;
      }
      if (!kind) return;
      if (!marker) {
        marker = kind === "light"
          ? new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshBasicMaterial({ wireframe: true }))
          : new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.35, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x70d8ff, wireframe: true }));
        marker.userData.kind = kind;
        marker.userData.markerFor = entity.id;
        markerObjects.set(entity.id, marker);
      }
      if (marker.parent !== object) object.add(marker);
      if (kind === "light") (marker.material as THREE.MeshBasicMaterial).color.set(typeof entity.components.Light?.color === "string" ? entity.components.Light.color : "#ffffff");
    }

    function syncEntities() {
      ambient.intensity = scene.settings.ambientLightIntensity + 0.7;
      for (const [id, light] of lightObjects) if (!scene.entities.some((entity) => entity.id === id)) { light.removeFromParent(); light.dispose(); lightObjects.delete(id); }
      for (const [id, marker] of markerObjects) if (!scene.entities.some((entity) => entity.id === id)) { disposeObject(marker); markerObjects.delete(id); }
      // Entities without a Mesh (groups, scene scripts, lights) become invisible Groups,
      // so their Transform still moves the children placed inside them.
      const live = new Map(scene.entities.map((entity) => [entity.id, entity]));
      for (const [id, object] of entityObjects) {
        const entity = live.get(id);
        if (entity && Boolean(entity.components.Mesh) === object instanceof THREE.Mesh) continue;
        for (const child of [...object.children]) if (child.userData.entityId) world.add(child);
        disposeObject(object);
        entityObjects.delete(id);
      }

      for (const entity of scene.entities) {
        const meshData = entity.components.Mesh;
        if (!meshData) {
          let group = entityObjects.get(entity.id);
          if (!group) {
            group = new THREE.Group();
            group.userData.entityId = entity.id;
            entityObjects.set(entity.id, group);
            world.add(group);
          }
          applyTransform(group, entity);
          continue;
        }
        const materialData = component(entity, "Material");
        let object = entityObjects.get(entity.id) as THREE.Mesh | undefined;
        if (!object) {
          object = new THREE.Mesh(meshGeometry(meshData), new THREE.MeshStandardMaterial());
          object.userData.entityId = entity.id;
          object.castShadow = true;
          object.receiveShadow = true;
          entityObjects.set(entity.id, object);
          world.add(object);
        } else if (object.userData.geometryKey !== meshGeometryKey(meshData)) {
          object.geometry.dispose();
          object.geometry = meshGeometry(meshData);
        }
        object.userData.geometryKey = meshGeometryKey(meshData);
        applyTransform(object, entity);
        const material = object.material as THREE.MeshStandardMaterial;
        material.color.set(typeof materialData.color === "string" ? materialData.color : "#ffffff");
        material.metalness = typeof materialData.metalness === "number" ? materialData.metalness : 0;
        material.roughness = typeof materialData.roughness === "number" ? materialData.roughness : 0.6;
        material.emissive.set(typeof materialData.emissive === "string" ? materialData.emissive : "#000000");
        material.emissiveIntensity = typeof materialData.emissiveIntensity === "number" ? materialData.emissiveIntensity : 0;
        material.opacity = typeof materialData.opacity === "number" ? materialData.opacity : 1;
        material.transparent = material.opacity < 1;
        material.wireframe = shading === "wireframe";
        surfaceTextures.sync(material, materialData);
      }

      // Parent once every object exists, so children listed before their parent still attach.
      for (const entity of scene.entities) {
        const object = entityObjects.get(entity.id)!;
        syncLight(entity, object);
        syncMarker(entity, object);
        const intendedParent = (entity.parent ? entityObjects.get(entity.parent) : undefined) ?? world;
        if (object.parent !== intendedParent) intendedParent.add(object);
      }

      for (const entity of scene.entities) {
        const object = entityObjects.get(entity.id);
        if (object instanceof THREE.Mesh) applySurfaceMapping(object, entity.components.Mesh ?? {}, entity.components.Material ?? {});
      }

      for (const [id, helper] of selectionHelpers) {
        if (!selectedIds.includes(id) || !entityObjects.has(id)) {
          helper.removeFromParent();
          helper.geometry.dispose();
          selectionHelpers.delete(id);
        }
      }
      for (const id of selectedIds) {
        const object = entityObjects.get(id);
        if (!object) continue;
        let helper = selectionHelpers.get(id);
        if (!helper) {
          helper = new THREE.BoxHelper(object, id === selectedId ? 0xa995ff : 0x70d8ff);
          selectionHelpers.set(id, helper);
          world.add(helper);
        }
        helper.update();
      }
      const selected = selectedId ? entityObjects.get(selectedId) : undefined;
      if (selected && mode !== "select" && !sceneView && selected !== gizmo.object) gizmo.attach(selected);
      else if ((!selected || mode === "select" || sceneView) && gizmo.object) gizmo.detach();
      world.background = new THREE.Color(scene.settings.background);
      orbit.update();
    }

    const axisDefs: { key: string; label: string; color: string; direction: THREE.Vector3; view: ViewPreset }[] = [
      { key: "x", label: "X", color: "#ef5350", direction: new THREE.Vector3(1, 0, 0), view: "right" },
      { key: "y", label: "Y", color: "#4caf50", direction: new THREE.Vector3(0, 1, 0), view: "top" },
      { key: "z", label: "Z", color: "#4a90e2", direction: new THREE.Vector3(0, 0, 1), view: "front" },
      { key: "-x", label: "", color: "#ef5350", direction: new THREE.Vector3(-1, 0, 0), view: "left" },
      { key: "-y", label: "", color: "#4caf50", direction: new THREE.Vector3(0, -1, 0), view: "bottom" },
      { key: "-z", label: "", color: "#4a90e2", direction: new THREE.Vector3(0, 0, -1), view: "back" }
    ];
    const lastGizmoQuaternion = new THREE.Quaternion(0, 0, 0, 0);
    const inverseCamera = new THREE.Quaternion();
    const projected = new THREE.Vector3();
    /** Re-projects the world axes into camera space whenever the camera turns. */
    function updateAxisMarks() {
      if (camera.quaternion.equals(lastGizmoQuaternion)) return;
      lastGizmoQuaternion.copy(camera.quaternion);
      inverseCamera.copy(camera.quaternion).invert();
      axisMarks = axisDefs.map((axis) => {
        projected.copy(axis.direction).applyQuaternion(inverseCamera);
        return { key: axis.key, label: axis.label, color: axis.color, positive: axis.label !== "", view: axis.view, x: projected.x, y: -projected.y, depth: projected.z };
      }).sort((a, b) => a.depth - b.depth);
    }

    let lastRender = performance.now();
    let wasSceneView = false;
    const render = (now = performance.now()) => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      const dt = Math.max(0, Math.min(0.1, (now - lastRender) / 1000));
      lastRender = now;
      if (sceneView !== wasSceneView) {
        cameraRig.reset(); cameraInput.reset();
        // Remove effective follow poses when returning to the editor camera.
        for (const entity of scene.entities) { const object = entityObjects.get(entity.id); if (object) applyTransform(object, entity); }
        wasSceneView = sceneView;
      }
      orbit.enabled = !sceneView && !gizmo.dragging && !objectDrag && !marqueeStart;
      gizmo.enabled = !sceneView;
      if (sceneView) {
        const ops = cameraInput.advance(scene, dt);
        if (ops.length) onCameraInput?.(ops);
        renderCamera = cameraRig.update(scene, entityObjects, camera.aspect, dt, playState === "stopped") ?? camera;
      } else { renderCamera = camera; stepCameraTween(now); orbit.update(); }
      grid.visible = gridVisible && !sceneView;
      for (const marker of markerObjects.values()) marker.visible = !sceneView;
      for (const helper of selectionHelpers.values()) helper.visible = !sceneView;
      updateAxisMarks();
      renderer.render(world, renderCamera);
    };
    render();

    const stopSync = $effect.root(() => {
      $effect(() => {
        scene;
        selectedId;
        selectedIds;
        shading;
        sceneView;
        syncEntities();
      });
      $effect(() => {
        if (mode !== "select") gizmo.setMode(mode);
      });
      $effect(() => {
        gizmo.setSpace(space);
        gizmo.setTranslationSnap(snap ? 0.5 : null);
        gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null);
        gizmo.setScaleSnap(snap ? 0.1 : null);
      });
      $effect(() => {
        grid.visible = gridVisible;
      });
      $effect(() => {
        // untrack: focus only when the token changes, not on every selection change.
        if (frameToken > 0) untrack(focusSelected);
      });
      $effect(() => {
        if (focusToken > 0) untrack(focusSelected);
      });
      return () => {};
    });

    return () => {
      disposed = true;
      viewControls = null;
      cancelAnimationFrame(frame);
      stopSync();
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", pointerDown, { capture: true });
      renderer.domElement.removeEventListener("pointerleave", pointerLeave);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      renderer.domElement.removeEventListener("contextmenu", contextMenu);
      host.removeEventListener("contextmenu", preventNativeContextMenu, { capture: true });
      renderer.domElement.removeEventListener("lostpointercapture", cancelRightPress);
      window.removeEventListener("blur", cancelRightPress);
      window.removeEventListener("keydown", onKey);
      gizmo.removeEventListener("objectChange", onObjectChange);
      gizmo.removeEventListener("dragging-changed", onDraggingChanged);
      gizmo.dispose();
      orbit.dispose();
      cameraInput.dispose();
      for (const light of lightObjects.values()) light.dispose();
      for (const marker of markerObjects.values()) disposeObject(marker);
      for (const object of entityObjects.values()) {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
      }
      for (const helper of selectionHelpers.values()) helper.geometry.dispose();
      renderer.dispose();
      surfaceTextures.dispose();
      renderer.domElement.remove();
    };
  });
</script>

<svelte:window onpointerdown={closeMenuOutside} onkeydown={(event) => { if (event.key === "Escape") openMenu = null; }} />

<div class="viewport" data-tutorial-target="viewport" bind:this={host} aria-label="3D scene viewport">
  {#if marquee}
    <div class="selection-marquee" style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px`}></div>
  {/if}
  <div class="view-menus">
    <button class="menu-trigger" class:active={sceneView} disabled={playState !== "stopped"} title="Preview the active scene camera" onclick={() => cameraPreview = !cameraPreview}>{sceneView ? sceneCameraName : "Scene camera"}</button>
    {#if !sceneView}
    <div class="view-menu">
      <button class="menu-trigger" aria-haspopup="menu" aria-expanded={openMenu === "view"} title="Camera view" onclick={() => (openMenu = openMenu === "view" ? null : "view")}>
        {viewLabel}<ChevronDown size={13} />
      </button>
      {#if openMenu === "view"}
        <div class="menu" role="menu" aria-label="Camera view">
          {#each viewOptions as item (item.view)}
            <button role="menuitemradio" aria-checked={activeView === item.view} class:active={activeView === item.view} onclick={() => { viewControls?.setView(item.view); openMenu = null; }}>{item.label}</button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="view-menu">
      <button class="menu-trigger" aria-haspopup="menu" aria-expanded={openMenu === "shading"} title="Shading mode" onclick={() => (openMenu = openMenu === "shading" ? null : "shading")}>
        {shadingLabel}<ChevronDown size={13} />
      </button>
      {#if openMenu === "shading"}
        <div class="menu" role="menu" aria-label="Shading mode">
          {#each shadingOptions as item (item.value)}
            <button role="menuitemradio" aria-checked={shading === item.value} class:active={shading === item.value} onclick={() => { shading = item.value; openMenu = null; }}>{item.label}</button>
          {/each}
        </div>
      {/if}
    </div>
    {/if}
  </div>
  {#if !sceneView}<div class="view-nav">
    <svg class="axis-gizmo" viewBox="-37 -37 74 74" role="group" aria-label="View axes">
      <circle class="gizmo-face" r="36" />
      {#each axisMarks as mark (mark.key)}
        {#if mark.positive}<line x1="0" y1="0" x2={mark.x * 24} y2={mark.y * 24} stroke={mark.color} stroke-width="1.6" />{/if}
      {/each}
      {#each axisMarks as mark (mark.key)}
        <g class="axis-mark" transform={`translate(${mark.x * 24} ${mark.y * 24})`} role="button" tabindex="0" aria-label={`${mark.positive ? "" : "Negative "}${mark.key.replace("-", "").toUpperCase()} axis view`} onclick={() => viewControls?.setView(mark.view)} onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); viewControls?.setView(mark.view); } }}>
          {#if mark.positive}
            <circle r="8" fill={mark.color} />
            <text dy="0.35em">{mark.label}</text>
          {:else}
            <circle r="5" fill="#18181b" stroke={mark.color} stroke-width="1.2" />
          {/if}
        </g>
      {/each}
    </svg>
    <div class="nav-buttons">
      <button title="Frame selected (F)" aria-label="Frame selected" disabled={!selectedId} onclick={() => viewControls?.frame()}><Focus size={15} /></button>
      <button title="Reset camera" aria-label="Reset camera" onclick={() => viewControls?.setView("home")}><House size={15} /></button>
    </div>
  </div>{/if}
  {#if playState === "playing" && activeCamera(scene)?.components.Camera?.controls === "fly"}
    <div class="camera-hint">Click view · WASD move · Q/E down/up · drag to look · Shift faster</div>
  {/if}
  {#if overlay}{@render overlay()}{/if}
</div>

<style>
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #202024;
    touch-action: none;
  }

  .selection-marquee {
    position: absolute;
    z-index: 1;
    border: 1px solid #70d8ff;
    background: #70d8ff24;
    pointer-events: none;
  }

  /* Sits beside the host's tool rail in the top-left corner. */
  .view-menus {
    position: absolute;
    z-index: 3;
    top: 10px;
    left: 56px;
    display: flex;
    gap: 6px;
  }

  .view-menu { position: relative; }

  .menu-trigger {
    display: flex;
    height: 28px;
    align-items: center;
    gap: 6px;
    padding: 0 9px 0 11px;
    border: 1px solid #ffffff14;
    border-radius: 7px;
    background: #18181bd9;
    backdrop-filter: blur(6px);
    color: #e4e4e7;
    font: 12px 'DM Sans', sans-serif;
    cursor: pointer;
    transition: background .12s, border-color .12s;
  }

  .menu-trigger :global(svg) { color: #a1a1aa; }
  .menu-trigger.active { color: #e1dbff; border-color: #8b7cf666; }
  .camera-hint { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); padding: 6px 10px; border-radius: 6px; background: #18181bd9; color: #c5c5cb; font: 11px 'DM Sans', sans-serif; pointer-events: none; white-space: nowrap; }
  .menu-trigger:hover, .menu-trigger[aria-expanded="true"] { border-color: #ffffff26; background: #232327e6; }

  .menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    display: flex;
    min-width: 100%;
    flex-direction: column;
    padding: 3px;
    border: 1px solid #ffffff1a;
    border-radius: 7px;
    background: #18181b;
    box-shadow: 0 8px 22px #0008;
  }

  .menu button {
    padding: 5px 10px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: #c5c5cb;
    font: 12px 'DM Sans', sans-serif;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .menu button:hover { background: #ffffff12; color: #fff; }
  .menu button.active { background: #3b3566; color: #e1dbff; }

  .view-nav {
    position: absolute;
    z-index: 2;
    top: 10px;
    right: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
  }

  .axis-gizmo { width: 74px; height: 74px; overflow: visible; }
  .gizmo-face { fill: #18181bb3; stroke: #ffffff14; }
  .axis-mark { cursor: pointer; outline: none; }
  .axis-mark text { fill: #18181b; font: 600 9px 'DM Sans', sans-serif; text-anchor: middle; pointer-events: none; }
  .axis-mark:hover circle, .axis-mark:focus-visible circle { stroke: #fff; stroke-width: 1.4; }

  .nav-buttons { display: flex; gap: 4px; }

  .nav-buttons button {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    padding: 0;
    border: 1px solid #ffffff14;
    border-radius: 7px;
    background: #18181bd9;
    backdrop-filter: blur(6px);
    color: #d4d4d8;
    cursor: pointer;
    transition: background .12s, color .12s;
  }

  .nav-buttons button:hover:not(:disabled) { background: #232327e6; color: #fff; }
  .nav-buttons button:disabled { opacity: .35; cursor: default; }
  .menu-trigger:focus-visible, .menu button:focus-visible, .nav-buttons button:focus-visible { outline: 2px solid #a99bff; outline-offset: 1px; }

  .viewport :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }
</style>
