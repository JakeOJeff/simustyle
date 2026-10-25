import { describe, expect, it } from "vitest";
import { CRITIQUE_JSON_SCHEMA, CRITIQUE_SYSTEM_PROMPT, critiqueCorrections, critiqueMessages, parseCritique } from "../../src/ai/critique";
import { frameTopDown } from "../../src/ai/framing";
import { AI_TASK_LIMITS } from "../../src/ai/tasks";

const images = { threeQuarter: "data:image/jpeg;base64,AAAA", topDown: "data:image/jpeg;base64,BBBB" };

describe("visual critique prompt", () => {
  it("lists the rubric in order and asks for harsh, visible-only issues", () => {
    const order = ["named is present", "recognizable", "Shape choice", "floating, clipping", "clearance", "Density", "mood words", "Scale and proportions"].map((rule) => CRITIQUE_SYSTEM_PROMPT.indexOf(rule));
    expect(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1]!))).toBe(true);
    for (const phrase of ["harsh", "visible in the images or the scene text", "At most 8 issues, most important first"]) expect(CRITIQUE_SYSTEM_PROMPT).toContain(phrase);
    expect(CRITIQUE_JSON_SCHEMA.schema.properties.issues.maxItems).toBe(8);
  });

  it("sends the request and scene as text with both images, within the task's input cap", () => {
    const messages = critiqueMessages("a red barn", "x".repeat(100_000), images);
    expect(messages[0]).toEqual({ role: "system", content: CRITIQUE_SYSTEM_PROMPT });
    const parts = messages[1]!.content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts.map((part) => part.type)).toEqual(["text", "image_url", "image_url"]);
    expect(parts[0]!.text).toContain("a red barn");
    expect(parts[0]!.text).toContain("[Scene text truncated.]");
    expect(parts.slice(1).map((part) => part.image_url!.url)).toEqual([images.threeQuarter, images.topDown]);
    expect(CRITIQUE_SYSTEM_PROMPT.length + parts[0]!.text!.length).toBeLessThanOrEqual(AI_TASK_LIMITS.scene_critique.maxInputChars);
  });
});

describe("parseCritique", () => {
  it("clamps the score, drops incomplete issues and keeps at most eight", () => {
    const issue = (index: number) => ({ entityId: index % 2 ? `e${index}` : null, problem: `Problem ${index}`, fix: `Fix ${index}` });
    const parsed = parseCritique({ score: 12, issues: [{ problem: "no fix" }, ...Array.from({ length: 10 }, (_, index) => issue(index))] })!;
    expect(parsed.score).toBe(10);
    expect(parsed.issues).toHaveLength(8);
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

describe("top-down framing", () => {
  it("centers above the bounds and fits the wider side with a margin", () => {
    const view = frameTopDown({ min: [-4, 0, -1], max: [2, 3, 1] }, 1);
    expect(view.center).toEqual([-1, 13, 0]);
    expect(view.halfWidth).toBeCloseTo(3.24);
    expect(view.halfHeight).toBeCloseTo(3.24);
    expect(view.height).toBe(23);
    expect(frameTopDown(null, 2).halfWidth).toBeCloseTo(10.8);
  });
});
