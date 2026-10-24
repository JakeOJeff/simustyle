import * as THREE from "three";
import { halfExtents } from "../runtime/commands";
import { worldMatrix } from "../scene/hierarchy";
import { activeCamera, createSceneCamera } from "../runtime/camera";
import type { Scene, SceneOp, Vec3 } from "../scene/types";

export interface BuildQualityReport {
  checks: string[];
  stats: { meshes: number; groups: number; dynamicBodies: number; lights: number };
  bounds: { min: Vec3; max: Vec3 } | null;
  warnings: string[];
}

const rounded = (point: THREE.Vector3): Vec3 => point.toArray().map((value) => Math.round(value * 1000) / 1000) as Vec3;

/** Conservative world bounds include all parent transforms and use the renderer's XY plane orientation. */
export function meshWorldBounds(scene: Scene, id: string): THREE.Box3 | null {
  const entity = scene.entities.find((candidate) => candidate.id === id);
  if (!entity?.components.Mesh) return null;
  const half = halfExtents({ ...entity, components: { ...entity.components, Transform: {} } });
  if (entity.components.Mesh.shape === "plane") {
    const radius = Number(entity.components.Mesh.radius ?? 0.5);
    half.splice(0, 3, radius, radius, 0.005);
  }
  return new THREE.Box3(new THREE.Vector3(...half).negate(), new THREE.Vector3(...half)).applyMatrix4(worldMatrix(scene, id));
}

/** Advisory design feedback; intent-sensitive findings are reviewed by the model, never silently repaired. */
export function inspectBuildQuality(scene: Scene, ops: SceneOp[]): BuildQualityReport {
  const touched = new Set(ops.flatMap((op) => op.op === "create" || op.op === "update" ? [op.id] : []));
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const ancestors = new Map<string, Set<string>>();
  for (const entity of scene.entities) {
    const chain = new Set<string>();
    let id: string | null = entity.id;
    while (id !== null && !chain.has(id)) { chain.add(id); id = byId.get(id)?.parent ?? null; }
    ancestors.set(entity.id, chain);
  }
  const affectedIds = new Set(scene.entities.filter((entity) => [...ancestors.get(entity.id)!].some((id) => touched.has(id))).map((entity) => entity.id));
  const affected = (id: string) => affectedIds.has(id);
  const meshes = scene.entities.filter((entity) => entity.components.Mesh);
  const dynamic = scene.entities.filter((entity) => entity.components.RigidBody && entity.components.RigidBody.anchored !== true && (entity.components.RigidBody.bodyType ?? "dynamic") === "dynamic");
  const warnings: string[] = [];
  const warn = (message: string) => { if (warnings.length < 30) warnings.push(message); };
  const boxes = new Map(meshes.map((entity) => [entity.id, meshWorldBounds(scene, entity.id)!]));
  const combined = new THREE.Box3();
  const poses = new Map<string, string>();
  for (const entity of meshes) {
    const bounds = boxes.get(entity.id)!;
    combined.union(bounds);
    const matrix = worldMatrix(scene, entity.id);
    const signature = JSON.stringify([entity.components.Mesh.shape ?? "box", entity.components.Mesh.radius ?? 0.5,
      entity.components.Mesh.height ?? 1, matrix.elements.map((value) => Math.round(value * 1e6))]);
    const previous = poses.get(signature);
    if (previous && (affected(entity.id) || affected(previous))) warn(`'${entity.id}' and '${previous}' have identical geometry and world poses; check for duplicate surfaces.`);
    poses.set(signature, entity.id);
    if (!affected(entity.id)) continue;
    if (!entity.components.Material) warn(`'${entity.id}' has no Material; choose a deliberate surface/color.`);
    if (Math.abs(matrix.determinant()) < 1e-10) warn(`'${entity.id}' has a collapsed world transform; check its own and its parents' scale.`);
    if (entity.components.Material?.opacity === 0) warn(`'${entity.id}' is fully transparent; confirm this is intentional.`);
    if (bounds.min.y < -0.03) warn(`'${entity.id}' extends below ground (world y=${rounded(bounds.min)[1]}); confirm intended burial/submersion.`);
  }
  for (const entity of dynamic.filter((body) => affected(body.id))) {
    const bounds = boxes.get(entity.id);
    if (!bounds) continue;
    for (const other of meshes) {
      if (ancestors.get(other.id)?.has(entity.id) || ancestors.get(entity.id)?.has(other.id)) continue;
      const overlap = bounds.clone().intersect(boxes.get(other.id)!);
      const size = overlap.getSize(new THREE.Vector3());
      if (size.x > 0.02 && size.y > 0.02 && size.z > 0.02) {
        warn(`Dynamic '${entity.id}' may overlap '${other.id}' at start (conservative world bounds; inspect intended contacts).`);
        break;
      }
    }
  }
  const newRoots = ops.filter((op) => op.op === "create" && op.parent === null && op.components.Mesh);
  if (newRoots.length >= 8) warn(`${newRoots.length} new mesh objects are at the scene root; organize related objects into named folders/assemblies.`);
  const cameraEntity = activeCamera(scene);
  if (cameraEntity && !cameraEntity.components.Camera?.lookAtTarget && !cameraEntity.components.Camera?.followTarget) {
    const world = worldMatrix(scene, cameraEntity.id);
    const position = new THREE.Vector3(); const orientation = new THREE.Quaternion(); const scale = new THREE.Vector3();
    world.decompose(position, orientation, scale);
    const probe = createSceneCamera(cameraEntity, 1);
    probe.position.copy(position); probe.quaternion.copy(orientation); probe.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(probe.projectionMatrix, probe.matrixWorldInverse));
    const affectedMeshes = meshes.filter((entity) => affected(entity.id));
    if (affectedMeshes.length && affectedMeshes.every((entity) => !frustum.intersectsBox(boxes.get(entity.id)!))) warn(`Edited meshes appear outside the active camera '${cameraEntity.id}' (approximate square viewport); check composition.`);
  }
  return {
    checks: ["World bounds and parent transforms", "Materials and duplicate surfaces", "Ground placement and possible dynamic overlaps", "Hierarchy organization", "Static camera framing when applicable"],
    stats: { meshes: meshes.length, groups: scene.entities.filter((entity) => Object.keys(entity.components).every((key) => key === "Transform")).length,
      dynamicBodies: dynamic.length, lights: scene.entities.filter((entity) => entity.components.Light).length },
    bounds: combined.isEmpty() ? null : { min: rounded(combined.min), max: rounded(combined.max) }, warnings
  };
}
