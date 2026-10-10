import { describe, expect, it } from "vitest";
import { lexScript, ScriptError } from "../../src/lang/lexer.js";

describe("script lexer", () => {
  it("preserves indentation and token positions", () => {
    const tokens = lexScript("if x > 1:\n  x += 2\n");
    expect(tokens.map(({ kind, value }) => [kind, value])).toEqual([
      ["identifier", "if"], ["identifier", "x"], ["operator", ">"], ["number", "1"], ["punctuation", ":"], ["newline", ""],
      ["indent", ""], ["identifier", "x"], ["operator", "+="], ["number", "2"], ["newline", ""], ["dedent", ""], ["eof", ""],
    ]);
    expect(tokens[6]).toMatchObject({ line: 2, column: 3 });
  });

  it("reads strings, colors, decimals, and emits dedents at end of input", () => {
    expect(lexScript('  print("ok\\n", #ff5500, .25)')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "string", value: "ok\n" }),
      expect.objectContaining({ kind: "color", value: "#ff5500" }),
      expect.objectContaining({ kind: "number", value: ".25" }),
      expect.objectContaining({ kind: "dedent" }),
    ]));
  });

  it("reports malformed characters and indentation with source location", () => {
    expect(() => lexScript("x = @")).toThrow(ScriptError);
    expect(() => lexScript("if x:\n  x = 1\n x = 2")).toThrow(/line 3, column 1/);
    expect(() => lexScript('x = "open')).toThrow(/Unterminated string literal/);
  });
});
