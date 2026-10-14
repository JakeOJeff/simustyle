import * as THREE from "three";
import { componentSchemas } from "../registry";
import { isSelfOrAncestor, relativeTransform, worldMatrix } from "./hierarchy";
import type { Entity, Scene, SceneOp, Vec3 } from "./types";

export interface EntityClipboard {
  entities: Entity[];
  rootWorld: number[];
}

export function copyEntityTree(scene: Scene, id: string): EntityClipboard | null {
  const root = scene.entities.find((entity) => entity.id === id);
  if (!root) return null;
  return {
    entities: structuredClone([root, ...scene.entities.filter((entity) => entity.id !== id && isSelfOrAncestor(scene, id, entity.parent))]),
    rootWorld: worldMatrix(scene, id).toArray()
  };
}

/** Copy internal references and preserve the captured world pose even if the old parent disappears. */
export function pasteEntityOps(scene: Scene, clipboard: EntityClipboard, options: { parent?: string | null; position?: Vec3 | null } = {}): { ops: SceneOp[]; rootId?: string; error?: string } {
  const root = clipboard.entities[0];
  if (!root) return { ops: [], error: "The clipboard is empty." };
  const usedIds = new Set(scene.entities.map((entity) => entity.id));
  const ids = new Map<string, string>();
  for (const source of clipboard.entities) {
    let suffix = 1;
    let id = `${source.id}_copy`;
    while (usedIds.has(id)) id = `${source.id}_copy${++suffix}`;
    usedIds.add(id);
    ids.set(source.id, id);
  }
  const parent = options.parent !== undefined ? options.parent
    : options.position ? null : scene.entities.some((entity) => entity.id === root.parent) ? root.parent : null;
  if (parent !== null && !scene.entities.some((entity) => entity.id === parent)) return { ops: [], error: "The paste destination no longer exists." };
  const world = new THREE.Matrix4().fromArray(clipboard.rootWorld);
  const point = new THREE.Vector3().setFromMatrixPosition(world);
  if (options.position) point.set(options.position[0], point.y, options.position[2]);
  else point.add(new THREE.Vector3(1.5, 0, 1.5));
  world.setPosition(point);
  let transform: ReturnType<typeof relativeTransform>;
  try { transform = relativeTransform(worldMatrix(scene, parent), world); }
  catch (error) { return { ops: [], error: (error as Error).message }; }
  const names = new Set(scene.entities.map((entity) => entity.name.toLowerCase()));
  const ops: SceneOp[] = clipboard.entities.map((source, index) => {
    const components = structuredClone(source.components);
    if (index === 0) components.Transform = { ...components.Transform, ...transform };
    for (const [name, fields] of Object.entries(components)) {
      for (const [field, schema] of Object.entries(componentSchemas[name]?.fields ?? {})) {
        const target = fields[field];
        if (schema.type !== "entityRef" || typeof target !== "string") continue;
        if (ids.has(target)) fields[field] = ids.get(target)!;
        else if (!scene.entities.some((entity) => entity.id === target)) {
          if (name === "Joint") delete components.Joint;
          else fields[field] = null;
        }
      }
    }
    if (components.Camera) components.Camera.isActive = false;
    const base = index === 0 ? `${source.name} Copy` : source.name;
    let name = base;
    let suffix = 2;
    while (names.has(name.toLowerCase())) name = `${base} ${suffix++}`;
    names.add(name.toLowerCase());
    return { op: "create", id: ids.get(source.id)!, name,
      parent: index === 0 ? parent : source.parent ? ids.get(source.parent) ?? source.parent : null, components };
  });
  return { ops, rootId: ids.get(root.id)! };
}
