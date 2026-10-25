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

  it("treats a flat ground slab with its top at y=0 as grounding its group", () => {
    const scene = (thickness: number, top = 0, width = 6): SceneOp[] => [group("display", "Cube Display"),
      box("ground", "Ground", "display", [0, top - thickness / 2, 0], [width, thickness, 6]), box("cube", "Cube", "display", [0, top + 0.3, 0], [0.6, 0.6, 0.6])];
    for (const ops of [scene(0.24), scene(0.04)]) expect(checkGeometry(build(ops), ops, "a blue cube")).toEqual([]);
    // Too thick to be a floor, too small, or sunk below the ground plane: still flagged.
    for (const ops of [scene(1), scene(0.24, 0, 0.5), scene(0.24, -0.5)]) expect(checkGeometry(build(ops), ops, "a blue cube").join()).toContain("Cube Display's lowest point");
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

  it("flags separate objects that pass through each other, but not ones resting on or apart from each other", () => {
    const table: SceneOp[] = [group("table", "SideTable"), box("top", "Top", "table", [0, 0.575, 0], [0.6, 0.05, 0.6]), box("cabinet", "Cabinet", "table", [0, 0.275, 0], [0.6, 0.55, 0.6])];
    const lamp = (x: number, y = 0): SceneOp[] => [group("lamp", "FloorLamp", null, [x, y, 0]), box("pole", "Pole", "lamp", [0, 0.75, 0], [0.4, 1.5, 0.4]), box("shade", "Shade", "lamp", [0, 1.6, 0], [0.5, 0.3, 0.5])];
    const base = build(table);
    // The pole spans x 0.1..0.5 against the cabinet's -0.3..0.3: 0.2 m deep.
    expect(checkGeometry(build(lamp(0.3), base), lamp(0.3), "a floor lamp")).toEqual(["FloorLamp overlaps SideTable by 0.2 m; move it apart."]);
    expect(checkGeometry(build(lamp(0.52), base), lamp(0.52), "a floor lamp")).toEqual([]);
    expect(checkGeometry(build(lamp(0.49), base), lamp(0.49), "a floor lamp")).toEqual([]); // 0.01 m snug fit
    expect(checkGeometry(build(lamp(0, 0.6), base), lamp(0, 0.6), "a lamp on the table")).toEqual([]);
    // Only built objects are reported, and parts of one object never count.
    expect(checkGeometry(build(lamp(0.3), base), [], "nothing")).toEqual([]);
    expect(checkGeometry(base, table, "a table")).toEqual([]);
  });

  /** An open room 4×3×4 m: floor, four walls, flat roof. */
  const room = (id = "house"): SceneOp[] => [
    group(id, "House"),
    box(`${id}_floor`, "Floor", id, [0, -0.05, 0], [4, 0.1, 4]),
    box(`${id}_back`, "Back Wall", id, [0, 1.5, -1.95], [4, 3, 0.1]),
    box(`${id}_front`, "Front Wall", id, [0, 1.5, 1.95], [4, 3, 0.1]),
    box(`${id}_left`, "Left Wall", id, [-1.95, 1.5, 0], [0.1, 3, 3.8]),
    box(`${id}_right`, "Right Wall", id, [1.95, 1.5, 0], [0.1, 3, 3.8]),
    box(`${id}_roof`, "Roof", id, [0, 3.05, 0], [4, 0.1, 4])
  ];
  /** A thick rug that sinks into the house floor (so it does not merely rest on it) and a chair. */
  const corner = (x: number, width = 1.5): SceneOp[] => [group("corner", "Corner", null, [x, 0, 0]), box("rug", "Rug", "corner", [0, -0.04, 0], [width, 0.12, width]), box("chair", "Chair", "corner", [0, 0.5, 0], [0.8, 1, 0.8])];

  it("treats an object inside another's interior as contained, not overlapping", () => {
    const inside = [...corner(0), ...room()];
    expect(checkGeometry(build(inside), inside, "build a house around the corner")).toEqual([]);
    const through = [...corner(1.6), ...room()];
    expect(checkGeometry(build(through), through, "build a house around the corner")).toEqual(["Corner overlaps House by 0.1 m; move it apart."]);
    // Buried inside one solid part is still an overlap.
    const buried = [box("big", "Big Block", null, [0, 1, 0], [2, 2, 2]), box("small", "Small Block", null, [0, 1, 0], [0.5, 0.5, 0.5])];
    expect(checkGeometry(build(buried), buried, "two blocks")).toEqual(["Big Block overlaps Small Block by 0.5 m; move it apart."]);
  });

  it("flags objects moved inside a container they stick out of", () => {
    const fits = [...corner(0), ...room()];
    const move: SceneOp = { op: "update", id: "corner", parent: "house", components: {} };
    expect(checkGeometry(build([move], build(fits)), [...fits, move], "put the corner inside the house")).toEqual([]);
    const small = [...corner(0, 4.3), ...room()];
    expect(checkGeometry(build([move], build(small)), [...small, move], "put the corner inside the house")).toEqual([
      "Corner was moved inside House but sticks out of it by 0.15 m; make House bigger (0.5 m clearance on every side and above) or center it on Corner."
    ]);
  });

  it("flags held floating objects with no string reaching an anchor", () => {
    const balloon = (id: string, name = "Balloon"): SceneOp => ({ op: "create", id, name, parent: null, components: { Transform: { position: [0, 3, 0] }, Mesh: { shape: "sphere", radius: 0.3 }, Material: {} } });
    const string = (bottom: number): SceneOp => ({ op: "create", id: "string", name: "String", parent: null,
      components: { Transform: { position: [0, (bottom + 2.7) / 2, 0] }, Mesh: { shape: "cylinder", radius: 0.01, height: 2.7 - bottom }, Material: {} } });
    const post = box("post", "Post", null, [0, 0.5, 0], [0.2, 1, 0.2]);
    const tied = [post, balloon("b"), string(1)];
    expect(checkGeometry(build(tied), tied, "a balloon tied to a post")).toEqual([]);
    const loose = [post, balloon("b")];
    expect(checkGeometry(build(loose), loose, "a balloon")).toEqual(["Balloon floats with nothing holding it; add a thin cylinder (radius 0.01) from it to its anchor point."]);
    const dangling = [post, balloon("b"), string(1.7)];
    expect(checkGeometry(build(dangling), dangling, "a balloon")).toEqual(["Balloon: its string does not reach anything; extend the thin cylinder until it touches its anchor point."]);
    const free = [balloon("hot", "Hot Air Balloon")];
    expect(checkGeometry(build(free), free, "a hot air balloon")).toEqual([]);
  });

  it("flags stray specks outside an object group, but not small parts a group holds", () => {
    const ops: SceneOp[] = [...car(), box("dot", "Dot", null, [3, 0.015, 0], [0.03, 0.03, 0.03]),
      box("button", "Button", "body", [0, 0.31, 0], [0.04 / 4, 0.03 / 0.6, 0.04 / 1.8]), box("bolt", "Bolt", "car", [0, 1.11, 0], [0.04, 0.04, 0.04])];
    expect(checkGeometry(build(ops), ops, "a car")).toEqual([
      "Dot is a speck (0.03×0.03×0.03 m), too small to see; delete it or make it at least 0.05 m on one side.",
      "Button is a speck (0.04×0.03×0.04 m), too small to see; delete it or make it at least 0.05 m on one side."
    ]);
    const thin: SceneOp[] = [box("rod", "Rod", null, [0, 0.3, 0], [0.02, 0.6, 0.02])];
    expect(checkGeometry(build(thin), thin, "a rod")).toEqual([]);
  });

  it("caps the output", () => {
    const ops: SceneOp[] = Array.from({ length: 20 }, (_, i) => [group(`g${i}`, `G${i}`, null, [i * 3, 2, 0]), box(`m${i}`, `M${i}`, `g${i}`, [0, 0, 0], [1, 1, 1])]).flat();
    const lines = checkGeometry(build(ops), ops, "boxes");
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe("...and 9 more geometry problems of the same kind.");
  });
});
