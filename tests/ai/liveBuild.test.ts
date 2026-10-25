import { describe, expect, it } from "vitest";
import { parsePartialReply } from "../../src/ai/partialJson";
import { LivePreview } from "../../src/ai/livePreview";
import { FEW_SHOT_EXAMPLES } from "../../src/ai/examples";
import { expandBuildOperations } from "../../src/ai/buildTools";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene } from "../../src/scene/types";

const part = (id: string, y: number) => ({ id, name: id, components: { Transform: { position: [0, y, 0] }, Mesh: {}, Material: { color: "#ff0000" } } });
const reply = {
  plan: "A \"tall\" tower\nof boxes",
  summary: "Built a tower.",
  ops: [
    { op: "settings", settings: { background: "#101010" } },
    { op: "assemble", id: "tower", name: "Tower", parent: null, parts: [part("a", 0.5), part("b", 1.5), part("c", 2.5)] },
    { op: "create", id: "ball", name: "Ball", parent: null, components: { Transform: { position: [3, 0.5, 0] }, Mesh: { shape: "sphere" } } }
  ]
};
const text = JSON.stringify(reply);

describe("parsePartialReply", () => {
  it("returns nothing usable before the ops array has a finished object", () => {
    expect(parsePartialReply("")).toEqual({ plan: "", ops: [], complete: 0 });
    expect(parsePartialReply('{"plan":"A \\"ta')).toEqual({ plan: 'A "ta', ops: [], complete: 0 });
    expect(parsePartialReply(text.slice(0, text.indexOf('"ops"') + 10)).ops).toEqual([]);
  });

  it("keeps the plan readable while it streams, even mid-escape", () => {
    expect(parsePartialReply(text.slice(0, text.indexOf("\\n") + 1)).plan).toBe('A "tall" tower');
    expect(parsePartialReply(text).plan).toBe(reply.plan);
  });

  it("grows an assemble part by part and never cuts inside a number array", () => {
    const afterFirstPart = text.indexOf('{"id":"b"');
    const early = parsePartialReply(text.slice(0, afterFirstPart));
    expect(early.complete).toBe(1);
    expect(early.ops).toHaveLength(2);
    expect((early.ops[1] as { parts: unknown[] }).parts).toEqual([part("a", 0.5)]);
    // Cut inside the second part's position array: only the first part is shown.
    const midNumber = parsePartialReply(text.slice(0, text.indexOf("1.5") + 2));
    expect((midNumber.ops[1] as { parts: unknown[] }).parts).toEqual([part("a", 0.5)]);
  });

  it("reports finished ops and hides an op that isn't an assemble until it is finished", () => {
    const midCreate = parsePartialReply(text.slice(0, text.indexOf('"Ball"')));
    expect(midCreate.complete).toBe(2);
    expect(midCreate.ops).toEqual(reply.ops.slice(0, 2));
    const done = parsePartialReply(text);
    expect(done).toEqual({ plan: reply.plan, ops: reply.ops, complete: 3 });
  });

  it("matches the final reply at every cut of a real example", () => {
    const example = JSON.stringify(FEW_SHOT_EXAMPLES[0]!.reply);
    let previous = 0;
    for (let end = 0; end <= example.length; end += 7) {
      const partial = parsePartialReply(example.slice(0, end));
      expect(partial.complete).toBeGreaterThanOrEqual(previous);
      previous = partial.complete;
      for (const [index, op] of partial.ops.slice(0, partial.complete).entries()) expect(op).toEqual(FEW_SHOT_EXAMPLES[0]!.reply.ops[index]);
    }
    expect(parsePartialReply(example).ops).toEqual(FEW_SHOT_EXAMPLES[0]!.reply.ops);
  });
});

describe("LivePreview", () => {
  it("shows a build growing and ends exactly where applying the whole reply would", () => {
    const base = createEmptyScene();
    const preview = new LivePreview();
    const counts: number[] = [];
    let last = base;
    for (let end = 0; end <= text.length; end += 5) {
      const partial = parsePartialReply(text.slice(0, end));
      last = preview.update(base, partial.ops, partial.complete);
      counts.push(last.entities.length);
    }
    expect(counts.every((count, index) => index === 0 || count >= counts[index - 1]!)).toBe(true);
    expect(new Set(counts)).toEqual(new Set([0, 2, 3, 4, 5]));
    const final = applyOps(base, expandBuildOperations(base, reply.ops).ops).scene;
    expect(last.entities).toEqual(final.entities);
    expect(last.settings.background).toBe("#101010");
    expect(base.entities).toEqual([]);
  });

  it("skips parts that don't apply and rebuilds when the base scene changes", () => {
    const preview = new LivePreview();
    const broken = { ...reply.ops[1], parts: [part("a", 0.5), { id: "bad", name: "Bad", components: { Mesh: { shape: "nonsense" } } }, part("c", 2.5)] };
    const shown = preview.update(createEmptyScene(), [broken], 1);
    expect(shown.entities.map((entity) => entity.id)).toEqual(["tower", "a", "c"]);
    const edited = createEmptyScene();
    edited.entities = [{ id: "floor", name: "Floor", parent: null, components: { Transform: {}, Mesh: {} } }];
    expect(preview.update(edited, [broken], 1).entities.map((entity) => entity.id)).toEqual(["floor", "tower", "a", "c"]);
  });
});
