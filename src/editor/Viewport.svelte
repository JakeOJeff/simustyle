<script lang="ts">
  import { onMount, untrack, type Snippet } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { TransformControls } from "three/addons/controls/TransformControls.js";
  import { Box, Focus, House } from "@lucide/svelte";
  import { easeProgress } from "../runtime/easing";
  import type { Entity, Scene, Vec3 } from "../scene/types";

  /** "select" picks objects without showing a transform gizmo. */
  type TransformMode = "select" | "translate" | "rotate" | "scale";
  type ViewPreset = "perspective" | "home" | "top" | "front" | "right" | "back" | "left";
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
    /** Extra floating controls drawn over the canvas (tool rail, create shelf). */
    overlay?: Snippet;
  }

  let { scene, selectedId, selectedIds, mode, onSelect, onSelectMany, onTransform, onModeChange, onContextMenu, frameToken, focusToken, gridVisible, space, snap, overlay }: Props = $props();
  let host: HTMLDivElement;
  let marquee: { left: number; top: number; width: number; height: number } | null = $state(null);
  let viewControls: { setView(view: ViewPreset): void; frame(): void } | null = null;
  /** The view preset the camera is in, or null after the user orbits freely. */
  let activeView = $state<ViewPreset | null>("perspective");
  const viewButtons: { view: ViewPreset; label: string; short: string; secondary?: boolean }[] = [
    { view: "top", label: "Top view", short: "Top" },
    { view: "front", label: "Front view", short: "Front" },
    { view: "right", label: "Right view", short: "Right" },
    { view: "back", label: "Back view", short: "Back", secondary: true },
    { view: "left", label: "Left view", short: "Left", secondary: true }
  ];

  function component(entity: Entity, name: string): Record<string, unknown> {
    return entity.components[name] ?? {};
  }

  function vec3(value: unknown, fallback: Vec3): Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
      ? [value[0], value[1], value[2]] as Vec3
      : fallback;
  }

  function geometryFor(mesh: Record<string, unknown>): THREE.BufferGeometry {
    const shape = mesh.shape ?? "box";
    const radius = typeof mesh.radius === "number" ? mesh.radius : 0.5;
    const height = typeof mesh.height === "number" ? mesh.height : 1;
    switch (shape) {
      case "sphere": return new THREE.SphereGeometry(radius, 24, 16);
      case "cylinder": return new THREE.CylinderGeometry(radius, radius, height, 24);
      case "capsule": return new THREE.CapsuleGeometry(radius, Math.max(0.01, height - 2 * radius), 4, 12);
      case "plane": return new THREE.PlaneGeometry(radius * 2, radius * 2);
      case "cone": return new THREE.ConeGeometry(radius, height, 24);
      default: return new THREE.BoxGeometry(radius * 2, height, radius * 2);
    }
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
    camera.position.set(7, 6, 9);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.8, 0);
    orbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    orbit.mouseButtons.RIGHT = null;

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
    const lightObjects = new Map<string, THREE.Light>();
    const markerObjects = new Map<string, THREE.Mesh>();
    const selectionHelpers = new Map<string, THREE.BoxHelper>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
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
      raycaster.setFromCamera(pointer, camera);
      const entity = pickEntity();
      onSelect(entity ?? null);
    }
    function pickContextMenu(event: MouseEvent) {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const pickables = [...[...entityObjects.values()].filter((object) => object instanceof THREE.Mesh), ...markerObjects.values()];
      const hit = raycaster.intersectObjects(pickables, false)[0];
      const entity = hit?.object.userData.markerFor ?? hit?.object.userData.entityId;
      event.preventDefault();
      if (entity) onSelect(entity);
      const groundHit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
      const placement = hit?.point ?? groundHit;
      onContextMenu(entity ?? null, event.clientX, event.clientY, placement ? [placement.x, placement.y, placement.z] : null);
    }
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
        top: new THREE.Vector3(0, 1, 0.0001), front: new THREE.Vector3(0, 0, 1), right: new THREE.Vector3(1, 0, 0), back: new THREE.Vector3(0, 0, -1), left: new THREE.Vector3(-1, 0, 0)
      };
      const reach = view === "home" ? Math.hypot(7, 5.2, 9) : distance;
      flyTo(target.clone().add(directions[view].normalize().multiplyScalar(reach)), target);
      activeView = view === "home" ? "perspective" : view;
    }
    viewControls = { setView, frame: focusSelected };
    orbit.addEventListener("start", () => { cameraTween = null; activeView = null; });
    const pointerDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
      if (event.button === 0 && event.ctrlKey && !gizmo.dragging) {
        event.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        marqueeStart = { x: event.clientX - rect.left, y: event.clientY - rect.top, pointerId: event.pointerId };
        orbitWasEnabled = orbit.enabled;
        orbit.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
      }
    };
    const pointerMove = (event: PointerEvent) => updateMarquee(event);
    const pointerUp = (event: PointerEvent) => {
      if (marqueeStart?.pointerId === event.pointerId) { finishMarquee(event); return; }
      if (event.button === 0) pick(event);
    };
    const pointerCancel = () => {
      if (!marqueeStart) return;
      marqueeStart = null;
      marquee = null;
      orbit.enabled = orbitWasEnabled;
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("pointercancel", pointerCancel);
    renderer.domElement.addEventListener("contextmenu", pickContextMenu);

    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
      if (event.key.toLowerCase() === "q") onModeChange("select");
      else if (event.key.toLowerCase() === "w") onModeChange("translate");
      else if (event.key.toLowerCase() === "e") onModeChange("rotate");
      else if (event.key.toLowerCase() === "r") onModeChange("scale");
      else if (event.key.toLowerCase() === "f") focusSelected();
    }
    window.addEventListener("keydown", onKey);

    function disposeObject(object: THREE.Object3D) {
      object.removeFromParent();
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
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
          object = new THREE.Mesh(geometryFor(meshData), new THREE.MeshStandardMaterial());
          object.userData.entityId = entity.id;
          object.castShadow = true;
          object.receiveShadow = true;
          entityObjects.set(entity.id, object);
          world.add(object);
        } else if (object.userData.shape !== meshData.shape || object.userData.radius !== meshData.radius || object.userData.height !== meshData.height) {
          object.geometry.dispose();
          object.geometry = geometryFor(meshData);
        }
        object.userData.shape = meshData.shape;
        object.userData.radius = meshData.radius;
        object.userData.height = meshData.height;
        applyTransform(object, entity);
        const material = object.material as THREE.MeshStandardMaterial;
        material.color.set(typeof materialData.color === "string" ? materialData.color : "#ffffff");
        material.metalness = typeof materialData.metalness === "number" ? materialData.metalness : 0;
        material.roughness = typeof materialData.roughness === "number" ? materialData.roughness : 0.6;
        material.emissive.set(typeof materialData.emissive === "string" ? materialData.emissive : "#000000");
        material.emissiveIntensity = typeof materialData.emissiveIntensity === "number" ? materialData.emissiveIntensity : 0;
        material.opacity = typeof materialData.opacity === "number" ? materialData.opacity : 1;
        material.transparent = material.opacity < 1;
      }

      // Parent once every object exists, so children listed before their parent still attach.
      for (const entity of scene.entities) {
        const object = entityObjects.get(entity.id)!;
        syncLight(entity, object);
        syncMarker(entity, object);
        const intendedParent = (entity.parent ? entityObjects.get(entity.parent) : undefined) ?? world;
        if (object.parent !== intendedParent) intendedParent.add(object);
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
      if (selected && mode !== "select" && selected !== gizmo.object) gizmo.attach(selected);
      else if ((!selected || mode === "select") && gizmo.object) gizmo.detach();
      world.background = new THREE.Color(scene.settings.background);
      orbit.update();
    }

    const render = (now = performance.now()) => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
      stepCameraTween(now);
      orbit.update();
      renderer.render(world, camera);
    };
    render();

    const stopSync = $effect.root(() => {
      $effect(() => {
        scene;
        selectedId;
        selectedIds;
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
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointermove", pointerMove);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      renderer.domElement.removeEventListener("pointercancel", pointerCancel);
      renderer.domElement.removeEventListener("contextmenu", pickContextMenu);
      window.removeEventListener("keydown", onKey);
      gizmo.removeEventListener("objectChange", onObjectChange);
      gizmo.removeEventListener("dragging-changed", onDraggingChanged);
      gizmo.dispose();
      orbit.dispose();
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
      renderer.domElement.remove();
    };
  });
</script>

<div class="viewport" bind:this={host} aria-label="3D scene viewport">
  {#if marquee}
    <div class="selection-marquee" style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px`}></div>
  {/if}
  <div class="view-controls" role="toolbar" aria-label="Camera view">
    <button class:active={activeView === "perspective"} title="Perspective view" aria-label="Perspective view" onclick={() => viewControls?.setView("perspective")}><Box size={13} /></button>
    {#each viewButtons as item (item.view)}
      <button class="text" class:secondary={item.secondary} class:active={activeView === item.view} title={item.label} aria-label={item.label} onclick={() => viewControls?.setView(item.view)}>{item.short}</button>
    {/each}
    <span class="divider"></span>
    <button title="Frame selected (F)" aria-label="Frame selected" disabled={!selectedId} onclick={() => viewControls?.frame()}><Focus size={13} /></button>
    <button title="Reset camera" aria-label="Reset camera" onclick={() => viewControls?.setView("home")}><House size={13} /></button>
  </div>
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
    background: #202124;
    touch-action: none;
  }

  .selection-marquee {
    position: absolute;
    z-index: 1;
    border: 1px solid #70d8ff;
    background: #70d8ff24;
    pointer-events: none;
  }

  .view-controls {
    position: absolute;
    z-index: 2;
    top: 10px;
    right: 10px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border: 1px solid #ffffff14;
    border-radius: 8px;
    background: #15161cd9;
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 18px #0006;
  }

  .view-controls button {
    display: grid;
    min-width: 26px;
    height: 24px;
    place-items: center;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 5px;
    background: transparent;
    color: #b1aebd;
    font: 9.5px 'DM Sans', sans-serif;
    cursor: pointer;
    transition: background .12s, color .12s;
  }

  .view-controls button:hover:not(:disabled) { background: #ffffff12; color: #fff; }
  .view-controls button.active { border-color: #7d6ff066; background: #3b3566; color: #e1dbff; }
  .view-controls button:disabled { opacity: .35; cursor: default; }
  .view-controls button:focus-visible { outline: 2px solid #a99bff; outline-offset: 1px; }
  .view-controls .divider { width: 1px; height: 16px; margin: 0 3px; background: #ffffff18; }

  @media (max-width: 1100px) {
    .view-controls .secondary:not(.active) { display: none; }
  }

  .viewport :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }
</style>
