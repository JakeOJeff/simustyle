import { describe, expect, it } from "vitest";
import { COLLIDER_REACTIONS } from "../../src/registry/components/collider";
import { typecheckScript } from "../../src/lang/checker";
import { parseScript } from "../../src/lang/parser";
import { SimulationController } from "../../src/runtime/physics";
import { reactionSource } from "../../src/runtime/reactions";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp } from "../../src/scene/types";

function build(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  return result.scene;
}

/** A ball dropped onto a resting platform. */
function dropScene(platform: Record<string, Record<string, unknown>>, collisions = true): Scene {
  return build([
    { op: "settings", settings: { collisions } },
    { op: "create", id: "platform", name: "Platform", parent: null, components: { Transform: { position: [0, 2, 0] }, Mesh: { shape: "box", radius: 2, height: 0.5 }, Material: { color: "#888888" }, ...platform } },
    { op: "create", id: "ball", name: "Ball", parent: null, components: { Transform: { position: [0, 4, 0] }, Mesh: { shape: "sphere" }, Material: { color: "#ffffff" }, RigidBody: { restitution: 0 } } }
  ]);
}

async function run(scene: Scene, seconds: number): Promise<{ scene: Scene; messages: string[] }> {
  const controller = new SimulationController();
  expect(await controller.play(scene)).toEqual([]);
  for (let frame = 0; frame < seconds * 60; frame += 1) scene = controller.advance(scene, 1 / 60);
  const messages = controller.takeScriptMessages();
  controller.stop();
  return { scene, messages };
}

function y(scene: Scene, id: string): number {
  return (scene.entities.find((entity) => entity.id === id)?.components.Transform?.position as number[])[1]!;
}

describe("collision system", () => {
  it("lands on a Collider-only object when collisions are on", async () => {
    const { scene } = await run(dropScene({ Collider: {} }), 2);
    expect(y(scene, "ball")).toBeGreaterThan(2.4);
  });

  it("passes through objects but stays on the floor when collisions are off", async () => {
    const { scene } = await run(dropScene({ Collider: {} }, false), 2);
    expect(y(scene, "ball")).toBeLessThan(0.7);
    expect(y(scene, "ball")).toBeGreaterThan(0.3);
  });

  it("lets a trigger detect a touch without blocking", async () => {
    const { scene } = await run(dropScene({ Collider: { trigger: true, reaction: "change color", reactionColor: "#00ff00" } }), 2);
    expect(y(scene, "ball")).toBeLessThan(0.7);
    expect(scene.entities.find((entity) => entity.id === "platform")?.components.Material?.color).toBe("#00ff00");
  });

  it("runs a destroy reaction and keeps simulating", async () => {
    const { scene, messages } = await run(dropScene({ Collider: { reaction: "destroy other" } }), 2);
    expect(scene.entities.some((entity) => entity.id === "ball")).toBe(false);
    expect(messages.filter((message) => message.includes("failed"))).toEqual([]);
  });

  it("fires 'when I touch' scripts on Collider objects", async () => {
    const { scene } = await run(dropScene({ Collider: {}, Script: { source: "when I touch a ball\n  paint blue\n" } }), 2);
    expect(scene.entities.find((entity) => entity.id === "platform")?.components.Material?.color).not.toBe("#888888");
  });

  it("writes every reaction as a valid script", () => {
    for (const reaction of COLLIDER_REACTIONS) {
      const source = reactionSource({ id: "a", name: "A", parent: null, components: { Collider: { reaction } } });
      if (reaction === "none") { expect(source).toBeNull(); continue; }
      expect(typecheckScript(parseScript(source!)), reaction).toEqual([]);
    }
  });
});
