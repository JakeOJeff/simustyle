import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FEW_SHOT_EXAMPLES, MODELING_RULES, fewShotText } from "../../src/ai/examples";
import { expandBuildOperations } from "../../src/ai/buildTools";
import { checkGeometry } from "../../src/ai/geometry";
import { meshWorldBounds } from "../../src/ai/quality";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene } from "../../src/scene/types";

const gap = (a: THREE.Box3, b: THREE.Box3) => Math.hypot(...(["x", "y", "z"] as const).map((axis) => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])));

describe("few-shot modeling examples", () => {
  it.each(FEW_SHOT_EXAMPLES.map((example) => [example.request, example] as const))("%s builds a valid, connected, grounded object", (request, example) => {
    expect(Object.keys(example.reply)).toEqual(["plan", "summary", "ops"]);
    expect(example.reply.plan.trim()).not.toBe("");
    const expanded = expandBuildOperations(createEmptyScene(), example.reply.ops);
    expect(expanded.errors).toEqual([]);
    const applied = applyOps(createEmptyScene(), expanded.ops);
    expect(applied.errors).toEqual([]);
    const { scene } = applied;
    expect(checkGeometry(scene, expanded.ops, request)).toEqual([]);

    const parts = scene.entities.filter((entity) => entity.components.Mesh);
    expect(parts.length).toBeGreaterThanOrEqual(6);
    expect(parts.length).toBeLessThanOrEqual(20);
    expect(parts.every((entity) => entity.parent !== null)).toBe(true);
    const boxes = parts.map((entity) => meshWorldBounds(scene, entity.id)!);
    for (const [index, box] of boxes.entries()) {
      expect(boxes.some((other, j) => j !== index && gap(box, other) <= 0.05), `${parts[index]!.name} touches another part`).toBe(true);
    }
    expect(Math.abs(Math.min(...boxes.map((box) => box.min.y)))).toBeLessThanOrEqual(0.05);
    const colors = new Set(parts.map((entity) => entity.components.Material?.color));
    expect(colors.size).toBeGreaterThanOrEqual(2);
    expect(colors.size).toBeLessThanOrEqual(4);
  });

  it("stays compact and mentions every request", () => {
    const text = fewShotText();
    expect(text.startsWith("## Examples")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(5500);
    expect(FEW_SHOT_EXAMPLES).toHaveLength(3);
    for (const example of FEW_SHOT_EXAMPLES) expect(text).toContain(`Request: "${example.request}"`);
    expect(MODELING_RULES.startsWith("## Modeling well")).toBe(true);
    expect(MODELING_RULES.length).toBeLessThanOrEqual(1400);
  });
});
