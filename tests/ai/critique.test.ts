import { describe, expect, it } from "vitest";
import { CHUNK_CRITIQUE_SYSTEM_PROMPT, CHUNK_VIEWS, CRITIQUE_JSON_SCHEMA, CRITIQUE_SYSTEM_PROMPT, OVERVIEW_VIEWS, critiqueCorrections, critiqueMessages, parseCritique } from "../../src/ai/critique";
import { frameFace, frameTopDown } from "../../src/ai/framing";
import { AI_TASK_LIMITS, MAX_CRITIQUE_IMAGES } from "../../src/ai/tasks";

const url = (name: string) => `data:image/jpeg;base64,${name}`;
type Part = { type: string; text?: string; image_url?: { url: string } };

describe("visual critique prompt", () => {
  it("lists the rubric in order and asks for harsh, visible-only issues", () => {
    const order = ["named is present", "recognizable", "Shape choice", "floating, clipping", "clearance", "Density", "mood words", "Scale, proportions"].map((rule) => CRITIQUE_SYSTEM_PROMPT.indexOf(rule));
    expect(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1]!))).toBe(true);
    for (const phrase of ["harsh", "visible in the images or the scene text", "At most 10 issues, most important first", "reference image"]) expect(CRITIQUE_SYSTEM_PROMPT).toContain(phrase);
    expect(CRITIQUE_JSON_SCHEMA.schema.properties.issues.maxItems).toBe(10);
  });

  it("has a chunk rubric that uses all six faces", () => {
    for (const phrase of ["all six sides", "floating or detached", "Symmetry", "open bottoms", "reference image"]) expect(CHUNK_CRITIQUE_SYSTEM_PROMPT).toContain(phrase);
    expect(CHUNK_VIEWS).toEqual(["front", "back", "left", "right", "top", "bottom", "frontRight"]);
    expect(OVERVIEW_VIEWS).toHaveLength(5);
  });

  it("sends an overview's request, scene and labelled views within the task's input cap", () => {
    const messages = critiqueMessages({ request: "a red barn", sceneText: "x".repeat(100_000), views: OVERVIEW_VIEWS.map((view) => ({ view, url: url(view) })) });
    expect(messages[0]).toEqual({ role: "system", content: CRITIQUE_SYSTEM_PROMPT });
    const parts = messages[1]!.content as Part[];
    expect(parts.map((part) => part.type)).toEqual(["text", ...OVERVIEW_VIEWS.map(() => "image_url")]);
    expect(parts[0]!.text).toContain("a red barn");
    expect(parts[0]!.text).toContain("[Scene text truncated.]");
    expect(parts[0]!.text).toContain("Image 5: orthographic top face");
    expect(parts.slice(1).map((part) => part.image_url!.url)).toEqual(OVERVIEW_VIEWS.map(url));
    expect(CRITIQUE_SYSTEM_PROMPT.length + parts[0]!.text!.length).toBeLessThanOrEqual(AI_TASK_LIMITS.scene_critique.maxInputChars);
  });

  it("puts the reference image first for a chunk, with the chunk and the issues it was fixed for", () => {
    const messages = critiqueMessages({ request: "the house from Up", sceneText: "- roof", views: CHUNK_VIEWS.map((view) => ({ view, url: url(view) })), reference: url("ref"),
      chunk: '"House" (ids house), 80 mesh parts', previous: [{ entityId: "roof", problem: "Roof floats.", fix: "Lower it 0.2 m." }] });
    expect(messages[0]!.content).toBe(CHUNK_CRITIQUE_SYSTEM_PROMPT);
    const parts = messages[1]!.content as Part[];
    expect(parts).toHaveLength(1 + MAX_CRITIQUE_IMAGES);
    expect(parts[1]!.image_url!.url).toBe(url("ref"));
    expect(parts[0]!.text).toContain("Image 1: reference image");
    expect(parts[0]!.text).toContain("Image 2: orthographic front face");
    expect(parts[0]!.text).toContain('## The chunk you check\n"House"');
    expect(parts[0]!.text).toContain("- [roof] Roof floats. Fix: Lower it 0.2 m.");
  });
});

describe("parseCritique", () => {
  it("clamps the score, drops incomplete issues and keeps at most ten", () => {
    const issue = (index: number) => ({ entityId: index % 2 ? `e${index}` : null, problem: `Problem ${index}`, fix: `Fix ${index}` });
    const parsed = parseCritique({ score: 12, issues: [{ problem: "no fix" }, ...Array.from({ length: 12 }, (_, index) => issue(index))] })!;
    expect(parsed.score).toBe(10);
    expect(parsed.issues).toHaveLength(10);
    expect(parsed.issues[0]).toEqual({ entityId: null, problem: "Problem 0", fix: "Fix 0" });
    expect(parseCritique({ score: 0.2, issues: "none" })).toEqual({ score: 1, issues: [] });
    expect(parseCritique({ issues: [] })).toBeNull();
    expect(parseCritique("8")).toBeNull();
  });

  it("turns issues into correction lines that name their entity", () => {
    expect(critiqueCorrections({ score: 4, issues: [{ entityId: "slide", problem: "The slide clips the ladder.", fix: "Move it 0.3 m along +x." },
      { entityId: null, problem: "There are no swings.", fix: "Add a two-seat swing set at x=3." }] })).toEqual([
      "[slide] The slide clips the ladder. Fix: Move it 0.3 m along +x.",
      "There are no swings. Fix: Add a two-seat swing set at x=3."
    ]);
  });
});

describe("view framing", () => {
  it("centers above the bounds and fits the wider side with a margin", () => {
    const view = frameTopDown({ min: [-4, 0, -1], max: [2, 3, 1] }, 1);
    expect(view.center).toEqual([-1, 13, 0]);
    expect(view.halfWidth).toBeCloseTo(3.24);
    expect(view.halfHeight).toBeCloseTo(3.24);
    expect(view.height).toBe(23);
    expect(frameTopDown(null, 2).halfWidth).toBeCloseTo(10.8);
  });

  it("frames each orthographic face on its own axis, fitting that face", () => {
    const bounds = { min: [-2, 0, -0.5], max: [2, 1, 0.5] };
    const front = frameFace(bounds, "front", 1);
    expect(front.target).toEqual([0, 0.5, 0]);
    expect(front.position).toEqual([0, 0.5, 2.5]);
    expect(front.halfWidth).toBeCloseTo(2.2);
    const right = frameFace(bounds, "right", 1);
    expect(right.position[0]).toBeGreaterThan(2);
    expect(right.halfWidth).toBeCloseTo(0.55);
    const bottom = frameFace(bounds, "bottom", 1);
    expect(bottom.position[1]).toBeLessThan(0);
    expect(bottom.up).toEqual([0, 0, 1]);
    expect(bottom.halfWidth).toBeCloseTo(2.2);
    expect(bottom.far).toBeGreaterThan(bottom.position[1] * -1);
    expect(() => frameFace(bounds, "frontRight", 1)).toThrow();
  });
});
