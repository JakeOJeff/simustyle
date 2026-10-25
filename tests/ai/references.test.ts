import { describe, expect, it } from "vitest";
import { MAX_EXPANDED, REFERENCE_JSON_SCHEMA, REFERENCE_SYSTEM_PROMPT, parseResolution, referenceUserMessage, resolutionText } from "../../src/ai/references";
import { freeSpots, matchedExpansion, sceneText } from "../../src/ai/sceneContext";
import { buildSceneUserMessage } from "../../src/ai/prompt";
import { AI_TASK_LIMITS } from "../../src/ai/tasks";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp, type Vec3 } from "../../src/scene/types";

const part = (id: string, name: string, parent: string, position: Vec3, scale: Vec3): SceneOp =>
  ({ op: "create", id, name, parent, components: { Transform: { position, scale }, Mesh: {}, Material: { color: "#7a5230" } } });

/** A loose crate, a chair group at x 2 z -1 (0.5×0.9×0.5 m) and a desk whose drawer is a nested group. */
function room(): Scene {
  const result = applyOps(createEmptyScene(), [
    { op: "create", id: "crate", name: "Crate", parent: null, components: { Transform: { position: [-2, 0.5, 0] }, Mesh: {}, Material: { color: "#8b5a3b" } } },
    { op: "create", id: "chair", name: "Chair", parent: null, components: { Transform: { position: [2, 0, -1] } } },
    part("seat", "Seat", "chair", [0, 0.45, 0], [0.5, 0.1, 0.5]),
    part("back", "Back", "chair", [0, 0.7, -0.22], [0.5, 0.4, 0.06]),
    ...[[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].map(([x, z], index) => part(`leg_${index}`, "Leg", "chair", [x!, 0.2, z!], [0.05, 0.4, 0.05])),
    { op: "create", id: "desk", name: "Desk", parent: null, components: { Transform: { position: [0, 0, -3] } } },
    part("desk_top", "Desk Top", "desk", [0, 0.74, 0], [1.4, 0.04, 0.7]),
    { op: "create", id: "drawer", name: "Drawer", parent: "desk", components: { Transform: { position: [0.4, 0.6, 0] } } },
    part("drawer_front", "Drawer Front", "drawer", [0, 0, 0.34], [0.4, 0.15, 0.02]),
    part("handle", "Handle", "drawer", [0, 0, 0.36], [0.12, 0.02, 0.02]),
    part("monitor", "Monitor", "desk", [-0.3, 1, -0.2], [0.6, 0.4, 0.05])
  ]);
  expect(result.errors).toEqual([]);
  return result.scene;
}

describe("scene outline", () => {
  it("lists loose objects in full and collapses each group to its world box and own Transform", () => {
    const text = sceneText(room(), { expand: [] });
    expect(text).toContain('- crate "Crate" box 1×1×1 m, y 0 to 1: {"Transform":{"position":[-2,0.5,0]}');
    expect(text).toContain('- chair "Chair" group collapsed, 6 parts, box 0.5×0.9×0.5 m, center x 2 z -1, y 0 to 0.9: {"Transform":{"position":[2,0,-1]}}');
    expect(text).toMatch(/- desk "Desk" group collapsed, 4 parts, box /);
    for (const hidden of ["seat", "leg_0", "drawer", "handle", "monitor"]) expect(text).not.toContain(`- ${hidden} `);
    expect(text).toContain("never reference or guess ids of its hidden parts");
    expect(text).toContain("14 total, 3 top-level");
  });

  it("keeps free floor spots clear of grouped parts, not just loose objects", () => {
    // The desk group spans x -0.7..0.7, z -3.35..-2.64; a 1 m object needs 0.8 m of reach from its center.
    for (const [x, z] of freeSpots(room().entities, 6)) expect(Math.abs(x) >= 1.5 || z <= -4.15 || z >= -1.84).toBe(true);
  });

  it("lists an expanded group part by part, and opens a nested group's ancestors one level", () => {
    const chair = sceneText(room(), { expand: ["chair"] });
    expect(chair).toContain('- chair "Chair" group: ');
    expect(chair).toContain('  - seat "Seat" box 0.5×0.1×0.5 m: ');
    expect(chair).toMatch(/- desk "Desk" group collapsed/);
    const drawer = sceneText(room(), { expand: ["drawer"] });
    expect(drawer).toContain('- desk "Desk" group: ');
    expect(drawer).toContain('  - desk_top "Desk Top"');
    expect(drawer).toContain('  - drawer "Drawer" group: ');
    expect(drawer).toContain('    - handle "Handle"');
    expect(drawer).toMatch(/- chair "Chair" group collapsed/);
    // Without expand the scene is described in full, as before.
    expect(sceneText(room())).toContain('  - leg_3 "Leg"');
  });

  it("names the parts of collapsed groups for the reference step", () => {
    expect(sceneText(room(), { expand: [], partNames: true })).toContain("; parts: Seat, Back, Leg ×4");
  });

  it("stays much smaller than the full scene", () => {
    const scene = room();
    const ops: SceneOp[] = Array.from({ length: 30 }, (_, index) => part(`chair_part_${index}`, `Carved detail ${index}`, "chair", [0, 0.5, 0], [0.05, 0.05, 0.05]));
    const big = applyOps(scene, ops).scene;
    expect(sceneText(big, { expand: [] }).length * 3).toBeLessThan(sceneText(big).length);
  });

  it("expands the selection and objects the request names when no reference step ran", () => {
    expect(matchedExpansion(room(), "make the legs thinner")).toEqual(["leg_0", "leg_1", "leg_2", "leg_3"]);
    expect(matchedExpansion(room(), "paint it blue", ["drawer"])).toEqual(["drawer"]);
    expect(matchedExpansion(room(), "add a lamp")).toEqual([]);
  });
});

describe("reference step", () => {
  it("asks for references, expansions, a restated request and facts", () => {
    for (const phrase of ["references", "expand", "resolvedRequest", "facts", "its box is enough", "the latest one built the likeliest"]) expect(REFERENCE_SYSTEM_PROMPT).toContain(phrase);
    expect(REFERENCE_JSON_SCHEMA.schema.required).toEqual(["references", "expand", "resolvedRequest", "facts"]);
  });

  it("sends the outline with part names, the history, selection and request within the task's cap", () => {
    const message = referenceUserMessage(room(), "put a mug next to the monitor", { previousRequests: ["a desk with a monitor"], focusIds: ["desk"] });
    const order = ["## Scene outline", "parts: Desk Top, Drawer", "## Earlier requests", "- a desk with a monitor", '## Selected object ids\n["desk"]', "## Request\nput a mug next to the monitor"].map((part) => message.indexOf(part));
    expect(order.every((index, position) => index >= 0 && (position === 0 || index > order[position - 1]!))).toBe(true);
    expect(REFERENCE_SYSTEM_PROMPT.length + referenceUserMessage(room(), "x".repeat(6_000)).length).toBeLessThanOrEqual(AI_TASK_LIMITS.scene_context.maxInputChars);
  });

  it("keeps known ids only, caps the expansion and falls back to the request text", () => {
    const parsed = parseResolution({ references: [{ phrase: "it", ids: ["chair", "ghost"] }, { phrase: 3 }], expand: ["ghost", "chair", "chair", "desk", "drawer", "seat", "back", "leg_0", "leg_1"],
      resolvedRequest: "  ", facts: ["Chair [chair] is 0.5×0.9×0.5 m", 4, ""] }, room(), "make it taller")!;
    expect(parsed.references).toEqual([{ phrase: "it", ids: ["chair"] }]);
    expect(parsed.expand).toEqual(["chair", "desk", "drawer", "seat", "back", "leg_0"]);
    expect(parsed.expand).toHaveLength(MAX_EXPANDED);
    expect(parsed.resolvedRequest).toBe("make it taller");
    expect(parsed.facts).toEqual(["Chair [chair] is 0.5×0.9×0.5 m"]);
    expect(parseResolution("chair", room(), "x")).toBeNull();
  });

  it("puts the resolution just before the request, and adds nothing when it resolves nothing", () => {
    const resolution = { references: [{ phrase: "it", ids: ["chair"] }], expand: [], resolvedRequest: "Make the chair [chair] taller", facts: ["Chair [chair] top at y 0.9"] };
    const text = resolutionText(resolution, "make it taller");
    expect(text).toBe('## What the request refers to (resolved from the scene; the request below is what the player wrote)\nRestated: Make the chair [chair] taller\nReferences: "it" = chair\n- Chair [chair] top at y 0.9');
    expect(resolutionText({ references: [{ phrase: "a lamp", ids: [] }], expand: [], resolvedRequest: "add a lamp", facts: [] }, "add a lamp")).toBe("");
    const message = buildSceneUserMessage(room(), "make it taller", { expand: [], resolution: text, previousRequests: ["a chair"] });
    expect(message.indexOf("a chair")).toBeLessThan(message.indexOf("## What the request refers to"));
    expect(message.indexOf("## What the request refers to")).toBeLessThan(message.indexOf("## Request\nmake it taller"));
    expect(message).toMatch(/- chair "Chair" group collapsed/);
  });
});
