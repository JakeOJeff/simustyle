import { describe, expect, it } from "vitest";
import { findUnclearWords } from "../../src/lang/fuzzy";

const names = new Set(["box1", "ball1", "big", "rock"]);
const texts = (source: string, errorLines?: Set<number>) => findUnclearWords(source, names, errorLines).map((word) => word.text);

describe("findUnclearWords", () => {
  it("flags words the language does not know", () => {
    expect(texts("when game begins\n  move the object near this up 2")).toEqual(["begins", "this"]);
    expect(findUnclearWords("when clicked\n  colour me crimson", names)).toEqual([{ line: 2, column: 13, text: "crimson" }]);
  });

  it("accepts real syntax, scene names, shapes, and declared variables", () => {
    expect(texts("setting speed = 2 from 0 to 10\nwhen game starts\n  set score to 0\n  change score by speed\n  paint box1 red\n  move all cubes up 1\n  spin slowly\n  say \"anything goes\" score")).toEqual([]);
    expect(texts("when clicked\n  paint big rock blue")).toEqual([]);
  });

  it("boxes a broken line that has no unknown word", () => {
    expect(texts("when clicked\n  move up up -- note", new Set([2]))).toEqual(["move up up"]);
  });
});
