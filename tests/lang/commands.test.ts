import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/lang/parser";
import { typecheckScript } from "../../src/lang/checker";
import { lexScript } from "../../src/lang/lexer";
import { matchAnimation } from "../../src/lang/vocabulary";
import { ScriptRuntime } from "../../src/runtime/scripts";
import { colorWords } from "../../src/runtime/commands";
import { createEmptyScene, type Scene } from "../../src/scene/types";

function sampleScene(): Scene {
  const scene = createEmptyScene();
  scene.entities.push(
    { id: "ball", name: "Ball", parent: null, components: { Transform: { position: [0, 0.5, 0] }, Mesh: { shape: "sphere" }, Material: { color: "#e5484d" } } },
    { id: "box", name: "Crate", parent: null, components: { Transform: { position: [3, 0.5, 0] }, Mesh: {}, Material: { color: "#3e63dd" } } },
    { id: "top", name: "Topper", parent: null, components: { Transform: { position: [3, 2, 0] }, Mesh: { shape: "cone" }, Material: { color: "#30a46c" } } }
  );
  return scene;
}

/** advance() caps each step at 0.25s, so play longer spans in small steps. */
function play(runtime: ScriptRuntime, seconds: number): Scene {
  let scene = runtime.scene;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.1) scene = runtime.advance(Math.min(0.1, seconds - elapsed));
  return scene;
}

const position = (scene: Scene, id: string) => scene.entities.find((entity) => entity.id === id)?.components.Transform?.position as number[] | undefined;

describe("scene command language", () => {
  it("parses the command forms and checks them without errors", () => {
    const source = [
      "-- comments are ignored",
      "move ball to 1 -2 3",
      "move the red ball above the blue box",
      "move ball up 2 over 1s",
      "glide ball to (1 + 1), 0, 0",
      "destroy the one above the box",
      "animate ball like it's bouncing really fast",
      "turn ball left 90",
      "scale ball by 2",
      "paint ball green",
      "push ball up 5",
      "hide ball",
      "say \"hello\", 3",
      "let target = the nearest cone",
      "move target beside ball"
    ].join("\n");
    const program = parseScript(source);
    expect(program.statements).toHaveLength(14);
    expect(typecheckScript(program)).toEqual([]);
  });

  it("treats spaced coordinates as separate values", () => {
    const program = parseScript("move ball to 1 -2 3");
    const command = program.statements[0];
    expect(command?.kind === "command" && command.command.name === "move" && command.command.destination.kind === "point" ? command.command.destination.value.map((part) => part.kind) : []).toEqual(["number", "unary", "number"]);
  });

  it("keeps old call syntax and reports unknown animations inline", () => {
    expect(typecheckScript(parseScript("on collide(other):\n  destroy(other)\n"))).toEqual([]);
    const issues = typecheckScript(parseScript("animate ball like a sandwich"));
    expect(issues[0]?.message).toContain("don't know how to animate");
    expect(issues[0]?.line).toBe(1);
  });

  it("explains a missing object kind", () => {
    expect(() => parseScript("destroy the")).toThrow(/what kind of object/);
  });

  it("lexes comments without breaking indentation", () => {
    expect(() => lexScript("on start:\n  -- note\n  say 1\n-- end\n")).not.toThrow();
  });

  it("matches animation descriptions with speed and size words", () => {
    expect(matchAnimation(["like", "a", "spinning", "top"])?.style).toBe("spin");
    expect(matchAnimation(["slowly", "floating"])).toMatchObject({ style: "float", speed: 0.5 });
    expect(matchAnimation(["a", "bouncing", "ball"])?.style).toBe("bounce");
    expect(matchAnimation(["sandwich"])).toBeNull();
  });

  it("classifies colors the way people name them", () => {
    expect(colorWords("#e5484d")).toContain("red");
    expect(colorWords("#3e63dd")).toContain("blue");
    expect(colorWords("#8b7cff")).toContain("purple");
    expect(colorWords("#f2f2f2")).toEqual(["white"]);
  });
});

describe("scene command runtime", () => {
  it("moves objects by coordinates, direction, and relative to others", () => {
    let result = ScriptRuntime.runOnce(sampleScene(), "move ball to 1 2 3");
    expect(position(result.scene, "ball")).toEqual([1, 2, 3]);
    result = ScriptRuntime.runOnce(sampleScene(), "move ball up 2");
    expect(position(result.scene, "ball")).toEqual([0, 2.5, 0]);
    result = ScriptRuntime.runOnce(sampleScene(), "move the red ball above the blue box");
    expect(position(result.scene, "ball")?.[0]).toBe(3);
    expect(position(result.scene, "ball")?.[1]).toBeCloseTo(1.55);
    expect(result.issues).toEqual([]);
  });

  it("finds objects by name, shape word, or description with a relation", () => {
    expect(position(ScriptRuntime.runOnce(sampleScene(), "move crate by 0 1 0").scene, "box")).toEqual([3, 1.5, 0]);
    expect(position(ScriptRuntime.runOnce(sampleScene(), "move sphere by 1 0 0").scene, "ball")).toEqual([1, 0.5, 0]);
    const destroyed = ScriptRuntime.runOnce(sampleScene(), "destroy the one above the box").scene;
    expect(destroyed.entities.map((entity) => entity.id)).toEqual(["ball", "box"]);
  });

  it("reports objects it cannot find with the script line", () => {
    const result = ScriptRuntime.runOnce(sampleScene(), "say 1\ndestroy the yellow ball");
    expect(result.issues[0]).toMatchObject({ line: 2 });
    expect(result.issues[0]?.message).toContain("could not find 'the yellow ball'");
  });

  it("paints, scales, hides, and turns", () => {
    const scene = ScriptRuntime.runOnce(sampleScene(), "paint ball green\nscale ball by 2\nhide ball\nturn ball left 90").scene;
    const ball = scene.entities.find((entity) => entity.id === "ball")!;
    expect(ball.components.Material).toMatchObject({ color: "#30a46c", opacity: 0 });
    expect(ball.components.Transform).toMatchObject({ scale: [2, 2, 2], rotation: [0, 90, 0] });
  });

  it("glides over time during Play", () => {
    const scene = sampleScene();
    scene.entities[0]!.components.Script = { source: "on start:\n  move self to 2 0.5 0 over 1s\n" };
    const runtime = new ScriptRuntime(scene);
    runtime.start();
    const halfway = position(play(runtime, 0.5), "ball")!;
    expect(halfway[0]).toBeGreaterThan(0.5);
    expect(halfway[0]).toBeLessThan(1.5);
    expect(position(play(runtime, 0.6), "ball")).toEqual([2, 0.5, 0]);
  });

  it("animates and stops, returning the object to its start", () => {
    const scene = sampleScene();
    scene.entities[0]!.components.Script = { source: "on start:\n  animate self like a bouncing ball\nevery 1s:\n  stop self\n" };
    const runtime = new ScriptRuntime(scene);
    runtime.start();
    const bounced = position(play(runtime, 0.4), "ball")!;
    expect(bounced[1]).toBeGreaterThan(0.6);
    expect(position(play(runtime, 0.7), "ball")).toEqual([0, 0.5, 0]);
    expect(runtime.takeIssues()).toEqual([]);
  });

  it("asks for Play when an animation is run from the command bar", () => {
    const result = ScriptRuntime.runOnce(sampleScene(), "animate ball like spinning");
    expect(result.issues[0]?.message).toContain("Play");
  });
});
