import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import type { Entity, Scene, Vec3 } from "../scene/types";

/** Builds the scene's renderable objects using the same primitive and material rules as the viewport. */
export function createThreeScene(scene: Scene): THREE.Scene {
  const output = new THREE.Scene();
  output.name = "SimuStyle Scene";
  output.background = new THREE.Color(scene.settings.background);

  const objects = new Map<string, THREE.Object3D>();
  for (const entity of scene.entities) {
    const meshData = component(entity, "Mesh");
    const lightData = component(entity, "Light");
    let object: THREE.Object3D | undefined;

    if (entity.components.Mesh) {
      const geometry = geometryFor(meshData);
      const materialData = component(entity, "Material");
      const material = new THREE.MeshStandardMaterial({
        color: stringField(materialData, "color", "#ffffff"),
        metalness: numberField(materialData, "metalness", 0),
        roughness: numberField(materialData, "roughness", 0.6),
        emissive: stringField(materialData, "emissive", "#000000"),
        emissiveIntensity: numberField(materialData, "emissiveIntensity", 0),
        opacity: numberField(materialData, "opacity", 1)
      });
      material.transparent = material.opacity < 1;
      object = new THREE.Mesh(geometry, material);
    } else if (entity.components.Light) {
      object = lightFor(lightData);
    } else if (entity.components.Camera) {
      const cameraData = component(entity, "Camera");
      object = new THREE.PerspectiveCamera(numberField(cameraData, "fov", 50), 1, 0.1, 1000);
    }

    // Transform-only entities still form useful parent groups for child objects.
    object ??= new THREE.Group();
    object.name = entity.name;
    object.userData.entityId = entity.id;
    const transform = component(entity, "Transform");
    object.position.fromArray(vec3(transform.position, [0, 0, 0]));
    const rotation = vec3(transform.rotation, [0, 0, 0]);
    object.rotation.set(...rotation.map(THREE.MathUtils.degToRad) as Vec3);
    object.scale.fromArray(vec3(transform.scale, [1, 1, 1]));
    objects.set(entity.id, object);
  }

  // Attach after creation so parent entities may appear later in the scene array.
  const entitiesById = new Map(scene.entities.map((entity) => [entity.id, entity]));
  for (const [id, object] of objects) {
    const entity = entitiesById.get(id);
    const parent = entity?.parent ? objects.get(entity.parent) : undefined;
    (parent ?? output).add(object);
  }
  return output;
}

/** Exports the current scene as a binary glTF Blob suitable for a .glb download. */
export async function exportSceneGlb(scene: Scene): Promise<Blob> {
  const exportScene = createThreeScene(scene);
  try {
    const result = await new GLTFExporter().parseAsync(exportScene, { binary: true, trs: true });
    if (!(result instanceof ArrayBuffer)) {
      throw new Error("GLB export did not return binary data.");
    }
    return new Blob([result], { type: "model/gltf-binary" });
  } finally {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    exportScene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }
}

function geometryFor(mesh: Record<string, unknown>): THREE.BufferGeometry {
  const shape = mesh.shape ?? "box";
  const radius = numberField(mesh, "radius", 0.5);
  const height = numberField(mesh, "height", 1);
  switch (shape) {
    case "sphere": return new THREE.SphereGeometry(radius, 24, 16);
    case "cylinder": return new THREE.CylinderGeometry(radius, radius, height, 24);
    case "capsule": return new THREE.CapsuleGeometry(radius, Math.max(0.01, height - 2 * radius), 4, 12);
    case "plane": return new THREE.PlaneGeometry(radius * 2, radius * 2);
    case "cone": return new THREE.ConeGeometry(radius, height, 24);
    default: return new THREE.BoxGeometry(radius * 2, height, radius * 2);
  }
}

function lightFor(data: Record<string, unknown>): THREE.Light {
  const color = stringField(data, "color", "#ffffff");
  const intensity = numberField(data, "intensity", 1);
  switch (data.type) {
    case "directional": return new THREE.DirectionalLight(color, intensity);
    case "spot": return new THREE.SpotLight(color, intensity);
    default: return new THREE.PointLight(color, intensity);
  }
}

function component(entity: Entity, name: string): Record<string, unknown> {
  return entity.components[name] ?? {};
}

function vec3(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
    ? value as Vec3
    : fallback;
}

function numberField(data: Record<string, unknown>, field: string, fallback: number): number {
  const value = data[field];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringField(data: Record<string, unknown>, field: string, fallback: string): string {
  const value = data[field];
  return typeof value === "string" ? value : fallback;
}
