import { describe, expect, it } from "vitest";
import { expandBuildOperations, type BuildOperation } from "../../src/ai/buildTools";
import { applyOps } from "../../src/scene/applyOps";
import { worldMatrix } from "../../src/scene/hierarchy";
import { createEmptyScene } from "../../src/scene/types";

const assembly: BuildOperation = {
  op: "assemble", id: "lamp", name: "Lamp", parent: null, transform: { position: [0, 0, 0] },
  parts: [
    { id: "stem", name: "Stem", components: { Transform: { position: [0, 1, 0] }, Mesh: { height: 2 }, Material: { color: "#223344" } } },
    { id: "light", name: "Lamp light", parent: "stem", components: { Transform: {}, Light: {} } },
    { id: "camera", name: "Lamp camera", components: { Transform: {}, Camera: { lookAtTarget: "stem", isActive: true } } }
  ]
};

describe("scene building functions", () => {
  it("assembles and repeats whole trees with stable ids, local spacing and internal references", () => {
    const original = createEmptyScene();
    const expanded = expandBuildOperations(original, [assembly,
      { op: "repeat", source: "lamp", idPrefix: "row", name: "Row lamp", count: 2, step: [3, 0, 0], rotationStep: [0, 15, 0] }
    ]);
    expect(expanded.errors).toEqual([]);
    const applied = applyOps(original, expanded.ops);
    expect(applied.errors).toEqual([]);
    expect(original.entities).toEqual([]);
    expect(applied.scene.entities).toHaveLength(12);
    const copy = applied.scene.entities.find((entity) => entity.id === "row_2")!;
    expect(copy.components.Transform).toEqual({ position: [6, 0, 0], rotation: [0, 30, 0] });
    expect(applied.scene.entities.find((entity) => entity.id === "row_1_part_2")?.components.Camera).toEqual({ lookAtTarget: "row_1_part_1" });
    expect(applied.scene.entities.find((entity) => entity.id === "row_1_part_3")?.parent).toBe("row_1_part_1");
    expect(applyOps(applied.scene, applied.inverseOps).scene).toEqual(original);
  });

  it("organizes existing transformed objects without changing their world positions", () => {
    const expanded = expandBuildOperations(createEmptyScene(), [assembly]);
    const scene = applyOps(createEmptyScene(), expanded.ops).scene;
    const before = scene.entities.map((entity) => [entity.id, worldMatrix(scene, entity.id).toArray()] as const);
    const grouped = expandBuildOperations(scene, [{ op: "group", id: "props", name: "Props", ids: ["lamp", "stem"] }]);
    expect(grouped.errors).toEqual([]);
    const applied = applyOps(scene, grouped.ops);
    expect(applied.errors).toEqual([]);
    for (const [id, matrix] of before) {
      const after = worldMatrix(applied.scene, id).toArray();
      matrix.forEach((value, index) => expect(after[index]).toBeCloseTo(value, 5));
    }
    expect(applied.scene.entities.find((entity) => entity.id === "lamp")?.parent).toBe("props");
    expect(applied.scene.entities.find((entity) => entity.id === "stem")?.parent).toBe("lamp");
  });

  it.each([
    { op: "repeat", source: "lamp", idPrefix: "row", name: "Row", count: 0, step: [1, 0, 0] },
    { op: "repeat", source: "lamp", idPrefix: "row", name: "Row", count: 201, step: [1, 0, 0] },
    { op: "repeat", source: "lamp", idPrefix: "row", name: "Row", count: 1, step: [1, NaN, 0] },
    { op: "group", id: "props", name: "Props", ids: ["missing"] },
    { op: "assemble", id: "a", name: "A", parent: null, parts: [{ id: "a", name: "Duplicate", components: {} }] }
  ])("rejects malformed tools without returning partial operations: %j", (bad) => {
    const scene = createEmptyScene();
    const result = expandBuildOperations(scene, [assembly, bad]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.ops).toEqual([]);
    expect(scene.entities).toEqual([]);
  });

  it("rejects generated id collisions and expanded operation budgets", () => {
    const collision = expandBuildOperations(createEmptyScene(), [assembly,
      { op: "repeat", source: "lamp", idPrefix: "row", name: "Row", count: 1, step: [2, 0, 0] },
      { op: "repeat", source: "lamp", idPrefix: "row", name: "Row", count: 1, step: [4, 0, 0] }
    ]);
    expect(collision.errors.join()).toContain("already exists");
    const huge = { ...assembly, parts: Array.from({ length: 20 }, (_, i) => ({ id: `part_${i}`, name: `Part ${i}`, components: { Transform: {}, Mesh: {}, Material: {} } })) };
    const result = expandBuildOperations(createEmptyScene(), [huge, { op: "repeat", source: "lamp", idPrefix: "row", name: "Row", count: 200, step: [2, 0, 0] }]);
    expect(result.errors.join()).toContain("1500");
    expect(result.ops).toEqual([]);
  });
});
