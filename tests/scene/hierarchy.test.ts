import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyOps } from "../../src/scene/applyOps";
import { groupOps, reparentOps, topLevelIds, ungroupOps, worldMatrix } from "../../src/scene/hierarchy";
import { createEmptyScene, type Scene, type SceneOp } from "../../src/scene/types";

function sceneWith(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}

function worldPosition(scene: Scene, id: string): number[] {
  return new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, id)).toArray().map((value) => Math.round(value * 1000) / 1000);
}

const base: SceneOp[] = [
  { op: "create", id: "table", name: "Table", parent: null, components: { Transform: { position: [2, 1, 0], rotation: [0, 90, 0], scale: [2, 2, 2] }, Mesh: { shape: "box" } } },
  { op: "create", id: "cup", name: "Cup", parent: null, components: { Transform: { position: [3, 2, 1] }, Mesh: { shape: "cylinder" } } },
  { op: "create", id: "ball", name: "Ball", parent: null, components: { Transform: { position: [-1, 0.5, 0] }, Mesh: { shape: "sphere" } } }
];

describe("hierarchy helpers", () => {
  it("keeps an object's world position when it gets a new parent", () => {
    const scene = sceneWith(base);
    const { ops, error } = reparentOps(scene, "cup", "table");
    expect(error).toBeUndefined();
    const moved = applyOps(scene, ops).scene;
    expect(moved.entities.find((entity) => entity.id === "cup")?.parent).toBe("table");
    expect(worldPosition(moved, "cup")).toEqual([3, 2, 1]);
    const back = applyOps(moved, reparentOps(moved, "cup", null).ops).scene;
    expect(back.entities.find((entity) => entity.id === "cup")?.components.Transform?.position).toEqual([3, 2, 1]);
  });

  it("refuses to put an object inside its own child", () => {
    const scene = sceneWith([...base, { op: "update", id: "cup", components: {}, parent: "table" }]);
    expect(reparentOps(scene, "table", "cup").error).toMatch(/inside itself/);
  });

  it("groups objects around their center and ungroups them in place", () => {
    const scene = sceneWith(base);
    const grouped = groupOps(scene, ["cup", "ball"], "group", "Group");
    expect(grouped.error).toBeUndefined();
    const result = applyOps(scene, grouped.ops);
    expect(result.errors).toEqual([]);
    const group = result.scene.entities.find((entity) => entity.id === "group");
    expect(group?.components.Transform?.position).toEqual([1, 1.25, 0.5]);
    expect(worldPosition(result.scene, "cup")).toEqual([3, 2, 1]);
    expect(worldPosition(result.scene, "ball")).toEqual([-1, 0.5, 0]);

    const ungrouped = applyOps(result.scene, ungroupOps(result.scene, "group").ops).scene;
    expect(ungrouped.entities.some((entity) => entity.id === "group")).toBe(false);
    expect(worldPosition(ungrouped, "cup")).toEqual([3, 2, 1]);
    expect(ungrouped.entities.find((entity) => entity.id === "ball")?.parent).toBeNull();
  });

  it("treats a selected parent and child as one member", () => {
    const scene = sceneWith([...base, { op: "update", id: "cup", components: {}, parent: "table" }]);
    expect(topLevelIds(scene, ["cup", "table", "ball"])).toEqual(["table", "ball"]);
  });
});
