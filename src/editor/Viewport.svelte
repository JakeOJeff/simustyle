<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/addons/controls/OrbitControls.js";
  import { TransformControls } from "three/addons/controls/TransformControls.js";
  import type { Entity, Scene, Vec3 } from "../scene/types";

  type TransformMode = "translate" | "rotate" | "scale";
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
  }

  let { scene, selectedId, selectedIds, mode, onSelect, onSelectMany, onTransform, onModeChange, onContextMenu, frameToken, focusToken, gridVisible }: Props = $props();
  let host: HTMLDivElement;
  let marquee: { left: number; top: number; width: number; height: number } | null = $state(null);

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

    world.add(new THREE.HemisphereLight(0xe8efff, 0x44404b, 1.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(5, 9, 6);
    keyLight.castShadow = true;
    world.add(keyLight);
    const grid = new THREE.GridHelper(40, 40, 0x7e8493, 0x414652);
    world.add(grid);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x242832, roughness: 0.92, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.015;
    ground.receiveShadow = true;
    world.add(ground);

    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setMode(mode);
    world.add(gizmo.getHelper());
    const entityObjects = new Map<string, THREE.Object3D>();
    const selectionHelpers = new Map<string, THREE.BoxHelper>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;
    let marqueeStart: { x: number; y: number; pointerId: number } | null = null;
    let orbitWasEnabled = true;
    let frame = 0;
    let disposed = false;

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
    function pick(event: PointerEvent) {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) return;
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const pickables = [...entityObjects.values()].filter((object) => object instanceof THREE.Mesh);
      const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
      const entity = hit && [...entityObjects.entries()].find(([, object]) => object === hit)?.[0];
      onSelect(entity ?? null);
    }
    function pickContextMenu(event: MouseEvent) {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);
      const pickables = [...entityObjects.values()].filter((object) => object instanceof THREE.Mesh);
      const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
      const entity = hit && [...entityObjects.entries()].find(([, object]) => object === hit)?.[0];
      event.preventDefault();
      if (entity) onSelect(entity);
      const groundHit = raycaster.intersectObject(ground, false)[0]?.point;
      onContextMenu(entity ?? null, event.clientX, event.clientY, groundHit ? [groundHit.x, 0, groundHit.z] : null);
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
    function focusSelected() {
      const entity = currentEntity();
      const object = entity && entityObjects.get(entity.id);
      if (!object) return;
      const box = new THREE.Box3().setFromObject(object);
      const target = box.isEmpty() ? object.position.clone() : box.getCenter(new THREE.Vector3());
      const size = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
      const direction = camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(target);
      camera.position.copy(target).add(direction.multiplyScalar(Math.max(2, size * 1.8)));
      camera.updateProjectionMatrix();
    }
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
      pick(event);
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
      if (event.key.toLowerCase() === "w") onModeChange("translate");
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

    function syncEntities() {
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
      if (selected && selected !== gizmo.object) gizmo.attach(selected);
      else if (!selected && gizmo.object) gizmo.detach();
      world.background = new THREE.Color(scene.settings.background);
      orbit.update();
    }

    const render = () => {
      if (disposed) return;
      frame = requestAnimationFrame(render);
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
        gizmo.setMode(mode);
      });
      $effect(() => {
        grid.visible = gridVisible;
      });
      $effect(() => {
        if (frameToken > 0) focusSelected();
      });
      $effect(() => {
        if (focusToken > 0) focusSelected();
      });
      return () => {};
    });

    return () => {
      disposed = true;
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
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  });
</script>

<div class="viewport" bind:this={host} aria-label="3D scene viewport">
  {#if marquee}
    <div class="selection-marquee" style={`left:${marquee.left}px;top:${marquee.top}px;width:${marquee.width}px;height:${marquee.height}px`}></div>
  {/if}
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

  .viewport :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;
  }
</style>
