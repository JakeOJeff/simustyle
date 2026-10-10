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
    const model = fakeModel([{ lines: [{ line: 3, text: "  move Ball1 up 2" }], needsContext: false, meaning: "Moves the closest object" }]);
    const result = await runScriptRewrite({ source: "when clicked\n  spin\n  move the object near this up 2", owner, entities }, model.complete);
    expect(result).toMatchObject({ source: "when clicked\n  spin\n  move Ball1 up 2", stage: "lines", aiCalls: 1 });
    expect(model.calls[0]!.schema).toBe("script_line_fix");
    const prompt = model.calls[0]!.messages[1]!.content;
    expect(prompt).toContain('Line 3 (under "when clicked")');
    expect(prompt).not.toContain('"  spin"');
  });

  it("escalates to a full rewrite when the model needs context or the line fix fails", async () => {
    const model = fakeModel([
      { lines: [], needsContext: true, meaning: "" },
      { source: "when clicked\n  move Ball1 up 2", meaning: "Moves the ball" }
    ]);
    const result = await runScriptRewrite({ source: "when clicked\n  move the object near this up 2", owner, entities }, model.complete);
    expect(result).toMatchObject({ stage: "full", aiCalls: 2 });
    expect(model.calls.map((call) => call.schema)).toEqual(["script_line_fix", "script_rewrite"]);

    const broken = fakeModel([
      { lines: [{ line: 2, text: "  move gibberish wrongly" }], needsContext: false, meaning: "" },
      { source: "when clicked\n  move Ball1 up 2", meaning: "" }
    ]);
    expect((await runScriptRewrite({ source: "when clicked\n  move the object near this up 2", owner, entities }, broken.complete)).stage).toBe("full");
  });

  it("rejects a full rewrite that still does not compile", async () => {
    const model = fakeModel([{ lines: [], needsContext: true, meaning: "" }, { source: "when clicked\n  move gibberish wrongly", meaning: "" }]);
    await expect(runScriptRewrite({ source: "when clicked\n  move the object near this up 2", owner, entities }, model.complete)).rejects.toThrow(/still has script errors/);
  });
});
