import { describe, expect, it } from "vitest";
import { generateScript } from "../../src/lang/codegen";
import { parseScript } from "../../src/lang/parser";

describe("script code generation", () => {
  it("emits a guarded loop and handlers from the AST", () => {
    const generated = generateScript(parseScript("let count = 0\non start:\n  count += 1\nevery frame:\n  while count < 5:\n    count += 1\n"));
    expect(generated.initialize).toContain('state["count"] = 0');
    expect(generated.start).toContain("assignLocal");
    expect(generated.frame).toContain("__guard++ < 10000");
  });

  it("does not include source comments or raw source as executable code", () => {
    const source = 'on start:\n  print("quoted \\\" value")\n';
    const generated = generateScript(parseScript(source));
    expect(generated.start).toContain("ctx.call(\"print\"");
    expect(generated.start).not.toContain("on start:");
  });
});
