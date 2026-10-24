import { componentSchemas } from "../registry";
import { validateFieldValue } from "../scene/validate";
import { applyOps } from "../scene/applyOps";
import type { Entity, Scene, SceneOp, Vec3 } from "../scene/types";
import type { FieldSchema } from "../registry/types";
import { easeProgress, isBezierPoints, isInterpolation, type AnimationInterpolation, type BezierPoints } from "./easing";

export type { AnimationInterpolation, BezierPoints } from "./easing";
export type AnimationValue = number | Vec3 | string;

export interface AnimationKey {
  time: number;
  value: AnimationValue;
  /** Easing from this key to the next; omitted values use linear. */
  interpolation?: AnimationInterpolation;
  /** Control points used when interpolation is "bezier". */
  bezier?: BezierPoints;
}

export interface AnimationTrack {
  component: string;
  field: string;
  keys: AnimationKey[];
}

export interface AnimatorResult {
  scene: Scene;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAnimationValue(value: unknown): value is AnimationValue {
  return typeof value === "number" && Number.isFinite(value) ||
    typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ||
    Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));
}

function mixColor(from: string, to: string, amount: number): string {
  const channel = (color: string, offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16);
  // Overshooting eases (back, elastic) can push channels past 0..255.
  const result = [1, 3, 5].map((offset) => Math.max(0, Math.min(255, Math.round(channel(from, offset) + (channel(to, offset) - channel(from, offset)) * amount))));
  return `#${result.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function mixValue(from: AnimationValue, to: AnimationValue, amount: number): AnimationValue {
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * amount;
  if (typeof from === "string" && typeof to === "string") return mixColor(from, to, amount);
  if (Array.isArray(from) && Array.isArray(to)) {
    return from.map((value, index) => value + (to[index]! - value) * amount) as Vec3;
  }
  return from;
}

/** Evaluate a single track at a local animation time in seconds. */
export function evaluateTrack(track: AnimationTrack, timeSeconds: number): AnimationValue | undefined {
  if (!track.keys.length) return undefined;
  const keys = [...track.keys].sort((first, second) => first.time - second.time);
  if (timeSeconds <= keys[0]!.time) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (timeSeconds >= last.time) return last.value;

  for (let index = 0; index < keys.length - 1; index += 1) {
    const first = keys[index]!;
    const second = keys[index + 1]!;
    if (timeSeconds > second.time) continue;
    if (timeSeconds === second.time) return second.value;
    const span = second.time - first.time;
    if (span <= 0) return second.value;
    if (first.interpolation === "step") return first.value;
    const amount = easeProgress(first.interpolation, (timeSeconds - first.time) / span, first.bezier);
    return mixValue(first.value, second.value, amount);
  }
  return last.value;
}

/** Keeps eased values inside the field's valid range, so overshoot never fails validation. */
function clampToField(field: FieldSchema, value: AnimationValue): AnimationValue {
  if (field.type === "float" && typeof value === "number") return Math.max(field.min, Math.min(field.max, value));
  if (field.type === "vec3" && Array.isArray(value)) {
    return value.map((part) => Math.max(field.min ?? -Infinity, Math.min(field.max ?? Infinity, part))) as Vec3;
  }
  return value;
}

function tracksFor(entity: Entity, warnings: string[]): AnimationTrack[] {
  const tracks: unknown = entity.components.Animator?.tracks;
  if (tracks === undefined) return [];
  if (!Array.isArray(tracks)) {
    warnings.push(`Animator on '${entity.name}' has invalid tracks data; it was skipped.`);
    return [];
  }
  const valid: AnimationTrack[] = [];
  for (const [index, raw] of tracks.entries()) {
    const label = `Animator track ${index} on '${entity.name}'`;
    if (!isRecord(raw) || typeof raw.component !== "string" || typeof raw.field !== "string" || !Array.isArray(raw.keys)) {
      warnings.push(`${label} is malformed and was skipped.`);
      continue;
    }
    const field = componentSchemas[raw.component]?.fields[raw.field];
    if (!field || (field.type !== "float" && field.type !== "vec3" && field.type !== "color")) {
      warnings.push(`${label} targets unsupported field '${raw.component}.${raw.field}' and was skipped.`);
      continue;
    }
    const keys: AnimationKey[] = [];
    let malformed = false;
    for (const key of raw.keys) {
      if (!isRecord(key) || typeof key.time !== "number" || !Number.isFinite(key.time) || key.time < 0 ||
          !isAnimationValue(key.value) || (key.interpolation !== undefined && !isInterpolation(key.interpolation)) ||
          (key.bezier !== undefined && !isBezierPoints(key.bezier))) {
        malformed = true;
        break;
      }
      const error = validateFieldValue(field, key.value);
      if (error) {
        malformed = true;
        break;
      }
      keys.push({
        time: key.time,
        value: key.value,
        interpolation: key.interpolation as AnimationInterpolation | undefined,
        ...(key.bezier ? { bezier: key.bezier as BezierPoints } : {})
      });
    }
    if (malformed || keys.length === 0) {
      warnings.push(`${label} has invalid or missing keys and was skipped.`);
      continue;
    }
    valid.push({ component: raw.component, field: raw.field, keys });
  }
  return valid;
}

function localTime(entity: Entity, timeSeconds: number): number {
  const animator = entity.components.Animator ?? {};
  const duration = typeof animator.duration === "number" && Number.isFinite(animator.duration) && animator.duration > 0
    ? animator.duration
    : 5;
  const time = Math.max(0, timeSeconds);
  return animator.loop === false ? Math.min(time, duration) : time % duration;
}

/** Applies timeline values to a scene using the same validated operation path as editor edits. */
export function evaluateAnimations(scene: Scene, timeSeconds: number): AnimatorResult {
  const warnings: string[] = [];
  const ops: SceneOp[] = [];
  for (const entity of scene.entities) {
    if (!entity.components.Animator) continue;
    const tracks = tracksFor(entity, warnings);
    if (!tracks.length) continue;
    const time = localTime(entity, timeSeconds);
    const changes: Record<string, Record<string, unknown>> = {};
    for (const track of tracks) {
      if (track.component === "Transform" && entity.components.RigidBody && entity.components.RigidBody.anchored !== true && entity.components.RigidBody.bodyType !== "static" && entity.components.RigidBody.bodyType !== "kinematic") {
        warnings.push(`Animation on dynamic rigid body '${entity.name}' was skipped; Transform animation is supported only for kinematic bodies.`);
        continue;
      }
      const value = evaluateTrack(track, time);
      if (value === undefined) continue;
      const field = componentSchemas[track.component]!.fields[track.field]!;
      (changes[track.component] ??= {})[track.field] = clampToField(field, value);
    }
    if (Object.keys(changes).length) ops.push({ op: "update", id: entity.id, components: changes });
  }
  if (!ops.length) return { scene, warnings };
  const result = applyOps(scene, ops);
  if (result.errors.length) {
    warnings.push(`Animation updates were rejected: ${result.errors.join("; ")}`);
    return { scene, warnings };
  }
  return { scene: result.scene, warnings };
}

/** Stateful playback clock; evaluate() also supports non-mutating edit-mode scrubbing. */
export class AnimatorRuntime {
  time = 0;

  evaluate(scene: Scene, timeSeconds: number): AnimatorResult {
    return evaluateAnimations(scene, timeSeconds);
  }

  advance(scene: Scene, elapsedSeconds: number): AnimatorResult {
    if (Number.isFinite(elapsedSeconds)) this.time += Math.max(0, elapsedSeconds);
    return evaluateAnimations(scene, this.time);
  }

  reset(): void {
    this.time = 0;
  }
}
