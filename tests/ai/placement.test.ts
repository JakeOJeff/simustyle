import { describe, expect, it } from "vitest";
import { runSceneAgent } from "../../src/ai/agent";
import { tidyCreates } from "../../src/ai/placement";
import { buildSystemPrompt } from "../../src/ai/prompt";
import { freeSpots, sceneText } from "../../src/ai/sceneContext";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp } from "../../src/scene/types";

function sceneWith(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}

const crate: SceneOp = { op: "create", id: "crate", name: "Crate", parent: null, components: { Transform: { position: [0, 0.5, 0] }, Mesh: { shape: "box" }, Material: { color: "#8b5a3b" } } };

describe("scene context", () => {
  it("describes objects compactly with size, floor contact, children, and free spots", () => {
    const scene = sceneWith([
      crate,
      { op: "create", id: "table", name: "Table", parent: null, components: { Transform: { position: [3, 0, 0] } } },
      { op: "create", id: "top", name: "Top", parent: "table", components: { Transform: { position: [0, 1, 0] }, Mesh: { height: 0.1, radius: 1 } } }
    ]);
    const text = sceneText(scene);
    expect(text).toContain('- crate "Crate" box 1×1×1 m, y 0 to 1: {"Transform":{"position":[0,0.5,0]},"Mesh":{},"Material":{"color":"#8b5a3b"}}');
    expect(text).toContain('  - top "Top" box 2×0.1×2 m: ');
    const spots = freeSpots(scene.entities, 4);
    expect(spots).toHaveLength(4);
    for (const [x, z] of spots) expect(Math.abs(x) > 0.8 || Math.abs(z) > 0.8).toBe(true);
    expect(text).toContain("Free floor spots (x z) for new objects: ");
  });

  it("keeps the prompt much smaller than pretty-printed JSON for the same scene", () => {
    const ops = Array.from({ length: 20 }, (_, index): SceneOp => ({ op: "create", id: `box_${index}`, name: `Box${index}`, parent: null, components: { Transform: { position: [index, 0.5, 0] }, Mesh: {}, Material: {} } }));
    const scene = sceneWith(ops);
    const perObject = (buildSystemPrompt(scene).length - buildSystemPrompt(createEmptyScene()).length) / 20;
    expect(perObject).toBeLessThan(120);
    expect(buildSystemPrompt(createEmptyScene()).length).toBeLessThan(10000);
  });
});

describe("tidyCreates", () => {
  it("renames clashing ids and names and keeps child references pointing at the new id", () => {
    const scene = sceneWith([crate]);
    const { ops } = tidyCreates(scene, [
      { op: "create", id: "crate", name: "Crate", parent: null, components: { Mesh: {}, Material: {} } },
      { op: "create", id: "lid", name: "Lid", parent: "crate", components: { Transform: { position: [0, 0.5, 0] } } }
    ]);
    expect(ops[0]).toMatchObject({ id: "crate_2", name: "Crate2" });
    expect(ops[1]).toMatchObject({ parent: "crate_2" });
    expect(applyOps(scene, ops).errors).toEqual([]);
  });

  it("adds a missing Transform, places unpositioned objects on free spots, and lifts sunken ones", () => {
    const scene = sceneWith([crate]);
    const { ops, notes } = tidyCreates(scene, [
      { op: "create", id: "ball", name: "Ball", parent: null, components: { Mesh: { shape: "sphere", radius: 0.25 }, Material: {} } },
      { op: "create", id: "pillar", name: "Pillar", parent: null, components: { Transform: { position: [4, 0, 4] }, Mesh: { shape: "cylinder", height: 3 }, Material: {} } }
    ]);
    const [ball, pillar] = ops as Extract<SceneOp, { op: "create" }>[];
    const [x, y, z] = ball!.components.Transform!.position as number[];
    expect(y).toBe(0.25);
    expect(Math.abs(x!) > 0.75 || Math.abs(z!) > 0.75).toBe(true);
    expect(pillar!.components.Transform!.position).toEqual([4, 1.5, 4]);
    expect(notes).toEqual(["lifted Pillar onto the floor"]);
  });

  it("raises a falling body created inside another object and leaves children and static bodies alone", () => {
    const scene = sceneWith([crate]);
    const { ops } = tidyCreates(scene, [
      { op: "create", id: "ball", name: "Ball", parent: null, components: { Transform: { position: [0, 0.5, 0] }, Mesh: { shape: "sphere" }, Material: {}, RigidBody: {} } },
      { op: "create", id: "shelf", name: "Shelf", parent: null, components: { Transform: { position: [0, 0.5, 0] }, Mesh: {}, Material: {}, RigidBody: { bodyType: "static" } } },
      { op: "create", id: "handle", name: "Handle", parent: "crate", components: { Transform: { position: [0, -2, 0] }, Mesh: {}, Material: {} } }
    ]);
    const positions = ops.map((operation) => (operation as Extract<SceneOp, { op: "create" }>).components.Transform!.position);
    expect(positions).toEqual([[0, 1.51, 0], [0, 0.5, 0], [0, -2, 0]]);
  });

  it("runs inside the agent and reports adjustments in the summary", async () => {
    const result = await runSceneAgent(sceneWith([crate]), "add another crate", {
      buildSystemPrompt: () => "prompt",
      responseSchema: {},
      complete: async () => ({ summary: "Added a crate.", ops: [{ op: "create", id: "crate", name: "Crate", parent: null, components: { Transform: { position: [2, -1, 0] }, Mesh: {}, Material: {} } }] })
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Added a crate. (Adjusted: named the new Crate "Crate2" because that name was taken; lifted Crate2 onto the floor.)');
  });

  it("sends the rejected reply back with the errors on retry", async () => {
    const previous: string[] = [];
    const replies = [{ summary: "bad", ops: [{ op: "update", id: "ghost", components: {} }] }, { summary: "ok", ops: [] }];
    await runSceneAgent(createEmptyScene(), "x", {
      buildSystemPrompt: () => "prompt",
      responseSchema: {},
      complete: async ({ previousReply }) => { previous.push(previousReply); return replies.shift(); }
    });
    expect(previous[0]).toBe("");
    expect(JSON.parse(previous[1]!)).toMatchObject({ summary: "bad" });
  });
});
