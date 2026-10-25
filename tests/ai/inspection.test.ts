import { describe, expect, it } from "vitest";
import { MAX_CHUNK_AREA, MAX_CHUNK_SIZE, chunkDescription, fixRequestText, isolateScene, planChunks, rootsOf, strayParts } from "../../src/ai/inspection";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp, type Vec3 } from "../../src/scene/types";

const mesh = (id: string, parent: string | null, position: Vec3, scale: Vec3 = [0.2, 0.2, 0.2]): SceneOp =>
  ({ op: "create", id, name: id.replace(/_\d+$/, ""), parent, components: { Transform: { position, scale }, Mesh: {}, Material: { color: "#7a5230" } } });
const group = (id: string, parent: string | null, position: Vec3 = [0, 0, 0]): SceneOp =>
  ({ op: "create", id, name: id, parent, components: { Transform: { position } } });

function build(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}

/** A floor, a chair group, two mugs side by side and a far lamp, and a 6.2 m wide house of 71 parts in two wings. */
function town(): Scene {
  return build([
    mesh("floor", null, [0, -0.05, 0], [20, 0.1, 20]),
    group("chair", null, [2, 0, 0]), mesh("seat", "chair", [0, 0.45, 0], [0.5, 0.1, 0.5]), mesh("leg_0", "chair", [0.2, 0.2, 0.2], [0.05, 0.4, 0.05]),
    mesh("mug_a", null, [5, 0.05, 0], [0.1, 0.1, 0.1]), mesh("mug_b", null, [5.3, 0.05, 0], [0.1, 0.1, 0.1]), mesh("lamp", null, [-6, 0.5, 0]),
    group("house", null, [0, 0, -8]), group("west", "house", [-3, 0, 0]), group("east", "house", [3, 0, 0]),
    ...Array.from({ length: 35 }, (_, index) => mesh(`west_part_${index}`, "west", [0, index * 0.1, 0])),
    ...Array.from({ length: 35 }, (_, index) => mesh(`east_part_${index}`, "east", [0, index * 0.1, 0])),
    mesh("door", "house", [0, 1, 1], [1, 2, 0.1])
  ]);
}

describe("inspection chunks", () => {
  it("finds the top-level roots of touched ids", () => {
    expect(rootsOf(town(), ["leg_0", "west_part_3", "mug_a", "seat", "ghost"])).toEqual(["chair", "mug_a", "house"]);
  });

  it("chunks each object, splits a large structure by sub-group, clusters near loose parts and skips the floor", () => {
    const scene = town();
    const chunks = planChunks(scene, scene.entities.filter((entity) => !entity.parent).map((entity) => entity.id));
    const byName = Object.fromEntries(chunks.map((chunk) => [chunk.name, chunk]));
    expect(Object.keys(byName).sort()).toEqual(["chair", "east", "house (other parts)", "lamp", "mug_a, mug_b", "west"].sort());
    expect(byName.west).toMatchObject({ ids: ["west"], parts: 35 });
    expect(byName["house (other parts)"]!.ids).toEqual(["door"]);
    expect(byName["mug_a, mug_b"]!.ids).toEqual(["mug_a", "mug_b"]);
    expect(chunks[0]!.parts).toBeGreaterThanOrEqual(chunks.at(-1)!.parts);
    expect(MAX_CHUNK_SIZE).toBeLessThan(6.2);
    // A 70-part car-sized object stays one chunk.
    const car = build([group("car", null), group("wheels", "car"), ...Array.from({ length: 70 }, (_, index) => mesh(`car_part_${index}`, index < 4 ? "wheels" : "car", [index * 0.05, 0.5, 0]))]);
    expect(planChunks(car, ["car"]).map((chunk) => chunk.ids)).toEqual([["car"]]);
    // A 4×4 m room splits into its furniture; once split it stays split, however small it gets.
    const room = build([group("room", null), group("sofa", "room"), mesh("cushion", "sofa", [1, 0.4, 1]), mesh("wall", "room", [0, 1.5, -2], [4, 3, 0.1]), mesh("rug", "room", [0, 0.01, 0], [4, 0.02, 4])]);
    expect(16).toBeGreaterThan(MAX_CHUNK_AREA);
    const split = new Set<string>();
    expect(planChunks(room, ["room"], split).map((chunk) => chunk.name).sort()).toEqual(["room (other parts)", "sofa"]);
    expect([...split]).toEqual(["room"]);
    const shrunk = applyOps(room, [{ op: "delete", id: "rug" }, { op: "update", id: "wall", components: { Transform: { position: [0, 1.5, -2], scale: [1, 1, 0.1] } } }]).scene;
    expect(planChunks(shrunk, ["room"]).map((chunk) => chunk.name)).toEqual(["room"]);
    expect(planChunks(shrunk, ["room"], split).map((chunk) => chunk.name).sort()).toEqual(["room (other parts)", "sofa"]);
    expect(planChunks(scene, ["floor"])).toEqual([]);
  });

  it("keeps a chunk's key stable and describes its size and place", () => {
    const scene = town();
    const [chair] = planChunks(scene, ["chair"]);
    expect(chair!.key).toBe("chair");
    expect(chunkDescription(scene, chair!)).toMatch(/^"chair" \(ids chair\), 2 mesh parts, 0\.5×0\.5×0\.5 m, centered at x 2/);
  });

  it("isolates a chunk with its ancestors' transforms but none of their meshes or other objects", () => {
    const scene = build([group("house", null, [0, 0, -8]), mesh("roof", "house", [0, 3, 0]), group("west", "house", [-3, 0, 0]), mesh("wall", "west", [0, 1, 0]), mesh("lamp", null, [5, 0.5, 0]),
      { op: "create", id: "sun", name: "Sun", parent: null, components: { Transform: {}, Light: { type: "directional" } } }]);
    const isolated = isolateScene(scene, ["west"]);
    expect(isolated.entities.map((entity) => entity.id)).toEqual(["house", "west", "wall"]);
    expect(isolated.entities[0]!.components).toEqual({ Transform: scene.entities[0]!.components.Transform });
    const withRoof = isolateScene(scene, ["roof", "west"]);
    expect(withRoof.entities.map((entity) => entity.id)).toEqual(["house", "roof", "west", "wall"]);
  });

  it("finds parts a fix created or moved outside the build", () => {
    const before = build([mesh("floor", null, [0, -0.05, 0], [4, 0.1, 4]), group("table", null), mesh("top", "table", [0, 0.75, 0], [1, 0.05, 1])]);
    const fix = [{ op: "update", id: "table", components: { Transform: { position: [0.5, 0, 0] } } }, mesh("plank", "table", [0, 0.75, 0.5], [0.1, 0.02, 0.6])] as SceneOp[];
    expect(strayParts(before, applyOps(before, fix).scene, fix)).toEqual([]);
    // World coordinates under a parent: the parent's offset puts the plank 3 m outside the 4 m room.
    const misplaced = [{ op: "update", id: "table", components: { Transform: { position: [3, 0, 0] } } }, mesh("plank", "table", [0, 0.75, 0], [0.1, 0.02, 0.6])] as SceneOp[];
    expect(strayParts(before, applyOps(before, misplaced).scene, misplaced)).toEqual(["top", "plank"]);
  });

  it("asks the fix pass to change only what the issues need", () => {
    const text = fixRequestText("a chair", 'chunk "Chair"', { score: 5, issues: [] }, "## Reference concept\nspec");
    for (const phrase of ['inspected renders of chunk "Chair" from every side', '"a chair"', "5/10", "skip those", "Return only the ops that change it", "## Reference concept"]) expect(text).toContain(phrase);
    const rebuild = fixRequestText("a chair", 'chunk "Chair"', { score: 3, issues: [] }, undefined, ["chair"]);
    expect(rebuild).toContain('Rebuild it whole: delete "chair"');
    expect(rebuild).not.toContain("Return only the ops that change it");
  });
});
