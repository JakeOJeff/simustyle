import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { detailPrompt, fitDetailObject, MAX_DETAIL_ITEMS, parseDetailItems, placeLiveDetail, type DetailItem } from "../../src/ai/detailPass";
import { meshWorldBounds } from "../../src/ai/quality";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type SceneOp, type Vec3 } from "../../src/scene/types";

const item = (overrides: Partial<DetailItem> = {}): DetailItem => ({ id: "chair", name: "Chair", description: "a wooden chair", position: [2, 0, -1], rotation: [0, 90, 0], size: [0.5, 1, 0.5], parent: null, ...overrides });
const box = (id: string, parent: string | null, position: Vec3, scale: Vec3, extra: Record<string, Record<string, unknown>> = {}): SceneOp =>
  ({ op: "create", id, name: id, parent, components: { Transform: { position, scale }, Mesh: {}, Material: { color: "#884422" }, ...extra } });

describe("parseDetailItems", () => {
  it("keeps valid objects, fills defaults and reports the rest", () => {
    const { items, errors } = parseDetailItems([
      { id: "bed", name: "Bed", description: "double bed", position: [0, 0, 0], size: [1.6, 1, 2.1] },
      { id: "lamp", name: "Lamp", position: [1, 0.6, 0], size: [0.3, 0.5, 0.3], rotation: [0, 45, 0], parent: "bed" },
      { id: "bad id!", name: "X", position: [0, 0, 0], size: [1, 1, 1] },
      { id: "flat", name: "Flat", position: [0, 0, 0], size: [1, 0, 1] },
      { id: "bed", name: "Again", position: [0, 0, 0], size: [1, 1, 1] }
    ]);
    expect(items.map((entry) => [entry.id, entry.description, entry.rotation, entry.parent])).toEqual([["bed", "double bed", [0, 0, 0], null], ["lamp", "Lamp", [0, 45, 0], "bed"]]);
    expect(errors).toHaveLength(3);
    expect(errors[2]).toContain("repeats the id 'bed'");
    expect(parseDetailItems(undefined)).toEqual({ items: [], errors: [] });
    expect(parseDetailItems("chair").errors).toHaveLength(1);
  });

  it("builds at most MAX_DETAIL_ITEMS objects and says so", () => {
    const many = Array.from({ length: MAX_DETAIL_ITEMS + 3 }, (_, i) => ({ id: `o${i}`, name: `O${i}`, position: [i, 0, 0], size: [0.5, 0.5, 0.5] }));
    const { items, errors } = parseDetailItems(many);
    expect(items).toHaveLength(MAX_DETAIL_ITEMS);
    expect(errors.join()).toContain("group small props");
  });
});

describe("fitDetailObject", () => {
  // Built off-center and slightly above y=0, as a model might: seat 0.45x0.05x0.45 on four legs, plus a back.
  const chair: SceneOp[] = [
    { op: "create", id: "chair", name: "Wrong name", parent: null, components: { Transform: { position: [9, 9, 9] } } },
    box("seat", "chair", [1, 0.5, 1], [0.45, 0.05, 0.45]),
    box("chair_leg", "chair", [1, 0.26, 1], [0.04, 0.47, 0.04]),
    box("back", "seat", [0, 0.25, -0.2], [0.45, 0.45, 0.04], { RigidBody: { anchored: true }, Joint: { type: "fixed", target: "seat" } })
  ];

  it("prefixes ids, follows references, re-centers on the base and takes the layout slot", () => {
    const { ops, notes } = fitDetailObject(item(), chair);
    expect(notes).toEqual([]);
    expect(ops.map((op) => op.op === "create" && [op.id, op.parent])).toEqual([["chair", null], ["chair_seat", "chair"], ["chair_leg", "chair"], ["chair_back", "chair_seat"]]);
    const root = ops[0] as Extract<SceneOp, { op: "create" }>;
    expect(root.name).toBe("Chair");
    expect(root.components.Transform).toEqual({ position: [2, 0, -1], rotation: [0, 90, 0] });
    expect((ops[3] as Extract<SceneOp, { op: "create" }>).components.Joint?.target).toBe("chair_seat");
    // Placed at the origin without its layout transform, the object's base center is the origin.
    const local = applyOps(createEmptyScene(), ops.map((op) => op.op === "create" && op.id === "chair" ? { ...op, components: { Transform: {} } } : op)).scene;
    const bounds = local.entities.filter((entity) => entity.components.Mesh).reduce((total, entity) => total.union(meshWorldBounds(local, entity.id)!), new THREE.Box3());
    expect(bounds.min.y).toBeCloseTo(0);
    expect((bounds.min.x + bounds.max.x) / 2).toBeCloseTo(0);
    expect((bounds.min.z + bounds.max.z) / 2).toBeCloseTo(0);
  });

  it("scales an object down uniformly only when it overflows its box by more than 15%", () => {
    const small = fitDetailObject(item({ size: [0.3, 0.6, 0.3] }), chair);
    expect(small.notes[0]).toMatch(/Chair was scaled to \d+% to fit/);
    const scale = (small.ops[0] as Extract<SceneOp, { op: "create" }>).components.Transform?.scale as number[];
    expect(scale[0]).toBeCloseTo(0.3 / 0.45, 2);
    expect(fitDetailObject(item({ size: [0.42, 0.75, 0.42] }), chair).notes).toEqual([]);
  });

  it("reports replies with no object or no visible parts", () => {
    expect(fitDetailObject(item(), []).notes[0]).toContain("no object");
    expect(fitDetailObject(item(), [chair[0]!]).notes[0]).toContain("no visible parts");
  });
});

describe("detail pass messages and live view", () => {
  it("names the object, its box and the rest of the scene", () => {
    const items = [item(), item({ id: "desk", name: "Desk", size: [1.2, 0.75, 0.6] })];
    const prompt = detailPrompt("a study", "desk by the window", items, items[0]!);
    for (const fragment of ["id: chair", "0.5 wide (x) × 1 tall (y) × 0.5 deep (z)", "Desk (1.2×0.75×0.6 m)", 'Start every part id with "chair_"', "15–60 parts", "nothing under 5 cm", "desk by the window"]) expect(prompt).toContain(fragment);
    expect(prompt).not.toContain("Chair (0.5");
  });

  it("shows a growing assemble in its layout slot and drops anything else", () => {
    const live = placeLiveDetail(item(), [{ op: "settings", settings: {} }, { op: "assemble", id: "x", name: "x", parent: null, parts: [{ id: "p" }] }]);
    expect(live).toEqual([{ op: "assemble", id: "chair", name: "Chair", parent: null, parts: [{ id: "p" }], transform: { position: [2, 0, -1], rotation: [0, 90, 0] } }]);
  });
});
