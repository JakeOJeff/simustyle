import { describe, expect, it } from "vitest";
import { CONCEPT_JSON_SCHEMA, CONCEPT_SYSTEM_PROMPT, REFERENCE_MIN_COMPLEXITY, REFERENCE_SPEC_SYSTEM_PROMPT, conceptUserMessage, parseConcept, parseReferenceSpec, referenceSpecMessages, referenceText, wantsReference } from "../../src/ai/concept";
import { AI_TASK_LIMITS } from "../../src/ai/tasks";

describe("concept step", () => {
  it("rates whether and how complex a request creates something, and writes a clean-render image prompt", () => {
    for (const phrase of ["creates", "complexity", "1-2 a single simple shape", "9-10", "3/4 view from the front-right", "plain neutral light-grey background", "no text"]) expect(CONCEPT_SYSTEM_PROMPT).toContain(phrase);
    expect(CONCEPT_JSON_SCHEMA.schema.required).toEqual(["creates", "complexity", "subject", "imagePrompt"]);
  });

  it("sends the outline, earlier requests, resolution and request within the task's cap", () => {
    const message = conceptUserMessage("put this inside the Up house", { outline: "- corner \"Reading Corner\" group collapsed".repeat(2_000), previousRequests: ["a reading corner"], resolution: "## What the request refers to\nthis = corner" });
    expect(message.indexOf("## Scene outline")).toBe(0);
    expect(message).toContain("[Outline truncated.]");
    expect(message.indexOf("- a reading corner")).toBeLessThan(message.indexOf("this = corner"));
    expect(message.endsWith("## Request\nput this inside the Up house")).toBe(true);
    expect(CONCEPT_SYSTEM_PROMPT.length + message.length).toBeLessThanOrEqual(AI_TASK_LIMITS.scene_concept.maxInputChars);
    expect(conceptUserMessage("a chair")).toContain("Empty: this is the first build.");
  });

  it("parses the plan and asks for an image only for complex creations", () => {
    const plan = parseConcept({ creates: true, complexity: 7.4, subject: "Up house", imagePrompt: " The house from Up " })!;
    expect(plan).toEqual({ creates: true, complexity: 7, subject: "Up house", imagePrompt: "The house from Up" });
    expect(wantsReference(plan)).toBe(true);
    expect(wantsReference({ ...plan, complexity: REFERENCE_MIN_COMPLEXITY - 1 })).toBe(false);
    expect(wantsReference({ ...plan, creates: false })).toBe(false);
    expect(wantsReference({ ...plan, imagePrompt: "" })).toBe(false);
    expect(parseConcept({ creates: true })).toBeNull();
    expect(parseConcept({ complexity: 40, imagePrompt: "x".repeat(9_000) })).toMatchObject({ creates: false, complexity: 10, imagePrompt: "x".repeat(AI_TASK_LIMITS.scene_image.maxInputChars) });
  });
});

describe("reference spec", () => {
  it("asks for a dense, measured spec the builder can model without the image", () => {
    for (const phrase of ["cannot see the image", "meters", "hex code", "counts", "Signature features", "floor plan"]) expect(REFERENCE_SPEC_SYSTEM_PROMPT).toContain(phrase);
    const messages = referenceSpecMessages("a red chair", "red chair", "data:image/jpeg;base64,AAAA");
    const parts = messages[1]!.content as { type: string; image_url?: { url: string } }[];
    expect(parts.map((part) => part.type)).toEqual(["text", "image_url"]);
    expect(parts[1]!.image_url!.url).toBe("data:image/jpeg;base64,AAAA");
  });

  it("parses the spec and frames it for the builder", () => {
    expect(parseReferenceSpec({ spec: "  Chair: 0.45×0.9×0.5 m  " })).toBe("Chair: 0.45×0.9×0.5 m");
    expect(parseReferenceSpec({ spec: " " })).toBeNull();
    expect(referenceText("Chair")).toMatch(/^## Reference concept[^\n]*\n.*the request wins where they disagree\.\nChair$/s);
  });
});
