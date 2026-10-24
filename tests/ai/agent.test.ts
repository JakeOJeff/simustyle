import { describe, expect, it } from "vitest";
import { runSceneAgent } from "../../src/ai/agent";
import { createEmptyScene } from "../../src/scene/types";
import type { SceneAgentRequest } from "../../src/ai/agent";
import { buildSystemPrompt } from "../../src/ai/prompt";

const dependencies = (replies: unknown[]) => ({
  buildSystemPrompt: () => "generated system prompt",
  responseSchema: { type: "object" },
  complete: async () => replies.shift()
});

describe("scene agent validation loop", () => {
  it("keeps review context below transport limits for a 1,407-object repeated build", async () => {
    const build = { summary: "Built a row of assemblies.", ops: [
      { op: "assemble", id: "module", name: "Module", parent: null, parts: Array.from({ length: 6 }, (_, i) => ({
        id: `module_part_${i}`, name: `Module detail ${i}`, components: {
          Transform: { position: [i * 0.2, 0.5, 0], scale: [0.1, 0.1, 0.1] }, Mesh: {}, Material: { color: "#334455" }
        }
      })) },
      { op: "repeat", source: "module", idPrefix: "row", name: "Row module", count: 200, step: [2, 0, 0] }
    ] };
    const requests: SceneAgentRequest[] = [];
    const result = await runSceneAgent(createEmptyScene(), "Build 201 modules with consistent detail", {
      buildSystemPrompt, responseSchema: {}, complete: async (request) => { requests.push(request); return build; }
    });
    expect(result.ok).toBe(true);
    expect(result.scene?.entities).toHaveLength(1407);
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.systemPrompt.length).toBeLessThan(50_000);
      expect(request.userPrompt.length).toBeLessThan(50_000);
    }
    expect(requests[1]?.userPrompt).toContain("Bounded snapshot");
    expect(requests[1]?.userPrompt).toContain('"op":"repeat"');
    expect(buildSystemPrompt(result.scene!, { focusIds: ["row_200_part_6"] }).length).toBeLessThan(50_000);
  });

  it("rejects invalid source scenes before making any model requests", async () => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "bad", name: "Bad", parent: "missing", components: { Transform: {} } });
    let calls = 0;
    const result = await runSceneAgent(scene, "build", { ...dependencies([]), complete: async () => { calls++; return {}; } });
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(0);
    expect(calls).toBe(0);
    expect(result.errors.join()).toContain("current entity 'bad'");
  });
  it("expands assemblies before review and supplies style context and measured design feedback", async () => {
    const build = { summary: "Built the red arch.", ops: [{ op: "assemble", id: "arch", name: "Arch", parent: null,
      parts: [{ id: "beam", name: "Top beam", components: { Transform: { position: [0, 2, 0] }, Mesh: {}, Material: { color: "#bb2233" } } }] }] };
    const requests: SceneAgentRequest[] = [];
    const result = await runSceneAgent(createEmptyScene(), "Use bright red in my playful style", {
      ...dependencies([build, build]), previousRequests: ["Use a playful low-poly style"],
      complete: async (request) => { requests.push(request); return build; }
    });
    expect(result.ok).toBe(true);
    expect(result.ops.every((op) => op.op === "create")).toBe(true);
    expect(requests[0]?.systemPrompt).toContain("Use a playful low-poly style");
    expect(requests[1]?.userPrompt).toContain("DESIGN AND ORGANIZATION CHECKS");
    expect(requests[1]?.userPrompt).toContain("ORIGINAL scene");
    expect(requests[1]?.userPrompt).toContain('"op":"assemble"');
    expect(requests[1]?.userPrompt).toContain("Use bright red in my playful style");
    expect(result.preflight?.quality?.stats).toMatchObject({ groups: 1, meshes: 1 });
  });

  it("turns malformed operation payloads into correction feedback instead of crashing", async () => {
    const result = await runSceneAgent(createEmptyScene(), "build", {
      ...dependencies([{ summary: "Bad", ops: [{ op: "create", id: "bad", parent: null, components: { Mesh: null } }] }]), maxRetries: 0
    });
    expect(result.ok).toBe(false);
    expect(result.ops).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("allows unrelated edits when a baseline script already has compile errors", async () => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "old", name: "Old script", parent: null, components: { Transform: {}, Script: { source: "when game starts\n  unsupported command" } } });
    const reply = { summary: "Changed the background.", ops: [{ op: "settings", settings: { background: "#112233" } }] };
    const result = await runSceneAgent(scene, "change the background", dependencies([reply, reply]));
    expect(result.ok).toBe(true);
    expect(result.preflight?.baselineIssues.length).toBeGreaterThan(0);
    expect(result.scene?.settings.background).toBe("#112233");
  });

  it("does not hide a new runtime error behind twenty existing baseline issues", async () => {
    const scene = createEmptyScene();
    scene.entities = Array.from({ length: 21 }, (_, i) => ({ id: `old_${i}`, name: `Old ${i}`, parent: null,
      components: { Transform: {}, Script: { source: `when game starts\n  move missing_${i} up 1` } } }));
    const broken = { summary: "Added a broken script.", ops: [{ op: "create", id: "new", name: "New", parent: null,
      components: { Transform: {}, Script: { source: "when game starts\n  move another_missing up 1" } } }] };
    const result = await runSceneAgent(scene, "add script", { ...dependencies([]), complete: async () => broken, maxRetries: 0 });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("another_missing");
  });

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
