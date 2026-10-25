// Chunked visual inspection of a finished build: the objects a build touched are split into chunks (one object or
// group each, large structures split by their sub-groups, small loose pieces clustered by distance), each chunk is
// rendered alone from its six faces (see snapshot.ts) and critiqued on its own, and failing chunks get their own fix
// pass (see runSceneAgent).
import * as THREE from "three";
import type { Entity, Scene } from "../scene/types";
import { meshWorldBounds } from "./quality";
import type { SceneCritique } from "./critique";

/**
 * A subtree longer than this (m) or covering more floor than MAX_CHUNK_AREA (m²) is split into its sub-groups when it
 * has any: a house or a room, whose contents would be small and hidden behind walls in views of the whole. An object
 * of any part count within both stays whole, so a car is always seen as a car.
 */
export const MAX_CHUNK_SIZE = 6;
export const MAX_CHUNK_AREA = 12;
/** At most this many chunks are inspected per round, largest first. */
export const MAX_CHUNKS = 14;
/** Loose single parts closer than this (m) are inspected together. */
const CLUSTER_GAP = 0.6;

export interface InspectionChunk {
  /** Stable across rounds while the same ids make the chunk. */
  key: string;
  name: string;
  /** Entities whose subtrees form the chunk. */
  ids: string[];
  parts: number;
}

function childrenOf(scene: Scene): Map<string | null, Entity[]> {
  const children = new Map<string | null, Entity[]>();
  for (const entity of scene.entities) {
    const list = children.get(entity.parent) ?? [];
    list.push(entity);
    children.set(entity.parent, list);
  }
  return children;
}

/** Ids of the entity's subtree, itself first. */
export function subtreeIds(scene: Scene, id: string): string[] {
  const children = childrenOf(scene);
  const ids = [id];
  for (let index = 0; index < ids.length; index += 1) for (const child of children.get(ids[index]!) ?? []) ids.push(child.id);
  return ids;
}

/** The top-level ancestor of each id that still exists, once each, in scene order. */
export function rootsOf(scene: Scene, ids: readonly string[]): string[] {
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const roots = new Set<string>();
  for (const id of ids) {
    let entity = byId.get(id);
    while (entity?.parent && byId.has(entity.parent)) entity = byId.get(entity.parent);
    if (entity) roots.add(entity.id);
  }
  return scene.entities.filter((entity) => roots.has(entity.id)).map((entity) => entity.id);
}

/** World bounds of the meshes under the ids, or null when there are none. */
export function chunkBounds(scene: Scene, ids: readonly string[]): THREE.Box3 | null {
  const box = new THREE.Box3();
  for (const id of ids) for (const member of subtreeIds(scene, id)) {
    const bounds = meshWorldBounds(scene, member);
    if (bounds) box.union(bounds);
  }
  return box.isEmpty() ? null : box;
}

/** Floors, ground slabs and flat planes: nothing to see from six sides. */
function isGround(scene: Scene, entity: Entity): boolean {
  if (entity.components.Mesh?.shape === "plane") return true;
  const box = meshWorldBounds(scene, entity.id);
  return !!box && box.max.y - box.min.y <= 0.3 && box.max.y <= 0.35 && box.max.x - box.min.x >= 2 && box.max.z - box.min.z >= 2;
}

/**
 * Chunks covering the subtrees of the given top-level roots. A subtree larger than MAX_CHUNK_SIZE or MAX_CHUNK_AREA,
 * or already in `split` (which records each split, so a structure stays split while fixes change its size), is split
 * into its child groups (recursively) plus one chunk of its remaining direct parts; single-part roots are clustered
 * with neighbours; ground-only chunks are left out. Largest first, at most MAX_CHUNKS.
 */
export function planChunks(scene: Scene, roots: readonly string[], split = new Set<string>()): InspectionChunk[] {
  const children = childrenOf(scene);
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const meshes = (ids: readonly string[]) => ids.flatMap((id) => subtreeIds(scene, id)).map((id) => byId.get(id)!).filter((entity) => entity.components.Mesh);
  const chunks: InspectionChunk[] = [];
  const add = (name: string, ids: string[]) => {
    const parts = meshes(ids);
    if (!parts.length || parts.every((entity) => isGround(scene, entity))) return;
    chunks.push({ key: [...ids].sort().join("+"), name, ids, parts: parts.length });
  };
  const divide = (id: string) => {
    const entity = byId.get(id)!;
    const kids = children.get(id) ?? [];
    const groups = kids.filter((child) => children.has(child.id));
    const size = chunkBounds(scene, [id])?.getSize(new THREE.Vector3());
    const large = !!size && (Math.max(size.x, size.y, size.z) > MAX_CHUNK_SIZE || size.x * size.z > MAX_CHUNK_AREA);
    if (!groups.length || !(large || split.has(id))) { add(entity.name, [id]); return; }
    split.add(id);
    groups.forEach((group) => divide(group.id));
    const rest = kids.filter((child) => !children.has(child.id)).map((child) => child.id);
    if (rest.length) add(`${entity.name} (other parts)`, rest);
  };
  const loose: string[] = [];
  for (const id of roots) {
    if (!byId.has(id)) continue;
    if (children.has(id) || !byId.get(id)!.components.Mesh) divide(id);
    // A floor touches everything on it, so it never joins a cluster.
    else if (!isGround(scene, byId.get(id)!)) loose.push(id);
  }
  // Clusters of loose parts: each joins the first cluster it comes within CLUSTER_GAP of.
  const clusters: { ids: string[]; box: THREE.Box3 }[] = [];
  for (const id of loose) {
    const box = meshWorldBounds(scene, id);
    if (!box) continue;
    const near = clusters.filter((cluster) => cluster.box.clone().expandByScalar(CLUSTER_GAP).intersectsBox(box));
    const target = near[0] ?? { ids: [], box: new THREE.Box3() };
    if (!near.length) clusters.push(target);
    // A part that bridges several clusters merges them.
    for (const other of near.slice(1)) { target.ids.push(...other.ids); target.box.union(other.box); clusters.splice(clusters.indexOf(other), 1); }
    target.ids.push(id);
    target.box.union(box);
  }
  for (const cluster of clusters) {
    const names = [...new Set(cluster.ids.map((id) => byId.get(id)!.name))];
    add(names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", "), cluster.ids);
  }
  return chunks.sort((a, b) => b.parts - a.parts).slice(0, MAX_CHUNKS);
}

/** What the chunk is, for its critique and fix pass. */
export function chunkDescription(scene: Scene, chunk: InspectionChunk): string {
  const box = chunkBounds(scene, chunk.ids);
  const size = box ? box.getSize(new THREE.Vector3()).toArray().map((value) => Math.round(value * 100) / 100).join("×") : "?";
  const center = box ? box.getCenter(new THREE.Vector3()).toArray().map((value) => Math.round(value * 100) / 100) : null;
  return `"${chunk.name}" (ids ${chunk.ids.slice(0, 12).join(", ")}${chunk.ids.length > 12 ? ", …" : ""}), ${chunk.parts} mesh parts, ${size} m${center ? `, centered at x ${center[0]} y ${center[1]} z ${center[2]}` : ""}`;
}

/**
 * The scene reduced to the chunk: the subtrees of its ids, plus their ancestors with their Mesh removed (so their
 * transforms still apply). Lights outside the chunk are dropped; the renderer stages its own.
 */
export function isolateScene(scene: Scene, ids: readonly string[]): Scene {
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const keep = new Set(ids.flatMap((id) => byId.has(id) ? subtreeIds(scene, id) : []));
  const ancestors = new Set<string>();
  for (const id of ids) {
    for (let parent = byId.get(id)?.parent; parent && byId.has(parent) && !keep.has(parent); parent = byId.get(parent)!.parent) ancestors.add(parent);
  }
  const entities = scene.entities.flatMap((entity): Entity[] => {
    if (keep.has(entity.id)) return [entity];
    if (!ancestors.has(entity.id)) return [];
    return [{ ...entity, components: { Transform: entity.components.Transform } } as Entity];
  });
  return { ...scene, entities };
}

/**
 * Names of the mesh parts a fix created or moved (with everything under them) that end up outside the scene's bounds
 * before the fix, grown by 10% of its largest side (at least 0.3 m). A fix only refines what is there; parts that
 * land outside it were placed in the wrong space (world positions under a parent), as a real run did with a rug and
 * floor planks.
 */
export function strayParts(before: Scene, after: Scene, ops: readonly { op: string; id?: string }[]): string[] {
  const box = new THREE.Box3();
  for (const entity of before.entities) {
    const bounds = entity.components.Mesh ? meshWorldBounds(before, entity.id) : null;
    if (bounds) box.union(bounds);
  }
  if (box.isEmpty()) return [];
  const size = box.getSize(new THREE.Vector3());
  box.expandByScalar(Math.max(0.3, 0.1 * Math.max(size.x, size.y, size.z)));
  const moved = new Set(ops.flatMap((op) => (op.op === "create" || op.op === "update") && op.id && after.entities.some((entity) => entity.id === op.id) ? subtreeIds(after, op.id) : []));
  return after.entities.filter((entity) => moved.has(entity.id) && entity.components.Mesh)
    .filter((entity) => { const bounds = meshWorldBounds(after, entity.id); return !!bounds && !box.containsBox(bounds); })
    .map((entity) => entity.name);
}

/** At or below this score, a chunk's fix pass rebuilds it whole instead of patching it. */
export const REBUILD_SCORE = 4;

/** The fix pass's request for one failing target; `rebuild` names the root ids of a chunk to rebuild whole. */
export function fixRequestText(request: string, target: string, critique: SceneCritique, spec?: string, rebuild?: readonly string[]): string {
  const how = rebuild?.length
    ? `The object is too far off to patch. Rebuild it whole: delete ${rebuild.map((id) => `"${id}"`).join(", ")} and create the object again with assemble (it may keep the same root id), at the same place, size and facing, solving every listed problem${spec ? " and matching the reference concept" : ""}. Use curved and bevelled shapes where the real thing is curved, and 30-80 parts.`
    : "Fix every one of them in the current scene. Return only the ops that change it (update, delete, or create for missing parts); keep what is already right, keep ids, and keep every part attached to what it belongs to.";
  return `A reviewer inspected renders of ${target} from every side, built for this request: "${request.slice(0, 2_000)}". It scored ${critique.score}/10 and found the problems listed after this message. Earlier fixes may already have solved some of them: check the current scene and skip those. ${how}${spec ? `\n\n${spec}` : ""}`;
}
