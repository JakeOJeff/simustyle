import { describe, expect, it } from "vitest";
import * as RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { meshFeatureBounds, meshGeometry, meshGeometryKey } from "../../src/scene/meshGeometry";
import { createThreeScene } from "../../src/export/gltf";
import { PhysicsRuntime } from "../../src/runtime/physics";
import { halfExtents } from "../../src/runtime/commands";
import { meshWorldBounds } from "../../src/ai/quality";
import { applyOps } from "../../src/scene/applyOps";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { validateScene } from "../../src/scene/validate";
import { createEmptyScene, type Entity, type Scene } from "../../src/scene/types";

const subject = (fields: Record<string, unknown>, body: Record<string, unknown> = {}): Entity =>
  ({ id: "subject", name: "Subject", parent: null, components: { Transform: { position: [0, 5, 0] }, Mesh: fields, RigidBody: body } });

function sceneOf(entity: Entity): Scene {
  const result = applyOps(createEmptyScene(), [{ op: "create", id: entity.id, name: entity.name, parent: null, components: entity.components }]);
  expect(result.errors).toEqual([]);
  return result.scene;
}

function bounds(fields: Record<string, unknown>): { min: number[]; max: number[] } {
  const geometry = meshGeometry(fields);
  geometry.computeBoundingBox();
  return { min: geometry.boundingBox!.min.toArray(), max: geometry.boundingBox!.max.toArray() };
}

async function colliderOf(entity: Entity): Promise<{ type: RAPIER.ShapeType; contains: (point: [number, number, number]) => boolean; dispose: () => void }> {
  const runtime = await PhysicsRuntime.create(sceneOf(entity));
  let collider: RAPIER.Collider | undefined;
  runtime.world.forEachCollider((candidate) => { if (candidate.parent()?.translation().y === 5) collider = candidate; });
  expect(collider).toBeDefined();
  return { type: collider!.shapeType(), contains: ([x, y, z]) => collider!.containsPoint({ x, y: y + 5, z }), dispose: () => runtime.dispose() };
}

// GLTFExporter reads its buffers with the browser's FileReader, which Node lacks.
globalThis.FileReader ??= class {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((buffer) => { this.result = buffer; this.onloadend?.(); }); }
  readAsDataURL(blob: Blob) { void blob.arrayBuffer().then((buffer) => { this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`; this.onloadend?.(); }); }
} as unknown as typeof FileReader;

/** Saves, loads and exports a scene holding one mesh; returns the loaded fields and the exported vertex count. */
async function roundTrip(fields: Record<string, unknown>): Promise<{ loaded: Record<string, unknown>; vertices: number }> {
  const scene = sceneOf(subject(fields));
  expect(validateScene(scene)).toEqual([]);
  const loaded = deserializeScene(serializeScene(scene)).entities[0]!.components.Mesh!;
  const gltf = await new GLTFExporter().parseAsync(createThreeScene(scene), { binary: false }) as { meshes: { primitives: { attributes: { POSITION: number } }[] }[]; accessors: { count: number }[] };
  return { loaded, vertices: gltf.accessors[gltf.meshes[0]!.primitives[0]!.attributes.POSITION]!.count };
}

const close = (values: number[], expected: number[]) => values.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 4));

describe("bevel", () => {
  it("rounds a box without changing its size", () => {
    const geometry = meshGeometry({ radius: 0.5, height: 0.2, bevel: 0.05 });
    expect(geometry.type).toBe("RoundedBoxGeometry");
    close(bounds({ radius: 0.5, height: 0.2, bevel: 0.05 }).max, [0.5, 0.1, 0.5]);
    // A corner of the sharp box is cut off.
    const position = geometry.getAttribute("position");
    const corner = new THREE.Vector3(0.5, 0.1, 0.5);
    const nearest = Math.min(...Array.from({ length: position.count }, (_, i) => new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).distanceTo(corner)));
    expect(nearest).toBeGreaterThan(0.01);
    expect(meshGeometry({ bevel: 0 })).toBeInstanceOf(THREE.BoxGeometry);
  });

  it("uses Rapier's rounded cuboid, saves and exports", async () => {
    const collider = await colliderOf(subject({ radius: 0.5, height: 1, bevel: 0.2 }));
    try {
      expect(collider.type).toBe(RAPIER.ShapeType.RoundCuboid);
      expect(collider.contains([0.45, 0, 0])).toBe(true);
      expect(collider.contains([0.48, 0.48, 0.48])).toBe(false);
    } finally { collider.dispose(); }
    const { loaded, vertices } = await roundTrip({ bevel: 0.1 });
    expect(loaded.bevel).toBe(0.1);
    expect(vertices).toBe(meshGeometry({ bevel: 0.1 }).getAttribute("position").count);
  });
});

describe("sides", () => {
  it("makes faceted prisms and pyramids whose radius reaches the faces", () => {
    // A 4-sided pyramid of radius 1 has a 2×2 base square to the axes.
    const pyramid = bounds({ shape: "cone", radius: 1, height: 1, sides: 4 });
    close(pyramid.min, [-1, -0.5, -1]);
    close(pyramid.max, [1, 0.5, 1]);
    // A hexagon is 2·radius across its flats (Z) and wider across its corners (X).
    const hex = bounds({ shape: "cylinder", radius: 1, height: 1, sides: 6 });
    close([hex.max[2]!, hex.max[0]!], [1, 2 / Math.sqrt(3)]);
    expect(halfExtents(subject({ shape: "cylinder", radius: 1, sides: 6 }))[0]).toBeCloseTo(2 / Math.sqrt(3));
    // Flat-shaded: the side triangles' normals are the face normals.
    const prism = meshGeometry({ shape: "cylinder", radius: 1, height: 1, sides: 3 });
    const normal = prism.getAttribute("normal");
    const sideNormals = new Set(Array.from({ length: normal.count }, (_, i) => i).filter((i) => Math.abs(normal.getY(i)) < 0.5).map((i) => [normal.getX(i), normal.getZ(i)].map((v) => v.toFixed(3)).join()));
    expect(sideNormals.size).toBe(3);
    // Round shapes keep three's own geometry, with the side count as segments.
    expect((meshGeometry({ shape: "cylinder", sides: 40 }) as THREE.CylinderGeometry).parameters.radialSegments).toBe(40);
  });

  it("collides with the faceted hull, saves and exports", async () => {
    const collider = await colliderOf(subject({ shape: "cone", radius: 1, height: 1, sides: 4 }));
    try {
      expect(collider.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
      // The base corner (outside a round cone of radius 1) is solid.
      expect(collider.contains([0.9, -0.45, 0.9])).toBe(true);
    } finally { collider.dispose(); }
    const round = await colliderOf(subject({ shape: "cylinder" }));
    try { expect(round.type).toBe(RAPIER.ShapeType.Cylinder); } finally { round.dispose(); }
    const { loaded, vertices } = await roundTrip({ shape: "cylinder", sides: 6 });
    expect(loaded.sides).toBe(6);
    expect(vertices).toBe(meshGeometry({ shape: "cylinder", sides: 6 }).getAttribute("position").count);
  });
});

describe("arc", () => {
  it("makes domes, half-pipes and arches", () => {
    const dome = bounds({ shape: "sphere", radius: 1, arc: 180 });
    close(dome.min, [-1, 0, -1]);
    close(dome.max, [1, 1, 1]);
    // Both sides are drawn, so a bowl's inside shows.
    expect(meshGeometry({ shape: "sphere", arc: 180 }).getAttribute("position").count).toBe(2 * new THREE.SphereGeometry(0.5, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed().getAttribute("position").count);
    const halfPipe = bounds({ shape: "cylinder", radius: 1, height: 2, arc: 180, hollow: 0.9 });
    close([halfPipe.min[0]!, halfPipe.max[0]!], [0, 1]);
    const arch = bounds({ shape: "torus", radius: 1, height: 0.2, arc: 180 });
    // Its ends are cut flat at y=0, so it stands on the ground.
    close([arch.min[1]!, arch.max[1]!], [0, 1.1]);
    // The checker sees the dome where it is drawn: resting on y=0, not buried.
    const scene = sceneOf({ ...subject({ shape: "sphere", radius: 1, arc: 180 }), components: { Transform: { position: [0, 0, 0] }, Mesh: { shape: "sphere", radius: 1, arc: 180 } } });
    expect(meshWorldBounds(scene, "subject")!.min.y).toBeCloseTo(0);
  });

  it("gives static shells their triangles and dynamic ones a hull; saves and exports", async () => {
    const bowl = await colliderOf(subject({ shape: "sphere", radius: 1, arc: 180 }, { anchored: true }));
    try {
      expect(bowl.type).toBe(RAPIER.ShapeType.TriMesh);
    } finally { bowl.dispose(); }
    const falling = await colliderOf(subject({ shape: "sphere", radius: 1, arc: 180 }));
    try {
      expect(falling.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
      expect(falling.contains([0, 0.5, 0])).toBe(true);
      expect(falling.contains([0, -0.5, 0])).toBe(false);
    } finally { falling.dispose(); }
    const { loaded, vertices } = await roundTrip({ shape: "torus", arc: 180 });
    expect(loaded.arc).toBe(180);
    expect(vertices).toBe(meshGeometry({ shape: "torus", arc: 180 }).getAttribute("position").count);
  });
});

describe("hollow", () => {
  it("makes an open tube with walls of the requested thickness", () => {
    const tube = meshGeometry({ shape: "cylinder", radius: 1, height: 1, hollow: 0.8 });
    const position = tube.getAttribute("position");
    const radii = Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i), position.getZ(i)));
    expect(Math.min(...radii)).toBeCloseTo(0.8);
    expect(Math.max(...radii)).toBeCloseTo(1, 2);
    // Every face normal points out of the material: away from the axis on the outer wall, toward it on the inner.
    const normal = tube.getAttribute("normal");
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5) continue;
      const outward = position.getX(i) * normal.getX(i) + position.getZ(i) * normal.getZ(i);
      expect(Math.sign(outward)).toBe(radii[i]! > 0.9 ? 1 : -1);
    }
    expect(meshGeometryKey({ shape: "cylinder", hollow: 0.5 })).not.toBe(meshGeometryKey({ shape: "cylinder" }));
    // Only cylinders hollow out.
    expect(meshGeometry({ shape: "cone", hollow: 0.5 })).toBeInstanceOf(THREE.ConeGeometry);
  });

  it("is open inside when static, saves and exports", async () => {
    const pipe = await colliderOf(subject({ shape: "cylinder", radius: 1, height: 1, hollow: 0.5 }, { bodyType: "static" }));
    try {
      expect(pipe.type).toBe(RAPIER.ShapeType.TriMesh);
    } finally { pipe.dispose(); }
    const { loaded, vertices } = await roundTrip({ shape: "cylinder", hollow: 0.85 });
    expect(loaded.hollow).toBe(0.85);
    expect(vertices).toBe(meshGeometry({ shape: "cylinder", hollow: 0.85 }).getAttribute("position").count);
  });
});

describe("torus", () => {
  it("is an XY ring: radius to the tube center, height is the tube thickness", () => {
    const ring = bounds({ shape: "torus", radius: 1, height: 0.2 });
    close(ring.min, [-1.1, -1.1, -0.1]);
    close(ring.max, [1.1, 1.1, 0.1]);
    close(halfExtents(subject({ shape: "torus", radius: 1, height: 0.2 })), [1.1, 1.1, 0.1]);
  });

  it("has a hole when static and a hull when dynamic; saves and exports", async () => {
    const fixed = await colliderOf(subject({ shape: "torus", radius: 1, height: 0.2 }, { anchored: true }));
    try {
      expect(fixed.type).toBe(RAPIER.ShapeType.TriMesh);
    } finally { fixed.dispose(); }
    const wheel = await colliderOf(subject({ shape: "torus", radius: 1, height: 0.2 }));
    try {
      expect(wheel.type).toBe(RAPIER.ShapeType.ConvexPolyhedron);
      expect(wheel.contains([0, 0, 0])).toBe(true);
    } finally { wheel.dispose(); }
    const { loaded, vertices } = await roundTrip({ shape: "torus", radius: 0.3, height: 0.05 });
    expect(loaded).toEqual({ shape: "torus", radius: 0.3, height: 0.05 });
    expect(vertices).toBe(meshGeometry({ shape: "torus", radius: 0.3, height: 0.05 }).getAttribute("position").count);
  });
});

describe("text", () => {
  it("is centered, cap letters are height tall, and depth is 2·radius", () => {
    const sign = bounds({ shape: "text", text: "HELL", height: 0.5, radius: 0.05 });
    close([sign.max[1]! - sign.min[1]!, sign.max[2]! - sign.min[2]!], [0.5, 0.1]);
    close([sign.min[0]! + sign.max[0]!, sign.min[1]! + sign.max[1]!, sign.min[2]! + sign.max[2]!], [0, 0, 0]);
    expect(sign.max[0]! - sign.min[0]!).toBeGreaterThan(1);
    // Longer text is wider; empty text falls back to the default word; unknown characters become '?'.
    expect(bounds({ shape: "text", text: "HELL WORLD", height: 0.5 }).max[0]!).toBeGreaterThan(sign.max[0]!);
    expect(meshGeometryKey({ shape: "text", text: "  " })).toBe(meshGeometryKey({ shape: "text" }));
    expect(meshGeometryKey({ shape: "text", text: "café" })).toBe(meshGeometryKey({ shape: "text", text: "caf?" }));
    expect(meshFeatureBounds({ shape: "text", text: "HELL", height: 0.5, radius: 0.05 })!.max.y).toBeCloseTo(0.25);
  });

  it("validates its length, collides, saves and exports", async () => {
    const tooLong = createEmptyScene();
    tooLong.entities = [subject({ shape: "text", text: "x".repeat(41) })];
    expect(validateScene(tooLong).join()).toContain("at most 40 characters");
    const fixed = await colliderOf(subject({ shape: "text", text: "OPEN" }, { anchored: true }));
    try { expect(fixed.type).toBe(RAPIER.ShapeType.TriMesh); } finally { fixed.dispose(); }
    const loose = await colliderOf(subject({ shape: "text", text: "OPEN" }));
    try { expect(loose.type).toBe(RAPIER.ShapeType.ConvexPolyhedron); } finally { loose.dispose(); }
    const { loaded, vertices } = await roundTrip({ shape: "text", text: "Coffee", height: 0.2, radius: 0.02 });
    expect(loaded.text).toBe("Coffee");
    expect(vertices).toBe(meshGeometry({ shape: "text", text: "Coffee", height: 0.2, radius: 0.02 }).getAttribute("position").count);
  });
});

describe("older scenes", () => {
  it("load unchanged: new fields stay unset and default fields are not saved", () => {
    const saved = JSON.stringify({ version: 1, settings: {}, entities: [subject({ shape: "cylinder", radius: 0.3 })] });
    const loaded = deserializeScene(saved);
    expect(loaded.entities[0]!.components.Mesh).toEqual({ shape: "cylinder", radius: 0.3 });
    expect(JSON.parse(serializeScene(loaded)).entities[0].components.Mesh).toEqual({ shape: "cylinder", radius: 0.3 });
    const defaults = sceneOf(subject({ bevel: 0, sides: 32, arc: 360, hollow: 0, text: "Text" }));
    expect(defaults.entities[0]!.components.Mesh).toEqual({});
  });
});
