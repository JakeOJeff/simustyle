// Deterministic clean-up of the scene agent's create operations before validation.
// It fixes the mistakes models make most often when creating objects, which would
// otherwise cost a full retry round trip or leave a broken scene:
//   - an id that already exists (renamed; later references in the batch follow it)
//   - a duplicate name (Crate → Crate2, so scripts can tell them apart)
//   - a missing Transform (every component requires one)
//   - no position (placed at a free floor spot instead of on top of the origin)
//   - sunk into the floor (lifted so its bottom rests on y = 0)
//   - a falling body created inside another object (raised to sit on top of it)
// Only top-level, unrotated meshes are moved: children use parent-relative
// coordinates and tilted bounds are not computed here. The scene agent preserves
// explicitly supplied positions and sends their world bounds to the reviewer.
import { halfExtents, positionOf, uniqueName } from "../runtime/commands";
import type { Entity, Scene, SceneOp } from "../scene/types";
import { freeSpots } from "./sceneContext";
import { componentSchemas } from "../registry";

type CreateOp = Extract<SceneOp, { op: "create" }>;

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

/** Returns corrected operations plus one short note per change, for the reply summary. */
export function tidyCreates(scene: Scene, ops: SceneOp[], options: { preserveExplicitPositions?: boolean } = {}): { ops: SceneOp[]; notes: string[] } {
  const deleted = new Set(ops.flatMap((operation) => (operation.op === "delete" ? [operation.id] : [])));
  const placed: Entity[] = scene.entities.filter((entity) => !deleted.has(entity.id));
  const ids = new Set(placed.map((entity) => entity.id));
  const renamed = new Map<string, string>();
  const notes: string[] = [];

  const result = ops.map((operation): SceneOp => {
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
      const blockers = falling && !preservePosition ? placed.filter((other) => !other.parent && other.components.Mesh && overlaps(entity, other)) : [];
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
