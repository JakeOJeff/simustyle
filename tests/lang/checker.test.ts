import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/lang/parser";
import { typecheckScript } from "../../src/lang/checker";

describe("script type checker", () => {
  it("resolves schema fields and catches misspelled components with locations", () => {
    const program = parseScript("every frame:\n  self.rigidbdy.mass = 3\n");
    const diagnostics = typecheckScript(program);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ line: 2, column: 16 });
    expect(diagnostics[0]?.message).toContain("Did you mean RigidBody?");
  });

  it("rejects assigning a string to a numeric transform field", () => {
    const program = parseScript('on start:\n  self.transform.position.x = "left"\n');
    expect(typecheckScript(program).some((issue) => issue.message.includes("Cannot assign string to number"))).toBe(true);
  });
});
