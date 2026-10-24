import * as THREE from "three";

const num = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Top radius of a cylinder or cone: radiusTop when set, else the shape's own top (radius for a cylinder, 0 for a cone). */
export function meshTopRadius(mesh: Record<string, unknown>): number {
  return num(mesh.radiusTop, mesh.shape === "cone" ? 0 : num(mesh.radius, 0.5));
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

/** The renderable geometry for a Mesh component; the viewport, physics hulls and both exports share it. */
export function meshGeometry(mesh: Record<string, unknown>): THREE.BufferGeometry {
  const radius = num(mesh.radius, 0.5);
  const height = num(mesh.height, 1);
  switch (mesh.shape ?? "box") {
    case "sphere": return new THREE.SphereGeometry(radius, 24, 16);
    case "cylinder": return new THREE.CylinderGeometry(meshTopRadius(mesh), radius, height, 24);
    case "capsule": return new THREE.CapsuleGeometry(radius, Math.max(0.01, height - 2 * radius), 4, 12);
    case "plane": return new THREE.PlaneGeometry(radius * 2, radius * 2);
    case "cone": {
      const top = meshTopRadius(mesh);
      return top > 0 ? new THREE.CylinderGeometry(top, radius, height, 24) : new THREE.ConeGeometry(radius, height, 24);
    }
    case "wedge": return wedgeGeometry(radius, height);
    default: return new THREE.BoxGeometry(radius * 2, height, radius * 2);
  }
}
