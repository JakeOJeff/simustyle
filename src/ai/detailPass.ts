// Two-stage building: the layout reply lists the substantial objects of a scene in "detail" instead of
// modeling them, and each is then built in its own high-detail call. These helpers validate that list,
// write the detail-pass request, and fit a finished object into its layout box under unique ids.
import * as THREE from "three";
import { componentSchemas } from "../registry";
import { applyOps } from "../scene/applyOps";
import { createEmptyScene, type SceneOp, type Vec3 } from "../scene/types";
import { meshWorldBounds } from "./quality";

export interface DetailItem {
  id: string;
  name: string;
  /** Key features, sub-parts, materials and colors, as the layout model described them. */
  description: string;
  /** Center of the object's base, in the parent's space. */
  position: Vec3;
  rotation: Vec3;
  /** Width, height, depth of the box the object must fit in (meters). */
  size: Vec3;
  parent: string | null;
}

/** At most this many objects are detailed per request; the rest are reported as skipped. */
export const MAX_DETAIL_ITEMS = 24;
/** An object may exceed its layout box by this factor before it is scaled down to fit. */
const FIT_TOLERANCE = 1.15;

const isVec3 = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));
const text = (value: unknown, max: number): string | null => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** The valid entries of a reply's "detail" list; invalid entries are reported, never guessed at. */
export function parseDetailItems(value: unknown): { items: DetailItem[]; errors: string[] } {
  if (value === undefined) return { items: [], errors: [] };
  if (!Array.isArray(value)) return { items: [], errors: ["detail must be an array of objects to build in detail."] };
  const items: DetailItem[] = [];
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of value.slice(0, MAX_DETAIL_ITEMS).entries()) {
    const entry = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const id = text(entry.id, 60);
    const name = text(entry.name, 80);
    const size = entry.size;
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || !name || !isVec3(entry.position) || !isVec3(size) || size.some((part) => part <= 0 || part > 100) ||
        (entry.rotation !== undefined && !isVec3(entry.rotation)) || (entry.parent !== undefined && entry.parent !== null && !text(entry.parent, 60))) {
      errors.push(`detail[${index}] needs a snake_case id, a name, a position [x,y,z], a size [w,h,d] in 0..100 m, and optional rotation and parent.`);
      continue;
    }
    if (ids.has(id)) { errors.push(`detail[${index}] repeats the id '${id}'.`); continue; }
    ids.add(id);
    items.push({ id, name, description: text(entry.description, 600) ?? name, position: entry.position as Vec3, rotation: isVec3(entry.rotation) ? entry.rotation : [0, 0, 0],
      size: size as Vec3, parent: typeof entry.parent === "string" ? entry.parent : null });
  }
  if (value.length > MAX_DETAIL_ITEMS) errors.push(`Only the first ${MAX_DETAIL_ITEMS} detail objects are built; group small props into one item.`);
  return { items, errors };
}

/** The user message for one object's detail pass. */
export function detailPrompt(request: string, plan: string, items: readonly DetailItem[], item: DetailItem): string {
  const others = items.filter((other) => other !== item).map((other) => `${other.name} (${other.size.join("×")} m)`).join(", ");
  return `## Detail pass
The scene for this request was laid out; you now build ONE object of it in high detail.
Request: ${request.slice(0, 2000)}
Layout plan: ${plan.slice(0, 1500) || "(none)"}
Other objects in the scene (built separately; match their style, do not build them): ${others || "none"}

## Build only this object
id: ${item.id}
name: ${item.name}
description: ${item.description}
size: ${item.size[0]} wide (x) × ${item.size[1]} tall (y) × ${item.size[2]} deep (z) m; its front faces +z.

Return {"plan","summary","ops"} where ops is exactly one assemble op: id "${item.id}", name "${item.name}", parent null, NO transform. Positions are local: the origin is the center of the object's base, y=0 is its bottom, and every part fits inside the size above. Use 15–60 parts, in this order: the main forms, then the items it holds or carries if the description names them, then the features that make it recognizable (handles, legs, cushions, frames). Every part must be visible from a room-wide camera: nothing under 5 cm on every side, and no decorative lines, seams, stitching, buttons, bolts or labels. A Light goes only inside a glowing part (bulb, flame, screen). Use repeat ops after the assemble for repeated features. Start every part id with "${item.id}_". Settings, cameras and other objects are not allowed.`;
}

/**
 * One finished detail reply (already expanded to create ops) placed into its layout slot: ids that don't start
 * with "<id>_" get that prefix (and every reference to them follows), the object is re-centered on its base,
 * scaled down uniformly if it overflows its box, and its root takes the layout position, rotation and parent.
 */
export function fitDetailObject(item: DetailItem, ops: readonly SceneOp[]): { ops: SceneOp[]; notes: string[] } {
  const notes: string[] = [];
  const creates = ops.filter((op): op is Extract<SceneOp, { op: "create" }> => op.op === "create");
  const root = creates.find((op) => op.id === item.id) ?? creates.find((op) => op.parent === null);
  if (!root) return { ops: [], notes: [`${item.name}: the detail reply had no object.`] };
  const ids = new Map<string, string>();
  for (const op of creates) ids.set(op.id, op === root ? item.id : op.id.startsWith(`${item.id}_`) ? op.id : `${item.id}_${op.id}`);
  const remapped = creates.map((op): Extract<SceneOp, { op: "create" }> => {
    const components = structuredClone(op.components);
    for (const [name, fields] of Object.entries(components)) {
      for (const [field, schema] of Object.entries(componentSchemas[name]?.fields ?? {})) {
        if (schema.type === "entityRef" && typeof fields[field] === "string" && ids.has(fields[field] as string)) fields[field] = ids.get(fields[field] as string);
      }
    }
    if (op === root) components.Transform = {};
    return { op: "create", id: ids.get(op.id)!, name: op === root ? item.name : op.name, parent: op === root ? null : ids.get(op.parent ?? "") ?? item.id, components };
  });

  // Measure at the origin with an identity root, then shift the root's children so the base center is the origin.
  // Shape alone decides the size, so a part with a broken field (repaired later by the caller) is measured without it.
  let measured = createEmptyScene();
  for (const op of remapped) {
    const { Transform, Mesh } = op.components;
    const shape = applyOps(measured, [op]);
    measured = shape.errors.length ? applyOps(measured, [{ ...op, components: { ...(Transform ? { Transform } : {}), ...(Mesh ? { Mesh } : {}) } }]).scene : shape.scene;
  }
  if (!measured.entities.some((entity) => entity.id === item.id)) return { ops: [], notes: [`${item.name}: ${applyOps(createEmptyScene(), remapped).errors.slice(0, 2).join("; ")}`] };
  const bounds = new THREE.Box3();
  for (const entity of measured.entities) if (entity.components.Mesh) bounds.union(meshWorldBounds(measured, entity.id)!);
  if (bounds.isEmpty()) return { ops: [], notes: [`${item.name}: the detail reply had no visible parts.`] };
  const actual = bounds.getSize(new THREE.Vector3());
  const ratio = Math.max(actual.x / item.size[0], actual.y / item.size[1], actual.z / item.size[2]);
  const scale = ratio > FIT_TOLERANCE ? 1 / ratio : 1;
  if (scale < 1) notes.push(`${item.name} was scaled to ${Math.round(scale * 100)}% to fit its ${item.size.join("×")} m space`);
  const shift: Vec3 = [-(bounds.min.x + bounds.max.x) / 2, -bounds.min.y, -(bounds.min.z + bounds.max.z) / 2];
  const placed = remapped.map((op): SceneOp => {
    if (op.id === item.id) {
      return { ...op, parent: item.parent, components: { Transform: { position: item.position, ...(item.rotation.some(Boolean) ? { rotation: item.rotation } : {}), ...(scale < 1 ? { scale: [scale, scale, scale] } : {}) } } };
    }
    if (op.parent !== item.id) return op;
    const position = (op.components.Transform?.position as Vec3 | undefined) ?? [0, 0, 0];
    return { ...op, components: { ...op.components, Transform: { ...op.components.Transform, position: position.map((value, axis) => Math.round((value + shift[axis]!) * 1e4) / 1e4) } } };
  });
  return { ops: placed, notes };
}

/** A detail reply still streaming, shown in its layout slot (unfitted) so it grows in the right place. */
export function placeLiveDetail(item: DetailItem, ops: readonly unknown[]): unknown[] {
  return ops.map((op) => {
    const fields = op as Record<string, unknown>;
    if (fields?.op !== "assemble") return op;
    return { ...fields, id: item.id, name: item.name, parent: item.parent, transform: { position: item.position, rotation: item.rotation } };
  }).filter((op) => (op as Record<string, unknown>)?.op === "assemble");
}
