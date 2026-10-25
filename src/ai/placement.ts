// Deterministic clean-up of the scene agent's create operations before validation.
// It fixes the mistakes models make most often when creating objects, which would
// otherwise cost a full retry round trip or leave a broken scene:
//   - an id that already exists (renamed; later references in the batch follow it)
//   - a duplicate name (Crate → Crate2, so scripts can tell them apart)
//   - a missing Transform (every component requires one)
//   - no position (placed at a free floor spot instead of on top of the origin)
//   - sunk into the floor (lifted so its bottom rests on y = 0)
//   - a falling body created inside another object (raised to sit on top of it)
//   - a container (a new object that the same batch moves existing objects into): centered on its
//     contents instead of a free spot, and contents moved without a position keep their world pose
// Only top-level, unrotated meshes are moved: children use parent-relative
// coordinates and tilted bounds are not computed here. The scene agent preserves
// explicitly supplied positions and sends their world bounds to the reviewer.
import * as THREE from "three";
import { halfExtents, positionOf, uniqueName } from "../runtime/commands";
import { relativeTransform, worldMatrix } from "../scene/hierarchy";
import type { Entity, Scene, SceneOp } from "../scene/types";
import { meshWorldBounds } from "./quality";
import { freeSpots } from "./sceneContext";
import { componentSchemas } from "../registry";

type CreateOp = Extract<SceneOp, { op: "create" }>;
type UpdateOp = Extract<SceneOp, { op: "update" }>;

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isUnrotated(components: CreateOp["components"]): boolean {
  const rotation = components.Transform?.rotation;
  return !Array.isArray(rotation) || rotation.every((value) => Math.abs(Number(value)) < 0.01);
}

function freeId(base: string, taken: Set<string>): string {
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

function overlaps(a: Entity, b: Entity): boolean {
  const [ax, ay, az] = positionOf(a);
  const [bx, by, bz] = positionOf(b);
  const ha = halfExtents(a);
  const hb = halfExtents(b);
  return Math.abs(ax - bx) < ha[0] + hb[0] && Math.abs(ay - by) < ha[1] + hb[1] && Math.abs(az - bz) < ha[2] + hb[2];
}

/** World bounds of the meshes in each entity's subtree, or null when there are none. */
export function subtreeBounds(scene: Scene, ids: readonly string[]): THREE.Box3 | null {
  const box = new THREE.Box3();
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const bounds = meshWorldBounds(scene, id);
    if (bounds) box.union(bounds);
    for (const child of scene.entities) if (child.parent === id) visit(child.id);
  };
  ids.forEach(visit);
  return box.isEmpty() ? null : box;
}

/** Returns corrected operations plus one short note per change, for the reply summary. */
export function tidyCreates(scene: Scene, ops: SceneOp[], options: { preserveExplicitPositions?: boolean } = {}): { ops: SceneOp[]; notes: string[] } {
  const deleted = new Set(ops.flatMap((operation) => (operation.op === "delete" ? [operation.id] : [])));
  const placed: Entity[] = scene.entities.filter((entity) => !deleted.has(entity.id));
  const ids = new Set(placed.map((entity) => entity.id));
  const renamed = new Map<string, string>();
  const notes: string[] = [];
  const existing = new Map(scene.entities.map((entity) => [entity.id, entity]));
  // Container id (as the model wrote it) → existing objects this batch moves into it.
  const contents = new Map<string, string[]>();
  for (const operation of ops) {
    if (operation.op === "update" && typeof operation.parent === "string" && existing.has(operation.id)) contents.set(operation.parent, [...contents.get(operation.parent) ?? [], operation.id]);
  }

  /** An existing object moved into a new parent stays where it is in the world, unless the update positions it itself. */
  const keepWorldPose = (operation: UpdateOp): SceneOp => {
    const update: UpdateOp = structuredClone(operation);
    if (update.parent && renamed.has(update.parent)) update.parent = renamed.get(update.parent)!;
    const entity = existing.get(update.id);
    const given = update.components?.Transform;
    if (!entity || entity.parent === update.parent || given === null || Array.isArray(given?.position)) return update;
    try {
      const pose = relativeTransform(worldMatrix({ ...scene, entities: placed }, update.parent ?? null), worldMatrix(scene, update.id));
      update.components = { ...update.components, Transform: { ...pose, ...given } };
    } catch { /* a distorting parent: leave the model's update for validation to report */ }
    return update;
  };

  const result = ops.map((operation): SceneOp => {
    if (operation.op === "update" && typeof operation.parent === "string") return keepWorldPose(operation);
    if (operation.op !== "create" || typeof operation.id !== "string" || !operation.components || typeof operation.components !== "object") return operation;
    const create: CreateOp = structuredClone(operation);
    if (create.parent && renamed.has(create.parent)) create.parent = renamed.get(create.parent)!;
    for (const [name, component] of Object.entries(create.components)) {
      for (const [field, schema] of Object.entries(componentSchemas[name]?.fields ?? {})) {
        if (schema.type === "entityRef" && component && typeof component[field] === "string" && renamed.has(component[field] as string)) component[field] = renamed.get(component[field] as string)!;
      }
    }

    if (ids.has(create.id)) {
      const id = freeId(create.id, ids);
      renamed.set(create.id, id);
      create.id = id;
    }
    ids.add(create.id);

    const name = uniqueName({ ...scene, entities: placed }, create.name, false);
    if (name !== create.name) { notes.push(`named the new ${create.name} "${name}" because that name was taken`); create.name = name; }

    if (!create.components.Transform) create.components.Transform = {};
    const transform = create.components.Transform;
    const preservePosition = options.preserveExplicitPositions && Array.isArray(transform.position);
    const entity: Entity = { id: create.id, name: create.name, parent: create.parent, components: create.components };
    const mesh = create.components.Mesh;
    const inside = contents.get(operation.id) ?? [];
    const held = !create.parent && !Array.isArray(transform.position) ? subtreeBounds(scene, inside) : null;
    if (held) {
      // A container goes around what it holds; a mesh container still rests on the floor.
      const center = held.getCenter(new THREE.Vector3());
      transform.position = [round(center.x), mesh && mesh.shape !== "plane" ? round(halfExtents(entity)[1]) : 0, round(center.z)];
      notes.push(`centered ${create.name} on the objects moved inside it`);
    }
    if (!create.parent && mesh && mesh.shape !== "plane" && isUnrotated(create.components)) {
      const half = halfExtents(entity);
      if (!Array.isArray(transform.position)) {
        const [x, z] = freeSpots(placed, 1, Math.max(half[0], half[2]))[0] ?? [0, 0];
        transform.position = [x, round(half[1]), z];
      } else if (!preservePosition && positionOf(entity)[1] - half[1] < -0.001) {
        transform.position = [positionOf(entity)[0], round(half[1]), positionOf(entity)[2]];
        notes.push(`lifted ${create.name} onto the floor`);
      }
      const falling = create.components.RigidBody && create.components.RigidBody.anchored !== true && (create.components.RigidBody.bodyType ?? "dynamic") === "dynamic";
      const blockers = falling && !preservePosition ? placed.filter((other) => !other.parent && !inside.includes(other.id) && other.components.Mesh && overlaps(entity, other)) : [];
      if (blockers.length) {
        const top = Math.max(...blockers.map((other) => positionOf(other)[1] + halfExtents(other)[1]));
        const [x, , z] = positionOf(entity);
        transform.position = [x, round(top + half[1] + 0.01), z];
        notes.push(`raised ${create.name} so it does not start inside ${blockers[0]!.name}`);
      }
    }
    placed.push(entity);
    return create;
  });

  return { ops: result, notes };
}
