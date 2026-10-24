import type * as THREE from "three";
import { surfaceTexture, normalTexture } from "./catalog";

type UVState = { original: Float32Array; key: string };
const uvStates = new WeakMap<THREE.BufferGeometry, UVState>();

/** Bake one tile per meter into UVs, keeping every material map and GLB in sync.
 * Boxes use each face's dimensions; curved shapes use circumference/arc length.
 * Original UVs are retained once and restored for Stretch or Custom modes. */
export function applySurfaceMapping(mesh: THREE.Mesh, shape: Record<string, unknown>, material: Record<string, unknown>): void {
  const geometry = mesh.geometry;
  const uv = geometry.getAttribute("uv");
  if (!uv) return;
  let state = uvStates.get(geometry);
  if ((!surfaceTexture(material.texture) && !normalTexture(material)) || (material.textureMapping ?? "auto") !== "auto") {
    if (state && state.key !== "original") {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, state.original[i * 2]!, state.original[i * 2 + 1]!);
      uv.needsUpdate = true;
      state.key = "original";
    }
    return;
  }
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld.elements;
  const sx = Math.hypot(m[0]!, m[1]!, m[2]!);
  const sy = Math.hypot(m[4]!, m[5]!, m[6]!);
  const sz = Math.hypot(m[8]!, m[9]!, m[10]!);
  const radius = typeof shape.radius === "number" ? shape.radius : 0.5;
  const height = typeof shape.height === "number" ? shape.height : 1;
  const kind = String(shape.shape ?? "box");
  const key = [kind, radius, height, shape.radiusTop ?? "", sx, sy, sz].map((part) => typeof part === "number" ? part.toFixed(6) : part).join(":");
  if (state?.key === key) return;
  if (!state) {
    const original = new Float32Array(uv.count * 2);
    for (let i = 0; i < uv.count; i++) { original[i * 2] = uv.getX(i); original[i * 2 + 1] = uv.getY(i); }
    state = { original, key: "original" };
    uvStates.set(geometry, state);
  }
  const normal = geometry.getAttribute("normal");
  const width = 2 * radius * sx, depth = 2 * radius * sz, tall = height * sy;
  // RMS radius approximates the circumference of a scaled circular primitive.
  const radial = radius * Math.hypot(sx, sz) / Math.SQRT2;
  for (let i = 0; i < uv.count; i++) {
    let u = width, v = tall;
    if (kind === "box" || kind === "wedge") {
      if (Math.abs(normal.getX(i)) > 0.5) u = depth;
      else if (Math.abs(normal.getY(i)) > 0.5) v = depth;
    } else if (kind === "plane") v = 2 * radius * sy;
    else if (kind === "sphere") { u = 2 * Math.PI * radial; v = Math.PI * radius * sy; }
    else if ((kind === "cylinder" || kind === "cone") && Math.abs(normal.getY(i)) > 0.999) v = depth;
    else {
      u = 2 * Math.PI * radial;
      v = kind === "cone" ? Math.hypot(tall, radial) : kind === "capsule" ? (Math.max(0.01, height - 2 * radius) + Math.PI * radius) * sy : tall;
    }
    uv.setXY(i, state.original[i * 2]! * Math.max(0.0001, u), state.original[i * 2 + 1]! * Math.max(0.0001, v));
  }
  uv.needsUpdate = true;
  state.key = key;
}
