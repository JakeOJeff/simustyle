import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FEW_SHOT_EXAMPLES, MODELING_RULES, fewShotText } from "../../src/ai/examples";
import { expandBuildOperations } from "../../src/ai/buildTools";
import { checkGeometry } from "../../src/ai/geometry";
import { meshWorldBounds } from "../../src/ai/quality";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Entity, type Scene } from "../../src/scene/types";
import { worldMatrix } from "../../src/scene/hierarchy";

const gap = (a: THREE.Box3, b: THREE.Box3) => Math.hypot(...(["x", "y", "z"] as const).map((axis) => Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])));

/** Parent chain of an entity, nearest first. */
const ancestors = (scene: Scene, entity: Entity): Entity[] => {
  const chain: Entity[] = [];
  for (let parent = scene.entities.find((candidate) => candidate.id === entity.parent); parent; parent = scene.entities.find((candidate) => candidate.id === parent!.parent)) chain.push(parent);
  return chain;
};

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
    expect(parts.every((entity) => entity.parent !== null)).toBe(true);
    const boxes = parts.map((entity) => meshWorldBounds(scene, entity.id)!);
    for (const [index, box] of boxes.entries()) {
      expect(boxes.some((other, j) => j !== index && gap(box, other) <= 0.05), `${parts[index]!.name} touches another part`).toBe(true);
    }
    expect(Math.abs(Math.min(...boxes.map((box) => box.min.y)))).toBeLessThanOrEqual(0.05);
    // Each top-level object: 2–4 related colors and at most 20 parts (a composition holds several objects).
    for (const root of scene.entities.filter((entity) => entity.parent === null)) {
      const own = parts.filter((entity) => ancestors(scene, entity).includes(root));
      expect(own.length, `${root.name} parts`).toBeLessThanOrEqual(20);
      const colors = new Set(own.map((entity) => entity.components.Material?.color));
      expect(colors.size, `${root.name} colors`).toBeGreaterThanOrEqual(root.name === "Corner" ? 1 : 2);
      expect(colors.size, `${root.name} colors`).toBeLessThanOrEqual(4);
    }
  });

  describe("the reading corner follows the room, shelf, table, light and mood rules", () => {
    const example = FEW_SHOT_EXAMPLES.find((candidate) => candidate.request.includes("reading corner"))!;
    const expanded = expandBuildOperations(createEmptyScene(), example.reply.ops);
    const { scene } = applyOps(createEmptyScene(), expanded.ops);
    const byName = (name: string) => scene.entities.find((entity) => entity.name === name && entity.parent === null)!;
    const bounds = (id: string) => meshWorldBounds(scene, id)!;
    const meshesIn = (root: Entity) => scene.entities.filter((entity) => entity.components.Mesh && ancestors(scene, entity).includes(root));
    /** Meshes in root whose bottom rests (within 0.05 m) on the top of the given support. */
    const restingOn = (root: Entity, support: Entity) => meshesIn(root).filter((entity) => entity !== support &&
      Math.abs(bounds(entity.id).min.y - bounds(support.id).max.y) <= 0.05 && bounds(entity.id).intersectsBox(bounds(support.id).clone().expandByScalar(0.05)));

    it("has two walls that meet", () => {
      const walls = meshesIn(byName("Corner")).filter((entity) => bounds(entity.id).getSize(new THREE.Vector3()).y >= 2);
      expect(walls).toHaveLength(2);
      const [a, b] = walls.map((wall) => bounds(wall.id).getSize(new THREE.Vector3()));
      expect(Math.min(a!.x, a!.z) < 0.2 && Math.min(b!.x, b!.z) < 0.2 && (a!.x < 0.2) !== (b!.x < 0.2)).toBe(true);
      expect(bounds(walls[0]!.id).intersectsBox(bounds(walls[1]!.id))).toBe(true);
    });

    it("fills every shelf row with 5–8 books of varied height, width and color", () => {
      const shelf = byName("Bookshelf");
      const rows = meshesIn(shelf).filter((entity) => entity.name.startsWith("Board")).map((board) => restingOn(shelf, board).filter((entity) => entity.name.includes("Book")));
      const filled = rows.filter((row) => row.length);
      expect(filled.length).toBeGreaterThanOrEqual(2);
      for (const row of filled) {
        expect(row.length).toBeGreaterThanOrEqual(5);
        expect(row.length).toBeLessThanOrEqual(8);
        const sizes = row.map((book) => bounds(book.id).getSize(new THREE.Vector3()));
        expect(new Set(sizes.map((size) => size.y.toFixed(2))).size).toBeGreaterThan(2);
        expect(new Set(sizes.map((size) => size.x.toFixed(2))).size).toBeGreaterThan(2);
        expect(new Set(row.map((book) => book.components.Material?.color)).size).toBeGreaterThan(1);
        expect(row.some((book) => (book.components.Transform?.rotation as number[] | undefined)?.some((angle) => angle !== 0))).toBe(true);
      }
    });

    it("puts 2–4 props on the side table", () => {
      const table = byName("Side Table");
      const props = restingOn(table, meshesIn(table).find((entity) => entity.name === "Top")!);
      expect(props.length).toBeGreaterThanOrEqual(2);
      expect(props.length).toBeLessThanOrEqual(4);
    });

    it("gives the lamp a warm Light child inside an emissive shade, wide end down", () => {
      const lamp = byName("Floor Lamp");
      const light = scene.entities.find((entity) => entity.components.Light && ancestors(scene, entity).includes(lamp))!;
      expect(light).toBeDefined();
      const shade = meshesIn(lamp).find((entity) => entity.name === "Shade")!;
      expect(shade.components.Material?.emissiveIntensity).toBeGreaterThanOrEqual(1);
      expect(shade.components.Material?.emissiveIntensity).toBeLessThanOrEqual(3);
      expect(Number(shade.components.Mesh?.radiusTop)).toBeLessThan(Number(shade.components.Mesh?.radius));
      const at = new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, light.id));
      expect(bounds(shade.id).clone().expandByScalar(0.1).containsPoint(at)).toBe(true);
      const color = new THREE.Color(String(light.components.Light?.color));
      expect(color.r).toBeGreaterThan(color.g);
      expect(color.g).toBeGreaterThan(color.b);
    });

    it("sets cozy lighting and groups furniture near the armchair", () => {
      expect(scene.settings.ambientLightIntensity).toBeCloseTo(0.3);
      const background = new THREE.Color(scene.settings.background);
      expect(Math.max(background.r, background.g, background.b)).toBeLessThan(0.2);
      const center = (root: Entity) => meshesIn(root).reduce((box, entity) => box.union(bounds(entity.id)), new THREE.Box3()).getCenter(new THREE.Vector3());
      const focal = center(byName("Armchair"));
      for (const name of ["Bookshelf", "Side Table", "Floor Lamp"]) expect(center(byName(name)).setY(0).distanceTo(focal.clone().setY(0)), name).toBeLessThanOrEqual(1.5);
    });
  });

  it("stays compact and mentions every request", () => {
    const text = fewShotText();
    expect(text.startsWith("## Examples")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(12_500);
    expect(FEW_SHOT_EXAMPLES).toHaveLength(4);
    for (const example of FEW_SHOT_EXAMPLES) expect(text).toContain(`Request: "${example.request}"`);
    expect(MODELING_RULES.startsWith("## Modeling well")).toBe(true);
    expect(MODELING_RULES.length).toBeLessThanOrEqual(2_400);
    for (const rule of ["rows of 5–8 items", "tables get 2–4 small props", "get a Light child", "#ffb070–#ffd6a0", "ambientLightIntensity ~0.3", "at least two walls meeting", "within 1.5 m of the focal piece"]) expect(MODELING_RULES).toContain(rule);
  });
});
