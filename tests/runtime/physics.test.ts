import { describe, expect, it } from "vitest";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene } from "../../src/scene/types";
import { PhysicsRuntime, SimulationController } from "../../src/runtime/physics";

function boxScene(count: number, firstY = 0.5) {
  const scene = createEmptyScene();
  const ops = Array.from({ length: count }, (_, index) => ({
    op: "create" as const,
    id: `box_${index}`,
    name: `Box ${index}`,
    parent: null,
    components: {
      Transform: { position: [0, firstY + index, 0] },
      Mesh: { shape: "box" },
      RigidBody: { restitution: 0, friction: 0.8 }
    }
  }));
  const result = applyOps(scene, ops);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  return result.scene;
}

describe("Rapier simulation", () => {
  it("steps a 20-box stack and lets it settle on the ground", async () => {
    const runtime = await PhysicsRuntime.create(boxScene(20));
    let scene = boxScene(20);
    for (let frame = 0; frame < 600; frame += 1) scene = runtime.advance(scene, 1 / 60);
    const bottom = scene.entities.find((entity) => entity.id === "box_0");
    const top = scene.entities.find((entity) => entity.id === "box_19");
    const bottomY = bottom?.components.Transform?.position as number[] | undefined;
    const topY = top?.components.Transform?.position as number[] | undefined;
    expect(bottomY?.[1]).toBeGreaterThan(0.4);
    expect(bottomY?.[1]).toBeLessThan(0.7);
    expect(topY?.[1]).toBeGreaterThan(18);
    expect(runtime.warnings).toEqual([]);
    runtime.dispose();
  }, 20_000);

  it("pauses stepping and Stop restores the exact pre-play scene", async () => {
    const initial = boxScene(1, 5);
    const controller = new SimulationController();
    expect(await controller.play(initial)).toEqual([]);
    const moving = controller.advance(initial, 1);
    expect(moving).not.toEqual(initial);
    controller.pause();
    expect(controller.state).toBe("paused");
    expect(controller.advance(moving, 1)).toBe(moving);
    controller.resume();
    const restored = controller.stop();
    expect(restored).toEqual(initial);
    expect(controller.state).toBe("stopped");
  });

  it("builds a rope joint to a world anchor", async () => {
    const scene = createEmptyScene();
    const result = applyOps(scene, [{
      op: "create",
      id: "ball",
      name: "Wrecking Ball",
      parent: null,
      components: {
        Transform: { position: [-6, 5, 0] },
        Mesh: { shape: "sphere", radius: 0.8 },
        RigidBody: { mass: 40 },
        Joint: { type: "rope", anchor: [0, 10, 0], length: 7 }
      }
    }]);
    expect(result.errors).toEqual([]);
    const runtime = await PhysicsRuntime.create(result.scene);
    expect(runtime.warnings).toEqual([]);
    let simulated = result.scene;
    for (let frame = 0; frame < 60; frame += 1) simulated = runtime.advance(simulated, 1 / 60);
    const position = simulated.entities[0].components.Transform?.position as number[];
    expect(position.every(Number.isFinite)).toBe(true);
    runtime.dispose();
  });
});
