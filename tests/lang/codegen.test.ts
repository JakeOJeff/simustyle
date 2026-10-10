import { describe, expect, it } from "vitest";
import { generateScript } from "../../src/lang/codegen";
import { parseScript } from "../../src/lang/parser";

describe("script code generation", () => {
  it("emits a guarded loop and handlers from the AST", () => {
    const generated = generateScript(parseScript("let count = 0\non start:\n  count += 1\nevery frame:\n  while count < 5:\n    count += 1\n"));
    expect(generated.initialize).toContain('state["count"] = 0');
    expect(generated.handlers.map((handler) => handler.event)).toEqual(["start", "frame"]);
    expect(generated.handlers[0]?.body).toContain("assignLocal");
    expect(generated.handlers[1]?.body).toContain("ctx.loop(");
  });

  it("does not include source comments or raw source as executable code", () => {
    const source = 'on start:\n  print("quoted \\" value")\n';
    const body = generateScript(parseScript(source)).handlers[0]?.body ?? "";
    expect(body).toContain("ctx.call(\"print\"");
    expect(body).not.toContain("on start:");
  });

  it("turns wait into a yield and starts set variables at zero", () => {
    const generated = generateScript(parseScript("when game starts\n  set score to 5\n  wait 2 seconds\n"));
    expect(generated.initialize).toContain('state["score"] = 0');
    expect(generated.handlers[0]?.body).toContain("yield");
  });
});
