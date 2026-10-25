import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SCENE_INPUT_CHARS, runSceneAgent } from "../../src/ai/agent";
import { createEmptyScene, type SceneOp } from "../../src/scene/types";
import { applyOps } from "../../src/scene/applyOps";
import { REFERENCE_SYSTEM_PROMPT } from "../../src/ai/references";
import type { SceneAgentReply, SceneAgentRequest } from "../../src/ai/agent";
import { buildSystemPrompt, EXAMPLES_HEADING } from "../../src/ai/prompt";
import { BuildCache } from "../../src/ai/cache";
import { checkGeometry } from "../../src/ai/geometry";

// The geometry checker is built separately; these tests control its lines directly.
vi.mock("../../src/ai/geometry", () => ({ checkGeometry: vi.fn(() => []) }));
const geometry = vi.mocked(checkGeometry);
beforeEach(() => { geometry.mockReset(); geometry.mockReturnValue([]); });

const dependencies = (replies: unknown[]) => ({
  buildSystemPrompt: () => "generated system prompt",
  responseSchema: { type: "object" },
  complete: async () => replies.shift()
});

/** Total characters the client sends: system + user, plus the echoed reply and correction turn when correcting. */
const requestChars = (request: SceneAgentRequest) => request.systemPrompt.length + request.userPrompt.length
  + (request.correctionErrors.length ? request.previousReply.length + `Fix only these errors and return the full corrected JSON response: ${JSON.stringify(request.correctionErrors)}`.length : 0);

const cube = (id: string, position: [number, number, number] = [0, 0.5, 0]) => ({ op: "create", id, name: id, parent: null, components: { Transform: { position }, Mesh: {}, Material: { color: "#3366aa" } } });
const clean = { plan: "One 1 m cube at the origin.", summary: "Added a cube.", ops: [cube("cube")] };
/** Below ground, so the design checks warn and the draft is not clean. */
const sunken = { summary: "Added a sunken cube.", ops: [cube("cube", [0, -1, 0])] };
const threeCubes = { summary: "Added three cubes.", ops: [cube("a", [-3, 0.5, 0]), cube("b", [0, 0.5, 0]), cube("c", [3, 0.5, 0])] };

function recorder(replies: unknown[]) {
  const requests: SceneAgentRequest[] = [];
  return { requests, complete: async (request: SceneAgentRequest) => { requests.push(request); return replies.length > 1 ? replies.shift() : replies[0]; } };
}

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
      buildSystemPrompt, responseSchema: {}, solReviewEnabled: true, complete: async (request) => { requests.push(request); return build; }
    });
    expect(result.ok).toBe(true);
    expect(result.scene?.entities).toHaveLength(1407);
    expect(requests.map((request) => request.task)).toEqual(["scene_draft", "scene_review"]);
    for (const request of requests) expect(requestChars(request)).toBeLessThanOrEqual(MAX_SCENE_INPUT_CHARS);
    expect(requests[1]?.userPrompt).toContain("Bounded snapshot");
    expect(requests[1]?.userPrompt).toContain('"op":"repeat"');
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
    const part = (id: string, y: number) => ({ id, name: id, components: { Transform: { position: [0, y, 0] }, Mesh: {}, Material: { color: "#bb2233" } } });
    const build = { plan: "Arch: beam 2 m up on two posts.", summary: "Built the red arch.", ops: [{ op: "assemble", id: "arch", name: "Arch", parent: null,
      parts: [part("beam", 2), part("post_left", 1), part("post_right", 1.01)] }] };
    const { requests, complete } = recorder([build]);
    const result = await runSceneAgent(createEmptyScene(), "Use bright red in my playful style", {
      ...dependencies([]), previousRequests: ["Use a playful low-poly style"], solReviewEnabled: true, complete
    });
    expect(result.ok).toBe(true);
    expect(result.ops.every((op) => op.op === "create")).toBe(true);
    expect(requests[0]?.userPrompt).toContain("Use a playful low-poly style");
    expect(requests[1]?.task).toBe("scene_review");
    expect(requests[1]?.systemPrompt).toBe(requests[0]?.systemPrompt);
    expect(requests[1]?.userPrompt).toContain("DESIGN AND ORGANIZATION CHECKS");
    expect(requests[1]?.userPrompt).toContain("ORIGINAL scene");
    expect(requests[1]?.userPrompt).toContain("Keep decorative details that support the request");
    expect(requests[1]?.userPrompt).toContain("If the first build is sparse, add detail instead of removing it.");
    expect(requests[1]?.userPrompt).not.toContain("remove unrelated additions");
    expect(requests[1]?.userPrompt).toContain('"op":"assemble"');
    expect(requests[1]?.userPrompt).toContain("Arch: beam 2 m up on two posts.");
    expect(requests[1]?.userPrompt).toContain("Use bright red in my playful style");
    expect(result.preflight?.quality?.stats).toMatchObject({ groups: 1, meshes: 3 });
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
    // The draft is applied when the review can't fix it, but the new issue is still reported.
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("script issue");
    expect(result.preflight?.issues.join()).toContain("another_missing");
  });

  it("accepts a valid operation and returns one inverse batch without a review for a clean draft", async () => {
    const result = await runSceneAgent(createEmptyScene(), "add a cube", dependencies([
      { summary: "First build: added a cube.", ops: [{ op: "create", id: "cube", name: "Cube", parent: null, components: { Transform: {}, Mesh: {}, Material: {} } }] }
    ]));
    expect(result.ok).toBe(true);
    expect(result.summary).toBe("First build: added a cube.");
    expect(result.scene?.entities[0]?.id).toBe("cube");
    expect(result.inverseOps).toEqual([{ op: "delete", id: "cube" }]);
    expect(result.attempts).toBe(1);
    expect(result.preflight?.frames).toBe(5);
  });

  it("sends validation errors into the correction retry", async () => {
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

  it("caps the draft at two correction retries", async () => {
    const bad = { summary: "Bad", ops: [{ op: "update", id: "ghost", components: {} }] };
    for (const maxRetries of [undefined, 5]) {
      const { requests, complete } = recorder([bad]);
      const result = await runSceneAgent(createEmptyScene(), "x", { ...dependencies([]), complete, ...(maxRetries === undefined ? {} : { maxRetries }) });
      expect(result.ok).toBe(false);
      expect(requests).toHaveLength(3);
      expect(requests.every((request) => request.task === "scene_draft")).toBe(true);
    }
  });

  it("applies the part of a build that still applies when every attempt is rejected", async () => {
    const mixed = { summary: "Two cubes and a ghost edit.", ops: [cube("a", [-3, 0.5, 0]), { op: "update", id: "ghost", components: {} }, cube("b", [3, 0.5, 0])] };
    const { requests, complete } = recorder([mixed]);
    const result = await runSceneAgent(createEmptyScene(), "add two cubes", { ...dependencies([]), complete });
    expect(result.ok).toBe(true);
    expect(requests.filter((request) => request.task === "scene_draft").length).toBeGreaterThanOrEqual(3);
    expect(result.skipped).toMatchObject({ kept: 2, total: 3 });
    expect(result.skipped?.errors.join(" ")).toContain("ghost");
    expect(result.ops.map((op) => op.op === "create" ? op.id : op.op)).toEqual(["a", "b"]);
    expect(result.summary).toContain("kept 2 of 3");
  });

  it("repairs ops by dropping only the component that fails, keeping their children", async () => {
    const broken = { summary: "Broken", ops: [
      cube("keep"),
      { op: "create", id: "bad", name: "Bad", parent: null, components: { Transform: {}, Script: { source: "every frame:\n  self.rigidbdy.mass = 2\n" } } },
      { op: "create", id: "child", name: "Child", parent: "bad", components: { Transform: {} } }
    ] };
    const result = await runSceneAgent(createEmptyScene(), "x", { ...dependencies([]), complete: recorder([broken]).complete });
    expect(result.ok).toBe(true);
    expect(result.ops.map((op) => op.op === "create" ? op.id : op.op)).toEqual(["keep", "bad", "child"]);
    expect(result.scene?.entities.find((entity) => entity.id === "bad")?.components.Script).toBeUndefined();
    expect(result.skipped?.errors.join(" ")).toContain("Did you mean RigidBody?");
  });

  it("does not cache a salvaged build, so retrying the request rebuilds it", async () => {
    const mixed = { summary: "Cube and ghost.", ops: [cube("a"), { op: "update", id: "ghost", components: {} }] };
    const cache = new BuildCache<SceneAgentReply>();
    const result = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), cache, complete: recorder([mixed]).complete });
    expect(result.skipped).toBeDefined();
    const again = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), cache, complete: recorder([clean]).complete });
    expect(again.cacheHit).toBeUndefined();
    expect(again.skipped).toBeUndefined();
  });

  it("fails only when no part of any attempt applies", async () => {
    const bad = { summary: "Bad", ops: [{ op: "update", id: "ghost", components: {} }] };
    const result = await runSceneAgent(createEmptyScene(), "x", { ...dependencies([]), complete: recorder([bad]).complete });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBeUndefined();
  });

  it("rejects scripts with compile errors before committing ops", async () => {
    const result = await runSceneAgent(createEmptyScene(), "add a broken script", {
      ...dependencies([
      { summary: "Broken script", ops: [{ op: "create", id: "bad-script", name: "Bad Script", parent: null, components: { Transform: {}, Script: { source: "every frame:\n  self.rigidbdy.mass = 2\n" } } }] }
      ]), maxRetries: 0
    });
    // The object is kept without its broken script, and the compile error is reported as skipped.
    expect(result.scene?.entities.find((entity) => entity.id === "bad-script")?.components.Script).toBeUndefined();
    expect(result.skipped?.errors.join(" ")).toContain("Did you mean RigidBody?");
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
    const { requests, complete } = recorder([first, second]);
    const result = await runSceneAgent(createEmptyScene(), "make a player say hello when the game starts", { ...dependencies([]), complete });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.task).toBe("scene_draft");
    expect(requests[1]?.userPrompt).toContain("make a player say hello when the game starts");
    expect(requests[1]?.userPrompt).toContain("could not find 'missing'");
    expect(requests[1]?.userPrompt).toContain("Player: draft hello");
    expect(result.preflight?.console).toContain("Player: reviewed hello");
    expect(result.preflight?.issues).toEqual([]);
  });

  it("applies the draft with its runtime issues listed when the second pass can't fix them", async () => {
    const broken = { summary: "Added a broken player.", ops: [{
      op: "create" as const,
      id: "player",
      name: "Player",
      parent: null,
      components: { Transform: {}, Script: { source: "when game starts\n  move missing up 1" } }
    }] };
    const { requests, complete } = recorder([broken]);
    const result = await runSceneAgent(createEmptyScene(), "add a player", { ...dependencies([]), complete });
    expect(result.ok).toBe(true);
    expect(result.scene?.entities.some((entity) => entity.id === "player")).toBe(true);
    expect(requests).toHaveLength(3);
    expect(result.summary).toContain("1 script issue");
    expect(result.preflight?.issues.join(" ")).toContain("could not find 'missing'");
  });

  it("quotes the rejected script line in the correction error", async () => {
    const result = await runSceneAgent(createEmptyScene(), "add a kill brick", {
      ...dependencies([
      { summary: "Kill brick", ops: [{ op: "create", id: "killbrick_1", name: "KillBrick1", parent: null, components: { Transform: {}, Script: { source: "when I touch\n  kill it\n" } } }] }
      ]), maxRetries: 0
    });
    expect(result.skipped?.errors.join(" ")).toContain(`Entity 'killbrick_1', line 2, column 8 in "kill it"`);
  });

  it("documents the kill-brick reset idiom in the script spec", async () => {
    const { SCRIPT_AGENT_SPEC } = await import("../../src/ai/prompt");
    const { diagnose } = await import("../../src/lang/autocorrect");
    expect(SCRIPT_AGENT_SPEC).toContain("there is no kill");
    expect(diagnose("when I touch player\n  move it to 0 2 0")).toEqual([]);
  });
});

describe("prompt caching layout", () => {
  it("sends one byte-identical system prompt for every scene, request, correction and review", async () => {
    const prompts = new Set<string>();
    const users: string[] = [];
    const run = async (scene: ReturnType<typeof createEmptyScene>, request: string, replies: unknown[]) => {
      const { requests, complete } = recorder(replies);
      await runSceneAgent(scene, request, { buildSystemPrompt, responseSchema: {}, complete, previousRequests: [`before ${request}`], focusIds: scene.entities.map((entity) => entity.id) });
      for (const sent of requests) { prompts.add(sent.systemPrompt); users.push(sent.userPrompt); }
      return requests;
    };
    const populated = createEmptyScene();
    populated.entities.push({ id: "room", name: "Room", parent: null, components: { Transform: {} } });
    const first = await run(createEmptyScene(), "add a sunken cube", [{ summary: "bad", ops: [{ op: "delete", id: "ghost" }] }, sunken]);
    const second = await run(populated, "paint the room", [clean]);
    expect(first.map((request) => request.task)).toEqual(["scene_draft", "scene_draft", "scene_draft"]);
    expect(first[2]?.userPrompt).toContain("second-pass review");
    expect(second).toHaveLength(1);
    expect(prompts.size).toBe(1);
    expect([...prompts][0]).toBe(buildSystemPrompt());
    // Matching library examples come first (an empty scene always gets one), then the scene.
    for (const sent of [first[0], second[0]]) expect(sent?.userPrompt.startsWith(EXAMPLES_HEADING)).toBe(true);
    expect(first[0]?.userPrompt).toContain("\n\n## Current scene\n");
    expect(second[0]?.userPrompt).toContain('Request: "a cozy reading corner"');
    expect(second[0]?.userPrompt).toContain('- room "Room"');
    expect(second[0]?.userPrompt).toContain('Selected object ids (resolve this/these using this selection): ["room"]');
    expect(second[0]?.userPrompt).toContain("before paint the room");
    expect(users.every((user) => !buildSystemPrompt().includes(user))).toBe(true);
  });

  it("ignores the plan when applying and accepts a reply that omits it", async () => {
    for (const reply of [clean, { summary: clean.summary, ops: clean.ops }]) {
      const { requests, complete } = recorder([reply]);
      const result = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), complete });
      expect(result.ok).toBe(true);
      expect(requests).toHaveLength(1);
      expect(result.ops).toHaveLength(1);
      expect(JSON.stringify(result.ops)).not.toContain("One 1 m cube");
    }
  });
});

describe("geometry checks", () => {
  const flag = "Wheel3 is 0.4 m below CarBody and touches nothing";

  it("feeds geometry lines into the draft correction errors", async () => {
    geometry.mockReturnValueOnce([flag]);
    const { requests, complete } = recorder([clean]);
    const result = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), complete });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.correctionErrors).toContain(flag);
    expect(requests[1]?.previousReply).toContain("Added a cube.");
    expect(geometry.mock.calls[0]?.[2]).toBe("add a cube");
  });

  it("accepts a draft with only geometry flags on its last attempt and passes them to the review", async () => {
    geometry.mockReturnValue([flag]);
    const { requests, complete } = recorder([clean]);
    const result = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), complete });
    expect(result.ok).toBe(true);
    expect(requests.map((request) => request.task)).toEqual(["scene_draft", "scene_draft", "scene_draft", "scene_draft", "scene_draft"]);
    expect(requests[3]?.userPrompt).toContain(`GEOMETRY CHECKS (exact; fix each unless the request intends it):\n- ${flag}`);
    expect(requests[4]?.correctionErrors).toContain(flag);
    expect(result.preflight?.geometry).toEqual([flag]);
  });

  it("feeds a missing requested object back as a correction, then into the review's checklist", async () => {
    const missing = "Requested 'dome climber' is missing; build it, named for what it is, before any extras.";
    const partial = { ...clean, requested: ["cube", "dome climber"] };
    const complete = { ...clean, requested: ["cube", "dome climber"], ops: [cube("cube"), cube("Dome Climber", [3, 0.5, 0])] };
    const { requests, complete: answer } = recorder([partial, complete]);
    const result = await runSceneAgent(createEmptyScene(), "a cube and a dome climber", { ...dependencies([]), complete: answer });
    expect(result.ok).toBe(true);
    expect(requests[1]?.correctionErrors).toEqual([missing]);
    expect(result.scene?.entities.map((entity) => entity.name)).toContain("Dome Climber");

    // Still missing after every draft attempt: the review is told what was listed, and runs the checklist.
    const stuck = recorder([partial]);
    await runSceneAgent(createEmptyScene(), "a cube and a dome climber", { ...dependencies([]), complete: stuck.complete });
    const review = stuck.requests[3]!.userPrompt;
    expect(review).toContain("REQUESTED OBJECTS LISTED BY THE FIRST BUILD (re-check against the request):\ncube; dome climber");
    expect(review).toContain(`- ${missing}`);
    expect(review).toContain("every object the player explicitly named");
    expect(review).toContain("Identity: every part must clearly be part of a named thing");
    // The review's reply is checked the same way.
    expect(stuck.requests[4]?.correctionErrors).toContain(missing);
  });
});

describe("review escalation", () => {
  const run = async (replies: unknown[], solReviewEnabled?: boolean) => {
    const { requests, complete } = recorder(replies);
    const result = await runSceneAgent(createEmptyScene(), "build it", { ...dependencies([]), complete, ...(solReviewEnabled === undefined ? {} : { solReviewEnabled }) });
    return { result, tasks: requests.map((request) => request.task) };
  };

  it("skips the review for a clean draft when escalation is off", async () => {
    const { result, tasks } = await run([threeCubes], false);
    expect(result.ok).toBe(true);
    expect(tasks).toEqual(["scene_draft"]);
  });

  it("escalates to scene_review for three or more created entities", async () => {
    expect((await run([threeCubes], true)).tasks).toEqual(["scene_draft", "scene_review"]);
  });

  it("skips the review for a small clean draft that needed no correction", async () => {
    expect((await run([clean], true)).tasks).toEqual(["scene_draft"]);
  });

  it("escalates when the draft needed a correction", async () => {
    expect((await run([{ summary: "bad", ops: [{ op: "delete", id: "ghost" }] }, clean], true)).tasks).toEqual(["scene_draft", "scene_draft", "scene_review"]);
  });

  it("reviews an unclean draft on the cheap model when not escalated", async () => {
    const { result, tasks } = await run([sunken], false);
    expect(result.ok).toBe(true);
    expect(tasks).toEqual(["scene_draft", "scene_draft"]);
  });

  it("caps the review at one correction, then falls back to the validated draft", async () => {
    const { result, tasks } = await run([sunken, { summary: "bad", ops: [{ op: "delete", id: "ghost" }] }], true);
    expect(tasks).toEqual(["scene_draft", "scene_draft", "scene_draft"]);
    expect(result.ok).toBe(true);
    expect(result.summary).toContain("Applied the validated first draft");
    const escalated = await run([threeCubes, { summary: "bad", ops: [{ op: "delete", id: "ghost" }] }], true);
    expect(escalated.tasks).toEqual(["scene_draft", "scene_review", "scene_review"]);
    expect(escalated.result.summary).toContain("Applied the validated first draft");
  });
});

describe("request size budget", () => {
  it("keeps every draft, correction and review request within the server input cap", async () => {
    const scene = createEmptyScene();
    scene.entities = Array.from({ length: 800 }, (_, i) => ({ id: `crate_${i}`, name: `Crate number ${i}`, parent: null,
      components: { Transform: { position: [(i % 40) * 2, 0.5, Math.floor(i / 40) * 2] }, Mesh: {}, Material: { color: "#8b5a3b", roughness: 0.7 },
        Script: { source: `when clicked\n  say "crate ${i} ${"detail ".repeat(10)}"` } } }));
    const ghosts = { summary: "Bad", plan: "p".repeat(1500), ops: Array.from({ length: 60 }, (_, i) => ({ op: "update", id: `ghost_${i}_${"x".repeat(80)}`, components: {} })) };
    const valid = { summary: "Added a sunken cube.", plan: "q".repeat(1500), ops: [cube("cube", [0, -1, 0]), ...Array.from({ length: 50 }, (_, i) => cube(`extra_${i}`, [i * 2, 0.5, 60]))] };
    // Pad the system prompt to at least 30k so later growth of the modeling rules/examples stays covered.
    const system = buildSystemPrompt() + "\n" + "m".repeat(Math.max(0, 30_000 - buildSystemPrompt().length));
    const { requests, complete } = recorder(["{".repeat(30_000), ghosts, valid, "{".repeat(30_000), valid]);
    const result = await runSceneAgent(scene, "Add a cube. " + "Make it look good. ".repeat(150), {
      buildSystemPrompt: () => system, responseSchema: {}, complete, solReviewEnabled: true,
      previousRequests: Array.from({ length: 6 }, (_, i) => `Earlier request ${i} `.repeat(60)), focusIds: scene.entities.map((entity) => entity.id)
    });
    expect(result.ok).toBe(true);
    expect(requests.map((request) => request.task)).toEqual(["scene_draft", "scene_draft", "scene_draft", "scene_review", "scene_review"]);
    const sizes = requests.map(requestChars);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(MAX_SCENE_INPUT_CHARS);
    expect(requests[1]?.previousReply).toContain("[Rejected response truncated for context budget.]");
    expect(requests[3]?.userPrompt).toContain("Bounded snapshot");
    console.info(`system prompt ${buildSystemPrompt().length} chars (test uses ${system.length}); request sizes ${sizes.join(", ")}`);
  });

  it("fails fast when the request cannot fit even with an empty scene context", async () => {
    let calls = 0;
    const result = await runSceneAgent(createEmptyScene(), "x".repeat(11_000), { ...dependencies([]), buildSystemPrompt: () => "s".repeat(33_000), complete: async () => { calls++; return clean; } });
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("too large");
    expect(calls).toBe(0);
  });
});

describe("unusable replies", () => {
  const unusable = (truncated: boolean) => Object.assign(new Error("unusable"), { name: "UnusableReplyError", truncated });

  it("retries a reply cut off at the output limit with a compactness correction", async () => {
    const requests: SceneAgentRequest[] = [];
    const result = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), complete: async (request) => {
      requests.push(request);
      if (requests.length === 1) throw unusable(true);
      return clean;
    } });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(requests[1]?.correctionErrors.join()).toContain("cut off");
    expect(requests[1]?.previousReply).toBe("");
  });

  it("still stops after the retry cap when every reply is unusable", async () => {
    let calls = 0;
    const result = await runSceneAgent(createEmptyScene(), "add a cube", { ...dependencies([]), complete: async () => { calls++; throw unusable(false); } });
    expect(result.ok).toBe(false);
    expect(calls).toBe(3);
    expect(result.errors.join()).toContain("AI request failed");
  });
});

describe("live builds", () => {
  it("streams draft calls into onLiveBuild, never reviews, and always shows the finished draft", async () => {
    const live: { attempt: number; ops: number; complete: number }[] = [];
    const requests: SceneAgentRequest[] = [];
    const text = JSON.stringify(threeCubes);
    const result = await runSceneAgent(createEmptyScene(), "three cubes", {
      ...dependencies([]), solReviewEnabled: true,
      onLiveBuild: (build) => live.push({ attempt: build.attempt, ops: build.ops.length, complete: build.complete }),
      complete: async (request) => {
        requests.push(request);
        // Stream the draft in pieces; the throttle lets only the first through, the final emit shows the rest.
        if (request.task === "scene_draft") for (let end = 1; end <= text.length; end += 40) request.onText?.(text.slice(0, end));
        return threeCubes;
      }
    });
    expect(result.ok).toBe(true);
    expect(requests.map((request) => [request.task, typeof request.onText])).toEqual([["scene_draft", "function"], ["scene_review", "undefined"]]);
    expect(live.at(-1)).toEqual({ attempt: 1, ops: 3, complete: 3 });
    expect(live.length).toBeGreaterThanOrEqual(2);
  });

  it("numbers correction attempts and sends no onText without a live listener", async () => {
    const attempts: number[] = [];
    await runSceneAgent(createEmptyScene(), "a cube", { ...dependencies([{ summary: "bad", ops: [{ op: "nonsense" }] }, clean]), onLiveBuild: (build) => attempts.push(build.attempt) });
    expect([...new Set(attempts)]).toEqual([1, 2]);
    const { requests, complete } = recorder([clean]);
    await runSceneAgent(createEmptyScene(), "a cube", { ...dependencies([]), complete });
    expect(requests[0]?.onText).toBeUndefined();
  });
});

describe("detail passes", () => {
  const floor = { op: "create", id: "floor", name: "Floor", parent: null, components: { Transform: { position: [0, -0.02, 0], scale: [4, 0.04, 4] }, Mesh: {}, Material: { color: "#776655" } } };
  const layout = { plan: "Room with a table and a chair.", summary: "Laid out a room.", ops: [floor], detail: [
    { id: "table", name: "Table", description: "round table", position: [0, 0, 0], size: [1, 0.8, 1] },
    { id: "chair", name: "Chair", description: "chair", position: [1.2, 0, 0], rotation: [0, -90, 0], size: [0.5, 1, 0.5] }
  ] };
  const leg = (id: string, x: number) => ({ id, name: "Leg", components: { Transform: { position: [x, 0.35, 0], scale: [0.05, 0.7, 0.05] }, Mesh: {}, Material: { color: "#553311" } } });
  const object = (id: string) => ({ plan: `${id} parts`, summary: `Built the ${id}.`, ops: [{ op: "assemble", id, name: id, parent: null, parts: [
    { id: "top", name: "Top", components: { Transform: { position: [0, 0.72, 0], scale: [0.5, 0.04, 0.5] }, Mesh: {}, Material: { color: "#aa7744" } } }, leg("leg_a", -0.2), leg("leg_b", 0.2)
  ] }] });
  const objectFor = (prompt: string) => object(/\nid: (\w+)/.exec(prompt)![1]!);

  it("builds each listed object in its own detail call, skips the review, and fits them in place", async () => {
    const requests: SceneAgentRequest[] = [];
    const labels: string[] = [];
    const result = await runSceneAgent(createEmptyScene(), "a dining room", {
      ...dependencies([]), solReviewEnabled: true, onLiveBuild: (build) => { if (build.label) labels.push(build.label); },
      complete: async (request) => {
        requests.push(request);
        if (request.task !== "scene_detail") return layout;
        const reply = objectFor(request.userPrompt);
        request.onText?.(JSON.stringify(reply));
        return reply;
      }
    });
    expect(result.ok).toBe(true);
    expect(requests.map((request) => request.task)).toEqual(["scene_draft", "scene_detail", "scene_detail"]);
    expect(requests[1]?.userPrompt).toContain("## Detail pass");
    const ids = result.scene!.entities.map((entity) => entity.id);
    expect(ids).toEqual(expect.arrayContaining(["floor", "table", "table_top", "table_leg_a", "chair", "chair_top", "chair_leg_b"]));
    expect(result.scene!.entities.find((entity) => entity.id === "chair")?.components.Transform).toEqual({ position: [1.2, 0, 0], rotation: [0, -90, 0] });
    expect(result.summary).toContain("Built 2 of 2 objects in detail (6 parts).");
    expect(labels.some((label) => /^Detailing \d of 2/.test(label))).toBe(true);
  });

  it("keeps the rest when an object fails, and retries a cut-off object once", async () => {
    const tasks: string[] = [];
    const corrections: string[][] = [];
    let chairCalls = 0;
    const result = await runSceneAgent(createEmptyScene(), "a dining room", {
      ...dependencies([]),
      complete: async (request) => {
        tasks.push(request.task);
        if (request.task !== "scene_detail") return layout;
        if (request.userPrompt.includes("\nid: table")) return { summary: "nothing", ops: [{ op: "nonsense" }] };
        chairCalls += 1;
        corrections.push(request.correctionErrors);
        if (chairCalls === 1) throw Object.assign(new Error("cut"), { name: "UnusableReplyError", truncated: true });
        return objectFor(request.userPrompt);
      }
    });
    expect(result.ok).toBe(true);
    expect(tasks.filter((task) => task === "scene_detail")).toHaveLength(4);
    expect(corrections[1]?.[0]).toContain("16000-token output limit");
    expect(result.scene!.entities.some((entity) => entity.id === "chair_top")).toBe(true);
    expect(result.scene!.entities.some((entity) => entity.id === "table")).toBe(false);
    expect(result.summary).toContain("Built 1 of 2 objects in detail");
    expect(result.summary).toContain("Could not detail: Table");
  });

  it("keeps an object whose correction still has a broken field, repairing just that part", async () => {
    const broken = (id: string) => {
      const reply = object(id);
      (reply.ops[0]!.parts[0]!.components.Material as Record<string, unknown>).texture = "marble";
      return reply;
    };
    const tasks: string[] = [];
    const result = await runSceneAgent(createEmptyScene(), "a dining room", {
      ...dependencies([]),
      complete: async (request) => {
        tasks.push(request.task);
        if (request.task !== "scene_detail") return layout;
        return request.userPrompt.includes("\nid: table") ? broken("table") : objectFor(request.userPrompt);
      }
    });
    expect(tasks.filter((task) => task === "scene_detail")).toHaveLength(3);
    const top = result.scene!.entities.find((entity) => entity.id === "table_top");
    expect(top).toBeDefined();
    expect(top?.components.Material).toBeUndefined();
    expect(result.summary).toContain("Table: some parts repaired or left out (");
    expect(result.summary).toContain("Built 2 of 2 objects");
  });

  it("asks the layout to fix detail objects that clash with the scene", async () => {
    const { requests, complete } = recorder([{ ...layout, detail: [{ ...layout.detail[0], id: "floor" }] }, { plan: "", summary: "Added a floor.", ops: [floor] }]);
    await runSceneAgent(createEmptyScene(), "a room", { ...dependencies([]), complete });
    expect(requests[1]?.correctionErrors[0]).toContain("detail object 'floor' reuses an id");
  });
});

describe("visual critique", () => {
  const issue = { entityId: "b", problem: "Cube b floats.", fix: "Set its y to 0.5." };
  /** Three cubes, then (when asked) a fix reply; the critique is mocked, so no vision call is made. */
  const run = async (critique: (request: { userPrompt: string }) => Promise<unknown>, fix: unknown = { summary: "Recolored cube b.", ops: [{ op: "update", id: "b", components: { Material: { color: "#aa3333" } } }] }) => {
    const { requests, complete } = recorder([threeCubes, fix]);
    const asked: string[] = [];
    const result = await runSceneAgent(createEmptyScene(), "three cubes", {
      ...dependencies([]), complete, critique: async (request) => { asked.push(request.userPrompt); return critique(request) as never; }
    });
    return { result, requests, asked };
  };

  it("passes a build that scores 8 or more without a fix pass", async () => {
    const { result, requests, asked } = await run(async () => ({ score: 8, issues: [issue] }));
    expect(asked).toEqual(["three cubes"]);
    expect(requests).toHaveLength(1);
    expect(result.preflight?.critique).toEqual({ score: 8, issues: [issue], outcome: "passed" });
  });

  it("runs one fix pass with the issues as correction errors and applies it on top of the build", async () => {
    const { result, requests } = await run(async () => ({ score: 5, issues: [issue] }));
    expect(requests.map((request) => request.task)).toEqual(["scene_draft", "scene_draft"]);
    expect(requests[1]?.correctionErrors).toEqual(["[b] Cube b floats. Fix: Set its y to 0.5."]);
    expect(requests[1]?.userPrompt).toContain("three cubes");
    expect(result.ok).toBe(true);
    expect(result.ops).toHaveLength(4);
    expect(result.scene?.entities.find((entity) => entity.id === "b")?.components.Material?.color).toBe("#aa3333");
    expect(result.summary).toContain("Visual critique: 5/10; fixed: Recolored cube b.");
    expect(result.preflight?.critique).toMatchObject({ score: 5, outcome: "fixed" });
    // The undo batch reverts the build and the fix together.
    expect(result.inverseOps?.length).toBeGreaterThan(0);
  });

  it("keeps the critiqued build when the fix pass does not validate", async () => {
    const { result, requests } = await run(async () => ({ score: 4, issues: [issue] }), { summary: "Broke it.", ops: [{ op: "update", id: "missing", components: {} }] });
    expect(requests).toHaveLength(2);
    expect(result.ok).toBe(true);
    expect(result.ops).toHaveLength(3);
    expect(result.preflight?.critique).toMatchObject({ score: 4, outcome: "kept" });
    expect(result.preflight?.critique?.note).toContain("did not validate");
  });

  it("keeps the build when the fix adds geometry problems", async () => {
    geometry.mockImplementation((_scene, ops) => ops.length > 3 ? ["Cube b floats."] : []);
    const { result } = await run(async () => ({ score: 6, issues: [issue] }));
    expect(result.ops).toHaveLength(3);
    expect(result.preflight?.critique?.note).toContain("added geometry problems");
  });

  it("skips the critique for builds of fewer than three entities and when it can't run", async () => {
    let calls = 0;
    const small = await runSceneAgent(createEmptyScene(), "a cube", { ...dependencies([clean]), critique: async () => { calls += 1; return { score: 2, issues: [issue] }; } });
    expect(calls).toBe(0);
    expect(small.preflight?.critique).toBeUndefined();
    const { result, requests } = await run(async () => null);
    expect(requests).toHaveLength(1);
    expect(result.preflight?.critique).toBeUndefined();
  });

  it("reports a failed critique call and applies the build", async () => {
    const { result } = await run(async () => { throw new Error("Visual critique is turned off on this server."); });
    expect(result.ok).toBe(true);
    expect(result.preflight?.critique).toEqual({ issues: [], outcome: "failed", note: "Visual critique is turned off on this server." });
  });
});

describe("follow-up scene context", () => {
  /** A chair group (seat and a leg) beside a loose crate: the scene a follow-up request edits. */
  const furnished = () => {
    const result = applyOps(createEmptyScene(), [
      cube("crate", [-2, 0.5, 0]) as SceneOp,
      { op: "create", id: "chair", name: "Chair", parent: null, components: { Transform: { position: [2, 0, -1] } } },
      { op: "create", id: "seat", name: "Seat", parent: "chair", components: { Transform: { position: [0, 0.45, 0], scale: [0.5, 0.1, 0.5] }, Mesh: {}, Material: {} } },
      { op: "create", id: "leg", name: "Leg", parent: "chair", components: { Transform: { position: [0.2, 0.2, 0.2], scale: [0.05, 0.4, 0.05] }, Mesh: {}, Material: {} } }
    ]);
    expect(result.errors).toEqual([]);
    return result.scene;
  };
  const moved = { summary: "Moved the chair.", ops: [{ op: "update", id: "chair", components: { Transform: { position: [3, 0, -1] } } }] };
  const resolution = { references: [{ phrase: "it", ids: ["chair"] }], expand: [], resolvedRequest: "Move the chair [chair] 1 m along +x", facts: ["Chair [chair] spans x 1.75..2.25"] };
  const run = async (resolve: ((request: { systemPrompt: string; userPrompt: string }) => Promise<unknown>) | undefined, prompt = "move it right", focusIds: string[] = []) => {
    const { requests, complete } = recorder([moved]);
    const asked: { systemPrompt: string; userPrompt: string }[] = [];
    const result = await runSceneAgent(furnished(), prompt, { ...dependencies([]), complete, previousRequests: ["a chair and a crate"], focusIds,
      ...(resolve ? { resolveReferences: async (request: { systemPrompt: string; userPrompt: string }) => { asked.push(request); return resolve(request); } } : {}) });
    return { result, draft: requests[0]!.userPrompt, asked };
  };

  it("resolves references first, then drafts against the outline with groups collapsed", async () => {
    const { result, draft, asked } = await run(async () => resolution);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.systemPrompt).toBe(REFERENCE_SYSTEM_PROMPT);
    expect(asked[0]!.userPrompt).toContain("parts: Seat, Leg");
    expect(asked[0]!.userPrompt).toContain("- a chair and a crate");
    expect(draft).toMatch(/- chair "Chair" group collapsed, 2 parts, box 0\.5×0\.5×0\.5 m/);
    expect(draft).not.toContain('- seat "Seat"');
    expect(draft).toContain("Restated: Move the chair [chair] 1 m along +x");
    expect(draft).toContain("- Chair [chair] spans x 1.75..2.25");
    expect(draft.indexOf("Restated:")).toBeLessThan(draft.indexOf("## Request\nmove it right"));
    expect(result.ok).toBe(true);
    expect(result.preflight?.context).toEqual({ source: "model", expanded: [], resolvedRequest: "Move the chair [chair] 1 m along +x", facts: ["Chair [chair] spans x 1.75..2.25"] });
  });

  it("lists the groups the step expands and a selected part part by part", async () => {
    expect((await run(async () => ({ ...resolution, expand: ["chair"] }))).draft).toContain('  - seat "Seat"');
    const selected = await run(async () => resolution, "make this thicker", ["leg"]);
    expect(selected.draft).toContain('  - leg "Leg"');
    expect(selected.result.preflight?.context?.expanded).toEqual(["leg"]);
  });

  it("expands what the request names when the step fails or is off, and skips it on an empty scene", async () => {
    const failed = await run(async () => { throw new Error("out of credits"); }, "make the seat red");
    expect(failed.draft).toContain('  - seat "Seat"');
    expect(failed.result.preflight?.context).toMatchObject({ source: "names", expanded: ["seat"], note: "The reference step failed: out of credits" });
    expect((await run(async () => null)).result.preflight?.context?.note).toBe("The reference step was skipped.");
    expect((await run(undefined, "move the chair")).draft).toContain('  - seat "Seat"');
    const asked: unknown[] = [];
    await runSceneAgent(createEmptyScene(), "a cube", { ...dependencies([clean]), resolveReferences: async (request) => { asked.push(request); return resolution; } });
    expect(asked).toEqual([]);
  });
});
