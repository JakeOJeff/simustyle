import { describe, expect, it } from "vitest";
import { applyLineFixes, runScriptRewrite, type RewriteCompletion } from "../../src/ai/scriptRewrite";
import type { ParseEntity } from "../../src/ai/scriptParse";
import type { ChatMessage } from "../../src/ai/client";
import { autocorrect, editDistance, scriptProblems } from "../../src/lang/autocorrect";

const entities: ParseEntity[] = [
  { id: "box1", name: "Box1", shape: "box", position: [0, 0, 0] },
  { id: "ball1", name: "Ball1", shape: "sphere", position: [1, 0, 0] }
];
const owner = entities[0]!;

/** A fake model that returns the queued replies in order and records each request. */
function fakeModel(replies: unknown[]): { complete: RewriteCompletion; calls: { messages: ChatMessage[]; schema: string }[] } {
  const calls: { messages: ChatMessage[]; schema: string }[] = [];
  return {
    calls,
    complete: async (messages, schema) => {
      calls.push({ messages, schema: schema.name });
      if (!replies.length) throw new Error("unexpected AI call");
      return replies.shift();
    }
  };
}

describe("autocorrect", () => {
  it("measures typos including swapped letters", () => {
    expect(editDistance("pant", "paint", 2)).toBe(1);
    expect(editDistance("strats", "starts", 2)).toBe(1);
    expect(editDistance("abc", "xyzzy", 1)).toBe(2);
  });

  it("fixes typos, scene names, and clear synonyms without changing valid words", () => {
    const result = autocorrect("when game begins\n  pant bxo1 red\n  wiat 1 secs", entities);
    expect(result.source).toBe("when game starts\n  paint Box1 red\n  wait 1 seconds");
    expect(scriptProblems(result.source, new Set(["box1", "ball1"]))).toEqual([]);
  });

  it("leaves words it cannot place for the AI", () => {
    expect(autocorrect("when clicked\n  move the object near this up 2", entities).fixes).toEqual([]);
  });
});

describe("applyLineFixes", () => {
  it("replaces only allowed lines, keeps indentation, and tracks split lines", () => {
    const result = applyLineFixes("when clicked\n  hop then wait\n  spin", [
      { line: 2, text: "bounce\nwait 1 second" },
      { line: 3, text: "destroy me" }
    ], new Set([2]));
    expect(result.source).toBe("when clicked\n  bounce\n  wait 1 second\n  spin");
    expect(result.edited).toEqual([[2, 3]]);
  });
});

describe("runScriptRewrite", () => {
  it("makes no AI call when the script is valid or only has typos", async () => {
    const model = fakeModel([]);
    const valid = await runScriptRewrite({ source: "when clicked\n  spin", owner, entities }, model.complete);
    expect(valid.stage).toBe("none");
    const typo = await runScriptRewrite({ source: "when clicked\n  pant red", owner, entities }, model.complete);
    expect(typo).toMatchObject({ source: "when clicked\n  paint red", stage: "local", aiCalls: 0 });
    expect(model.calls).toHaveLength(0);
  });

  it("sends only the broken lines and splices the fix in", async () => {
    const model = fakeModel([{ lines: [{ line: 3, text: "  move Ball1 up 2" }], meaning: "Moves the closest object" }]);
    const result = await runScriptRewrite({ source: "when clicked\n  spin\n  move the object near this up 2", owner, entities }, model.complete);
    expect(result).toMatchObject({ source: "when clicked\n  spin\n  move Ball1 up 2", stage: "lines", aiCalls: 1 });
    expect(model.calls[0]!.schema).toBe("script_line_fix");
    const prompt = model.calls[0]!.messages[1]!.content;
    expect(prompt).toContain('Line 3 (under "when clicked")');
    expect(prompt).not.toContain("Line 2");
  });

  it("never changes valid lines, even if the model returns them", async () => {
    const model = fakeModel([{ lines: [{ line: 2, text: "  destroy me" }, { line: 3, text: "  move Ball1 up 2" }], meaning: "" }]);
    const result = await runScriptRewrite({ source: "when clicked\n  spin\n  move the object near this up 2", owner, entities }, model.complete);
    expect(result.source).toBe("when clicked\n  spin\n  move Ball1 up 2");
  });

  it("sends a failed line fix back with its errors and retries only that line", async () => {
    const model = fakeModel([
      { lines: [{ line: 2, text: "  move gibberish wrongly" }], meaning: "" },
      { lines: [{ line: 2, text: "  move Ball1 up 2" }], meaning: "Moves the ball" }
    ]);
    const result = await runScriptRewrite({ source: "when clicked\n  move the object near this up 2", owner, entities }, model.complete);
    expect(result).toMatchObject({ source: "when clicked\n  move Ball1 up 2", stage: "lines", aiCalls: 2 });
    expect(model.calls.map((call) => call.schema)).toEqual(["script_line_fix", "script_line_fix"]);
    expect(model.calls[1]!.messages[1]!.content).toContain('your previous fix "  move gibberish wrongly" failed');
  });

  it("keeps the lines it fixed and retries only the ones still broken", async () => {
    const model = fakeModel([
      { lines: [{ line: 2, text: "  move Ball1 up 2" }, { line: 3, text: "  zorp" }], meaning: "" },
      { lines: [{ line: 3, text: "  spin" }], meaning: "" }
    ]);
    const result = await runScriptRewrite({ source: "when clicked\n  move the object near this up 2\n  do a twirl thing", owner, entities }, model.complete);
    expect(result.source).toBe("when clicked\n  move Ball1 up 2\n  spin");
    expect(model.calls[1]!.messages[1]!.content).not.toContain("Line 2 (");
  });

  it("checks fixes top-down so a broken line above cannot hide a bad fix below", async () => {
    const model = fakeModel([
      { lines: [{ line: 1, text: "when I touch Ball1" }, { line: 2, text: "  move Ball1 to random 1 to 10 random 1 to 10 random 1 to 10" }], meaning: "" },
      { lines: [{ line: 2, text: "  move Ball1 to (random 1 to 10) 0 0" }], meaning: "" }
    ]);
    const result = await runScriptRewrite({ source: "when i jump into Ball1\n  move the object near this somewhere random", owner, entities }, model.complete);
    expect(result.source).toBe("when I touch Ball1\n  move Ball1 to (random 1 to 10) 0 0");
    expect(model.calls[1]!.messages[1]!.content).toContain("your previous fix");
  });

  it("comments out a line no fix compiles, and the block it leaves empty", async () => {
    const bad = { lines: [{ line: 2, text: "  move gibberish wrongly" }], meaning: "" };
    const model = fakeModel([bad, bad, bad, bad]);
    const result = await runScriptRewrite({ source: "when clicked\n  move the object near this up 2", owner, entities }, model.complete);
    expect(result.source).toBe("-- Parse could not convert: when clicked\n  -- Parse could not convert: move the object near this up 2");
    expect(result.meaning).toMatch(/commented out .*line 2 .*AI's last try "move gibberish wrongly" failed/);
    expect(scriptProblems(result.source, new Set(["box1", "ball1"]))).toEqual([]);
  });

  it("keeps fixed lines and comments out only the ones still broken", async () => {
    const reply = { lines: [{ line: 2, text: "  move Ball1 up 2" }, { line: 3, text: "  zorp" }], meaning: "" };
    const stuck = { lines: [{ line: 3, text: "  zorp" }], meaning: "" };
    const model = fakeModel([reply, stuck, stuck, stuck]);
    const result = await runScriptRewrite({ source: "when clicked\n  move the object near this up 2\n  give me a point", owner, entities }, model.complete);
    expect(result.source).toBe("when clicked\n  move Ball1 up 2\n  -- Parse could not convert: give me a point");
    expect(result.meaning).toContain('line 3 "give me a point"');
  });
});
