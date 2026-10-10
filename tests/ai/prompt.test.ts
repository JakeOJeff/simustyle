import { describe, expect, it } from "vitest";
import { componentSchemas } from "../../src/registry";
import { createEmptyScene } from "../../src/scene/types";
import { buildResponseJsonSchema, buildSystemPrompt, describeComponentSchemas, SCRIPT_AGENT_SPEC } from "../../src/ai/prompt";

describe("AI scene prompt construction", () => {
  it("includes registered component fields and requirements from the live registry", () => {
    const prompt = buildSystemPrompt(createEmptyScene());

    for (const [name, schema] of Object.entries(componentSchemas)) {
      expect(prompt).toContain(`"${name}"`);
      expect(prompt).toContain(schema.description);
      for (const field of Object.keys(schema.fields)) expect(prompt).toContain(`"${field}"`);
    }
    expect(prompt).toContain('"requires": [\n      "Transform",\n      "Mesh"');
    expect(prompt).toContain("## Current scene");
    expect(prompt).toContain('"version": 1');
  });

  it("includes the script grammar and safe runtime capabilities", () => {
    const prompt = buildSystemPrompt(createEmptyScene());
    expect(prompt).toContain(SCRIPT_AGENT_SPEC);
    expect(prompt).toContain("self.rigidbody.applyImpulse");
    expect(prompt).toContain("while (maximum 10,000 iterations per loop)");
    expect(prompt).toContain("Do not put JavaScript");
  });

  it("describes script parameters as managed data and serializes an existing scene", () => {
    const scene = createEmptyScene();
    scene.entities.push({
      id: "ball", name: "Ball", parent: null,
      components: { Transform: { position: [1, 2, 3] }, Script: { source: "param speed: float 0..10 = 3", parameters: { speed: 4 } } }
    });
    const prompt = buildSystemPrompt(scene);
    const descriptions = describeComponentSchemas();

    expect((descriptions.Script as { managedFields: unknown }).managedFields).toEqual({ parameters: "scriptParameters" });
    expect(prompt).toContain('"id": "ball"');
    expect(prompt).toContain('"speed": 4');
  });
});

describe("AI response JSON schema", () => {
  it("allows all current operation kinds and strict field constraints", () => {
    const schema = buildResponseJsonSchema();
    const serialized = JSON.stringify(schema);

    for (const op of ["create", "update", "delete", "settings"]) expect(serialized).toContain(`"const":"${op}"`);
    expect(serialized).toContain('"minimum":0.01');
    expect(serialized).toContain('"maximum":1000');
    expect(serialized).toContain('"enum":["box","sphere","cylinder","capsule","plane","cone"]');
    expect(serialized).toContain('"parameters"');
    expect(serialized).toContain('"additionalProperties":false');
  });
});
