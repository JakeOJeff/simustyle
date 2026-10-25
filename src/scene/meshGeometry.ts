import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { Font, type FontData } from "three/addons/loaders/FontLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
// Droid Sans Bold (Apache-2.0, see fonts/LICENSE-droid-sans.txt), subset to printable ASCII.
import fontData from "./fonts/droid-sans-bold.json";

const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Top radius of a cylinder or cone: radiusTop when set, else the shape's own top (radius for a cylinder, 0 for a cone). */
export function meshTopRadius(mesh: Record<string, unknown>): number {
  return num(mesh.radiusTop, mesh.shape === "cone" ? 0 : num(mesh.radius, 0.5));
}

/** Box edge rounding in meters (0 = sharp). */
export const meshBevel = (mesh: Record<string, unknown>) => clamp(num(mesh.bevel, 0), 0, 0.5);
/** Cylinder/cone side count; 12 or fewer is a faceted prism or pyramid. */
export const meshSides = (mesh: Record<string, unknown>) => Math.round(clamp(num(mesh.sides, 32), 3, 64));
/** Sweep in degrees for sphere, cylinder, cone and torus. */
export const meshArc = (mesh: Record<string, unknown>) => clamp(num(mesh.arc, 360), 1, 360);
/** Cylinder inner radius as a fraction of the outer one (0 = solid). */
export const meshHollow = (mesh: Record<string, unknown>) => mesh.shape === "cylinder" ? clamp(num(mesh.hollow, 0), 0, 0.95) : 0;
export const MAX_TEXT_LENGTH = 40;
/** The letters a text mesh shows: printable ASCII only (the bundled font's subset), at most 40 characters. */
export const meshText = (mesh: Record<string, unknown>) => {
  const text = typeof mesh.text === "string" ? mesh.text.replace(/[^\x20-\x7e]/g, "?").slice(0, MAX_TEXT_LENGTH) : "";
  return text.trim() ? text : "Text";
};
/** Prisms and pyramids have flat faces: radius measures to a face (2·radius across flats) and a face points +Z. */
export const isFaceted = (mesh: Record<string, unknown>) => (mesh.shape === "cylinder" || mesh.shape === "cone") && meshSides(mesh) <= 12;

/** Everything the geometry depends on; equal keys mean identical geometry. */
export function meshGeometryKey(mesh: Record<string, unknown>): string {
  return JSON.stringify([mesh.shape ?? "box", mesh.radius ?? 0.5, mesh.height ?? 1, mesh.radiusTop ?? null, mesh.bevel ?? 0, mesh.sides ?? 32, mesh.arc ?? 360, mesh.hollow ?? 0, mesh.shape === "text" ? meshText(mesh) : null]);
}

/**
 * Triangular prism filling the box 2·radius × height × 2·radius. Its cross-section lies in XY:
 * the bottom spans x=-radius..radius, and the slope rises from the -X bottom edge to the top of the +X face.
 */
export function wedgeGeometry(radius: number, height: number): THREE.BufferGeometry {
  const r = radius, h = height / 2;
  const a = [-r, -h], b = [r, -h], c = [r, h];
  const positions: number[] = [];
  const uvs: number[] = [];
  const quad = (p: number[][], uv: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(...p[i]!); uvs.push(...uv[i]!); }
  };
  const square = [[0, 0], [1, 0], [1, 1], [0, 1]];
  // Triangular ends at +Z and -Z (counter-clockwise from outside).
  positions.push(a[0]!, a[1]!, r, b[0]!, b[1]!, r, c[0]!, c[1]!, r);
  uvs.push(0, 0, 1, 0, 1, 1);
  positions.push(a[0]!, a[1]!, -r, c[0]!, c[1]!, -r, b[0]!, b[1]!, -r);
  uvs.push(1, 0, 0, 1, 0, 0);
  quad([[a[0]!, -h, -r], [b[0]!, -h, -r], [b[0]!, -h, r], [a[0]!, -h, r]], square); // bottom
  quad([[r, -h, r], [r, -h, -r], [r, h, -r], [r, h, r]], square); // +X face
  quad([[a[0]!, -h, r], [c[0]!, h, r], [c[0]!, h, -r], [a[0]!, -h, -r]], square); // slope
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

type V3 = [number, number, number];

/**
 * A cylinder/cone along Y with any side count, an optional partial sweep (closed by flat cut faces) and an optional
 * hollow core (open at both ends). Angles follow three.js: a point at angle θ is (sin θ, ·, cos θ).
 */
function latheSolid(bottom: number, top: number, height: number, segments: number, start: number, arc: number, hollow: number, flat: boolean): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  const h = height / 2;
  const at = (radius: number, angle: number, y: number): V3 => [radius * Math.sin(angle), y, radius * Math.cos(angle)];
  const triangle = (points: V3[], pointNormals: V3[], pointUvs: number[][]) => {
    // Wind each triangle so its face agrees with the intended outward normal.
    const [a, b, c] = points.map((point) => new THREE.Vector3(...point)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
    if (a.distanceToSquared(b) < 1e-12 || b.distanceToSquared(c) < 1e-12 || a.distanceToSquared(c) < 1e-12) return;
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    const order = face.dot(new THREE.Vector3(...pointNormals[0]!).add(new THREE.Vector3(...pointNormals[1]!)).add(new THREE.Vector3(...pointNormals[2]!))) < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const i of order) { positions.push(...points[i]!); normals.push(...pointNormals[i]!); uvs.push(...pointUvs[i]!); }
  };
  const quad = (points: V3[], pointNormals: V3[], pointUvs: number[][]) => {
    triangle([points[0]!, points[1]!, points[2]!], [pointNormals[0]!, pointNormals[1]!, pointNormals[2]!], [pointUvs[0]!, pointUvs[1]!, pointUvs[2]!]);
    triangle([points[0]!, points[2]!, points[3]!], [pointNormals[0]!, pointNormals[2]!, pointNormals[3]!], [pointUvs[0]!, pointUvs[2]!, pointUvs[3]!]);
  };
  const wallNormal = (angle: number, sign: number): V3 => {
    const n = new THREE.Vector3(Math.sin(angle) * height, bottom - top, Math.cos(angle) * height).normalize().multiplyScalar(sign);
    return [n.x, n.y, n.z];
  };
  const step = arc / segments;
  const walls: [number, number][] = [[1, 1], ...(hollow > 0 ? [[hollow, -1] as [number, number]] : [])];
  for (let k = 0; k < segments; k++) {
    const [a0, a1] = [start + k * step, start + (k + 1) * step];
    const [u0, u1] = [k / segments, (k + 1) / segments];
    for (const [scale, sign] of walls) {
      const n0 = wallNormal(flat ? (a0 + a1) / 2 : a0, sign), n1 = wallNormal(flat ? (a0 + a1) / 2 : a1, sign);
      quad([at(bottom * scale, a0, -h), at(bottom * scale, a1, -h), at(top * scale, a1, h), at(top * scale, a0, h)], [n0, n1, n1, n0], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
    }
    for (const [radius, y] of [[top, h], [bottom, -h]] as const) {
      const normal: V3 = [0, Math.sign(y), 0];
      const points = [at(radius, a0, y), at(radius, a1, y), at(radius * hollow, a1, y), at(radius * hollow, a0, y)];
      const capUvs = points.map(([x, , z]) => [x / (2 * Math.max(radius, 1e-6)) + 0.5, z / (2 * Math.max(radius, 1e-6)) + 0.5]);
      quad(points, [normal, normal, normal, normal], capUvs);
    }
  }
  if (arc < Math.PI * 2 - 1e-9) {
    for (const [angle, sign] of [[start, -1], [start + arc, 1]] as const) {
      const normal: V3 = [Math.cos(angle) * sign, 0, -Math.sin(angle) * sign];
      quad([at(bottom * hollow, angle, -h), at(bottom, angle, -h), at(top, angle, h), at(top * hollow, angle, h)], [normal, normal, normal, normal], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

/** An open shell seen from both sides (a bowl's inside, a dome's underside): the surface plus a reversed copy. */
function bothSides(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const outside = geometry.index ? geometry.toNonIndexed() : geometry;
  const inside = outside.clone();
  const position = inside.getAttribute("position"), normal = inside.getAttribute("normal"), uv = inside.getAttribute("uv");
  for (let i = 0; i < position.count; i += 3) {
    for (const attribute of [position, normal, uv]) {
      for (let c = 0; c < attribute.itemSize; c++) {
        const first = attribute.getComponent(i + 1, c);
        attribute.setComponent(i + 1, c, attribute.getComponent(i + 2, c));
        attribute.setComponent(i + 2, c, first);
      }
    }
  }
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  const merged = mergeGeometries([outside, inside])!;
  geometry.dispose(); outside.dispose(); inside.dispose();
  return merged;
}

let font: Font | undefined;
let capHeight = 0;
/** Letters read along +X facing +Z, centered on the origin; cap letters are `height` tall and the text 2·radius deep. */
function textGeometry(text: string, height: number, depth: number): THREE.BufferGeometry {
  if (!font) {
    font = new Font(fontData as unknown as FontData);
    const probe = new TextGeometry("H", { font, size: 1, depth: 0.01, curveSegments: 1 });
    probe.computeBoundingBox();
    capHeight = probe.boundingBox!.max.y - probe.boundingBox!.min.y;
    probe.dispose();
  }
  const geometry = new TextGeometry(text, { font, size: height / capHeight, depth, curveSegments: 4 });
  geometry.center();
  return geometry;
}

/** The renderable geometry for a Mesh component; the viewport, physics hulls and both exports share it. */
export function meshGeometry(mesh: Record<string, unknown>): THREE.BufferGeometry {
  const radius = num(mesh.radius, 0.5);
  const height = num(mesh.height, 1);
  const arc = THREE.MathUtils.degToRad(meshArc(mesh));
  const full = arc >= Math.PI * 2 - 1e-9;
  switch (mesh.shape ?? "box") {
    case "sphere":
      // A partial arc keeps the top cap: 180 is a dome (or, flipped, a bowl).
      return full ? new THREE.SphereGeometry(radius, 24, 16) : bothSides(new THREE.SphereGeometry(radius, 24, Math.max(2, Math.ceil(16 * arc / (Math.PI * 2))), 0, Math.PI * 2, 0, arc / 2));
    case "cylinder":
    case "cone": {
      const sides = meshSides(mesh), hollow = meshHollow(mesh), faceted = isFaceted(mesh);
      let top = meshTopRadius(mesh), bottom = radius;
      if (full && !faceted && hollow === 0) {
        if (mesh.shape === "cone" && top === 0) return new THREE.ConeGeometry(radius, height, sides);
        return new THREE.CylinderGeometry(top, radius, height, sides);
      }
      // Faceted: the radius reaches the middle of each face, so a 4-sided pyramid of radius 1 has a 2×2 base.
      const corner = faceted ? 1 / Math.cos(Math.PI / sides) : 1;
      [top, bottom] = [top * corner, bottom * corner];
      const segments = full ? sides : Math.max(1, Math.round(sides * arc / (Math.PI * 2)));
      return latheSolid(bottom, top, height, segments, full ? Math.PI / sides : 0, arc, hollow, faceted);
    }
    case "capsule": return new THREE.CapsuleGeometry(radius, Math.max(0.01, height - 2 * radius), 4, 12);
    case "plane": return new THREE.PlaneGeometry(radius * 2, radius * 2);
    case "wedge": return wedgeGeometry(radius, height);
    // A ring in the XY plane around Z; a partial arc starts at +X and sweeps up, so 180 is an arch.
    case "torus": return new THREE.TorusGeometry(radius, Math.max(0.005, height / 2), 12, Math.max(4, Math.ceil(48 * arc / (Math.PI * 2))), arc);
    case "text": return textGeometry(meshText(mesh), height, radius * 2);
    default: {
      const bevel = meshBevel(mesh);
      if (bevel <= 0) return new THREE.BoxGeometry(radius * 2, height, radius * 2);
      return new RoundedBoxGeometry(radius * 2, height, radius * 2, 3, Math.min(bevel, radius * 0.999, height / 2 * 0.999));
    }
  }
}

/** Shapes whose geometry has concave parts: a solid hull would fill their holes. */
export function isConcave(mesh: Record<string, unknown>): boolean {
  const shape = mesh.shape ?? "box";
  if (shape === "torus" || shape === "text") return true;
  if (shape === "sphere") return meshArc(mesh) < 360;
  if (shape === "cylinder" || shape === "cone") return meshHollow(mesh) > 0 || meshArc(mesh) > 180 + 1e-9 && meshArc(mesh) < 360;
  return false;
}

const boundsCache = new Map<string, THREE.Box3>();
/**
 * Exact local bounds for shapes that the plain radius/height formula gets wrong (domes, arches, prisms, rings, text);
 * null for the rest. Results are cached, since text is costly to build.
 */
export function meshFeatureBounds(mesh: Record<string, unknown>): THREE.Box3 | null {
  const shape = mesh.shape ?? "box";
  const special = shape === "torus" || shape === "text" || isFaceted(mesh) || ((shape === "sphere" || shape === "cylinder" || shape === "cone") && meshArc(mesh) < 360);
  if (!special) return null;
  const key = meshGeometryKey(mesh);
  let box = boundsCache.get(key);
  if (!box) {
    const geometry = meshGeometry(mesh);
    geometry.computeBoundingBox();
    box = geometry.boundingBox!.clone();
    geometry.dispose();
    if (boundsCache.size > 500) boundsCache.clear();
    boundsCache.set(key, box);
  }
  return box.clone();
}

/** Mesh fields that only some shapes use; the Inspector hides them for the rest. */
export const MESH_FIELD_SHAPES: Record<string, readonly string[]> = {
  radiusTop: ["cylinder", "cone"],
  bevel: ["box"],
  sides: ["cylinder", "cone"],
  arc: ["sphere", "cylinder", "cone", "torus"],
  hollow: ["cylinder"],
  text: ["text"]
};
