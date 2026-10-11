import { describe, expect, it } from "vitest";
import { ScriptRuntime } from "../../src/runtime/scripts";
import { describeChanges } from "../../src/scene/describeChanges";
import { createEmptyScene, type Scene } from "../../src/scene/types";

const run = (scene: Scene, command: string) => {
  const result = ScriptRuntime.runOnce(scene, command);
  expect(result.issues).toEqual([]);
  return result.scene;
};

describe("describeChanges", () => {
  it("names a created object with its color and shape", () => {
    const before = createEmptyScene();
    const lines = describeChanges(before, run(before, "add red ball"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Created \S+: red ball at /);
  });

  it("describes paint, move, hide, and destroy commands by object name", () => {
    const empty = createEmptyScene();
    const scene = run(empty, `create a blue box called "Crate"`);
    expect(describeChanges(scene, run(scene, "paint Crate red"))).toEqual(["Crate: painted red"]);
    expect(describeChanges(scene, run(scene, "move Crate to 1 2 3"))).toEqual(["Crate: moved to 1 2 3"]);
    expect(describeChanges(scene, run(scene, "hide Crate"))).toEqual(["Crate: hidden"]);
    expect(describeChanges(scene, run(scene, "destroy Crate"))).toEqual(["Removed Crate"]);
  });
});
