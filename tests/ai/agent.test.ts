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
      { summary: "First build: added a cube.", ops: [{ op: "create", id: "cube", name: "Cube", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] },
      { summary: "Reviewed the request and kept the cube.", ops: [{ op: "create", id: "cube", name: "Cube", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] }
    ]));
    expect(result.ok).toBe(true);
    expect(result.scene?.entities[0]?.id).toBe("cube");
    expect(result.inverseOps).toEqual([{ op: "delete", id: "cube" }]);
    expect(result.attempts).toBe(2);
    expect(result.preflight?.frames).toBe(5);
  });

  it("sends validation errors into the correction retry and caps attempts", async () => {
    const replies = [
      { summary: "Bad edit", ops: [{ op: "create", id: "bad", name: "Bad", parent: null, components: { Mesh: { unsupported: 1 } } }] },
      { summary: "Fixed edit", ops: [{ op: "create", id: "good", name: "Good", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] },
      { summary: "Reviewed the fixed edit.", ops: [{ op: "create", id: "good", name: "Good", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] }
    ];
    const requests: string[][] = [];
    const result = await runSceneAgent(createEmptyScene(), "make a cube", {
      ...dependencies(replies),
      complete: async ({ correctionErrors }) => { requests.push(correctionErrors); return replies.shift(); }
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(3);
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

  it("uses isolated Console output and runtime issues to improve the second build", async () => {
    const first = { summary: "Added the scripted player.", ops: [{
      op: "create" as const,
      id: "player",
      name: "Player",
      parent: null,
      components: { Transform: {}, Script: { source: 'when game starts\n  move missing up 1\n  say "draft hello"' } }
    }] };
    const second = { summary: "Checked the output and removed the missing target.", ops: [{
      op: "create" as const,
      id: "player",
      name: "Player",
      parent: null,
      components: { Transform: {}, Script: { source: 'when game starts\n  say "reviewed hello"' } }
    }] };
    const requests: { systemPrompt: string; userPrompt: string }[] = [];
    const replies = [first, second];
    const result = await runSceneAgent(createEmptyScene(), "make a player say hello when the game starts", {
      ...dependencies(replies),
      complete: async (request) => { requests.push(request); return replies.shift(); }
    });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.userPrompt).toContain("make a player say hello when the game starts");
    expect(requests[1]?.userPrompt).toContain("could not find 'missing'");
    expect(requests[1]?.userPrompt).toContain("Player: draft hello");
    expect(result.preflight?.console).toContain("Player: reviewed hello");
    expect(result.preflight?.issues).toEqual([]);
  });

  it("does not return a scene when the second pass keeps producing runtime errors", async () => {
    const broken = { summary: "Added a broken player.", ops: [{
      op: "create" as const,
      id: "player",
      name: "Player",
      parent: null,
      components: { Transform: {}, Script: { source: "when game starts\n  move missing up 1" } }
    }] };
    const result = await runSceneAgent(createEmptyScene(), "add a player", dependencies([broken, broken, broken, broken]));
    expect(result.ok).toBe(false);
    expect(result.scene).toBeUndefined();
    expect(result.errors.join(" ")).toContain("could not find 'missing'");
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
