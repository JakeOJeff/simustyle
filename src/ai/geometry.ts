import * as THREE from "three";
import { halfExtents } from "../runtime/commands";
import { meshWorldBounds } from "./quality";
import type { Entity, Scene, SceneOp } from "../scene/types";

const TOUCH = 0.05;
/** Separate top-level objects may interpenetrate this much (a deliberate snug fit) before it reads as a mistake. */
const OVERLAP = 0.03;
const MAX_LINES = 12;
/** Requests whose objects may legitimately leave the ground. */
const AIRBORNE = /\b(float|floating|fly|flying|flies|hover|hovering|levitat|airborne|in the air|in the sky|cloud|balloon|hanging|hang|hung|ceiling|chandelier|orbit|outer space|in space|zero gravity|bird|drone|plane|jet|spaceship|ufo|underwater|submerged|buried)\w*/i;

/** Requests that put existing objects inside another one. */
const CONTAINMENT = /\b(inside|into|within|around|enclos\w*|surround\w*|contain\w*)\b/i;
/** Things held aloft on a string (matched by their own or an ancestor's name; nothing else marks them). Hot-air balloons fly free. */
const HELD = /\b(balloon|kite|pi[nñ]ata)s?\b/i;
const FREE_FLYING = /\bhot[\s-]*air\b/i;

/** Round to 2 decimals without trailing zeros (and never "-0"). */
const meters = (value: number) => String(Math.round(Math.abs(value) * 100) / 100);

/** Per-axis separation between two boxes: positive when b lies on the + side of a, negative on the - side, 0 when overlapping. */
function separation(a: THREE.Box3, b: THREE.Box3): [number, number, number] {
  return (["x", "y", "z"] as const).map((axis) =>
    b.min[axis] > a.max[axis] ? b.min[axis] - a.max[axis] : a.min[axis] > b.max[axis] ? b.max[axis] - a.min[axis] : 0) as [number, number, number];
}
const gap = (a: THREE.Box3, b: THREE.Box3) => Math.hypot(...separation(a, b));

/** Flat (at most 0.3 m thick), at least 1×1 m, with its top at the ground plane. */
const isGroundSlab = (box: THREE.Box3) => Math.abs(box.max.y) <= TOUCH && box.max.y - box.min.y <= 0.3 && box.max.x - box.min.x >= 1 && box.max.z - box.min.z >= 1;

const isGroup = (entity: Entity) => Object.keys(entity.components).every((key) => key === "Transform");
const isDynamic = (entity: Entity) => {
  const body = entity.components.RigidBody;
  return !!body && body.anchored !== true && (body.bodyType ?? "dynamic") === "dynamic";
};

/** A string, cord or rod: two short sides (≤ 5 cm) and a length at least 5× that. */
export const isThin = (entity: Entity) => {
  const [a, b, c] = halfExtents(entity).map((half) => half * 2).sort((x, y) => x - y) as [number, number, number];
  return a >= 0 && b <= 0.05 && c >= 5 * b;
};

export interface Tether {
  /** A floating mesh of a held object (a balloon, a kite). */
  mesh: Entity;
  /** The held object it belongs to: the nearest ancestor-or-self whose name says what it is. */
  object: Entity;
  /** Whether a thin part (string) is connected to it. */
  string: boolean;
  /** What the string is tied to: a mesh, the ground, or nothing. */
  anchor: Entity | "ground" | null;
}

/**
 * How each floating held object is tied down. Balloons, knots and strings that touch form one chain; it is
 * tethered when a string in the chain touches something else (the anchor) or the ground.
 */
export function tethers(scene: Scene): Tether[] {
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const lineage = (entity: Entity) => {
    const chain = [entity];
    for (let parent = byId.get(entity.parent ?? ""); parent && !chain.includes(parent); parent = byId.get(parent.parent ?? "")) chain.push(parent);
    return chain;
  };
  const heldBy = (entity: Entity) => {
    const chain = lineage(entity);
    return chain.some((member) => FREE_FLYING.test(member.name)) ? undefined : chain.find((member) => HELD.test(member.name));
  };
  const meshes = scene.entities.filter((entity) => entity.components.Mesh);
  const boxes = new Map(meshes.map((entity) => [entity.id, meshWorldBounds(scene, entity.id)!]));
  const thin = new Set(meshes.filter(isThin));
  const held = new Set(meshes.filter((mesh) => !thin.has(mesh) && heldBy(mesh)));
  const touching = (a: Entity, b: Entity) => gap(boxes.get(a.id)!, boxes.get(b.id)!) <= TOUCH;
  const others = meshes.filter((mesh) => !thin.has(mesh) && !held.has(mesh));
  const floating = [...held].filter((mesh) => {
    const box = boxes.get(mesh.id)!;
    return box.min.y > TOUCH && !others.some((other) => boxes.get(other.id)!.max.y <= box.min.y + TOUCH && touching(mesh, other));
  });
  const chains = new Map<Entity, { string: boolean; anchor: Tether["anchor"] }>();
  for (const start of floating) {
    if (chains.has(start)) continue;
    const chain = new Set([start]);
    for (const member of chain) {
      for (const next of [...held, ...thin]) if (!chain.has(next) && touching(member, next)) chain.add(next);
    }
    const strings = [...chain].filter((mesh) => thin.has(mesh));
    let anchor: Tether["anchor"] = null;
    for (const string of strings) {
      anchor = others.find((other) => touching(string, other)) ?? (boxes.get(string.id)!.min.y <= TOUCH ? "ground" : null);
      if (anchor) break;
    }
    for (const mesh of chain) chains.set(mesh, { string: strings.length > 0, anchor });
  }
  return floating.map((mesh) => ({ mesh, object: heldBy(mesh)!, ...chains.get(mesh)! }));
}

/** "is 0.4 m below Body; move it up 0.42 m" — words describe where the part sits relative to the reference. */
function describeOffset(part: THREE.Box3, reference: THREE.Box3, referenceName: string): string {
  // Offset of the part relative to the reference: + means the part is on the reference's + side.
  const offset = separation(reference, part);
  const words: [string, string, string, string][] = [["right of", "left of", "left", "right"], ["above", "below", "down", "up"], ["in front of", "behind", "back", "forward"]];
  const axes = [0, 1, 2].filter((axis) => Math.abs(offset[axis]!) >= 0.005).sort((a, b) => Math.abs(offset[b]!) - Math.abs(offset[a]!) || a - b);
  const where = axes.map((axis) => `${meters(offset[axis]!)} m ${offset[axis]! > 0 ? words[axis]![0] : words[axis]![1]}`);
  const moves = axes.map((axis) => `${offset[axis]! > 0 ? words[axis]![2] : words[axis]![3]} ${meters(Math.abs(offset[axis]!) + 0.02)} m`);
  return `is ${where.join(" and ")} ${referenceName} and touches nothing; move it ${moves.join(" and ")} so they overlap ~0.02 m`;
}

/**
 * Deterministic post-build geometry review of entities created/updated by `ops` (and their descendants):
 * detached parts, object groups that do not rest on the ground, top-level objects that overlap (one sitting wholly
 * inside the other's interior is contained, not overlapping), held floating objects with no string to an anchor, and
 * objects moved inside a container they do not fit in. One correction line per problem.
 */
export function checkGeometry(scene: Scene, ops: SceneOp[], request: string): string[] {
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const ancestorsOf = (entity: Entity): Entity[] => {
    const chain: Entity[] = [];
    const seen = new Set([entity.id]);
    for (let parent = byId.get(entity.parent ?? ""); parent && !seen.has(parent.id); parent = byId.get(parent.parent ?? "")) {
      seen.add(parent.id); chain.push(parent);
    }
    return chain;
  };
  const touched = new Set(ops.flatMap((op) => op.op === "create" || op.op === "update" ? [op.id] : []));
  const affected = (entity: Entity) => touched.has(entity.id) || ancestorsOf(entity).some((ancestor) => touched.has(ancestor.id));
  const meshes = scene.entities.filter((entity) => entity.components.Mesh);
  const boxes = new Map(meshes.map((entity) => [entity.id, meshWorldBounds(scene, entity.id)!]));
  const rootOf = (entity: Entity) => ancestorsOf(entity).at(-1) ?? entity;
  const lines: string[] = [];

  // Object groups: Transform-only, a direct mesh child, and no object-group or mesh ancestor.
  const hasMeshChild = (entity: Entity) => meshes.some((mesh) => mesh.parent === entity.id);
  const objectGroup = (entity: Entity) => isGroup(entity) && hasMeshChild(entity);
  if (!AIRBORNE.test(request)) {
    const groups = scene.entities.filter((group) => objectGroup(group) && !ancestorsOf(group).some((ancestor) => ancestor.components.Mesh || objectGroup(ancestor)));
    const meshesIn = new Map(groups.map((group) => [group, meshes.filter((mesh) => ancestorsOf(mesh).includes(group))]));
    // Touching sibling sub-assemblies (e.g. Car/Shell and Car/Wheels) are one object, named by their common ancestor.
    const clusters: Entity[][] = [];
    for (const group of groups) {
      const joined = clusters.filter((cluster) => cluster.some((other) => rootOf(other) === rootOf(group) &&
        meshesIn.get(other)!.some((a) => meshesIn.get(group)!.some((b) => gap(boxes.get(a.id)!, boxes.get(b.id)!) <= TOUCH))));
      clusters.splice(0, clusters.length, ...clusters.filter((cluster) => !joined.includes(cluster)), [...joined.flat(), group]);
    }
    clusters.sort((a, b) => scene.entities.indexOf(a[0]!) - scene.entities.indexOf(b[0]!));
    for (const cluster of clusters) {
      if (!cluster.some(affected)) continue;
      const group = cluster.length === 1 ? cluster[0]! : ancestorsOf(cluster[0]!).find((ancestor) => cluster.every((member) => ancestorsOf(member).includes(ancestor)))!;
      const inside = cluster.flatMap((member) => meshesIn.get(member)!);
      const lowest = Math.min(...inside.map((mesh) => boxes.get(mesh.id)!.min.y));
      if (Math.abs(lowest) <= TOUCH) continue;
      // A floor or ground slab whose top is the ground plane (it may extend below y=0) grounds its whole group.
      if (inside.some((mesh) => isGroundSlab(boxes.get(mesh.id)!))) continue;
      const footprint = inside.reduce((box, mesh) => box.union(boxes.get(mesh.id)!), boxes.get(inside[0]!.id)!.clone());
      const resting = meshes.some((mesh) => {
        if (inside.includes(mesh)) return false;
        const box = boxes.get(mesh.id)!;
        return Math.abs(lowest - box.max.y) <= TOUCH && box.min.x < footprint.max.x && box.max.x > footprint.min.x && box.min.z < footprint.max.z && box.max.z > footprint.min.z;
      });
      if (resting) continue;
      lines.push(`${group.name}'s lowest point is at y=${lowest < 0 ? "-" : ""}${meters(lowest)}; move it ${lowest > 0 ? "down" : "up"} ${meters(lowest)} m so it rests on the ground (y=0).`);
    }
  }

  // Parts: parented, non-dynamic meshes. Touching any other mesh or resting on/through the ground counts as support.
  // A root scope where most meshes touch nothing in it is a collection of standalone objects, not an assembly.
  const scopes = new Map<string, Entity[]>();
  for (const mesh of meshes) scopes.set(rootOf(mesh).id, [...scopes.get(rootOf(mesh).id) ?? [], mesh]);
  const assembly = new Map<string, boolean>();
  const isAssembly = (rootId: string) => {
    if (!assembly.has(rootId)) {
      const scope = scopes.get(rootId)!;
      const connected = scope.filter((mesh) => scope.some((other) => other !== mesh && gap(boxes.get(mesh.id)!, boxes.get(other.id)!) <= TOUCH));
      assembly.set(rootId, scope.length > 1 && connected.length * 2 >= scope.length);
    }
    return assembly.get(rootId)!;
  };
  for (const part of meshes) {
    if (part.parent === null || isDynamic(part) || !affected(part)) continue;
    const box = boxes.get(part.id)!;
    if (box.min.y <= TOUCH && box.max.y >= -TOUCH) continue;
    if (meshes.some((other) => other !== part && gap(box, boxes.get(other.id)!) <= TOUCH)) continue;
    const rootId = rootOf(part).id;
    if (!isAssembly(rootId)) continue;
    let nearest: Entity | undefined;
    for (const other of scopes.get(rootId)!) {
      if (other !== part && (!nearest || gap(box, boxes.get(other.id)!) < gap(box, boxes.get(nearest.id)!))) nearest = other;
    }
    lines.push(`${part.name} ${describeOffset(box, boxes.get(nearest!.id)!, nearest!.name)}.`);
  }

  // Top-level objects that pass through each other. One resting on/in the other (its lowest point within TOUCH of the
  // top of a part it stands over) is fine; nested objects are parts, not separate objects, and are never compared.
  const roots = [...scopes.keys()].map((id) => byId.get(id)!);
  const lowestOf = (scope: Entity[]) => Math.min(...scope.map((mesh) => boxes.get(mesh.id)!.min.y));
  const restsOn = (upper: Entity[], lower: Entity[]) => {
    const bottom = lowestOf(upper);
    const footprint = upper.reduce((box, mesh) => box.union(boxes.get(mesh.id)!), boxes.get(upper[0]!.id)!.clone());
    return lower.some((mesh) => {
      const box = boxes.get(mesh.id)!;
      return Math.abs(bottom - box.max.y) <= TOUCH && box.min.x < footprint.max.x && box.max.x > footprint.min.x && box.min.z < footprint.max.z && box.max.z > footprint.min.z;
    });
  };
  const unionOf = (scope: Entity[]) => scope.reduce((box, mesh) => box.union(boxes.get(mesh.id)!), new THREE.Box3());
  // Contained: the inner object fits inside the outer one's bounds without being buried in one solid (opaque) part of it.
  const solid = (mesh: Entity) => !(Number(mesh.components.Material?.opacity ?? 1) < 1);
  const containedIn = (inner: Entity[], outer: Entity[]) => {
    const box = unionOf(inner);
    return unionOf(outer).expandByScalar(OVERLAP).containsBox(box) && !outer.some((mesh) => solid(mesh) && boxes.get(mesh.id)!.clone().expandByScalar(OVERLAP).containsBox(box));
  };
  for (const [index, first] of roots.entries()) {
    for (const second of roots.slice(index + 1)) {
      const subject = affected(second) && !affected(first) ? second : first;
      const other = subject === first ? second : first;
      if (!affected(subject)) continue;
      const [a, b] = [scopes.get(subject.id)!, scopes.get(other.id)!];
      if (restsOn(a, b) || restsOn(b, a) || containedIn(a, b) || containedIn(b, a)) continue;
      let depth = 0;
      for (const mesh of a) for (const against of b) {
        // getSize is 0 for an empty (non-overlapping) intersection.
        const size = boxes.get(mesh.id)!.clone().intersect(boxes.get(against.id)!).getSize(new THREE.Vector3());
        depth = Math.max(depth, Math.min(size.x, size.y, size.z));
      }
      if (depth > OVERLAP) lines.push(`${subject.name} overlaps ${other.name} by ${meters(depth)} m; move it apart.`);
    }
  }

  // Objects moved inside a container must fit within it.
  if (CONTAINMENT.test(request)) {
    const subtree = (id: string) => meshes.filter((mesh) => mesh.id === id || ancestorsOf(mesh).some((ancestor) => ancestor.id === id));
    const moves = ops.flatMap((op) => op.op === "update" && typeof op.parent === "string" && byId.has(op.id) && byId.has(op.parent) ? [op as { id: string; parent: string }] : []);
    const moved = new Set(moves.flatMap((move) => subtree(move.id)));
    for (const move of moves) {
      const shell = subtree(move.parent).filter((mesh) => !moved.has(mesh));
      const inner = subtree(move.id);
      if (!shell.length || !inner.length) continue;
      const [outer, box] = [unionOf(shell), unionOf(inner)];
      const excess = Math.max(...(["x", "y", "z"] as const).flatMap((axis) => [outer.min[axis] - box.min[axis], box.max[axis] - outer.max[axis]]));
      const [name, container] = [byId.get(move.id)!.name, byId.get(move.parent)!.name];
      if (excess > OVERLAP) lines.push(`${name} was moved inside ${container} but sticks out of it by ${meters(excess)} m; make ${container} bigger (0.5 m clearance on every side and above) or center it on ${name}.`);
    }
  }

  // Held floating objects need a string to what holds them.
  const loose = new Map<string, { count: number; string: boolean }>();
  for (const tether of tethers(scene)) {
    if (tether.anchor || !affected(tether.mesh)) continue;
    const key = `${tether.object.name}\u0000${tether.string}`;
    loose.set(key, { count: (loose.get(key)?.count ?? 0) + 1, string: tether.string });
  }
  for (const [key, { count, string }] of loose) {
    const name = `${key.split("\u0000")[0]}${count > 1 ? ` (${count} parts)` : ""}`;
    lines.push(string ? `${name}: its string does not reach anything; extend the thin cylinder until it touches its anchor point.`
      : `${name} floats with nothing holding it; add a thin cylinder (radius 0.01) from it to its anchor point.`);
  }
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES - 1), `...and ${lines.length - MAX_LINES + 1} more geometry problems of the same kind.`] : lines;
}
