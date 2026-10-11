import { COLOR_NAMES } from "../lang/vocabulary";
import type { Entity, Scene } from "./types";

const SHAPE_WORDS: Record<string, string> = { sphere: "ball" };

function colorName(value: unknown): string {
  const hex = String(value).toLowerCase();
  return Object.entries(COLOR_NAMES).find(([, color]) => color === hex)?.[0] ?? hex;
}

function numbers(value: unknown): string {
  return Array.isArray(value) ? value.map((n) => String(Math.round(Number(n) * 100) / 100)).join(" ") : String(value);
}

function sizeText(scale: unknown): string {
  if (Array.isArray(scale) && scale.every((n) => n === scale[0])) return numbers([scale[0]]);
  return numbers(scale);
}

/** "red ball", "box", "light", or "object" for a new entity. */
function kindText(entity: Entity): string {
  const { Mesh, Material, Light, Camera } = entity.components;
  if (Mesh) {
    const shape = String(Mesh.shape ?? "box");
    const color = Material?.color === undefined ? "" : `${colorName(Material.color)} `;
    return `${color}${SHAPE_WORDS[shape] ?? shape}`;
  }
  if (Light) return "light";
  if (Camera) return "camera";
  if (entity.components.Script) return "script object";
  return "group";
}

function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Readable list of what changed on one entity, e.g. ["moved to 1 0.5 0", "painted blue"]. */
function updateParts(before: Entity, after: Entity): string[] {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`renamed from ${before.name}`);
  if (before.parent !== after.parent) parts.push(after.parent ? `moved under ${after.parent}` : "moved to the top level");
  const names = new Set([...Object.keys(before.components), ...Object.keys(after.components)]);
  for (const name of names) {
    const was = before.components[name];
    const now = after.components[name];
    if (same(was, now)) continue;
    if (!was) { parts.push(`added ${name}`); continue; }
    if (!now) { parts.push(`removed ${name}`); continue; }
    const changed = Object.keys({ ...was, ...now }).filter((field) => !same(was[field], now[field]));
    for (const field of changed) {
      const value = now[field];
      if (name === "Transform" && field === "position") parts.push(`moved to ${numbers(value)}`);
      else if (name === "Transform" && field === "rotation") parts.push(`turned to ${numbers(value)}`);
      else if (name === "Transform" && field === "scale") parts.push(`scaled to ${sizeText(value)}`);
      else if (name === "Material" && field === "color") parts.push(`painted ${colorName(value)}`);
      else if (name === "Material" && field === "opacity" && value === 0) parts.push("hidden");
      else if (name === "Material" && field === "opacity" && was.opacity === 0) parts.push("shown");
      else parts.push(`changed ${name}.${field}`);
    }
  }
  return parts;
}

/** One console line per created, changed, or removed entity between two scenes. */
export function describeChanges(before: Scene, after: Scene): string[] {
  const lines: string[] = [];
  for (const entity of after.entities) {
    const original = before.entities.find((candidate) => candidate.id === entity.id);
    if (!original) {
      const position = entity.components.Transform?.position;
      lines.push(`Created ${entity.name}: ${kindText(entity)}${position ? ` at ${numbers(position)}` : ""}`);
      continue;
    }
    const parts = updateParts(original, entity);
    if (parts.length) lines.push(`${entity.name}: ${parts.join(", ")}`);
  }
  for (const entity of before.entities) {
    if (!after.entities.some((candidate) => candidate.id === entity.id)) lines.push(`Removed ${entity.name}`);
  }
  return lines;
}
