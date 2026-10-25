// Compact text the scene agent reads: component schemas and the current scene as
// one line per field set / object instead of pretty-printed JSON. It also adds the
// spatial facts the model would otherwise have to guess (sizes, floor contact,
// free places to put new objects) at a fraction of the old token cost.
import { componentSchemas } from "../registry";
import { surfaceTexture, normalTexture } from "../materials/catalog";
import type { ComponentSchema, FieldSchema } from "../registry/types";
import { halfExtents, positionOf } from "../runtime/commands";
import { omitDefaultFields } from "../scene/serialize";
import { DEFAULT_SCENE_SETTINGS, type Entity, type Scene, type SceneSettings } from "../scene/types";
import { BuildCache } from "./cache";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function fieldText(name: string, field: FieldSchema): string {
  const fallback = JSON.stringify(field.default);
  switch (field.type) {
    case "float":
    case "int":
      return `${name} ${field.type} ${field.min}..${field.max} =${"optional" in field && field.optional ? "unset" : fallback}`;
    case "vec3":
      return `${name} vec3${field.min === undefined ? "" : ` ${field.min}..${field.max}`} =${fallback}`;
    case "enum":
      return `${name} ${field.options.join("|")} =${fallback}`;
    case "color":
      return `${name} #rrggbb =${fallback}`;
    case "entityRef":
      return `${name} entity id|null =null`;
    case "string":
      return `${name} ${field.multiline ? "text" : "string"}${field.maxLength ? ` max ${field.maxLength}` : ""} =${fallback}`;
    default:
      return `${name} ${field.type} =${fallback}`;
  }
}

function managedText(schema: ComponentSchema): string {
  return Object.entries(schema.managedFields ?? {}).map(([name, kind]) =>
    kind === "animationTracks" ? `${name} [{component, field, keys:[{time, value, interpolation}]}]` : `${name} {settingName: value}`
  ).join("; ");
}

/** Two lines per component: "Name (requires X): description" and "field type range =default; ...". */
export function componentSchemaText(schemas: Record<string, ComponentSchema> = componentSchemas): string {
  return Object.entries(schemas).map(([name, schema]) => {
    const fields = Object.entries(schema.fields).map(([field, definition]) => fieldText(field, definition));
    const managed = managedText(schema);
    return `${name}${schema.requires?.length ? ` (requires ${schema.requires.join(", ")})` : ""}: ${schema.description}\n  ${[...fields, ...(managed ? [managed] : [])].join("; ")}`;
  }).join("\n");
}

function shapeOf(entity: Entity): string {
  const mesh = entity.components.Mesh;
  if (mesh) {
    const material = entity.components.Material;
    const texture = surfaceTexture(material?.texture);
    const normal = normalTexture(material ?? {});
    return `${String(mesh.shape ?? "box")}${texture || normal ? ` texture=${texture?.id ?? "none"} mapping=${material?.textureMapping ?? "auto"}${material?.textureMapping === "custom" ? ` tiling=${material?.textureRepeatX ?? 1}x${material?.textureRepeatY ?? 1}` : ""} normal=${material?.normalStrength ?? 1} normalMap=${normal?.id ?? "none"} depth=${material?.reliefDepth ?? 0.035} shadow=${material?.occlusionStrength ?? 1}` : ""}`;
  }
  if (entity.components.Light) return `${String(entity.components.Light.type ?? "point")} light`;
  if (entity.components.Camera) return "camera";
  if (entity.components.Script) return "script";
  return "group";
}

/** Rotation is ignored for bounds, so tilted objects report approximate sizes. */
function isUnrotated(entity: Entity): boolean {
  const rotation = entity.components.Transform?.rotation;
  return !Array.isArray(rotation) || rotation.every((value) => Math.abs(Number(value)) < 0.01);
}

function sizeText(entity: Entity): string {
  if (!entity.components.Mesh) return "";
  const half = halfExtents(entity);
  const size = half.map((value) => round(value * 2)).join("×");
  if (entity.parent || !isUnrotated(entity)) return ` ${size} m`;
  const y = positionOf(entity)[1];
  return ` ${size} m, y ${round(y - half[1])} to ${round(y + half[1])}`;
}

/** Floor footprints [minX, maxX, minZ, maxZ] of top-level solid objects; flat planes do not block. */
export function footprints(entities: Entity[]): [number, number, number, number][] {
  return entities.filter((entity) => !entity.parent && entity.components.Mesh && entity.components.Mesh.shape !== "plane").map((entity) => {
    const [x, , z] = positionOf(entity);
    const [hx, , hz] = halfExtents(entity);
    return [x - hx, x + hx, z - hz, z + hz];
  });
}

/** Points on a spiral around the origin where a 1 m object (plus a gap) touches no footprint. */
export function freeSpots(entities: Entity[], count: number, radius = 0.5, gap = 0.3): [number, number][] {
  const taken = footprints(entities);
  const spots: [number, number][] = [];
  for (let index = 0; spots.length < count && index < 400; index += 1) {
    const angle = index * 2.399963229728653;
    const distance = 1.5 * Math.sqrt(index);
    const x = round(distance * Math.cos(angle));
    const z = round(distance * Math.sin(angle));
    const reach = radius + gap;
    const blocked = [...taken, ...spots.map(([sx, sz]): [number, number, number, number] => [sx - radius, sx + radius, sz - radius, sz + radius])]
      .some(([minX, maxX, minZ, maxZ]) => x + reach > minX && x - reach < maxX && z + reach > minZ && z - reach < maxZ);
    if (!blocked) spots.push([x, z]);
  }
  return spots;
}

const contextCache = new BuildCache<string>(6);

export interface SceneContextOptions {
  maxChars?: number;
  focusIds?: readonly string[];
  query?: string;
}

/** One line per object, children indented under their parent, with non-default components as compact JSON. */
export function sceneText(scene: Scene, options: SceneContextOptions = {}): string {
  // Content keys also invalidate correctly for callers that mutate the same scene object.
  const key = JSON.stringify([componentSchemas, scene, options]);
  const cached = contextCache.get(key);
  if (cached !== undefined) return cached;
  const full = describeScene(scene);
  const result = options.maxChars !== undefined && full.length > options.maxChars ? boundedSceneText(scene, options) : full;
  contextCache.set(key, result);
  return result;
}

/** Keep requested/selected assemblies first; explicitly mark omitted details rather than inventing them. */
function boundedSceneText(scene: Scene, options: SceneContextOptions): string {
  const budget = Math.max(0, options.maxChars ?? 23_000);
  const selected = new Set(options.focusIds ?? []);
  const words = (options.query?.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((word) => !["the", "and", "add", "make", "with", "this", "that", "scene", "build", "create"].includes(word));
  const byId = new Map(scene.entities.map((entity) => [entity.id, entity]));
  const focus = new Set(selected);
  for (const entity of scene.entities) {
    const label = `${entity.name} ${entity.id}`.toLowerCase();
    if (words.some((word) => label.includes(word))) focus.add(entity.id);
  }
  const priority = new Set(focus);
  for (const id of focus) {
    let parent = byId.get(id)?.parent;
    while (parent) { priority.add(parent); parent = byId.get(parent)?.parent; }
  }
  const children = new Map<string, number>();
  for (const entity of scene.entities) if (entity.parent) children.set(entity.parent, (children.get(entity.parent) ?? 0) + 1);
  const ordered = [...scene.entities].sort((a, b) => {
    const rank = (entity: Entity) => selected.has(entity.id) ? 0 : focus.has(entity.id) ? 1 : priority.has(entity.id) ? 2 : !entity.parent ? 3 : focus.has(entity.parent) ? 4 : 5;
    return rank(a) - rank(b);
  });
  const header = `Settings: ${JSON.stringify(scene.settings)}\nObjects: ${scene.entities.length} total. Bounded snapshot: selected/requested objects and their folders first. Entries may be out of parent order; parent ids are explicit. Do not assume omitted objects are absent or modify omitted ids.\n`;
  if (header.length + 100 > budget) return "Scene details omitted for context budget.".slice(0, budget);
  let result = header;
  let included = 0;
  // Reserve space to make omissions visible even when the last object fills the budget.
  for (const entity of ordered) {
    const detail = JSON.stringify(Object.fromEntries(Object.entries(entity.components).map(([name, fields]) => [name, omitDefaultFields(name, fields)])));
    const prefix = `- ${entity.id} ${JSON.stringify(entity.name)} parent=${JSON.stringify(entity.parent)} ${shapeOf(entity)} children=${children.get(entity.id) ?? 0}`;
    const rich = `${prefix}: ${detail}\n`;
    const compact = `${prefix} position=${JSON.stringify(positionOf(entity))}${entity.components.Material?.color ? ` color=${entity.components.Material.color}` : ""}\n`;
    const line = rich.length < 900 && result.length + rich.length <= budget - 100 ? rich : compact;
    if (result.length + line.length > budget - 100) continue;
    result += line;
    included++;
  }
  return `${result}Snapshot includes ${included}/${scene.entities.length} objects; omitted component details require conservative edits.`;
}

function describeScene(scene: Scene): string {
  const changed = Object.fromEntries(Object.entries(scene.settings).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(DEFAULT_SCENE_SETTINGS[key as keyof SceneSettings])));
  const lines = [`Settings (only non-default): ${JSON.stringify(changed)}`];
  if (!scene.entities.length) return [...lines, "Objects: none yet.", "Free floor spots (x z): (0 0)"].join("\n");

  lines.push("Objects: id \"name\" kind size [top-level: y bottom to top]: components (defaults omitted). Children are indented under their parent; their Transform is relative to it.");
  const children = new Map<string | null, Entity[]>();
  for (const entity of scene.entities) children.set(entity.parent, [...(children.get(entity.parent) ?? []), entity]);
  const visit = (parent: string | null, depth: number) => {
    for (const entity of children.get(parent) ?? []) {
      const components = Object.fromEntries(Object.entries(entity.components).map(([name, fields]) => [name, omitDefaultFields(name, fields)]));
      lines.push(`${"  ".repeat(depth)}- ${entity.id} ${JSON.stringify(entity.name)} ${shapeOf(entity)}${sizeText(entity)}: ${JSON.stringify(components)}`);
      visit(entity.id, depth + 1);
    }
  };
  visit(null, 0);
  lines.push(`Free floor spots (x z) for new objects: ${freeSpots(scene.entities, 4).map(([x, z]) => `(${x} ${z})`).join(", ")}`);
  return lines.join("\n");
}
