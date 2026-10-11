import type { Entity, SceneOp, Vec3 } from "../scene/types";
import type { AnimationInterpolation, AnimationKey, AnimationTrack, AnimationValue } from "./animator";

export type PresetCategory = "motion" | "emphasis" | "entrance" | "look";

/** A preset key uses normalized time (0..1), scaled to the Animator duration when applied. */
interface PresetKey { at: number; value: AnimationValue; ease?: AnimationInterpolation }
interface PresetTrack { component: string; field: string; keys: PresetKey[] }

interface BaseValues {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: string;
  emissiveIntensity: number;
  intensity: number;
}

export interface AnimationPreset {
  id: string;
  label: string;
  description: string;
  category: PresetCategory;
  /** Components the entity needs for this preset to make sense. */
  requires: string[];
  /** Seconds; used when the preset is the only animation on the object. */
  duration: number;
  /** Entrances play once by default. */
  loop: boolean;
  build(base: BaseValues): PresetTrack[];
}

const add = (vector: Vec3, axis: 0 | 1 | 2, amount: number): Vec3 => vector.map((value, index) => index === axis ? value + amount : value) as Vec3;
const times = (vector: Vec3, amount: number): Vec3 => vector.map((value) => value * amount) as Vec3;

function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const delta = max - min;
  const saturation = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, saturation, light];
}

function hslToHex(hue: number, saturation: number, light: number): string {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const segment = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  const [r, g, b] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const m = light - chroma / 2;
  return `#${[r, g, b].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, "0")).join("")}`;
}

export const ANIMATION_PRESETS: AnimationPreset[] = [
  {
    id: "bounce", label: "Bounce", description: "Hops up and lands, again and again.", category: "motion", requires: ["Transform"], duration: 1, loop: true,
    build: ({ position }) => [{ component: "Transform", field: "position", keys: [
      { at: 0, value: position, ease: "ease-out-quad" }, { at: 0.5, value: add(position, 1, 1.5), ease: "ease-in-quad" }, { at: 1, value: position }
    ] }]
  },
  {
    id: "float", label: "Float", description: "Drifts gently up and down.", category: "motion", requires: ["Transform"], duration: 3, loop: true,
    build: ({ position }) => [{ component: "Transform", field: "position", keys: [
      { at: 0, value: position, ease: "ease-in-out-sine" }, { at: 0.5, value: add(position, 1, 0.4), ease: "ease-in-out-sine" }, { at: 1, value: position }
    ] }]
  },
  {
    id: "spin", label: "Spin", description: "Turns a full circle at a steady speed.", category: "motion", requires: ["Transform"], duration: 2, loop: true,
    build: ({ rotation }) => [{ component: "Transform", field: "rotation", keys: [
      { at: 0, value: rotation, ease: "linear" }, { at: 1, value: add(rotation, 1, 360) }
    ] }]
  },
  {
    id: "swing", label: "Swing", description: "Rocks side to side like a pendulum.", category: "motion", requires: ["Transform"], duration: 2, loop: true,
    build: ({ rotation }) => [{ component: "Transform", field: "rotation", keys: [
      { at: 0, value: add(rotation, 2, 25), ease: "ease-in-out-sine" }, { at: 0.5, value: add(rotation, 2, -25), ease: "ease-in-out-sine" }, { at: 1, value: add(rotation, 2, 25) }
    ] }]
  },
  {
    id: "pulse", label: "Pulse", description: "Swells and shrinks like a heartbeat.", category: "emphasis", requires: ["Transform"], duration: 1.2, loop: true,
    build: ({ scale }) => [{ component: "Transform", field: "scale", keys: [
      { at: 0, value: scale, ease: "ease-in-out-sine" }, { at: 0.5, value: times(scale, 1.2), ease: "ease-in-out-sine" }, { at: 1, value: scale }
    ] }]
  },
  {
    id: "shake", label: "Shake", description: "A quick side-to-side jitter.", category: "emphasis", requires: ["Transform"], duration: 0.6, loop: true,
    build: ({ position }) => [{ component: "Transform", field: "position", keys: [
      { at: 0, value: position }, { at: 0.15, value: add(position, 0, 0.15) }, { at: 0.3, value: add(position, 0, -0.15) },
      { at: 0.45, value: add(position, 0, 0.1) }, { at: 0.6, value: add(position, 0, -0.1) }, { at: 0.75, value: add(position, 0, 0.05) }, { at: 1, value: position }
    ] }]
  },
  {
    id: "wobble", label: "Wobble", description: "Tilts and settles like jelly.", category: "emphasis", requires: ["Transform"], duration: 1.2, loop: true,
    build: ({ rotation }) => [{ component: "Transform", field: "rotation", keys: [
      { at: 0, value: rotation, ease: "ease-in-out-sine" }, { at: 0.2, value: add(rotation, 2, 12), ease: "ease-in-out-sine" },
      { at: 0.45, value: add(rotation, 2, -10), ease: "ease-in-out-sine" }, { at: 0.7, value: add(rotation, 2, 6), ease: "ease-in-out-sine" }, { at: 1, value: rotation }
    ] }]
  },
  {
    id: "pop-in", label: "Pop In", description: "Grows from nothing with a springy overshoot.", category: "entrance", requires: ["Transform"], duration: 1, loop: false,
    build: ({ scale }) => [{ component: "Transform", field: "scale", keys: [
      { at: 0, value: times(scale, 0), ease: "ease-out-back" }, { at: 0.6, value: scale }
    ] }]
  },
  {
    id: "drop-in", label: "Drop In", description: "Falls into place and bounces to rest.", category: "entrance", requires: ["Transform"], duration: 1.4, loop: false,
    build: ({ position }) => [{ component: "Transform", field: "position", keys: [
      { at: 0, value: add(position, 1, 4), ease: "ease-out-bounce" }, { at: 0.75, value: position }
    ] }]
  },
  {
    id: "slide-in", label: "Slide In", description: "Glides in from the left and eases to a stop.", category: "entrance", requires: ["Transform"], duration: 1.2, loop: false,
    build: ({ position }) => [{ component: "Transform", field: "position", keys: [
      { at: 0, value: add(position, 0, -4), ease: "ease-out-cubic" }, { at: 0.6, value: position }
    ] }]
  },
  {
    id: "color-cycle", label: "Color Cycle", description: "Shifts smoothly around the color wheel.", category: "look", requires: ["Material"], duration: 3, loop: true,
    build: ({ color }) => {
      const [hue, saturation, light] = hexToHsl(color);
      const s = Math.max(saturation, 0.6), l = Math.min(Math.max(light, 0.4), 0.65);
      return [{ component: "Material", field: "color", keys: [
        { at: 0, value: color, ease: "ease-in-out-sine" }, { at: 1 / 3, value: hslToHex(hue + 120, s, l), ease: "ease-in-out-sine" },
        { at: 2 / 3, value: hslToHex(hue + 240, s, l), ease: "ease-in-out-sine" }, { at: 1, value: color }
      ] }];
    }
  },
  {
    id: "glow-pulse", label: "Glow Pulse", description: "Breathes light in its own color.", category: "look", requires: ["Material"], duration: 1.6, loop: true,
    build: ({ color, emissiveIntensity }) => [
      { component: "Material", field: "emissive", keys: [{ at: 0, value: color }] },
      { component: "Material", field: "emissiveIntensity", keys: [
        { at: 0, value: emissiveIntensity, ease: "ease-in-out-sine" }, { at: 0.5, value: Math.min(20, emissiveIntensity + 2), ease: "ease-in-out-sine" }, { at: 1, value: emissiveIntensity }
      ] }
    ]
  },
  {
    id: "flicker", label: "Flicker", description: "An unsteady light, like a candle or a faulty bulb.", category: "look", requires: ["Light"], duration: 1, loop: true,
    build: ({ intensity }) => [{ component: "Light", field: "intensity", keys: [
      { at: 0, value: intensity, ease: "step" }, { at: 0.1, value: intensity * 0.3, ease: "step" }, { at: 0.18, value: intensity * 1.1 },
      { at: 0.45, value: intensity * 0.6, ease: "step" }, { at: 0.52, value: intensity, ease: "ease-in-out-sine" }, { at: 1, value: intensity }
    ].map((key) => ({ ...key, value: Math.min(100, key.value) })) as PresetKey[] }]
  }
];

export const PRESET_CATEGORY_LABELS: Record<PresetCategory, string> = { motion: "Motion", emphasis: "Emphasis", entrance: "Entrance", look: "Look & light" };

function vec(value: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part)) ? [...value] as Vec3 : fallback;
}

function baseValues(entity: Entity): BaseValues {
  const transform = entity.components.Transform ?? {};
  const material = entity.components.Material ?? {};
  const light = entity.components.Light ?? {};
  return {
    position: vec(transform.position, [0, 0, 0]),
    rotation: vec(transform.rotation, [0, 0, 0]),
    scale: vec(transform.scale, [1, 1, 1]),
    color: typeof material.color === "string" ? material.color : "#ffffff",
    emissiveIntensity: typeof material.emissiveIntensity === "number" ? material.emissiveIntensity : 0,
    intensity: typeof light.intensity === "number" ? light.intensity : 1
  };
}

export function presetAvailable(preset: AnimationPreset, entity: Entity): boolean {
  return preset.requires.every((component) => component in entity.components);
}

const tidy = (value: number) => Math.round(value * 10000) / 10000;
const tidyValue = (value: AnimationValue): AnimationValue => typeof value === "number" ? tidy(value) : Array.isArray(value) ? value.map(tidy) as Vec3 : value;

/** Tracks for a preset, scaled to the given duration, using the entity's current values as the rest pose. */
export function presetTracks(preset: AnimationPreset, entity: Entity, duration = preset.duration): AnimationTrack[] {
  return preset.build(baseValues(entity)).map((track) => ({
    component: track.component,
    field: track.field,
    keys: track.keys.map((key): AnimationKey => ({ time: tidy(key.at * duration), value: tidyValue(key.value), interpolation: key.ease ?? "linear" }))
  }));
}

/**
 * One undoable update that applies a preset. Tracks for the same properties are replaced and others kept.
 * When the preset becomes the object's only animation, the Animator adopts the preset's length and looping.
 */
export function presetOp(presetId: string, entity: Entity): { op: SceneOp | null; error?: string } {
  const preset = ANIMATION_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return { op: null, error: `Unknown animation preset '${presetId}'.` };
  if (!presetAvailable(preset, entity)) return { op: null, error: `${preset.label} needs ${preset.requires.join(" and ")} on ${entity.name}.` };
  const animator = entity.components.Animator ?? {};
  const existing = Array.isArray(animator.tracks) ? animator.tracks as AnimationTrack[] : [];
  const built = preset.build(baseValues(entity));
  const kept = existing.filter((track) => !built.some((next) => next.component === track.component && next.field === track.field));
  const solo = kept.length === 0;
  const currentDuration = typeof animator.duration === "number" && animator.duration > 0 ? animator.duration : 5;
  const duration = solo ? preset.duration : currentDuration;
  const tracks = [...kept, ...presetTracks(preset, entity, duration)];
  return {
    op: { op: "update", id: entity.id, components: { Animator: { tracks, ...(solo ? { duration, loop: preset.loop } : {}) } } }
  };
}
