import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { meshGeometry, meshTopRadius } from "../../src/scene/meshGeometry";
import { createThreeScene } from "../../src/export/gltf";
import { PhysicsRuntime } from "../../src/runtime/physics";
import { halfExtents } from "../../src/runtime/commands";
import { applyOps } from "../../src/scene/applyOps";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { validateScene } from "../../src/scene/validate";
import { createEmptyScene, type Entity, type Scene } from "../../src/scene/types";

const mesh = (fields: Record<string, unknown>, transform: Record<string, unknown> = {}): Entity =>
  ({ id: "subject", name: "Subject", parent: null, components: { Transform: { position: [0, 5, 0], ...transform }, Mesh: fields, RigidBody: {} } });

function sceneOf(entity: Entity): Scene {
  const result = applyOps(createEmptyScene(), [{ op: "create", id: entity.id, name: entity.name, parent: null, components: entity.components }]);
  expect(result.errors).toEqual([]);
  return result.scene;
}

describe("wedge", () => {
  it("is a box-sized prism whose slope rises along +X", () => {
    const geometry = meshGeometry({ shape: "wedge", radius: 1, height: 2 });
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-1, -1, -1]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([1, 1, 1]);
    const position = geometry.getAttribute("position");
    expect(position.count).toBe(24); // 2 triangular ends + 3 quads
    const tops = Array.from({ length: position.count }, (_, i) => [position.getX(i), position.getY(i)]).filter(([, y]) => y === 1);
    expect(tops.every(([x]) => x === 1)).toBe(true);
    expect(geometry.getAttribute("uv").count).toBe(24);
    // Every face normal points away from the prism's center.
    const normal = geometry.getAttribute("normal");
    const center = new THREE.Vector3(1 / 3, -1 / 3, 0);
    for (let i = 0; i < position.count; i += 3) {
      const face = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i)).sub(center);
      expect(face.dot(new THREE.Vector3(normal.getX(i), normal.getY(i), normal.getZ(i)))).toBeGreaterThan(0);
    }
  });

  it("is a valid shape that exports and collides like its visible slope", async () => {
    const entity = mesh({ shape: "wedge", radius: 1, height: 2 });
    expect(validateScene(sceneOf(entity))).toEqual([]);
    expect(halfExtents(entity)).toEqual([1, 1, 1]);
    const exported = createThreeScene(sceneOf(entity)).getObjectByName("Subject") as THREE.Mesh;
    expect(exported.geometry.getAttribute("position").count).toBe(24);

    for (const [scale, low, high] of [[[1, 1, 1], -0.8, 0.8], [[-1, 1, 1], 0.8, -0.8]] as const) {
      const runtime = await PhysicsRuntime.create(sceneOf(mesh({ shape: "wedge", radius: 1, height: 2 }, { scale })));
      try {
        let collider: ReturnType<typeof runtime.world.getCollider> | undefined;
        runtime.world.forEachCollider((candidate) => { if (candidate.parent()?.isDynamic()) collider = candidate; });
        // Near the top, only the high (vertical-face) side is solid.
        expect(collider!.containsPoint({ x: high, y: 5.7, z: 0 })).toBe(true);
        expect(collider!.containsPoint({ x: low, y: 5.7, z: 0 })).toBe(false);
        expect(collider!.containsPoint({ x: low, y: 4.2, z: 0 })).toBe(true);
      } finally { runtime.dispose(); }
    }
  });
});

describe("radiusTop", () => {
  it("defaults to the shape's own top and truncates cylinders and cones", () => {
    expect(meshTopRadius({ shape: "cylinder", radius: 0.4 })).toBe(0.4);
    expect(meshTopRadius({ shape: "cone", radius: 0.4 })).toBe(0);
    expect(meshTopRadius({ shape: "cone", radius: 0.4, radiusTop: 0.15 })).toBe(0.15);
    const pointed = meshGeometry({ shape: "cone", radius: 0.4 }) as THREE.CylinderGeometry;
    expect(pointed).toBeInstanceOf(THREE.ConeGeometry);
    const shade = meshGeometry({ shape: "cone", radius: 0.4, radiusTop: 0.15 }) as THREE.CylinderGeometry;
    expect([shade.parameters.radiusTop, shade.parameters.radiusBottom]).toEqual([0.15, 0.4]);
    const bucket = meshGeometry({ shape: "cylinder", radius: 0.3, radiusTop: 0.4 }) as THREE.CylinderGeometry;
    expect([bucket.parameters.radiusTop, bucket.parameters.radiusBottom]).toEqual([0.4, 0.3]);
    expect(halfExtents(mesh({ shape: "cylinder", radius: 0.3, radiusTop: 0.4, height: 1 }))).toEqual([0.4, 0.5, 0.4]);
    const exported = createThreeScene(sceneOf(mesh({ shape: "cone", radius: 0.4, radiusTop: 0.15 }))).getObjectByName("Subject") as THREE.Mesh;
    expect((exported.geometry as THREE.CylinderGeometry).parameters.radiusTop).toBe(0.15);
  });

  it("is validated, and survives saving even when it equals the nominal default", () => {
    expect(validateScene(sceneOf(mesh({ shape: "cone", radiusTop: 0.5 })))).toEqual([]);
    const tooBig = createEmptyScene();
    tooBig.entities = [mesh({ shape: "cone", radiusTop: 51 })];
    expect(validateScene(tooBig).join()).toContain("radiusTop");
    const saved = deserializeScene(serializeScene(sceneOf(mesh({ shape: "cone", radiusTop: 0.5 }))));
    expect(saved.entities[0]!.components.Mesh!.radiusTop).toBe(0.5);
  });

  it("gives a truncated cone a flat-topped collider", async () => {
    for (const [radiusTop, solidTop] of [[undefined, false], [0.4, true]] as const) {
      const runtime = await PhysicsRuntime.create(sceneOf(mesh({ shape: "cone", radius: 0.5, height: 1, ...(radiusTop === undefined ? {} : { radiusTop }) })));
      try {
        let collider: ReturnType<typeof runtime.world.getCollider> | undefined;
        runtime.world.forEachCollider((candidate) => { if (candidate.parent()?.isDynamic()) collider = candidate; });
        expect(collider!.containsPoint({ x: 0.3, y: 5.4, z: 0 })).toBe(solidTop);
      } finally { runtime.dispose(); }
    }
  });
});
