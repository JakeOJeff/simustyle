// Runtime support for the plain-English script commands: finding objects by name or
// description ("the red ball above the box"), placing objects relative to each other,
// and the timed motions behind `move ... over 2s` and `animate ... like ...`.
import type { Entity, Scene, SceneOp } from "../scene/types";
import { ANY_NOUNS, SHAPE_NOUNS, type AnimationSpec, type RelationName } from "../lang/vocabulary";
import { componentSchemas } from "../registry";

export interface RuntimeDescription {
  text?: string;
  colors: string[];
  noun: string;
  superlative?: string;
  relation?: { relation: RelationName; target: unknown };
}

type Vector = [number, number, number];

function vec(value: unknown, fallback: Vector): Vector {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part))
    ? [value[0], value[1], value[2]]
    : fallback;
}

export function positionOf(entity: Entity): Vector { return vec(entity.components.Transform?.position, [0, 0, 0]); }
export function rotationOf(entity: Entity): Vector { return vec(entity.components.Transform?.rotation, [0, 0, 0]); }
export function scaleOf(entity: Entity): Vector { return vec(entity.components.Transform?.scale, [1, 1, 1]); }

/** Scenes store only non-default fields, so fall back to the schema default when a field is absent. */
function field(entity: Entity, component: string, name: string): unknown {
  const value = entity.components[component]?.[name];
  if (value !== undefined || !entity.components[component]) return value;
  const schema = componentSchemas[component]?.fields[name];
  return schema && "default" in schema ? schema.default : undefined;
}

function normalize(text: string): string { return text.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function distance(a: Vector, b: Vector): number { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

/** Half-size of an entity's mesh along each axis, matching the viewport geometry. */
export function halfExtents(entity: Entity): Vector {
  const mesh = entity.components.Mesh;
  const scale = scaleOf(entity).map(Math.abs) as Vector;
  if (!mesh) return [0.25 * scale[0], 0.25 * scale[1], 0.25 * scale[2]];
  const radius = Number(field(entity, "Mesh", "radius") ?? 0.5);
  const height = Number(field(entity, "Mesh", "height") ?? 1);
  const shape = field(entity, "Mesh", "shape");
  const base: Vector = shape === "sphere" ? [radius, radius, radius]
    : shape === "plane" ? [radius, 0.01, radius]
    : shape === "capsule" ? [radius, Math.max(height / 2, radius), radius]
    : [radius, height / 2, radius];
  return [base[0] * scale[0], base[1] * scale[1], base[2] * scale[2]];
}

/** Classify a #rrggbb color into the color words a person would use. */
export function colorWords(hex: unknown): string[] {
  if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}/.test(hex)) return [];
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as Vector;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.18 || max - min < 0.08) return lightness > 0.8 ? ["white"] : lightness < 0.18 ? ["black"] : ["gray"];
  let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return lightness > 0.7 ? ["pink"] : ["red"];
  if (hue < 45) return lightness < 0.4 ? ["brown", "orange"] : ["orange"];
  if (hue < 70) return ["yellow"];
  if (hue < 165) return ["green"];
  if (hue < 195) return ["cyan", "blue"];
  if (hue < 235) return ["blue"];
  if (hue < 290) return ["purple"];
  return ["pink", "purple"];
}

function nounMatches(entity: Entity, noun: string, scene: Scene): boolean {
  if (ANY_NOUNS.has(noun)) return true;
  const singular = noun === "boxes" ? "box" : noun.endsWith("s") && noun.length > 3 ? noun.slice(0, -1) : noun;
  // A group is an object without a mesh that holds other objects.
  if (singular === "group" && !entity.components.Mesh && scene.entities.some((child) => child.parent === entity.id)) return true;
  const kind = SHAPE_NOUNS[singular];
  if (kind === "Light" || kind === "Camera") return kind in entity.components;
  if (kind && field(entity, "Mesh", "shape") === kind) return true;
  const name = normalize(entity.name);
  const id = normalize(entity.id);
  return name.includes(normalize(singular)) || id.includes(normalize(singular));
}

function satisfiesRelation(candidate: Entity, anchor: Entity, relation: RelationName): boolean {
  const [cx, cy, cz] = positionOf(candidate);
  const [ax, ay, az] = positionOf(anchor);
  const a = halfExtents(anchor);
  const c = halfExtents(candidate);
  const reachX = a[0] + c[0] + 0.75;
  const reachZ = a[2] + c[2] + 0.75;
  const overlapsXZ = Math.abs(cx - ax) <= reachX && Math.abs(cz - az) <= reachZ;
  switch (relation) {
    case "above": return cy > ay && overlapsXZ;
    case "below": return cy < ay && overlapsXZ;
    case "left": return cx < ax;
    case "right": return cx > ax;
    case "front": return cz > az;
    case "behind": return cz < az;
    case "beside":
    case "near": return distance([cx, cy, cz], [ax, ay, az]) <= Math.max(reachX, reachZ) + 1.5;
  }
}

export interface Resolver {
  scene: Scene;
  selfId: string | null;
  /** Resolve a nested target (used by relations such as "above the box"). */
  resolve(target: unknown): Entity | undefined;
}

/** Every entity a description matches, best first; ties go to the one nearest the script's own object. */
export function describedMatches(description: RuntimeDescription, resolver: Resolver): Entity[] {
  const { scene, selfId } = resolver;
  const self = scene.entities.find((entity) => entity.id === selfId);
  const origin = self ? positionOf(self) : [0, 0, 0] as Vector;
  const anchor = description.relation ? resolver.resolve(description.relation.target) : undefined;
  if (description.relation && !anchor) return [];
  let matches = scene.entities.filter((entity) =>
    nounMatches(entity, description.noun, scene) &&
    description.colors.every((color) => colorWords(field(entity, "Material", "color")).includes(color)) &&
    (!anchor || (entity.id !== anchor.id && satisfiesRelation(entity, anchor, description.relation!.relation))));
  if (description.superlative === "nearest" || description.superlative === "farthest") matches = matches.filter((entity) => entity.id !== selfId);
  if (!matches.length) return [];
  const reference = anchor ? positionOf(anchor) : origin;
  const volume = (entity: Entity) => halfExtents(entity).reduce((product, value) => product * value, 1);
  const score: Record<string, (entity: Entity) => number> = {
    biggest: (entity) => -volume(entity),
    smallest: volume,
    highest: (entity) => -positionOf(entity)[1],
    lowest: (entity) => positionOf(entity)[1],
    farthest: (entity) => -distance(positionOf(entity), reference),
    nearest: (entity) => distance(positionOf(entity), reference)
  };
  const rank = score[description.superlative ?? "nearest"] ?? score.nearest!;
  return [...matches].sort((first, second) => rank(first) - rank(second));
}

/** Find an entity by id or display name, ignoring case, spaces, and underscores. */
export function findNamed(scene: Scene, name: string): Entity | undefined {
  const key = normalize(name);
  return scene.entities.find((entity) => entity.id === name)
    ?? scene.entities.find((entity) => normalize(entity.id) === key || normalize(entity.name) === key);
}

/** Where to put `mover` so it sits above/beside/... `anchor` without overlapping. */
export function placeRelative(mover: Entity, anchor: Entity, relation: RelationName): Vector {
  const [ax, ay, az] = positionOf(anchor);
  const a = halfExtents(anchor);
  const m = halfExtents(mover);
  const gap = 0.05;
  switch (relation) {
    case "above": return [ax, ay + a[1] + m[1] + gap, az];
    case "below": return [ax, Math.max(m[1], ay - a[1] - m[1] - gap), az];
    case "left": return [ax - a[0] - m[0] - gap - 0.2, ay, az];
    case "front": return [ax, ay, az + a[2] + m[2] + gap + 0.2];
    case "behind": return [ax, ay, az - a[2] - m[2] - gap - 0.2];
    case "right":
    case "beside":
    case "near": return [ax + a[0] + m[0] + gap + 0.2, ay, az];
  }
}

// --- Timed motion -----------------------------------------------------------------

type FieldKey = "position" | "rotation" | "scale";
interface Tween { id: string; field: FieldKey; from: Vector; to: Vector; elapsed: number; duration: number; }
interface ActiveAnimation { id: string; spec: AnimationSpec; elapsed: number; base: { position: Vector; rotation: Vector; scale: Vector; emissive: unknown; emissiveIntensity: unknown; color: unknown }; }

const easeInOut = (amount: number) => amount * amount * (3 - 2 * amount);

/**
 * Owns in-progress glides and looping animations during Play. Every change it makes
 * is returned as ordinary scene update ops, so validation and Stop/restore still apply.
 */
export class MotionController {
  private readonly tweens = new Map<string, Tween>();
  private readonly animations = new Map<string, ActiveAnimation>();

  isAnimating(id: string): boolean { return this.animations.has(id); }

  /** Set a transform field now, or glide to it when a duration is given. Returns ops to apply immediately. */
  set(entity: Entity, field: FieldKey, value: Vector, duration: number): SceneOp[] {
    const animation = this.animations.get(entity.id);
    const current = animation ? animation.base[field] : field === "position" ? positionOf(entity) : field === "rotation" ? rotationOf(entity) : scaleOf(entity);
    if (duration > 0) {
      this.tweens.set(`${entity.id}:${field}`, { id: entity.id, field, from: current, to: value, elapsed: 0, duration });
      return [];
    }
    this.tweens.delete(`${entity.id}:${field}`);
    if (animation) { animation.base[field] = value; return []; }
    return [{ op: "update", id: entity.id, components: { Transform: { [field]: value } } }];
  }

  animate(entity: Entity, spec: AnimationSpec): SceneOp[] {
    const restore = this.stop(entity.id);
    const material = entity.components.Material ?? {};
    this.animations.set(entity.id, {
      id: entity.id, spec, elapsed: 0,
      base: { position: positionOf(entity), rotation: rotationOf(entity), scale: scaleOf(entity), emissive: material.emissive, emissiveIntensity: material.emissiveIntensity, color: material.color }
    });
    return restore;
  }

  /** Stop an animation and put the object back where its animation started (plus any moves since). */
  stop(id: string): SceneOp[] {
    const animation = this.animations.get(id);
    for (const key of [...this.tweens.keys()]) if (key.startsWith(`${id}:`)) this.tweens.delete(key);
    if (!animation) return [];
    this.animations.delete(id);
    const { base } = animation;
    const ops: SceneOp[] = [{ op: "update", id, components: { Transform: { position: base.position, rotation: base.rotation, scale: base.scale } } }];
    if (animation.spec.style === "flash") ops.push({ op: "update", id, components: { Material: { emissive: base.emissive ?? "#000000", emissiveIntensity: base.emissiveIntensity ?? 0 } } });
    return ops;
  }

  forget(id: string): void {
    this.animations.delete(id);
    for (const key of [...this.tweens.keys()]) if (key.startsWith(`${id}:`)) this.tweens.delete(key);
  }

  /** Finish every glide immediately and drop animations (used outside Play). */
  settle(): { ops: SceneOp[]; animating: boolean } {
    const ops: SceneOp[] = [...this.tweens.values()].map((tween) => ({ op: "update" as const, id: tween.id, components: { Transform: { [tween.field]: tween.to } } }));
    const animating = this.animations.size > 0;
    this.tweens.clear();
    this.animations.clear();
    return { ops, animating };
  }

  /** Advance glides and animations; returns the scene ops for this frame. */
  advance(scene: Scene, dt: number): SceneOp[] {
    const transforms = new Map<string, Record<string, Vector>>();
    const write = (id: string, field: FieldKey, value: Vector) => {
      const record = transforms.get(id) ?? {};
      record[field] = value;
      transforms.set(id, record);
    };
    const ops: SceneOp[] = [];
    for (const [key, tween] of this.tweens) {
      if (!scene.entities.some((entity) => entity.id === tween.id)) { this.tweens.delete(key); continue; }
      tween.elapsed += dt;
      const amount = easeInOut(Math.min(1, tween.elapsed / tween.duration));
      const value = tween.from.map((start, index) => start + (tween.to[index]! - start) * amount) as Vector;
      const animation = this.animations.get(tween.id);
      if (animation) animation.base[tween.field] = value;
      else write(tween.id, tween.field, value);
      if (amount >= 1) this.tweens.delete(key);
    }
    for (const animation of this.animations.values()) {
      if (!scene.entities.some((entity) => entity.id === animation.id)) { this.animations.delete(animation.id); continue; }
      animation.elapsed += dt;
      const frame = animationFrame(animation, animation.elapsed * animation.spec.speed);
      for (const field of ["position", "rotation", "scale"] as const) if (frame[field]) write(animation.id, field, frame[field]!);
      if (frame.material) ops.push({ op: "update", id: animation.id, components: { Material: frame.material } });
    }
    for (const [id, fields] of transforms) ops.push({ op: "update", id, components: { Transform: fields } });
    return ops;
  }
}

/** The pose of an animated object `t` seconds (scaled by speed) after it started. */
function animationFrame(animation: ActiveAnimation, t: number): { position?: Vector; rotation?: Vector; scale?: Vector; material?: Record<string, unknown> } {
  const { base, spec } = animation;
  const a = spec.amplitude;
  const [px, py, pz] = base.position;
  const [rx, ry, rz] = base.rotation;
  const scaled = (factor: number) => base.scale.map((part) => part * factor) as Vector;
  const wrap = (degrees: number) => ((degrees % 360) + 360) % 360;
  switch (spec.style) {
    case "bounce": return { position: [px, py + 1.2 * a * Math.abs(Math.sin(Math.PI * t * 1.2)), pz] };
    case "spin": return { rotation: [rx, wrap(ry + 120 * t), rz] };
    case "float": return { position: [px, py + 0.25 * a * Math.sin(2 * t), pz], rotation: [rx + 3 * a * Math.sin(1.3 * t), ry, rz + 3 * a * Math.cos(t)] };
    case "pulse": return { scale: scaled(1 + 0.15 * a * Math.sin(2 * Math.PI * t)) };
    case "shake": return { position: [px + 0.06 * a * Math.sin(t * 41), py, pz + 0.06 * a * Math.cos(t * 37)] };
    case "wobble": return { rotation: [rx + 6 * a * Math.sin(t * 6), ry, rz + 12 * a * Math.sin(t * 8)] };
    case "sway": return { rotation: [rx, ry, rz + 20 * a * Math.sin(t * 2)] };
    case "orbit": return { position: [px + 1.5 * a * Math.cos(t), py, pz + 1.5 * a * Math.sin(t)] };
    case "tumble": return { rotation: [wrap(rx + 90 * t), wrap(ry + 60 * t), rz] };
    case "grow": return { scale: scaled(1 + Math.min(t, 2) / 2 * a) };
    case "shrink": return { scale: scaled(Math.max(0.05, 1 - Math.min(t, 2) / 2 * 0.95 * Math.min(a, 1))) };
    case "flash": return { material: { emissive: typeof base.color === "string" ? base.color : "#ffffff", emissiveIntensity: Math.min(20, 2 * a * (0.5 + 0.5 * Math.sin(2 * Math.PI * t * 1.5))) } };
  }
}

