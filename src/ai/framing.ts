// Pure camera framing for renders of a build: the editor's inspection snapshots (snapshot.ts) and the
// `npm run ai:eval` screenshots use the same views.

type Vec3 = [number, number, number];
export interface Bounds { min: number[]; max: number[] }

/** Front-right and above, looking down at the build: the same 3/4 direction for every prompt. */
const VIEW_DIRECTION: Vec3 = [1, 0.8, 1];

/** The views an inspection can render: four perspective corners from above, and the six orthographic faces. */
export type ViewName = "frontRight" | "frontLeft" | "backLeft" | "backRight" | "front" | "back" | "left" | "right" | "top" | "bottom";

/** Perspective views and the direction from the target to the camera. */
export const CORNER_DIRECTIONS: Partial<Record<ViewName, Vec3>> = {
  frontRight: VIEW_DIRECTION, frontLeft: [-1, 0.8, 1], backLeft: [-1, 0.8, -1], backRight: [1, 0.8, -1]
};

/** Orthographic faces: the direction from the target to the camera, and the camera's up. */
const FACES: Partial<Record<ViewName, { direction: Vec3; up: Vec3 }>> = {
  front: { direction: [0, 0, 1], up: [0, 1, 0] },
  back: { direction: [0, 0, -1], up: [0, 1, 0] },
  right: { direction: [1, 0, 0], up: [0, 1, 0] },
  left: { direction: [-1, 0, 0], up: [0, 1, 0] },
  // Front (+z) at the bottom of the image from above, and at the top from below.
  top: { direction: [0, 1, 0], up: [0, 0, -1] },
  bottom: { direction: [0, -1, 0], up: [0, 0, 1] }
};

/** How each view is described to the vision model. */
export const VIEW_LABELS: Record<ViewName, string> = {
  frontRight: "perspective from the front-right, above",
  frontLeft: "perspective from the front-left, above",
  backLeft: "perspective from the back-left, above",
  backRight: "perspective from the back-right, above",
  front: "orthographic front face (camera on +z looking toward -z; +x is to the right)",
  back: "orthographic back face (camera on -z looking toward +z; +x is to the left)",
  right: "orthographic right face (camera on +x looking toward -x; front +z is to the left)",
  left: "orthographic left face (camera on -x looking toward +x; front +z is to the right)",
  top: "orthographic top face (looking straight down; front +z at the bottom of the image)",
  bottom: "orthographic bottom face (looking straight up from below the floor; front +z at the top of the image)"
};

export const isFace = (view: ViewName) => FACES[view] !== undefined;

/** Camera position and target that fit the bounds in view from a perspective direction; the editor default when empty. */
export function frameThreeQuarter(bounds: Bounds | null, fovDegrees: number, aspect: number, direction: Vec3 = VIEW_DIRECTION): { position: Vec3; target: Vec3 } {
  if (!bounds) return { position: [7, 6, 9], target: [0, 0.8, 0] };
  const target = bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as Vec3;
  const radius = Math.max(0.5, Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]!)) / 2);
  const vertical = (fovDegrees * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
  const length = Math.hypot(...direction);
  return { position: target.map((value, axis) => value + (direction[axis]! / length) * distance) as Vec3, target };
}

/**
 * An orthographic view of one face of the bounds: camera position, target and up, the half width/height of the
 * frustum (fitting the face with 10% margin) and its near/far planes. Empty bounds get a 2 m box at the origin.
 */
export function frameFace(bounds: Bounds | null, face: ViewName, aspect: number): { position: Vec3; target: Vec3; up: Vec3; halfWidth: number; halfHeight: number; near: number; far: number } {
  const spec = FACES[face];
  if (!spec) throw new Error(`${face} is not an orthographic face.`);
  const box = bounds ?? { min: [-1, 0, -1], max: [1, 2, 1] };
  const target = box.min.map((value, axis) => (value + box.max[axis]!) / 2) as Vec3;
  const size = box.min.map((value, axis) => Math.max(0.2, box.max[axis]! - value));
  // The image's horizontal axis is up × direction; vertical is up.
  const across = Math.abs(spec.up[1] * spec.direction[2] - spec.up[2] * spec.direction[1]) > 0.5 ? 0
    : Math.abs(spec.up[2] * spec.direction[0] - spec.up[0] * spec.direction[2]) > 0.5 ? 1 : 2;
  const vertical = spec.up.findIndex((value) => value !== 0);
  const depthAxis = spec.direction.findIndex((value) => value !== 0);
  const width = size[across]! * 1.1;
  const height = size[vertical]! * 1.1;
  const halfHeight = Math.max(height, width / aspect) / 2;
  const reach = size[depthAxis]! / 2 + 2;
  return {
    position: target.map((value, axis) => value + spec.direction[axis]! * reach) as Vec3,
    target, up: spec.up, halfWidth: halfHeight * aspect, halfHeight, near: 0.01, far: reach * 2 + 1
  };
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
