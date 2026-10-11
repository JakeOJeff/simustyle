/** Easing curves shared by the animator, the timeline UI, and standalone exports. */

export const EASING_FAMILIES = ["sine", "quad", "cubic", "quart", "quint", "expo", "circ", "back", "elastic", "bounce"] as const;
export const EASING_DIRECTIONS = ["in", "out", "in-out"] as const;

export type EasingFamily = typeof EASING_FAMILIES[number];
export type EasingDirection = typeof EASING_DIRECTIONS[number];
export type FamilyEasing = `ease-${EasingDirection}-${EasingFamily}`;
/** "ease-in-out" is the original smoothstep curve and stays valid for older scenes. */
export type AnimationInterpolation = "linear" | "step" | "ease-in-out" | "bezier" | FamilyEasing;
/** CSS-style cubic-bezier control points: x1, y1, x2, y2. */
export type BezierPoints = [number, number, number, number];

export const DEFAULT_BEZIER: BezierPoints = [0.25, 0.1, 0.25, 1];
/** y control values may overshoot for anticipation; x stays in [0, 1] so time never runs backwards. */
export const BEZIER_Y_RANGE = [-2, 3] as const;

export const BEZIER_PRESETS: { id: string; label: string; points: BezierPoints }[] = [
  { id: "ease", label: "Ease", points: [0.25, 0.1, 0.25, 1] },
  { id: "ease-in", label: "Ease in", points: [0.42, 0, 1, 1] },
  { id: "ease-out", label: "Ease out", points: [0, 0, 0.58, 1] },
  { id: "ease-in-out", label: "Ease in-out", points: [0.42, 0, 0.58, 1] },
  { id: "snappy", label: "Snappy", points: [0.2, 0.9, 0.1, 1] },
  { id: "anticipate", label: "Anticipate", points: [0.6, -0.4, 0.7, 1] },
  { id: "overshoot", label: "Overshoot", points: [0.3, 1.5, 0.6, 1] },
  { id: "slow-mo", label: "Slow middle", points: [0.1, 0.7, 0.9, 0.3] }
];

const familyIn: Record<EasingFamily, (t: number) => number> = {
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  quad: (t) => t * t,
  cubic: (t) => t ** 3,
  quart: (t) => t ** 4,
  quint: (t) => t ** 5,
  expo: (t) => t === 0 ? 0 : 2 ** (10 * t - 10),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
  back: (t) => 2.70158 * t ** 3 - 1.70158 * t * t,
  elastic: (t) => t === 0 || t === 1 ? t : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  bounce: (t) => 1 - bounceOut(1 - t)
};

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

function directional(easeIn: (t: number) => number, direction: EasingDirection): (t: number) => number {
  if (direction === "in") return easeIn;
  if (direction === "out") return (t) => 1 - easeIn(1 - t);
  return (t) => t < 0.5 ? easeIn(2 * t) / 2 : 1 - easeIn(2 - 2 * t) / 2;
}

/** Solves a CSS cubic-bezier for y at time x (Newton steps, then bisection as a fallback). */
export function cubicBezier([x1, y1, x2, y2]: BezierPoints): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let index = 0; index < 8; index += 1) {
      const error = sampleX(s) - x;
      if (Math.abs(error) < 1e-6) return sampleY(s);
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0, high = 1;
    s = x;
    for (let index = 0; index < 40; index += 1) {
      const value = sampleX(s);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) low = s; else high = s;
      s = (low + high) / 2;
    }
    return sampleY(s);
  };
}

const familyPattern = new RegExp(`^ease-(${EASING_DIRECTIONS.join("|")})-(${EASING_FAMILIES.join("|")})$`);

export function parseFamilyEasing(value: string): { direction: EasingDirection; family: EasingFamily } | null {
  const match = familyPattern.exec(value);
  return match ? { direction: match[1] as EasingDirection, family: match[2] as EasingFamily } : null;
}

export function isInterpolation(value: unknown): value is AnimationInterpolation {
  return value === "linear" || value === "step" || value === "ease-in-out" || value === "bezier" ||
    typeof value === "string" && familyPattern.test(value);
}

export function isBezierPoints(value: unknown): value is BezierPoints {
  return Array.isArray(value) && value.length === 4 && value.every((part) => typeof part === "number" && Number.isFinite(part)) &&
    value[0] >= 0 && value[0] <= 1 && value[2] >= 0 && value[2] <= 1 &&
    value[1] >= BEZIER_Y_RANGE[0] && value[1] <= BEZIER_Y_RANGE[1] && value[3] >= BEZIER_Y_RANGE[0] && value[3] <= BEZIER_Y_RANGE[1];
}

/** Maps linear progress (0..1) through an interpolation. Back, elastic, and bezier curves may leave 0..1. */
export function easeProgress(interpolation: AnimationInterpolation | undefined, t: number, bezier?: BezierPoints): number {
  const amount = Math.max(0, Math.min(1, t));
  switch (interpolation) {
    case undefined:
    case "linear": return amount;
    case "step": return amount >= 1 ? 1 : 0;
    case "ease-in-out": return amount * amount * (3 - 2 * amount);
    case "bezier": return cubicBezier(bezier && isBezierPoints(bezier) ? bezier : DEFAULT_BEZIER)(amount);
  }
  const parsed = parseFamilyEasing(interpolation);
  return parsed ? directional(familyIn[parsed.family], parsed.direction)(amount) : amount;
}

const familyLabels: Record<EasingFamily, string> = {
  sine: "Sine", quad: "Quad", cubic: "Cubic", quart: "Quart", quint: "Quint", expo: "Expo", circ: "Circ", back: "Back", elastic: "Elastic", bounce: "Bounce"
};
const directionLabels: Record<EasingDirection, string> = { in: "In", out: "Out", "in-out": "In-Out" };

export function familyLabel(family: EasingFamily): string { return familyLabels[family]; }
export function directionLabel(direction: EasingDirection): string { return directionLabels[direction]; }

export function interpolationLabel(interpolation: AnimationInterpolation | undefined): string {
  switch (interpolation) {
    case undefined:
    case "linear": return "Linear";
    case "step": return "Step (hold)";
    case "ease-in-out": return "Smooth";
    case "bezier": return "Custom bezier";
  }
  const parsed = parseFamilyEasing(interpolation);
  return parsed ? `${familyLabels[parsed.family]} ${directionLabels[parsed.direction]}` : interpolation;
}

/** Samples a curve as [t, value] pairs for drawing. Step curves get a sharp corner. */
export function sampleEasing(interpolation: AnimationInterpolation | undefined, bezier?: BezierPoints, samples = 48): [number, number][] {
  if (interpolation === "step") return [[0, 0], [1, 0], [1, 1]];
  const points: [number, number][] = [];
  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    points.push([t, easeProgress(interpolation, t, bezier)]);
  }
  return points;
}
