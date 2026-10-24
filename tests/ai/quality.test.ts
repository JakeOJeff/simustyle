import { describe, expect, it } from "vitest";
import { inspectBuildQuality, meshWorldBounds } from "../../src/ai/quality";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type SceneOp } from "../../src/scene/types";
import { createDefaultScene } from "../../src/runtime/camera";

describe("build quality diagnostics", () => {
  it("uses world bounds for rotated/scaled groups and the renderer's XY planes", () => {
    const ops: SceneOp[] = [
      { op: "create", id: "room", name: "Room", parent: null, components: { Transform: { position: [10, 3, 0], rotation: [0, 90, 0], scale: [2, 2, 2] } } },
      { op: "create", id: "box", name: "Box", parent: "room", components: { Transform: { position: [1, 0, 0] }, Mesh: { height: 2 }, Material: {} } },
      { op: "create", id: "floor", name: "Floor", parent: null, components: { Transform: { rotation: [-90, 0, 0] }, Mesh: { shape: "plane", radius: 5 }, Material: {} } }
    ];
    const scene = applyOps(createEmptyScene(), ops).scene;
    const bounds = meshWorldBounds(scene, "box")!;
    expect(bounds.min.toArray()).toEqual([9, 1, -3]);
    expect(bounds.max.x).toBeCloseTo(11);
    expect(bounds.max.z).toBeCloseTo(-1);
    const floor = meshWorldBounds(scene, "floor")!;
    expect(floor.max.y).toBeCloseTo(0.005);
    expect(floor.max.z).toBeCloseTo(5);
    expect(inspectBuildQuality(scene, ops).warnings).toEqual([]);
  });

  it("reports duplicates, ground penetration, missing material, overlaps and a flat hierarchy", () => {
    const ops: SceneOp[] = Array.from({ length: 8 }, (_, i) => ({
      op: "create", id: `box_${i}`, name: `Box ${i}`, parent: null,
      components: { Transform: { position: [i === 1 ? 0 : i, 0, 0] }, Mesh: {}, ...(i ? { Material: {} } : { RigidBody: {} }) }
    }));
    const scene = applyOps(createEmptyScene(), ops).scene;
    const report = inspectBuildQuality(scene, ops);
    expect(report.stats.meshes).toBe(8);
    expect(report.warnings.join()).toContain("identical geometry");
    expect(report.warnings.join()).toContain("no Material");
    expect(report.warnings.join()).toContain("below ground");
    expect(report.warnings.join()).toContain("may overlap");
    expect(report.warnings.join()).toContain("folders/assemblies");
  });

  it("does not blame an unrelated edit for existing defects", () => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "old", name: "Old", parent: null, components: { Transform: {}, Mesh: {} } });
    expect(inspectBuildQuality(scene, []).warnings).toEqual([]);
    expect(inspectBuildQuality(scene, [{ op: "update", id: "old", components: { Transform: { scale: [0, 1, 1] } } }]).warnings.join()).toContain("no Material");
    const change: SceneOp[] = [{ op: "update", id: "old", components: { Transform: { scale: [0, 1, 1] } } }];
    expect(inspectBuildQuality(applyOps(scene, change).scene, change).warnings.join()).toContain("collapsed world transform");
  });

  it("checks static camera framing and treats tracking-camera framing as unresolved", () => {
    const ops: SceneOp[] = [{ op: "create", id: "far", name: "Far box", parent: null, components: { Transform: { position: [100, 0.5, 100] }, Mesh: {}, Material: {} } }];
    const scene = applyOps(createDefaultScene(), ops).scene;
    expect(inspectBuildQuality(scene, ops).warnings.join()).toContain("outside the active camera");
    scene.entities[0]!.components.Camera!.lookAtTarget = "far";
    expect(inspectBuildQuality(scene, ops).warnings.join()).not.toContain("outside the active camera");
  });
});
