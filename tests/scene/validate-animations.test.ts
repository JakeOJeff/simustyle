import { describe, expect, it } from "vitest";
import { validateScene } from "../../src/scene/validate";
import { createEmptyScene } from "../../src/scene/types";

function sceneWithTracks(tracks: unknown) {
  const scene = createEmptyScene();
  scene.entities.push({
    id: "animated",
    name: "Animated",
    parent: null,
    components: {
      Transform: {},
      Animator: { tracks }
    }
  });
  return scene;
}

describe("Animator track validation", () => {
  it("accepts float, vec3, and color tracks targeting schema fields", () => {
    const scene = sceneWithTracks([
      { component: "Transform", field: "position", keys: [{ time: 0, value: [0, 1, 2], interpolation: "linear" }] },
      { component: "Light", field: "intensity", keys: [{ time: 1.5, value: 0.75, interpolation: "ease-in-out" }] },
      { component: "Material", field: "color", keys: [{ time: 2, value: "#12aBcD", interpolation: "step" }] }
    ]);
    expect(validateScene(scene)).toEqual([]);
  });

  it("accepts an omitted interpolation field as linear", () => {
    expect(validateScene(sceneWithTracks([
      { component: "Transform", field: "position", keys: [{ time: 0, value: [0, 1, 2] }] }
    ]))).toEqual([]);
  });

  it("rejects malformed track shapes and unknown or non-animatable fields", () => {
    const errors = validateScene(sceneWithTracks([
      null,
      { component: "Missing", field: "value", keys: [] },
      { component: "Transform", field: "missing", keys: [] },
      { component: "Mesh", field: "shape", keys: [] },
      { component: "Transform", field: "position", keys: {} }
    ]));
    expect(errors).toEqual(expect.arrayContaining([
      "scene.entities[0].components.Animator.tracks[0]: must be an object",
      "scene.entities[0].components.Animator.tracks[1].component: unknown component 'Missing'",
      "scene.entities[0].components.Animator.tracks[2].field: unknown field 'missing' on Transform",
      "scene.entities[0].components.Animator.tracks[3].field: Mesh.shape cannot be animated",
      "scene.entities[0].components.Animator.tracks[4].keys: must be an array"
    ]));
  });

  it("validates key time, value shape, and interpolation", () => {
    const errors = validateScene(sceneWithTracks([
      { component: "Transform", field: "scale", keys: [
        { time: -1, value: [1, 2], interpolation: "cubic" },
        { time: Number.POSITIVE_INFINITY, value: [1, 2, 3], interpolation: "linear" }
      ] },
      { component: "Material", field: "color", keys: [{ time: 0, value: "red", interpolation: "linear" }] },
      { component: "Light", field: "intensity", keys: [{ time: 0, value: Number.NaN, interpolation: "step" }] }
    ]));
    expect(errors).toEqual(expect.arrayContaining([
      "scene.entities[0].components.Animator.tracks[0].keys[0].time: must be nonnegative",
      "scene.entities[0].components.Animator.tracks[0].keys[0].value: must be an array of three finite numbers",
      "scene.entities[0].components.Animator.tracks[0].keys[0].interpolation: must be linear, step, ease-in-out, bezier, or ease-<in|out|in-out>-<sine|quad|cubic|quart|quint|expo|circ|back|elastic|bounce>",
      "scene.entities[0].components.Animator.tracks[0].keys[1].time: must be a finite number",
      "scene.entities[0].components.Animator.tracks[1].keys[0].value: must be a #rrggbb color",
      "scene.entities[0].components.Animator.tracks[2].keys[0].value: must be a finite number"
    ]));
  });

  it("rejects non-array tracks", () => {
    expect(validateScene(sceneWithTracks({}))).toContain("scene.entities[0].components.Animator.tracks: must be an array");
  });
});
