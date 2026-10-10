import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseScript } from "../../src/lang/parser";
import { typecheckScript } from "../../src/lang/checker";
import { ScriptRuntime } from "../../src/runtime/scripts";
import { createEmptyScene, type Scene } from "../../src/scene/types";

function sceneWith(script: string, extra: Scene["entities"] = []): Scene {
  const scene = createEmptyScene();
  scene.entities.push(
    { id: "hero", name: "Hero", parent: null, components: { Transform: { position: [0, 0.5, 0] }, Mesh: { shape: "sphere" }, Material: { color: "#3e63dd" }, Script: { source: script } } },
    ...extra
  );
  return scene;
}

function play(runtime: ScriptRuntime, seconds: number): Scene {
  let scene = runtime.scene;
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += 0.1) scene = runtime.advance(Math.min(0.1, seconds - elapsed));
  return scene;
}

const entity = (scene: Scene, id: string) => scene.entities.find((candidate) => candidate.id === id);
const position = (scene: Scene, id: string) => entity(scene, id)?.components.Transform?.position as number[] | undefined;
const color = (scene: Scene, id: string) => entity(scene, id)?.components.Material?.color;
const problems = (source: string) => typecheckScript(parseScript(source)).map((issue) => issue.message);

describe("plain-sentence scripts", () => {
  it("reads like sentences without colons, dots, or brackets", () => {
    const source = [
      "setting speed = 2 from 0 to 10",
      "when game starts",
      "  set score to 0",
      "  say \"Go!\"",
      "  spin slowly",
      "forever",
      "  if key right is pressed",
      "    move right 0.1",
      "every 2 seconds",
      "  change score by 1",
      "  if score is more than 3 then",
      "    paint red",
      "  otherwise",
      "    turn left",
      "when clicked",
      "  hide",
      "when space is pressed",
      "  broadcast \"jump\"",
      "when I receive \"jump\"",
      "  move up 1 over 0.5 seconds",
      "when I touch a coin",
      "  destroy it"
    ].join("\n");
    const program = parseScript(source);
    expect(program.handlers.map((handler) => handler.event)).toEqual(["start", "frame", "interval", "click", "key", "message", "collide"]);
    expect(program.handlers.find((handler) => handler.event === "key")?.key).toBe("space");
    expect(program.params[0]).toMatchObject({ name: "speed", type: "float", min: 0, max: 10, defaultValue: 2 });
    expect(problems(source)).toEqual([]);
  });

  it("compiles the README example", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    const example = readme.slice(readme.indexOf("## Scripting")).match(/```\n([\s\S]*?)```/)?.[1] ?? "";
    expect(example).toContain("when game starts");
    expect(problems(example)).toEqual([]);
  });

  it("understands several ways to name a key", () => {
    for (const [header, key] of [["when I press left", "left"], ["when the a key is pressed", "a"], ["when key up is pressed", "up"], ["when enter is pressed", "enter"]] as const) {
      expect(parseScript(`${header}\n  say "hi"`).handlers[0]?.key).toBe(key);
    }
  });

  it("explains indented event lines and unknown events", () => {
    expect(() => parseScript("when game starts\n  every 2 seconds\n    say 1")).toThrow(/must not be indented/);
    expect(() => parseScript("when it rains\n  say 1")).toThrow(/don't know that event/);
  });

  it("shares variables between events and waits between steps", () => {
    const runtime = new ScriptRuntime(sceneWith([
      "when game starts",
      "  set steps to 0",
      "  move up 1",
      "  wait 1 second",
      "  move up 1",
      "  change steps by 1",
      "every 0.5 seconds",
      "  if steps is 1",
      "    paint green"
    ].join("\n")));
    expect(position(runtime.start(), "hero")).toEqual([0, 1.5, 0]);
    expect(position(play(runtime, 0.5), "hero")).toEqual([0, 1.5, 0]);
    const later = play(runtime, 1.1);
    expect(position(later, "hero")).toEqual([0, 2.5, 0]);
    expect(color(later, "hero")).toBe("#30a46c");
    expect(runtime.takeIssues()).toEqual([]);
  });

  it("repeats, compares with words, and acts on every match", () => {
    const balls = [1, 2, 3].map((index) => ({ id: `ball${index}`, name: `Ball ${index}`, parent: null, components: { Transform: { position: [index * 2, 0.5, 0] }, Mesh: { shape: "sphere" }, Material: { color: "#e5484d" } } }));
    const runtime = new ScriptRuntime(sceneWith([
      "when game starts",
      "  repeat 3 times",
      "    move right 1",
      "  if my x is at least 3",
      "    paint all red balls yellow"
    ].join("\n"), balls));
    const scene = runtime.start();
    expect(position(scene, "hero")).toEqual([3, 0.5, 0]);
    expect(balls.map((ball) => color(scene, ball.id))).toEqual(["#ffd60a", "#ffd60a", "#ffd60a"]);
  });

  it("delivers keys, clicks on children, and broadcasts", () => {
    const scene = sceneWith("when space is pressed\n  broadcast \"grow\"\nwhen I receive \"grow\"\n  scale by 2");
    scene.entities.push(
      { id: "group", name: "Group", parent: null, components: { Transform: {}, Script: { source: "when clicked\n  paint my children green" } } },
      { id: "leaf", name: "Leaf", parent: "group", components: { Transform: {}, Mesh: { shape: "box" }, Material: { color: "#ffffff" } } }
    );
    const runtime = new ScriptRuntime(scene);
    runtime.start();
    runtime.pressKey("space");
    runtime.click("leaf");
    const next = runtime.advance(0.1);
    expect(entity(next, "hero")?.components.Transform?.scale).toEqual([2, 2, 2]);
    expect(color(next, "leaf")).toBe("#30a46c");
  });

  it("filters touch events by description and lets 'it' mean the touched object", () => {
    const scene = sceneWith("when I touch the floor\n  paint it red");
    scene.entities.push(
      { id: "floor", name: "Floor", parent: null, components: { Transform: {}, Mesh: { shape: "plane" }, Material: { color: "#ffffff" } } },
      { id: "wall", name: "Wall", parent: null, components: { Transform: {}, Mesh: { shape: "box" }, Material: { color: "#ffffff" } } }
    );
    const runtime = new ScriptRuntime(scene);
    runtime.collide("hero", "wall");
    runtime.collide("hero", "floor");
    expect(color(runtime.scene, "wall")).toBe("#ffffff");
    expect(color(runtime.scene, "floor")).toBe("#e5484d");
  });

  it("creates objects and sets readable properties", () => {
    const runtime = new ScriptRuntime(sceneWith("when game starts\n  create a red ball at 0 3 0 called \"Coin\"\n  set my x to 4\n  set my color to green"));
    const scene = runtime.start();
    const coin = scene.entities.find((candidate) => candidate.name === "Coin");
    expect(coin?.components.Transform?.position).toEqual([0, 3, 0]);
    expect(coin?.components.Material?.color).toBe("#e5484d");
    expect(position(scene, "hero")).toEqual([4, 0.5, 0]);
    expect(color(scene, "hero")).toBe("#30a46c");
  });

  it("stops loops that never wait and reports the line", () => {
    const runtime = new ScriptRuntime(sceneWith("when game starts\n  forever\n    change spins by 1"));
    runtime.start();
    expect(runtime.takeIssues()[0]).toMatchObject({ line: 2, message: expect.stringContaining("without waiting") });
  });

  it("runs sentences once from the command bar, finishing waits instantly", () => {
    const result = ScriptRuntime.runOnce(sceneWith(""), "move hero up 1\nwait 1 second\nmove hero up 1");
    expect(result.issues).toEqual([]);
    expect(position(result.scene, "hero")).toEqual([0, 2.5, 0]);
  });
});
