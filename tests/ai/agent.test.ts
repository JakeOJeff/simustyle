import { describe, expect, it } from "vitest";
import { runSceneAgent } from "../../src/ai/agent";
import { createEmptyScene } from "../../src/scene/types";

const dependencies = (replies: unknown[]) => ({
  buildSystemPrompt: () => "generated system prompt",
  responseSchema: { type: "object" },
  complete: async () => replies.shift()
});

describe("scene agent validation loop", () => {
  it("accepts a valid operation and returns one inverse batch", async () => {
    const result = await runSceneAgent(createEmptyScene(), "add a cube", dependencies([
      { summary: "Added a cube.", ops: [{ op: "create", id: "cube", name: "Cube", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] }
    ]));
    expect(result.ok).toBe(true);
    expect(result.scene?.entities[0]?.id).toBe("cube");
    expect(result.inverseOps).toEqual([{ op: "delete", id: "cube" }]);
    expect(result.attempts).toBe(1);
  });

  it("sends validation errors into the correction retry and caps attempts", async () => {
    const replies = [
      { summary: "Bad edit", ops: [{ op: "create", id: "bad", name: "Bad", parent: null, components: { Mesh: { unsupported: 1 } } }] },
      { summary: "Fixed edit", ops: [{ op: "create", id: "good", name: "Good", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] }
    ];
    const requests: string[][] = [];
    const result = await runSceneAgent(createEmptyScene(), "make a cube", {
      ...dependencies(replies),
      complete: async ({ correctionErrors }) => { requests.push(correctionErrors); return replies.shift(); }
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(requests[0]).toEqual([]);
    expect(requests[1]?.length).toBeGreaterThan(0);
  });

  it("rejects scripts with compile errors before committing ops", async () => {
    const result = await runSceneAgent(createEmptyScene(), "add a broken script", {
      ...dependencies([
      { summary: "Broken script", ops: [{ op: "create", id: "bad-script", name: "Bad Script", parent: null, components: { Transform: {}, Script: { source: "every frame:\n  self.rigidbdy.mass = 2\n" } } }] }
      ]), maxRetries: 0
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("Did you mean RigidBody?");
  });

  it("quotes the rejected script line in the correction error", async () => {
    const result = await runSceneAgent(createEmptyScene(), "add a kill brick", {
      ...dependencies([
      { summary: "Kill brick", ops: [{ op: "create", id: "killbrick_1", name: "KillBrick1", parent: null, components: { Transform: {}, Script: { source: "when I touch\n  kill it\n" } } }] }
      ]), maxRetries: 0
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain(`Entity 'killbrick_1', line 2, column 8 in "kill it"`);
  });

  it("documents the kill-brick reset idiom in the script spec", async () => {
    const { SCRIPT_AGENT_SPEC } = await import("../../src/ai/prompt");
    const { diagnose } = await import("../../src/lang/autocorrect");
    expect(SCRIPT_AGENT_SPEC).toContain("there is no kill");
    expect(diagnose("when I touch player\n  move it to 0 2 0")).toEqual([]);
  });
});
