import { describe, expect, it } from "vitest";
import { checkGeometry } from "../../src/ai/geometry";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp, type Vec3 } from "../../src/scene/types";

const box = (id: string, name: string, parent: string | null, position: Vec3, scale: Vec3): SceneOp =>
  ({ op: "create", id, name, parent, components: { Transform: { position, scale }, Mesh: {}, Material: {} } });
const wheel = (id: string, name: string, parent: string, position: Vec3): SceneOp =>
  ({ op: "create", id, name, parent, components: { Transform: { position, rotation: [90, 0, 0] }, Mesh: { shape: "cylinder", radius: 0.35, height: 0.25 }, Material: {} } });
const group = (id: string, name: string, parent: string | null = null, position: Vec3 = [0, 0, 0]): SceneOp =>
  ({ op: "create", id, name, parent, components: { Transform: { position } } });

function build(ops: SceneOp[], base: Scene = createEmptyScene()): Scene {
  const result = applyOps(base, ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}

/** A grounded car: body y 0.5..1.1, wheels y 0..0.7. */
const car = (wheelParent = "car"): SceneOp[] => [
  group("car", "Car"),
  box("body", "Body", "car", [0, 0.8, 0], [4, 0.6, 1.8]),
  ...(wheelParent === "car" ? [] : [group(wheelParent, "Wheels", "car")]),
  ...[[1.3, 0.8], [1.3, -0.8], [-1.3, 0.8], [-1.3, -0.8]].map(([x, z], i) => wheel(`w${i + 1}`, `Wheel ${i + 1}`, wheelParent, [x!, 0.35, z!]))
];

describe("geometry checker", () => {
  it("flags a detached part with its distance, direction, reference and fix", () => {
    const ops: SceneOp[] = [
      group("car", "Car"),
      box("body", "Body", "car", [0, 2.3, 0], [4, 0.6, 1.8]),
      wheel("w1", "Wheel 1", "car", [1.3, 1.95, 0.8]),
      wheel("w2", "Wheel 2", "car", [1.3, 1.95, -0.8]),
      wheel("w3", "Wheel 3", "car", [-1.3, 1.25, 0.8]),
      wheel("w4", "Wheel 4", "car", [-1.3, 1.95, -0.8])
    ];
    expect(checkGeometry(build(ops), ops, "a car")).toEqual([
      "Car's lowest point is at y=0.9; move it down 0.9 m so it rests on the ground (y=0).",
      "Wheel 3 is 0.4 m below Body and touches nothing; move it up 0.42 m so they overlap ~0.02 m."
    ]);
  });

  it("names lateral separations", () => {
    const ops: SceneOp[] = [...car(), box("mirror", "Mirror", "car", [0, 0.9, 1.2], [0.1, 0.1, 0.2])];
    expect(checkGeometry(build(ops), ops, "a car")).toEqual([
      "Mirror is 0.2 m in front of Body and touches nothing; move it back 0.22 m so they overlap ~0.02 m."
    ]);
  });

  it("accepts touching parts and nested sub-groups", () => {
    for (const ops of [car(), car("wheels")]) expect(checkGeometry(build(ops), ops, "a car")).toEqual([]);
    const split: SceneOp[] = [group("car", "Car"), group("shell", "Shell", "car"), box("body", "Body", "shell", [0, 0.8, 0], [4, 0.6, 1.8]),
      group("wheels", "Wheels", "car"), ...car("wheels").filter((op) => op.op === "create" && op.parent === "wheels")];
    expect(checkGeometry(build(split), split, "a car")).toEqual([]);
    const raised = split.map((op) => op.op === "create" && op.id === "car" ? group("car", "Car", null, [0, 2, 0]) : op);
    expect(checkGeometry(build(raised), raised, "a car")).toEqual(["Car's lowest point is at y=2; move it down 2 m so it rests on the ground (y=0)."]);
  });

  it("flags floating groups unless the request is airborne or the group rests on another object", () => {
    const raised: SceneOp[] = [group("drone", "Drone", null, [0, 1, 0]), box("hull", "Hull", "drone", [0, 0, 0], [0.4, 0.1, 0.4]), box("rotor", "Rotor", "drone", [0, 0.07, 0], [0.6, 0.05, 0.05])];
    const scene = build(raised);
    expect(checkGeometry(scene, raised, "a quadcopter")).toEqual(["Drone's lowest point is at y=0.95; move it down 0.95 m so it rests on the ground (y=0)."]);
    expect(checkGeometry(scene, raised, "a flying drone")).toEqual([]);

    const table = build([group("table", "Table"), box("top", "Top", "table", [0, 0.725, 0], [1.2, 0.05, 0.8]), box("leg", "Leg", "table", [0, 0.35, 0], [0.1, 0.7, 0.1])]);
    const vase = (x: number): SceneOp[] => [group("vase", "Vase", null, [x, 0.75, 0]), box("pot", "Pot", "vase", [0, 0.15, 0], [0.2, 0.3, 0.2]), box("rim", "Rim", "vase", [0, 0.31, 0], [0.22, 0.03, 0.22])];
    expect(checkGeometry(build(vase(0.2), table), vase(0.2), "a vase on the table")).toEqual([]);
    expect(checkGeometry(build(vase(3), table), vase(3), "a vase")).toEqual(["Vase's lowest point is at y=0.75; move it down 0.75 m so it rests on the ground (y=0)."]);
  });

  it("ignores untouched objects and collections of standalone objects", () => {
    const broken: SceneOp[] = [group("old", "Old"), box("a", "A", "old", [0, 3, 0], [1, 1, 1]), box("b", "B", "old", [0, 5, 0], [1, 1, 1]), box("c", "C", "old", [0, 5.5, 0], [1, 0.1, 1])];
    const scene = build(broken);
    const ops: SceneOp[] = car();
    expect(checkGeometry(build(ops, scene), ops, "a car")).toEqual([]);
    const planets: SceneOp[] = [group("sky", "Planets"), box("p1", "P1", "sky", [0, 3, 0], [1, 1, 1]), box("p2", "P2", "sky", [3, 4, 0], [1, 1, 1])];
    expect(checkGeometry(build(planets), planets, "planets in space")).toEqual([]);
    expect(checkGeometry(build(planets), planets, "two boxes").join("\n")).not.toContain("touches nothing");
  });

  it("caps the output", () => {
    const ops: SceneOp[] = Array.from({ length: 20 }, (_, i) => [group(`g${i}`, `G${i}`, null, [i * 3, 2, 0]), box(`m${i}`, `M${i}`, `g${i}`, [0, 0, 0], [1, 1, 1])]).flat();
    const lines = checkGeometry(build(ops), ops, "boxes");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe("...and 9 more geometry problems of the same kind.");
  });
});
