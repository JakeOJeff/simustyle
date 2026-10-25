import { describe, expect, it } from "vitest";
import { missingRequested } from "../../src/ai/requested";
import { applyOps } from "../../src/scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp } from "../../src/scene/types";

const named = (id: string, name: string, parent: string | null = null): SceneOp => ({ op: "create", id, name, parent, components: { Transform: {} } });
function build(ops: SceneOp[]): Scene {
  const result = applyOps(createEmptyScene(), ops);
  expect(result.errors).toEqual([]);
  return result.scene;
}

describe("missingRequested", () => {
  const playground = build([named("pg", "Playground"), named("slide", "Slide", "pg"), named("swings", "Swing Set", "pg"), named("seat", "Seat", "swings")]);

  it("reports a requested object nothing is named for, as a correction", () => {
    expect(missingRequested(playground, ["slide", "swings", "dome climber"])).toEqual(["Requested 'dome climber' is missing; build it, named for what it is, before any extras."]);
  });

  it("matches word forms, ignores articles and counts, and reads names together with their ancestors", () => {
    const scene = build([named("climber", "Climbing Dome"), named("case", "Display Case"), named("pastry", "Pastry", "case"), named("mug", "Mug 1"), named("slides", "Slides")]);
    expect(missingRequested(scene, ["a dome climber", "the pastry case", "three mugs", "slide"])).toEqual([]);
    // Short words must match whole: "swing" is not met by "Sw".
    expect(missingRequested(build([named("s", "Sw")]), ["swing"])).toHaveLength(1);
  });

  it("counts planned detail objects, which are built next", () => {
    expect(missingRequested(playground, ["dome climber"], [{ name: "Dome Climber", parent: "pg" }])).toEqual([]);
  });

  it("ignores an empty list or items with no identifying words", () => {
    expect(missingRequested(playground, [])).toEqual([]);
    expect(missingRequested(playground, ["a few"])).toEqual([]);
  });
});
