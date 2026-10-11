import { describe, expect, it } from "vitest";
import {
  BEZIER_PRESETS, EASING_DIRECTIONS, EASING_FAMILIES, cubicBezier, easeProgress, interpolationLabel, isBezierPoints, isInterpolation, sampleEasing,
  type AnimationInterpolation
} from "../../src/runtime/easing";
import { evaluateAnimations, evaluateTrack } from "../../src/runtime/animator";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene } from "../../src/scene/types";
import { validateScene } from "../../src/scene/validate";

const families = EASING_DIRECTIONS.flatMap((direction) => EASING_FAMILIES.map((family) => `ease-${direction}-${family}` as AnimationInterpolation));

describe("easing curves", () => {
  it("starts at 0 and ends at 1 for every named curve", () => {
    for (const interpolation of [...families, "linear", "ease-in-out", "bezier"] as AnimationInterpolation[]) {
      expect(easeProgress(interpolation, 0), interpolation).toBeCloseTo(0, 6);
      expect(easeProgress(interpolation, 1), interpolation).toBeCloseTo(1, 6);
    }
  });

  it("shapes in, out, and in-out curves as expected", () => {
    expect(easeProgress("ease-in-quad", 0.5)).toBeCloseTo(0.25);
    expect(easeProgress("ease-out-quad", 0.5)).toBeCloseTo(0.75);
    expect(easeProgress("ease-in-out-cubic", 0.5)).toBeCloseTo(0.5);
    expect(easeProgress("ease-in-out-cubic", 0.25)).toBeCloseTo(0.0625);
    // Back overshoots below 0 going in, and past 1 coming out.
    expect(easeProgress("ease-in-back", 0.2)).toBeLessThan(0);
    expect(easeProgress("ease-out-back", 0.8)).toBeGreaterThan(1);
    // Bounce out touches 1 between bounces.
    expect(easeProgress("ease-out-bounce", 1 / 2.75)).toBeCloseTo(1);
  });

  it("keeps the original smoothstep for ease-in-out and clamps progress", () => {
    expect(easeProgress("ease-in-out", 0.25)).toBeCloseTo(0.15625);
    expect(easeProgress("linear", -1)).toBe(0);
    expect(easeProgress("linear", 2)).toBe(1);
    expect(easeProgress(undefined, 0.3)).toBeCloseTo(0.3);
  });

  it("solves cubic-bezier timing like CSS", () => {
    expect(cubicBezier([0, 0, 1, 1])(0.37)).toBeCloseTo(0.37, 4);
    const ease = cubicBezier([0.25, 0.1, 0.25, 1]);
    expect(ease(0.5)).toBeCloseTo(0.8024, 3);
    expect(ease(0.25)).toBeCloseTo(0.4085, 3);
    // y handles above 1 overshoot.
    expect(Math.max(...sampleEasing("bezier", [0.3, 1.5, 0.6, 1]).map(([, value]) => value))).toBeGreaterThan(1);
    expect(easeProgress("bezier", 0.5, [0.42, 0, 0.58, 1])).toBeCloseTo(0.5, 4);
  });

  it("recognizes valid interpolation names and bezier points", () => {
    expect(families.every(isInterpolation)).toBe(true);
    expect(isInterpolation("ease-sideways-quad")).toBe(false);
    expect(isInterpolation("ease-in-wobble")).toBe(false);
    expect(BEZIER_PRESETS.every((preset) => isBezierPoints(preset.points))).toBe(true);
    expect(isBezierPoints([1.2, 0, 0.5, 1])).toBe(false);
    expect(isBezierPoints([0.2, 4, 0.5, 1])).toBe(false);
    expect(isBezierPoints([0.2, 0, 0.5])).toBe(false);
    expect(interpolationLabel("ease-in-out-elastic")).toBe("Elastic In-Out");
    expect(interpolationLabel("ease-in-out")).toBe("Smooth");
  });

  it("draws step curves as a hold then a jump", () => {
    expect(sampleEasing("step")).toEqual([[0, 0], [1, 0], [1, 1]]);
  });
});

describe("eased animation tracks", () => {
  it("applies named and bezier easings between keys", () => {
    const track = { component: "Transform", field: "position", keys: [
      { time: 0, value: 0, interpolation: "ease-in-quad" as const }, { time: 2, value: 10 }
    ] };
    expect(evaluateTrack(track, 1)).toBeCloseTo(2.5);
    const bezier = { ...track, keys: [{ time: 0, value: 0, interpolation: "bezier" as const, bezier: [0.42, 0, 0.58, 1] as [number, number, number, number] }, { time: 2, value: 10 }] };
    expect(evaluateTrack(bezier, 1)).toBeCloseTo(5, 3);
  });

  it("clamps overshooting values to the field range so the frame still applies", () => {
    const created = applyOps(createEmptyScene(), [{
      op: "create", id: "orb", name: "Orb", parent: null,
      components: {
        Transform: {}, Mesh: {}, Material: {},
        Animator: { duration: 1, tracks: [
          { component: "Material", field: "opacity", keys: [{ time: 0, value: 0, interpolation: "ease-out-back" }, { time: 1, value: 1 }] },
          { component: "Material", field: "color", keys: [{ time: 0, value: "#000000", interpolation: "ease-out-elastic" }, { time: 1, value: "#ffffff" }] }
        ] }
      }
    }]);
    expect(created.errors).toEqual([]);
    const frame = evaluateAnimations(created.scene, 0.75);
    expect(frame.warnings).toEqual([]);
    const material = frame.scene.entities[0]!.components.Material!;
    // Clamped to the max, which equals the default, so applyOps stores it by omission.
    expect(material.opacity ?? 1).toBe(1);
    expect(material.color ?? "#ffffff").toMatch(/^#[0-9a-f]{6}$/);
  });

  it("validates new interpolation names and rejects malformed bezier data", () => {
    const sceneWith = (key: Record<string, unknown>) => ({
      ...createEmptyScene(),
      entities: [{ id: "a", name: "A", parent: null, components: { Transform: {}, Animator: { tracks: [
        { component: "Transform", field: "position", keys: [{ time: 0, value: [0, 0, 0], ...key }, { time: 1, value: [1, 0, 0] }] }
      ] } } }]
    });
    expect(validateScene(sceneWith({ interpolation: "ease-out-bounce" }))).toEqual([]);
    expect(validateScene(sceneWith({ interpolation: "bezier", bezier: [0.2, -0.4, 0.6, 1.3] }))).toEqual([]);
    expect(validateScene(sceneWith({ interpolation: "ease-out-wobble" })).join(" ")).toContain("interpolation");
    expect(validateScene(sceneWith({ interpolation: "bezier", bezier: [2, 0, 0.5, 1] })).join(" ")).toContain("bezier");
  });
});
