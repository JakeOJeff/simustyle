import { describe, expect, it } from "vitest";
import { ScriptRuntime } from "../../src/runtime/scripts";
import { createEmptyScene, type Scene } from "../../src/scene/types";

function scriptScene(source: string, extra: Record<string, Record<string, unknown>> = {}): Scene {
  const scene = createEmptyScene();
  scene.entities.push({ id: "mover", name: "Mover", parent: null, components: {
    Transform: { position: [0, 0, 0] }, Script: { source }, ...extra
  } });
  return scene;
}

describe("script runtime", () => {
  it("clears held keys when input focus is lost", () => {
    const runtime = new ScriptRuntime(scriptScene("forever\n  if key right is pressed\n    move right 1"));
    runtime.start();
    runtime.pressKey("right");
    expect(runtime.advance(0.1).entities[0].components.Transform.position).toEqual([1, 0, 0]);
    runtime.releaseAllKeys();
    expect(runtime.advance(0.1).entities[0].components.Transform.position).toEqual([1, 0, 0]);
    expect(runtime.takeIssues()).toEqual([]);
  });
  it("runs initialization, start, and frame handlers through validated scene ops", () => {
    const runtime = new ScriptRuntime(scriptScene("param speed: float 0..10 = 3\nlet count = 0\non start:\n  self.transform.position.x = speed\nevery frame:\n  self.transform.position.x += dt\n  count += 1\n"));
    const started = runtime.start();
    expect(started.entities[0]?.components.Transform?.position).toEqual([3, 0, 0]);
    const advanced = runtime.advance(0.5);
    expect(advanced.entities[0]?.components.Transform?.position).toEqual([3.25, 0, 0]);
    expect(runtime.takeIssues()).toEqual([]);
  });

  it("skips invalid scripts and records a helpful compile issue", () => {
    const runtime = new ScriptRuntime(scriptScene("every frame:\n  self.rigidbdy.mass = 2\n"));
    expect(runtime.advance(1 / 60).entities[0]?.components.Transform?.position).toEqual([0, 0, 0]);
    expect(runtime.takeIssues()[0]?.message).toContain("Did you mean RigidBody?");
  });

  it("uses a seeded random stream", () => {
    const scene = scriptScene("on start:\n  self.transform.position.x = random(0, 1)\n");
    const first = new ScriptRuntime(scene, 123).start().entities[0]?.components.Transform?.position;
    const second = new ScriptRuntime(scene, 123).start().entities[0]?.components.Transform?.position;
    expect(first).toEqual(second);
  });

  it("forwards collision events and rigidbody actions through the runtime API", () => {
    const scene = scriptScene("on collide(other):\n  if other.name == \"Wall\":\n    print(\"hit\", other.id)\n  self.rigidbody.applyImpulse(0, 5, 0)\n");
    scene.entities.push({ id: "wall", name: "Wall", parent: null, components: { Transform: { position: [0, 0, 0] } } });
    const actions: unknown[][] = [];
    const runtime = new ScriptRuntime(scene, 1, (_id, method, args) => { actions.push([method, ...args]); return true; });
    runtime.collide("mover", "wall");
    expect(runtime.takePrints()).toEqual([{ entityId: "mover", values: ["hit", "wall"] }]);
    expect(actions).toEqual([["applyImpulse", 0, 5, 0]]);
  });
});
