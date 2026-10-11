import { describe, expect, it } from "vitest";
import { ANIMATION_PRESETS, presetAvailable, presetOp } from "../../src/runtime/animationPresets";
import { evaluateAnimations, type AnimationTrack } from "../../src/runtime/animator";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Entity } from "../../src/scene/types";

function sceneWith(components: Entity["components"]) {
  const result = applyOps(createEmptyScene(), [{ op: "create", id: "thing", name: "Thing", parent: null, components }]);
  if (result.errors.length) throw new Error(result.errors.join("; "));
  return result.scene;
}

const shape = { Transform: { position: [2, 1, -1] }, Mesh: { shape: "box" }, Material: { color: "#3366cc" } };

describe("animation presets", () => {
  it("every available preset produces a valid, undoable edit that plays without warnings", () => {
    const light = { Transform: { position: [0, 3, 0] }, Light: { intensity: 20 } };
    for (const preset of ANIMATION_PRESETS) {
      const scene = sceneWith(preset.requires.includes("Light") ? light : shape);
      const entity = scene.entities[0]!;
      expect(presetAvailable(preset, entity), preset.id).toBe(true);
      const { op, error } = presetOp(preset.id, entity);
      expect(error, preset.id).toBeUndefined();
      const applied = applyOps(scene, [op!]);
      expect(applied.errors, preset.id).toEqual([]);
      for (const time of [0, preset.duration * 0.3, preset.duration * 0.7]) {
        expect(evaluateAnimations(applied.scene, time).warnings, `${preset.id} at ${time}s`).toEqual([]);
      }
      // Undo restores the object exactly.
      expect(applyOps(applied.scene, applied.inverseOps).scene).toEqual(scene);
    }
  });

  it("starts from the object's current pose and adopts the preset length and looping", () => {
    const scene = sceneWith(shape);
    const { op } = presetOp("bounce", scene.entities[0]!);
    const animator = (op as { components: Record<string, Record<string, unknown>> }).components.Animator!;
    expect(animator.duration).toBe(1);
    expect(animator.loop).toBe(true);
    const track = (animator.tracks as AnimationTrack[])[0]!;
    expect(track.keys[0]!.value).toEqual([2, 1, -1]);
    expect(track.keys[1]!.value).toEqual([2, 2.5, -1]);
    expect(track.keys[0]!.interpolation).toBe("ease-out-quad");

    const entrance = presetOp("pop-in", scene.entities[0]!).op as { components: Record<string, Record<string, unknown>> };
    expect(entrance.components.Animator!.loop).toBe(false);
  });

  it("replaces tracks for the same property, keeps others, and keeps the existing length", () => {
    const scene = sceneWith({ ...shape, Animator: { duration: 4, loop: true, tracks: [
      { component: "Transform", field: "position", keys: [{ time: 0, value: [0, 0, 0] }, { time: 4, value: [1, 0, 0] }] },
      { component: "Material", field: "color", keys: [{ time: 0, value: "#000000" }, { time: 4, value: "#ffffff" }] }
    ] } });
    const { op } = presetOp("float", scene.entities[0]!);
    const animator = (op as { components: Record<string, Record<string, unknown>> }).components.Animator!;
    const tracks = animator.tracks as AnimationTrack[];
    expect(tracks.map((track) => `${track.component}.${track.field}`)).toEqual(["Material.color", "Transform.position"]);
    expect(animator.duration).toBeUndefined();
    expect(tracks[1]!.keys.at(-1)!.time).toBe(4);
  });

  it("refuses presets the object cannot use", () => {
    const scene = sceneWith({ Transform: {} });
    expect(presetOp("color-cycle", scene.entities[0]!).error).toContain("Material");
    expect(presetOp("flicker", scene.entities[0]!).error).toContain("Light");
    expect(presetOp("nope", scene.entities[0]!).error).toContain("Unknown");
  });
});
