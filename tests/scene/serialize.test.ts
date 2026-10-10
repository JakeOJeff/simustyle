import { describe, expect, it } from "vitest";
import { applyOps } from "../../src/scene/applyOps";
import { deserializeScene, serializeScene } from "../../src/scene/serialize";
import { createEmptyScene } from "../../src/scene/types";

describe("scene serialization", () => {
  it("omits default component and settings fields and restores them on load", () => {
    const result = applyOps(createEmptyScene(), [{
      op: "create",
      id: "box",
      name: "Box",
      parent: null,
      components: { Transform: {}, Mesh: { shape: "box" }, Material: { color: "#ffffff", roughness: 0.2 } }
    }]);
    expect(result.errors).toEqual([]);
    const serialized = serializeScene(result.scene);
    expect(serialized).not.toContain('"position"');
    expect(serialized).not.toContain('"roughness": 0.6');
    expect(serialized).not.toContain('"gravity"');
    const restored = deserializeScene(serialized);
    expect(restored).toEqual(result.scene);
  });

  it("reports malformed JSON and invalid scene data clearly", () => {
    expect(() => deserializeScene("{")).toThrow("Scene file is not valid JSON");
    expect(() => deserializeScene(JSON.stringify({ version: 1, settings: {}, entities: [{}] }))).toThrow("Scene file is invalid");
  });
});
