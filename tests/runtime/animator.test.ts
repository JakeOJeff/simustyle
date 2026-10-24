import { describe, expect, it } from "vitest";
import { AnimatorRuntime, evaluateAnimations, evaluateTrack, type AnimationTrack } from "../../src/runtime/animator";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene } from "../../src/scene/types";

function animatedScene(options: { loop?: boolean; duration?: number; bodyType?: string } = {}) {
  const scene = createEmptyScene();
  const result = applyOps(scene, [{
    op: "create",
    id: "cube",
    name: "Cube",
    parent: null,
    components: {
      Transform: {},
      Mesh: { shape: "box" },
      Material: {},
      ...(options.bodyType ? { RigidBody: { bodyType: options.bodyType } } : {}),
      Animator: {
        ...(options.loop === undefined ? {} : { loop: options.loop }),
        ...(options.duration === undefined ? {} : { duration: options.duration }),
        tracks: [
          { component: "Transform", field: "position", keys: [
            { time: 0, value: [0, 0, 0], interpolation: "linear" },
            { time: 2, value: [4, 2, -2], interpolation: "linear" }
          ] },
          { component: "Material", field: "color", keys: [
            { time: 0, value: "#000000", interpolation: "linear" },
            { time: 2, value: "#ffffff", interpolation: "linear" }
          ] }
        ]
      }
    }
  }]);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  return result.scene;
}

describe("timeline animation runtime", () => {
  it("switches stepped values exactly at interior keyframes", () => {
    const track: AnimationTrack = { component: "Light", field: "intensity", keys: [
      { time: 0, value: 1, interpolation: "step" },
      { time: 1, value: 2, interpolation: "step" },
      { time: 2, value: 3, interpolation: "step" }
    ] };
    expect(evaluateTrack(track, 0.999)).toBe(1);
    expect(evaluateTrack(track, 1)).toBe(2);
    expect(evaluateTrack(track, 1.001)).toBe(2);
    expect(evaluateTrack(track, 2)).toBe(3);
  });
  it("interpolates float, vec3, and hex colors with each supported easing", () => {
    const linear: AnimationTrack = { component: "Transform", field: "position", keys: [
      { time: 0, value: [0, 0, 0], interpolation: "linear" }, { time: 2, value: [4, 2, -2], interpolation: "linear" }
    ] };
    expect(evaluateTrack(linear, 1)).toEqual([2, 1, -1]);
    expect(evaluateTrack({ ...linear, keys: linear.keys.map((key, index) => index === 0 ? { ...key, interpolation: "ease-in-out" as const } : key) }, 0.5)).toEqual([0.625, 0.3125, -0.3125]);
    expect(evaluateTrack({ ...linear, keys: linear.keys.map((key, index) => index === 0 ? { ...key, interpolation: "step" as const } : key) }, 1.5)).toEqual([0, 0, 0]);
    expect(evaluateTrack({ component: "Material", field: "color", keys: [
      { time: 0, value: "#000000", interpolation: "linear" }, { time: 2, value: "#ffffff", interpolation: "linear" }
    ] }, 1)).toBe("#808080");
    expect(evaluateTrack({ component: "Transform", field: "position", keys: [
      { time: 0, value: 0, interpolation: "linear" }, { time: 2, value: 10, interpolation: "linear" }
    ] }, 1)).toBe(5);
    expect(evaluateTrack({ component: "Transform", field: "position", keys: [
      { time: 0, value: 0 }, { time: 2, value: 10 }
    ] }, 1)).toBe(5);
  });

  it("applies animated fields through scene operations and supports loop and clamp", () => {
    const scene = animatedScene({ duration: 2 });
    const halfway = evaluateAnimations(scene, 1);
    expect(halfway.warnings).toEqual([]);
    expect(halfway.scene.entities[0]?.components.Transform?.position).toEqual([2, 1, -1]);
    expect(halfway.scene.entities[0]?.components.Material?.color).toBe("#808080");
    expect(evaluateAnimations(scene, 2).scene.entities[0]?.components.Transform?.position ?? [0, 0, 0]).toEqual([0, 0, 0]);

    const clamped = evaluateAnimations(animatedScene({ loop: false, duration: 2 }), 9);
    expect(clamped.scene.entities[0]?.components.Transform?.position).toEqual([4, 2, -2]);
  });

  it("skips and warns for Transform tracks on dynamic rigid bodies", () => {
    const result = evaluateAnimations(animatedScene({ bodyType: "dynamic" }), 1);
    expect(result.scene.entities[0]?.components.Transform?.position ?? [0, 0, 0]).toEqual([0, 0, 0]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("dynamic rigid body 'Cube'");
    expect(result.scene.entities[0]?.components.Material?.color).toBe("#808080");
  });

  it("allows explicit Transform animation on anchored bodies", () => {
    const scene = animatedScene({ bodyType: "dynamic" });
    scene.entities[0].components.RigidBody.anchored = true;
    const result = evaluateAnimations(scene, 1);
    expect(result.scene.entities[0].components.Transform.position).toEqual([2, 1, -1]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps a playback clock and can reset it", () => {
    const runtime = new AnimatorRuntime();
    const scene = animatedScene({ loop: false, duration: 5 });
    expect(runtime.advance(scene, 0.5).scene.entities[0]?.components.Transform?.position).toEqual([1, 0.5, -0.5]);
    expect(runtime.time).toBe(0.5);
    expect(runtime.evaluate(scene, 1).scene.entities[0]?.components.Transform?.position).toEqual([2, 1, -1]);
    runtime.reset();
    expect(runtime.time).toBe(0);
  });
});
