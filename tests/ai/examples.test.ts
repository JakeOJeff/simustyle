import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EXAMPLE_LIBRARY, FEW_SHOT_EXAMPLES, MODELING_RULES, examplesText, fewShotText, selectExamples, type FewShotExample } from "../../src/ai/examples";
import { expandBuildOperations } from "../../src/ai/buildTools";
import { checkGeometry } from "../../src/ai/geometry";
import { meshWorldBounds } from "../../src/ai/quality";
import { applyOps } from "../../src/scene/applyOps";
import { worldMatrix } from "../../src/scene/hierarchy";
import { createEmptyScene, type Entity, type Scene } from "../../src/scene/types";

const gap = (a: THREE.Box3, b: THREE.Box3) => Math.hypot(...(["x", "y", "z"] as const).map((axis) => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])));
const ALL: readonly FewShotExample[] = [...FEW_SHOT_EXAMPLES, ...EXAMPLE_LIBRARY];

/** Parent chain of an entity, nearest first. */
const ancestors = (scene: Scene, entity: Entity): Entity[] => {
  const chain: Entity[] = [];
  for (let parent = scene.entities.find((candidate) => candidate.id === entity.parent); parent; parent = scene.entities.find((candidate) => candidate.id === parent!.parent)) chain.push(parent);
  return chain;
};

function built(example: FewShotExample) {
  const expanded = expandBuildOperations(createEmptyScene(), example.reply.ops);
  const applied = applyOps(createEmptyScene(), expanded.ops);
  const scene = applied.scene;
  const meshes = scene.entities.filter((entity) => entity.components.Mesh);
  const bounds = (entity: Entity) => meshWorldBounds(scene, entity.id)!;
  const size = (entity: Entity) => bounds(entity).getSize(new THREE.Vector3());
  const rotated = (entity: Entity) => ((entity.components.Transform?.rotation as number[] | undefined) ?? []).some((angle) => angle !== 0);
  /** Meshes whose bottom rests (within 0.05 m) on the top of support and overlaps it horizontally. */
  const restingOn = (support: Entity) => meshes.filter((entity) => entity !== support && Math.abs(bounds(entity).min.y - bounds(support).max.y) <= 0.05 &&
    bounds(entity).min.x < bounds(support).max.x && bounds(entity).max.x > bounds(support).min.x && bounds(entity).min.z < bounds(support).max.z && bounds(entity).max.z > bounds(support).min.z);
  const isComposition = example.reply.ops.some((op) => (op as { op?: string }).op === "settings");
  return { expanded, applied, scene, meshes, bounds, size, rotated, restingOn, isComposition, words: example.request.toLowerCase() };
}

describe("examples", () => {
  it.each(ALL.map((example) => [example.request, example] as const))("%s builds a valid, connected, grounded result", (request, example) => {
    expect(Object.keys(example.reply)).toEqual(["plan", "summary", "ops"]);
    expect(example.reply.plan.trim()).not.toBe("");
    const { expanded, applied, scene, meshes, bounds } = built(example);
    expect(expanded.errors).toEqual([]);
    expect(applied.errors).toEqual([]);
    expect(checkGeometry(scene, expanded.ops, request)).toEqual([]);
    expect(meshes.length).toBeGreaterThanOrEqual(6);
    expect(meshes.every((entity) => entity.parent !== null)).toBe(true);
    for (const entity of meshes) expect(meshes.some((other) => other !== entity && gap(bounds(entity), bounds(other)) <= 0.05), `${entity.name} touches another part`).toBe(true);
    expect(Math.abs(Math.min(...meshes.map((entity) => bounds(entity).min.y)))).toBeLessThanOrEqual(0.05);
    // Each top-level object: at most 20 parts and 4 related colors.
    for (const root of scene.entities.filter((entity) => entity.parent === null)) {
      const own = meshes.filter((entity) => ancestors(scene, entity).includes(root));
      expect(own.length, `${root.name} parts`).toBeLessThanOrEqual(20);
      expect(new Set(own.map((entity) => entity.components.Material?.color)).size, `${root.name} colors`).toBeLessThanOrEqual(4);
    }
  });

  describe("follow the general rules", () => {
    it.each(ALL.map((example) => [example.request, example] as const))("%s: raised flat surfaces hold varied items", (_request, example) => {
      const { meshes, size, bounds, rotated, restingOn } = built(example);
      // Flat, unrotated, at least 0.25 m across and at least 0.4 m up: a shelf board, table top or counter.
      const surfaces = meshes.filter((entity) => !rotated(entity) && size(entity).y <= 0.08 && size(entity).x >= 0.25 && size(entity).z >= 0.25 && bounds(entity).max.y >= 0.4);
      for (const surface of surfaces) {
        const items = restingOn(surface);
        expect(items.length, `${surface.name} at y=${bounds(surface).max.y.toFixed(2)} holds items`).toBeGreaterThanOrEqual(2);
        if (items.length < 5) continue;
        const sizes = items.map((item) => size(item));
        expect(new Set(sizes.map((value) => value.y.toFixed(2))).size, `${surface.name} item heights vary`).toBeGreaterThan(2);
        expect(new Set(items.map((item) => item.components.Material?.color)).size, `${surface.name} item colors vary`).toBeGreaterThan(1);
        const stacked = items.some((item) => restingOn(item).length > 0);
        expect(items.some(rotated) || stacked, `${surface.name} has a leaning or stacked item`).toBe(true);
      }
    });

    it.each(ALL.map((example) => [example.request, example] as const))("%s: in a composition, every glowing part has a light at it", (_request, example) => {
      const { scene, meshes, bounds, isComposition } = built(example);
      if (!isComposition) return;
      for (const glow of meshes.filter((entity) => Number(entity.components.Material?.emissiveIntensity ?? 0) > 0)) {
        expect(Number(glow.components.Material?.emissiveIntensity)).toBeGreaterThanOrEqual(1);
        expect(Number(glow.components.Material?.emissiveIntensity)).toBeLessThanOrEqual(3);
        const near = scene.entities.filter((entity) => entity.components.Light && bounds(glow).clone().expandByScalar(0.3)
          .containsPoint(new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, entity.id))));
        expect(near.length, `${glow.name} has a Light`).toBeGreaterThan(0);
      }
    });

    it.each(ALL.map((example) => [example.request, example] as const))("%s: mood words set light color, ambient and background", (_request, example) => {
      const { scene, words, isComposition } = built(example);
      if (!isComposition) return;
      const background = new THREE.Color(scene.settings.background);
      const lights = scene.entities.filter((entity) => entity.components.Light).map((entity) => new THREE.Color(String(entity.components.Light?.color ?? "#ffffff")));
      expect(lights.length).toBeGreaterThan(0);
      if (/cozy|warm|night/.test(words)) {
        expect(scene.settings.ambientLightIntensity).toBeLessThanOrEqual(0.4);
        expect(Math.max(background.r, background.g, background.b)).toBeLessThan(0.2);
        for (const light of lights) expect(light.r > light.g && light.g > light.b).toBe(true);
      } else if (/sunny|bright|clean|day/.test(words)) {
        expect(scene.settings.ambientLightIntensity).toBeGreaterThanOrEqual(0.6);
        expect(Math.min(background.r, background.g, background.b)).toBeGreaterThan(0.6);
        for (const light of lights) expect(Math.min(light.r, light.g, light.b)).toBeGreaterThan(0.9);
      } else throw new Error(`Composition "${example.request}" names no mood`);
    });

    it.each(ALL.map((example) => [example.request, example] as const))("%s: a composition has a floor or ground, interiors meeting walls around a focal piece", (_request, example) => {
      const { scene, meshes, size, bounds, isComposition } = built(example);
      if (!isComposition) return;
      expect(meshes.some((entity) => Math.abs(bounds(entity).max.y) <= 0.05 && size(entity).y <= 0.3 && size(entity).x >= 2 && size(entity).z >= 2), "floor or ground").toBe(true);
      const focal = (example as { focal?: string }).focal;
      if (!/room|corner|nook|kitchen|interior/.test(example.request)) return;
      const walls = meshes.filter((entity) => size(entity).y >= 2 && Math.min(size(entity).x, size(entity).z) < 0.2);
      expect(walls.length).toBeGreaterThanOrEqual(2);
      expect(walls.some((a) => walls.some((b) => a !== b && (size(a).x < 0.2) !== (size(b).x < 0.2) && bounds(a).intersectsBox(bounds(b))))).toBe(true);
      expect(focal).toBeDefined();
      const center = (root: Entity) => meshes.filter((entity) => ancestors(scene, entity).includes(root)).reduce((box, entity) => box.union(bounds(entity)), new THREE.Box3()).getCenter(new THREE.Vector3()).setY(0);
      const anchor = center(scene.entities.find((entity) => entity.id === focal)!);
      const furniture = scene.entities.filter((entity) => entity.parent === null && entity.id !== focal && !meshes.some((mesh) => walls.includes(mesh) && ancestors(scene, mesh).includes(entity)));
      for (const root of furniture) expect(center(root).distanceTo(anchor), root.name).toBeLessThanOrEqual(1.5);
    });
  });

  it("keeps the static examples compact and the rules general", () => {
    expect(fewShotText().startsWith("## Examples")).toBe(true);
    expect(fewShotText().length).toBeLessThanOrEqual(5_000);
    expect(MODELING_RULES.startsWith("## Modeling well")).toBe(true);
    // Sent on every call; raised from 2,600 for the tether and containment rules.
    expect(MODELING_RULES.length).toBeLessThanOrEqual(2_900);
    for (const principle of ["never empty", "gives off light", "Light child", "mood of the request sets the lighting", "at least two walls that meet", "ground surface", "focal piece"]) expect(MODELING_RULES).toContain(principle);
    // A few library examples together must still leave room for the scene in one request.
    for (const example of EXAMPLE_LIBRARY) expect(examplesText([example]).length, example.request).toBeLessThanOrEqual(6_500);
  });
});

describe("selectExamples", () => {
  it("picks the most relevant library examples by tag, at most two", () => {
    expect(selectExamples("Build a cozy kitchen nook in warm wood and sage green", false).map((example) => example.request)).toEqual(["a cozy reading corner"]);
    expect(selectExamples("Create the house from Up and decorate its insides with furniture", false).map((example) => example.request)).toEqual(["a cozy reading corner", "a small two-story house"]);
    expect(selectExamples("a lemonade stand on a sunny street", false)[0]!.request).toBe("a fruit stall at a sunny market");
    expect(selectExamples("tents around a bonfire at night", true)[0]!.request).toBe("a campfire at night in a forest clearing");
    expect(selectExamples("A snowman in a snowy garden", true).length).toBeLessThanOrEqual(2);
  });

  it("gives an unmatched empty-scene request the fallback composition, and an unmatched edit nothing", () => {
    expect(selectExamples("A red sports car", true).map((example) => example.request)).toEqual(EXAMPLE_LIBRARY.filter((example) => example.fallback).map((example) => example.request));
    expect(selectExamples("make the car blue", false)).toEqual([]);
  });
});
