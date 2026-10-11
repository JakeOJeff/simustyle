// Parent/child helpers. A child's Transform is local to its parent, so moving an
// object to a new parent (or into a group) recomputes its local Transform to keep
// it exactly where it was in the world.
import * as THREE from "three";
import type { Entity, Scene, SceneOp, Vec3 } from "./types";

function vec(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part))
    ? [value[0], value[1], value[2]]
    : fallback;
}

function find(scene: Scene, id: string | null): Entity | undefined {
  return id === null ? undefined : scene.entities.find((entity) => entity.id === id);
}

/** Matrix for an entity's own Transform (rotation is XYZ Euler degrees, as in the viewport). */
function localMatrix(entity: Entity): THREE.Matrix4 {
  const transform = entity.components.Transform ?? {};
  const [rx, ry, rz] = vec(transform.rotation, [0, 0, 0]).map(THREE.MathUtils.degToRad) as Vec3;
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...vec(transform.position, [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "XYZ")),
    new THREE.Vector3(...vec(transform.scale, [1, 1, 1]))
  );
}

/** World matrix of an entity, or identity for the scene root (null). */
export function worldMatrix(scene: Scene, id: string | null): THREE.Matrix4 {
  const chain: Entity[] = [];
  const seen = new Set<string>();
  let current = find(scene, id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = find(scene, current.parent);
  }
  return chain.reduce((matrix, entity) => matrix.multiply(localMatrix(entity)), new THREE.Matrix4());
}

/** Convert a world-space point to the local coordinates of a parent entity. */
export function localPosition(scene: Scene, parent: string | null, position: Vec3): Vec3 {
  const local = worldMatrix(scene, parent).invert().multiply(new THREE.Vector3(...position));
  return local.toArray() as Vec3;
}

const tidy = (value: number) => Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e6) / 1e6;

function transformFrom(matrix: THREE.Matrix4): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  return {
    position: position.toArray().map(tidy) as Vec3,
    rotation: [euler.x, euler.y, euler.z].map((radians) => tidy(THREE.MathUtils.radToDeg(radians))) as Vec3,
    scale: scale.toArray().map(tidy) as Vec3
  };
}

export function childrenOf(scene: Scene, id: string | null): Entity[] {
  return scene.entities.filter((entity) => entity.parent === id);
}

/** True when `ancestorId` is `id` itself or one of its parents. */
export function isSelfOrAncestor(scene: Scene, ancestorId: string, id: string | null): boolean {
  const seen = new Set<string>();
  let current = find(scene, id);
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id);
    current = find(scene, current.parent);
  }
  return false;
}

/** Drop ids whose parent (or grandparent...) is also in the list, so a group moves as one. */
export function topLevelIds(scene: Scene, ids: string[]): string[] {
  const unique = [...new Set(ids)].filter((id) => find(scene, id));
  return unique.filter((id) => !unique.some((other) => other !== id && isSelfOrAncestor(scene, other, find(scene, id)?.parent ?? null)));
}

/** Ops that move `id` under `parent` (null = scene root) without moving it in the world. */
export function reparentOps(scene: Scene, id: string, parent: string | null): { ops: SceneOp[]; error?: string } {
  const entity = find(scene, id);
  if (!entity) return { ops: [], error: `Object '${id}' does not exist.` };
  if (parent !== null && !find(scene, parent)) return { ops: [], error: `Object '${parent}' does not exist.` };
  if (parent !== null && isSelfOrAncestor(scene, id, parent)) return { ops: [], error: `${entity.name} cannot go inside itself or one of its own children.` };
  if (entity.parent === parent) return { ops: [] };
  if (!entity.components.Transform) return { ops: [{ op: "update", id, components: {}, parent }] };
  const local = worldMatrix(scene, parent).invert().multiply(worldMatrix(scene, id));
  return { ops: [{ op: "update", id, components: { Transform: transformFrom(local) }, parent }] };
}

/**
 * Ops that wrap `ids` in a new empty group placed at their center. The group joins
 * the shared parent of the objects, or the scene root when they have different parents.
 */
export function groupOps(scene: Scene, ids: string[], groupId: string, name: string): { ops: SceneOp[]; error?: string } {
  const members = topLevelIds(scene, ids).map((id) => find(scene, id)!);
  if (!members.length) return { ops: [], error: "Select at least one object to group." };
  if (find(scene, groupId)) return { ops: [], error: `Object '${groupId}' already exists.` };
  const parents = new Set(members.map((member) => member.parent));
  const parent = parents.size === 1 ? members[0]!.parent : null;
  const parentWorld = worldMatrix(scene, parent);
  const toParent = parentWorld.clone().invert();
  const center = new THREE.Vector3();
  for (const member of members) center.add(new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, member.id)).applyMatrix4(toParent));
  center.divideScalar(members.length);
  const position = center.toArray().map(tidy) as Vec3;
  const groupWorld = parentWorld.clone().multiply(new THREE.Matrix4().makeTranslation(...position));
  const toGroup = groupWorld.invert();
  const ops: SceneOp[] = [{ op: "create", id: groupId, name, parent, components: { Transform: { position } } }];
  for (const member of members) {
    const local = toGroup.clone().multiply(worldMatrix(scene, member.id));
    ops.push(member.components.Transform
      ? { op: "update", id: member.id, components: { Transform: transformFrom(local) }, parent: groupId }
      : { op: "update", id: member.id, components: {}, parent: groupId });
  }
  return { ops };
}

/** Ops that move a group's children up to the group's parent and delete the empty group. */
export function ungroupOps(scene: Scene, id: string): { ops: SceneOp[]; error?: string } {
  const group = find(scene, id);
  if (!group) return { ops: [], error: `Object '${id}' does not exist.` };
  const children = childrenOf(scene, id);
  if (!children.length) return { ops: [], error: `${group.name} has no children to ungroup.` };
  const ops = children.flatMap((child) => reparentOps(scene, child.id, group.parent).ops);
  // Only remove the group itself when it is just a container (no mesh, light, script...).
  const onlyTransform = Object.keys(group.components).every((name) => name === "Transform");
  if (onlyTransform) ops.push({ op: "delete", id });
  return { ops };
}

/** A fresh id like `group`, `group_2`, ... that is not used in the scene. */
export function uniqueId(scene: Scene, base: string): string {
  let index = 1;
  const make = () => index === 1 ? base : `${base}_${index}`;
  while (scene.entities.some((entity) => entity.id === make())) index += 1;
  return make();
}
