import { describe, expect, it } from "vitest";
import { applyChoices, buildParseMessages, runScriptParse, validateParseReply, type ParseEntity } from "../../src/ai/scriptParse";

const entities: ParseEntity[] = [
  { id: "box1", name: "Box1", shape: "box", position: [0, 0, 0] },
  { id: "ball1", name: "Ball1", shape: "sphere", position: [1, 0, 0] }
];
const source = "when game begins\n  move the object near this up 2";

describe("validateParseReply", () => {
  it("keeps options the parser accepts and checks entity ids", () => {
    const result = validateParseReply(source, {
      fixes: [
        { line: 1, original: "begins", meaning: "start of play", options: [{ text: "starts", entityId: null, label: "means: starts" }] },
        { line: 2, original: "the object near this", meaning: "the closest object", options: [
          { text: "Ball1", entityId: "ball1", label: "1 m away" },
          { text: "Box1", entityId: "ghost", label: "" }
        ] }
      ]
    }, entities);
    expect(result.fixes).toHaveLength(2);
    expect(result.fixes[1]!.options.map((option) => option.entityId)).toEqual(["ball1", null]);
  });

  it("rejects text that is not in the line and options that do not compile", () => {
    const result = validateParseReply("when clicked\n  colour me crimson", {
      fixes: [
        { line: 2, original: "crimsun", meaning: "", options: [{ text: "red", entityId: null, label: "" }] },
        { line: 2, original: "crimson", meaning: "", options: [{ text: "scarlet", entityId: null, label: "" }, { text: "#dc143c", entityId: null, label: "" }] }
      ]
    }, entities);
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0]!.options.map((option) => option.text)).toEqual(["#dc143c"]);
    expect(result.errors.join(" ")).toMatch(/crimsun/);
    expect(result.errors.join(" ")).toMatch(/scarlet/);
  });

  it("returns an error for a malformed response", () => {
    expect(validateParseReply(source, { nope: true }, entities).errors).toHaveLength(1);
  });
});

describe("applyChoices", () => {
  it("replaces several fixes on one line right to left", () => {
    const line = "  paint thingy reddish";
    const fixes = [
      { fix: { line: 1, original: "thingy", meaning: "", options: [] }, option: { text: "box1", entityId: "box1", label: "" } },
      { fix: { line: 1, original: "reddish", meaning: "", options: [] }, option: { text: "red", entityId: null, label: "" } }
    ];
    expect(applyChoices(line, fixes)).toBe("  paint box1 red");
  });
});

describe("runScriptParse", () => {
  it("sends the scene and unclear words, and retries once when nothing survives", async () => {
    const calls: string[] = [];
    const replies = [
      { fixes: [{ line: 1, original: "begins", meaning: "", options: [{ text: "launches", entityId: null, label: "" }] }] },
      { fixes: [{ line: 1, original: "begins", meaning: "", options: [{ text: "starts", entityId: null, label: "" }] }] }
    ];
    const request = { source: "when game begins\n  spin", owner: entities[0]!, entities, unclear: [{ line: 1, column: 11, text: "begins" }] };
    const result = await runScriptParse(request, async (messages) => {
      calls.push(messages.at(-1)!.content);
      return replies[calls.length - 1];
    });
    expect(buildParseMessages(request)[1]!.content).toContain("Ball1");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatch(/rejected/);
    expect(result.fixes[0]!.options[0]!.text).toBe("starts");
  });
});
