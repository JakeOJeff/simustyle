import { describe, expect, it } from "vitest";
import { frameThreeQuarter, summaryTable, usageTotals, type EvalRow } from "../../scripts/ai-eval/report";
import { containedAndTethered } from "../../scripts/ai-eval/checks";
import type { CallCharge } from "../../src/ai/credits";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp, type Vec3 } from "../../src/scene/types";

const charge = (task: CallCharge["task"], model: string, promptTokens: number, cachedTokens: number, completionTokens: number, costUsd: number): CallCharge =>
  ({ task, model, usage: { promptTokens, cachedTokens, completionTokens }, costUsd, credits: 0 });

describe("ai:eval report", () => {
  it("frames every build from the same 3/4 direction, far enough to fit it", () => {
    const small = frameThreeQuarter({ min: [-1, 0, -1], max: [1, 2, 1] }, 45, 1.6);
    const big = frameThreeQuarter({ min: [-5, 0, -5], max: [5, 10, 5] }, 45, 1.6);
    expect(small.target).toEqual([0, 1, 0]);
    const direction = (view: typeof small) => view.position.map((value, axis) => value - view.target[axis]!);
    const [a, b] = [direction(small), direction(big)];
    expect(a[0]! / a[1]!).toBeCloseTo(b[0]! / b[1]!);
    expect(a[0]).toBeCloseTo(a[2]!);
    expect(a[0]).toBeGreaterThan(0);
    expect(a[1]).toBeGreaterThan(0);
    expect(Math.hypot(...b)).toBeCloseTo(Math.hypot(...a) * 5);
    // The bounding sphere (radius √3 ≈ 1.73) fits inside the vertical field of view.
    expect(Math.hypot(...a) * Math.sin((45 * Math.PI) / 360)).toBeGreaterThan(Math.sqrt(3));
    expect(frameThreeQuarter(null, 45, 1.6)).toEqual({ position: [7, 6, 9], target: [0, 0.8, 0] });
  });

  it("totals usage per prompt and prints one row per prompt plus totals", () => {
    const totals = usageTotals([charge("scene_draft", "gpt-6-luna", 9000, 7000, 3000, 0.0018), charge("scene_review", "gpt-6-sol", 11000, 7000, 2500, 0.034)]);
    expect({ ...totals, costUsd: Number(totals.costUsd.toFixed(6)) }).toEqual({ calls: ["scene_draft gpt-6-luna", "scene_review gpt-6-sol"], promptTokens: 20000, cachedTokens: 14000, completionTokens: 5500, costUsd: 0.0358 });
    const rows: EvalRow[] = [
      { prompt: "A red sports car", ok: true, ops: 3, parts: 14, ...totals, seconds: 41 },
      { prompt: "A snowman in a snowy garden", ok: false, ops: 0, parts: 0, ...usageTotals([charge("scene_draft", "gpt-6-luna", 9000, 0, 4000, 0.003)]), seconds: 30, error: "cut off" }
    ];
    const lines = summaryTable(rows).split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^Prompt\s+OK\s+Ops\s+Parts\s+Models\s+In tok\s+Cached\s+Out tok\s+Cost \$\s+Secs$/);
    expect(lines[2]).toContain("gpt-6-luna×1, gpt-6-sol×1");
    expect(lines[2]).toContain("0.0358");
    expect(lines[3]).toContain("NO");
    expect(lines[4]).toMatch(/^Total\s+1\/2\s+3\s+14\s+gpt-6-luna×2, gpt-6-sol×1\s+29000\s+14000\s+9500\s+0\.0388\s+71$/);
  });

  it("marks a build whose pass check failed", () => {
    const row: EvalRow = { prompt: "corner → house", ok: true, ops: 9, parts: 30, ...usageTotals([]), seconds: 50, checks: ["Corner is not inside House."] };
    const lines = summaryTable([row, { ...row, checks: [] }]).split("\n");
    expect(lines[2]).toMatch(/^corner → house\s+FAIL/);
    expect(lines[3]).toMatch(/^corner → house\s+yes/);
    expect(lines[4]).toMatch(/^Total\s+1\/2/);
  });
});

describe("ai:eval containment check", () => {
  const box = (id: string, name: string, parent: string | null, position: Vec3, scale: Vec3, mesh: Record<string, unknown> = {}): SceneOp =>
    ({ op: "create", id, name, parent, components: { Transform: { position, scale }, Mesh: mesh, Material: {} } });
  const build = (ops: SceneOp[], base = createEmptyScene()): Scene => {
    const result = applyOps(base, ops);
    expect(result.errors).toEqual([]);
    return result.scene;
  };
  const before = build([{ op: "create", id: "corner", name: "Corner", parent: null, components: { Transform: {} } },
    box("rug", "Rug", "corner", [0, 0.02, 0], [1.5, 0.04, 1.5]), box("chair", "Chair", "corner", [0, 0.5, 0], [0.8, 1, 0.8])]);
  /** A 4×3×4 m house with a flat roof at y 3..3.1 and one balloon whose string ends at stringBottom. */
  const house = (balloonX: number, stringBottom: number): SceneOp[] => [
    { op: "create", id: "house", name: "House", parent: null, components: { Transform: {} } },
    box("floor", "Floor", "house", [0, -0.05, 0], [4, 0.1, 4]),
    box("wall", "Back Wall", "house", [0, 1.5, -1.95], [4, 3, 0.1]),
    box("roof", "Roof", "house", [0, 3.05, 0], [4, 0.1, 4]),
    box("balloon", "Balloon", "house", [balloonX, 5, 0], [1, 1, 1], { shape: "sphere", radius: 0.3 }),
    box("string", "String", "house", [balloonX, (stringBottom + 4.7) / 2, 0], [1, 1, 1], { shape: "cylinder", radius: 0.01, height: 4.7 - stringBottom })
  ];

  it("passes when the earlier scene is inside the new building and its balloons are tied to the roof", () => {
    expect(containedAndTethered(before, build(house(0, 3.1), before))).toEqual([]);
  });

  it("reports contents left outside and balloons tied elsewhere", () => {
    const after = build([...house(3, 0), { op: "update", id: "corner", components: { Transform: { position: [10, 0, 0] } } }], before);
    expect(containedAndTethered(before, after)).toEqual(["Corner is not inside House.", "Balloon is not tethered to the roof of House."]);
    expect(containedAndTethered(before, before)).toEqual(["No new building was created."]);
  });
});
