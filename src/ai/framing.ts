// Pure camera framing for renders of a whole build: the editor's critique snapshots (snapshot.ts) and the
// `npm run ai:eval` screenshots use the same views.

type Vec3 = [number, number, number];
export interface Bounds { min: number[]; max: number[] }

/** Front-right and above, looking down at the build: the same 3/4 direction for every prompt. */
const VIEW_DIRECTION: Vec3 = [1, 0.8, 1];

/** Camera position and target that fit the bounds in view from the fixed 3/4 direction; the editor default when empty. */
export function frameThreeQuarter(bounds: Bounds | null, fovDegrees: number, aspect: number): { position: Vec3; target: Vec3 } {
  if (!bounds) return { position: [7, 6, 9], target: [0, 0.8, 0] };
  const target = bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as Vec3;
  const radius = Math.max(0.5, Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]!)) / 2);
  const vertical = (fovDegrees * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
  const length = Math.hypot(...VIEW_DIRECTION);
  return { position: target.map((value, axis) => value + (VIEW_DIRECTION[axis]! / length) * distance) as Vec3, target };
}

/**
 * An orthographic view straight down on the bounds, front (+z) at the bottom of the image: the camera's center and
 * the half width/height of its frustum, with 8% margin. Empty bounds get a 10 m square around the origin.
 */
export function frameTopDown(bounds: Bounds | null, aspect: number): { center: Vec3; halfWidth: number; halfHeight: number; height: number } {
  const box = bounds ?? { min: [-5, 0, -5], max: [5, 1, 5] };
  const center: Vec3 = [(box.min[0]! + box.max[0]!) / 2, box.max[1]! + 10, (box.min[2]! + box.max[2]!) / 2];
  const width = Math.max(0.5, box.max[0]! - box.min[0]!) * 1.08;
  const depth = Math.max(0.5, box.max[2]! - box.min[2]!) * 1.08;
  const halfHeight = Math.max(depth, width / aspect) / 2;
  return { center, halfWidth: halfHeight * aspect, halfHeight, height: box.max[1]! - box.min[1]! + 20 };
}
