import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/lang/parser.js";
import { ScriptError } from "../../src/lang/lexer.js";

describe("script parser", () => {
  it("parses random expressions as move coordinates, not object targets", () => {
    const program = parseScript("when clicked\n  move it to random -5 to 2 0 0");
    expect(program.handlers[0]?.body[0]).toMatchObject({
      kind: "command",
      command: { name: "move", destination: { kind: "point" } },
    });
  });

  it("parses typed parameters, top-level statements, and all handler forms", () => {
    const program = parseScript(`param speed: float 0..10 = 3
param tint: color = #ff5500
let count = 0

on start:
  self.material.color = tint

every frame:
  self.transform.position.x += speed * dt

on collide(other):
  print(other.name)

every 0.5s:
  count += 1`);
    expect(program.params).toEqual([
      { name: "speed", type: "float", min: 0, max: 10, defaultValue: 3, line: 1, column: 1 },
      { name: "tint", type: "color", defaultValue: "#ff5500", line: 2, column: 1 },
    ]);
    expect(program.statements[0]).toMatchObject({ kind: "let", name: "count" });
    expect(program.handlers.map(({ event, parameter, intervalSeconds }) => ({ event, parameter, intervalSeconds }))).toEqual([
      { event: "start", parameter: undefined, intervalSeconds: undefined },
      { event: "frame", parameter: undefined, intervalSeconds: undefined },
      { event: "collide", parameter: "other", intervalSeconds: undefined },
      { event: "interval", parameter: undefined, intervalSeconds: 0.5 },
    ]);
  });

  it("uses arithmetic and boolean precedence and parses nested calls/member access", () => {
    const program = parseScript(`let x = 1 + 2 * 3
if not ready or x >= clamp(4, 0, 10) and self.name != "x":
  self.rigidbody.applyImpulse(0, sin(time), 0)`);
    const addition = program.statements[0];
    expect(addition?.kind).toBe("let");
    if (addition?.kind === "let") {
      expect(addition.value).toMatchObject({ kind: "binary", operator: "+", right: { kind: "binary", operator: "*" } });
    }
    const conditional = program.statements[1];
    expect(conditional).toMatchObject({ kind: "if", branches: [{ condition: { kind: "binary", operator: "or" } }] });
  });

  it("parses if/else-if/else, while, assignments, and expression statements", () => {
    const program = parseScript(`if x == 0:
  x += 1
else if x < 0:
  x = 0
else:
  while x > 4:
    x /= 2
  print(x)`);
    expect(program.statements[0]).toMatchObject({
      kind: "if", branches: [{}, {}], otherwise: [{ kind: "while", body: [{ kind: "assign", operator: "/=" }] }, { kind: "expression" }],
    });
  });

  it("reports malformed syntax with line and column", () => {
    expect(() => parseScript("on start:\nself.name = 1")).toThrow(/line 2, column 1/);
    expect(() => parseScript("every 0s:\n  let x = 1")).toThrow(/greater than zero/);
    expect(() => parseScript("param answer: missing = 2")).toThrow(ScriptError);
    expect(() => parseScript("let x = 1\nelse:")).toThrow(/Unexpected keyword/);
  });
});
