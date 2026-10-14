import { describe, expect, it } from "vitest";
import { applyOps } from "../../src/scene/applyOps";
import { copyEntityTree, pasteEntityOps } from "../../src/scene/clipboard";
import { SceneHistory } from "../../src/scene/history";
import { deleteEntityOps } from "../../src/scene/delete";
import { removeComponentOps } from "../../src/scene/components";
import { evaluateAnimations } from "../../src/runtime/animator";
import { groupOps, reparentOps, ungroupOps, worldMatrix } from "../../src/scene/hierarchy";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { createEmptyScene, type Scene, type SceneOp } from "../../src/scene/types";
import { validateScene } from "../../src/scene/validate";

function sceneWith(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}
const object = (id: string, parent: string | null = null): SceneOp => ({ op: "create", id, name: id, parent, components: { Transform: {}, Mesh: {} } });
const position = (scene: Scene, id: string) => worldMatrix(scene, id).elements.slice(12, 15).map((n) => Math.round(n * 1e5) / 1e5);

describe("editor scene edge cases", () => {
  it("removes animation tracks with their component so preview cannot recreate the component", () => {
    const scene = sceneWith([object("box"), { op: "update", id: "box", components: {
      Material: {}, Animator: { tracks: [{ component: "Material", field: "color", keys: [{ time: 0, value: "#ff0000" }] }] }
    } }]);
    const history = new SceneHistory(scene);
    expect(history.apply(removeComponentOps(scene, "box", "Material"))).toEqual([]);
    expect(evaluateAnimations(history.scene, 1).scene.entities[0].components.Material).toBeUndefined();
    expect(history.undo()).toEqual([]);
    expect(history.scene).toEqual(scene);
  });
  it("deletes overlapping parent/child selections once and restores them with one undo", () => {
    const scene = sceneWith([object("parent"), object("child", "parent"), object("other"), object("keep")]);
    const history = new SceneHistory(scene);
    const ops = deleteEntityOps(scene, ["parent", "child", "other", "parent"]);
    expect(ops).toHaveLength(3);
    expect(history.apply(ops)).toEqual([]);
    expect(history.scene.entities.map((entity) => entity.id)).toEqual(["keep"]);
    expect(history.undo()).toEqual([]);
    expect(history.scene).toEqual(scene);
  });
  it.each([null, 3, "bad", []])("reports malformed known components without crashing: %j", (value) => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "bad", name: "Bad", parent: null, components: { Transform: value as never, Camera: value as never } });
    expect(validateScene(scene).join(" ")).toContain("component data must be an object");
    expect(() => deserializeScene(JSON.stringify(scene))).toThrow(/Scene file is invalid/);
    expect(applyOps(scene, []).scene).toBe(scene);
  });

  it.each(["constructor", "toString", "__proto__", "Missing"])("rejects unknown component/field names safely: %s", (name) => {
    const scene = sceneWith([object("box")]);
    const components = Object.fromEntries([[name, {}]]);
    expect(applyOps(scene, [{ op: "update", id: "box", components }]).errors.length).toBeGreaterThan(0);
    expect(applyOps(scene, [{ op: "create", id: "other", name: "Other", parent: null, components }]).errors.length).toBeGreaterThan(0);
    expect(applyOps(scene, [{ op: "update", id: "box", components: { Transform: Object.fromEntries([[name, 1]]) } }]).errors.length).toBeGreaterThan(0);
  });

  it.each([["background", 5], ["collisions", "yes"], ["fixedTimestep", NaN], ["gravity", null], ["unknown", true], ["constructor", true]])("rejects invalid settings atomically: %s", (key, value) => {
    const settings = { [String(key)]: value };
    const scene = createEmptyScene();
    const result = applyOps(scene, [object("box"), { op: "settings", settings }]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.scene).toBe(scene);
    expect(result.inverseOps).toEqual([]);
  });

  it("restores original entity order after deleting multiple objects and repeating undo/redo", () => {
    const original = sceneWith([object("a"), object("b"), object("c"), object("d")]);
    const history = new SceneHistory(original);
    expect(history.apply([{ op: "delete", id: "b" }, { op: "delete", id: "a" }, { op: "delete", id: "d" }])).toEqual([]);
    for (let n = 0; n < 4; n++) {
      expect(history.undo()).toEqual([]);
      expect(history.scene).toEqual(original);
      expect(history.redo()).toEqual([]);
      expect(history.scene.entities.map((entity) => entity.id)).toEqual(["c"]);
    }
  });

  it("deletes a joint target and restores the joint and camera targets in the same undo step", () => {
    const scene = sceneWith([
      { op: "create", id: "anchor", name: "Anchor", parent: null, components: { Transform: {}, RigidBody: { bodyType: "static" } } },
      { op: "create", id: "ball", name: "Ball", parent: null, components: { Transform: {}, RigidBody: {}, Joint: { target: "anchor" } } },
      { op: "create", id: "camera", name: "Camera", parent: null, components: { Transform: {}, Camera: { followTarget: "anchor", lookAtTarget: "anchor" } } }
    ]);
    const history = new SceneHistory(scene);
    expect(history.apply([{ op: "delete", id: "anchor" }])).toEqual([]);
    expect(history.scene.entities[0].components.Joint).toBeUndefined();
    expect(history.scene.entities[1].components.Camera).toEqual({});
    expect(history.undo()).toEqual([]);
    expect(history.scene).toEqual(scene);
    expect(history.redo()).toEqual([]);
  });

  it("copies nested references, disables cloned cameras, and gives every copy a unique name", () => {
    const scene = sceneWith([
      object("rig"), object("body", "rig"),
      { op: "update", id: "body", components: { RigidBody: {} } },
      { op: "create", id: "joint", name: "Joint", parent: "rig", components: { Transform: {}, RigidBody: {}, Joint: { target: "body" } } },
      { op: "create", id: "cam", name: "Cam", parent: "rig", components: { Transform: {}, Camera: { isActive: true, followTarget: "body" } } }
    ]);
    const clipboard = copyEntityTree(scene, "rig")!;
    const first = applyOps(scene, pasteEntityOps(scene, clipboard).ops);
    expect(first.errors).toEqual([]);
    expect(first.scene.entities.find((entity) => entity.id === "joint_copy")?.components.Joint?.target).toBe("body_copy");
    expect(first.scene.entities.find((entity) => entity.id === "cam_copy")?.components.Camera).toMatchObject({ followTarget: "body_copy" });
    expect(first.scene.entities.find((entity) => entity.id === "cam_copy")?.components.Camera?.isActive).not.toBe(true);
    const second = applyOps(first.scene, pasteEntityOps(first.scene, clipboard).ops);
    expect(second.errors).toEqual([]);
    expect(new Set(second.scene.entities.map((entity) => entity.name)).size).toBe(second.scene.entities.length);
    expect(clipboard).toEqual(copyEntityTree(scene, "rig"));
  });

  it("keeps the captured world pose when pasting a child after deleting its parent", () => {
    const scene = sceneWith([object("parent"), { op: "update", id: "parent", components: { Transform: { position: [10, 2, 3], rotation: [0, 90, 0], scale: [2, 2, 2] } } }, object("child", "parent"), { op: "update", id: "child", components: { Transform: { position: [1, 1, 0] } } }]);
    const clipboard = copyEntityTree(scene, "child")!;
    const empty = createEmptyScene();
    const pasted = applyOps(empty, pasteEntityOps(empty, clipboard).ops);
    expect(pasted.errors).toEqual([]);
    expect(position(pasted.scene, "child_copy")).toEqual([11.5, 4, 2.5]);
    const placed = applyOps(empty, pasteEntityOps(empty, clipboard, { position: [20, 0, 30] }).ops);
    expect(position(placed.scene, "child_copy")).toEqual([20, 4, 30]);
  });

  it("pastes inside the chosen parent and clears references to objects that no longer exist", () => {
    const scene = sceneWith([object("target"), { op: "create", id: "camera", name: "Camera", parent: null, components: { Transform: { position: [3, 4, 5] }, Camera: { followTarget: "target" } } }]);
    const destination = sceneWith([object("group"), { op: "update", id: "group", components: { Transform: { position: [8, 0, 0] } } }]);
    const pasted = applyOps(destination, pasteEntityOps(destination, copyEntityTree(scene, "camera")!, { parent: "group" }).ops);
    expect(pasted.errors).toEqual([]);
    expect(pasted.scene.entities[1].parent).toBe("group");
    expect(position(pasted.scene, "camera_copy")).toEqual([4.5, 4, 6.5]);
    expect(pasted.scene.entities[1].components.Camera.followTarget).toBeUndefined();
  });

  it("preserves children of containers without Transform when changing parents and grouping", () => {
    const scene = sceneWith([{ op: "create", id: "container", name: "Container", parent: null, components: {} }, object("child", "container"), object("parent"), { op: "update", id: "parent", components: { Transform: { position: [10, 0, 0] } } }]);
    const moved = applyOps(scene, reparentOps(scene, "container", "parent").ops);
    expect(moved.errors).toEqual([]);
    expect(position(moved.scene, "child")).toEqual([0, 0, 0]);
    const grouped = applyOps(scene, groupOps(scene, ["container", "parent"], "group", "Group").ops);
    expect(grouped.errors).toEqual([]);
    expect(position(grouped.scene, "child")).toEqual([0, 0, 0]);
  });

  it("refuses zero-scale and sheared reparenting without losing the scene", () => {
    const scene = sceneWith([object("parent"), { op: "update", id: "parent", components: { Transform: { scale: [0, 1, 1] } } }, object("child")]);
    expect(reparentOps(scene, "child", "parent").error).toMatch(/zero scale/);
    const scaled = applyOps(scene, [{ op: "update", id: "parent", components: { Transform: { scale: [2, 1, 1] } } }, { op: "update", id: "child", components: { Transform: { rotation: [0, 45, 0] } } }]).scene;
    expect(reparentOps(scaled, "child", "parent").error).toMatch(/distort/);
    const nested = applyOps(scaled, [{ op: "update", id: "child", parent: "parent", components: {} }]).scene;
    expect(ungroupOps(nested, "parent").error).toMatch(/distort/);
  });

  it("rejects out-of-range animation keys and nonfinite script parameters before saving", () => {
    const scene = sceneWith([object("box")]);
    expect(applyOps(scene, [{ op: "update", id: "box", components: { Animator: { tracks: [{ component: "Light", field: "intensity", keys: [{ time: 0, value: -1 }] }] } } }]).errors.join(" ")).toContain("must be between");
    expect(applyOps(scene, [{ op: "update", id: "box", components: { Script: { parameters: { speed: Infinity } } } }]).errors.length).toBeGreaterThan(0);
    expect(deserializeScene(serializeScene(scene))).toEqual(scene);
  });
});
