import { describe, expect, it } from "vitest";
import { applyOps } from "../../src/scene/applyOps";
import { SceneHistory } from "../../src/scene/history";
import { createEmptyScene } from "../../src/scene/types";

const box = {
  op: "create" as const,
  id: "box",
  name: "Box",
  parent: null,
  components: {
    Transform: {},
    Mesh: { shape: "box" },
    Material: { color: "#ff0000" }
  }
};

describe("applyOps", () => {
  it("creates, updates, and deletes entities", () => {
    const created = applyOps(createEmptyScene(), [box]);
    expect(created.errors).toEqual([]);
    expect(created.scene.entities).toHaveLength(1);
    expect(created.scene.entities[0].components.Material).toEqual({ color: "#ff0000" });

    const updated = applyOps(created.scene, [{ op: "update", id: "box", components: { Transform: { position: [1, 2, 3] } } }]);
    expect(updated.errors).toEqual([]);
    expect(updated.scene.entities[0].components.Transform).toEqual({ position: [1, 2, 3] });

    const deleted = applyOps(updated.scene, [{ op: "delete", id: "box" }]);
    expect(deleted.errors).toEqual([]);
    expect(deleted.scene.entities).toEqual([]);
  });

  it("rejects an invalid batch without partially applying it", () => {
    const source = applyOps(createEmptyScene(), [box]).scene;
    const result = applyOps(source, [
      { op: "update", id: "box", components: { Transform: { position: [4, 5, 6] } } },
      { op: "update", id: "missing", components: { Transform: { position: [0, 0, 0] } } }
    ]);
    expect(result.errors).toContain("ops[1]: entity 'missing' does not exist");
    expect(result.scene).toBe(source);
    expect(result.scene.entities[0].components.Transform).toEqual({});
  });

  it("rejects schema range and component dependency violations", () => {
    const badField = applyOps(createEmptyScene(), [{
      ...box,
      components: { Transform: {}, Mesh: { radius: 100 } }
    }]);
    expect(badField.errors.join(" ")).toContain("must be between 0.01 and 50");
    const missingDependency = applyOps(createEmptyScene(), [{
      ...box,
      components: { Material: { color: "#ffffff" } }
    }]);
    expect(missingDependency.errors.join(" ")).toContain("Material requires Mesh");
  });

  it("undoes and redoes create, update, and delete batches", () => {
    const initial = createEmptyScene();
    const history = new SceneHistory(initial);
    expect(history.apply([box])).toEqual([]);
    const created = structuredClone(history.scene);
    expect(history.apply([{ op: "update", id: "box", components: { Transform: { position: [2, 0, 0] } } }])).toEqual([]);
    expect(history.undo()).toEqual([]);
    expect(history.scene).toEqual(created);
    expect(history.redo()).toEqual([]);
    expect(history.scene.entities[0].components.Transform).toEqual({ position: [2, 0, 0] });
    expect(history.apply([{ op: "delete", id: "box" }])).toEqual([]);
    expect(history.undo()).toEqual([]);
    expect(history.scene.entities[0].id).toBe("box");
    expect(history.undo()).toEqual([]);
    expect(history.undo()).toEqual([]);
    expect(history.scene).toEqual(initial);
    expect(history.redo()).toEqual([]);
    expect(history.scene.entities[0].id).toBe("box");
  });

  it("coalesces one operation batch into one undo step", () => {
    const history = new SceneHistory(createEmptyScene());
    expect(history.apply([box, { op: "settings", settings: { background: "#000000" } }])).toEqual([]);
    expect(history.undo()).toEqual([]);
    expect(history.scene.entities).toEqual([]);
    expect(history.scene.settings.background).toBe("#202124");
  });

  it("reparents entities through update ops and restores parent on undo", () => {
    const history = new SceneHistory(createEmptyScene());
    expect(history.apply([
      { op: "create", id: "group", name: "Group", parent: null, components: {} },
      { op: "create", id: "child", name: "Child", parent: null, components: {} }
    ])).toEqual([]);
    expect(history.apply([{ op: "update", id: "child", components: {}, parent: "group" }])).toEqual([]);
    expect(history.scene.entities.find((entity) => entity.id === "child")?.parent).toBe("group");
    const invalid = applyOps(history.scene, [{ op: "update", id: "group", components: {}, parent: "child" }]);
    expect(invalid.errors.join(" ")).toContain("parent hierarchy contains a cycle");
    expect(history.undo()).toEqual([]);
    expect(history.scene.entities.find((entity) => entity.id === "child")?.parent).toBeNull();
  });

  it("renames entities through update ops and restores the name on undo", () => {
    const history = new SceneHistory(createEmptyScene());
    expect(history.apply([box])).toEqual([]);
    expect(history.apply([{ op: "update", id: "box", components: {}, name: "Renamed box" }])).toEqual([]);
    expect(history.scene.entities[0].name).toBe("Renamed box");
    expect(history.undo()).toEqual([]);
    expect(history.scene.entities[0].name).toBe("Box");
    expect(history.redo()).toEqual([]);
    expect(history.scene.entities[0].name).toBe("Renamed box");
    expect(applyOps(history.scene, [{ op: "update", id: "box", components: {}, name: "  " }]).errors).toContain("ops[0].name: must be a non-empty string");
  });
});
