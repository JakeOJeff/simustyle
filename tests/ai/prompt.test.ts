import { describe, expect, it } from "vitest";
import { componentSchemas } from "../../src/registry";
import { createEmptyScene } from "../../src/scene/types";
import { buildResponseJsonSchema, buildSceneUserMessage, buildSystemPrompt, SCRIPT_AGENT_SPEC } from "../../src/ai/prompt";
import { MODELING_RULES, fewShotText } from "../../src/ai/examples";

describe("AI scene prompt construction", () => {
  it("includes registered component fields and requirements from the live registry", () => {
    const prompt = buildSystemPrompt();

    for (const [name, schema] of Object.entries(componentSchemas)) {
      const requires = schema.requires?.length ? ` (requires ${schema.requires.join(", ")})` : "";
      expect(prompt).toContain(`${name}${requires}: ${schema.description}`);
      for (const field of Object.keys(schema.fields)) expect(prompt).toMatch(new RegExp(`[ ;]${field} `));
    }
    expect(prompt).toContain("Material (requires Transform, Mesh)");
    expect(prompt).toContain('shape box|sphere|cylinder|capsule|plane|cone ="box"');
    expect(buildSceneUserMessage(createEmptyScene(), "add a cube")).toContain("## Current scene\nSettings (only non-default): {}\nObjects: none yet.");
  });

  it("includes the script grammar and safe runtime capabilities", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(SCRIPT_AGENT_SPEC);
    expect(prompt).toContain("self.rigidbody.applyImpulse");
    expect(prompt).toContain("10,000 iterations without a wait");
    expect(prompt).toContain("when game starts");
    expect(prompt).toContain("Do not put JavaScript");
  });

  it("keeps the system prompt byte-identical and free of per-call data, and gives requested style priority", () => {
    const prompt = buildSystemPrompt();
    expect(buildSystemPrompt()).toBe(prompt);
    expect(prompt).not.toContain("## Current scene\n");
    expect(prompt).not.toContain("Earlier successful requests (context only");
    expect(prompt).toContain("The current request is authoritative");
    expect(prompt).toContain("Hierarchy groups are the editor's folders");
    expect(prompt).toContain("restrained detail");
    expect(prompt).toContain("repeat");
    expect(prompt).toContain("12,000");
  });

  it("orders static rules, schemas, specs, modeling rules, examples and output format", () => {
    const prompt = buildSystemPrompt();
    const order = ["You are the scene agent", "## Creation style and design rules", "## Building objects", "## Rules", "## Component schemas",
      "## Script language", "## High-level building functions", MODELING_RULES, fewShotText(), "## Output format"].map((marker) => prompt.indexOf(marker));
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(prompt.slice(prompt.indexOf("## Output format"))).toMatch(/"plan"[\s\S]*"summary"[\s\S]*"ops"/);
  });

  it("puts the scene first in the user message, then history, selection and the request", () => {
    const scene = createEmptyScene();
    scene.entities.push({ id: "room", name: "Room", parent: null, components: { Transform: {} } });
    const message = buildSceneUserMessage(scene, "paint it red", { focusIds: ["room"], previousRequests: ["Use warm colors"] });
    expect(message.startsWith("## Current scene\n")).toBe(true);
    const positions = ['- room "Room"', "Use warm colors", 'Selected object ids (resolve this/these using this selection): ["room"]', "## Request\npaint it red"].map((part) => message.indexOf(part));
    for (const index of positions) expect(index).toBeGreaterThan(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("bounds the scene snapshot and selection to the message budget", () => {
    const scene = createEmptyScene();
    scene.entities = Array.from({ length: 600 }, (_, i) => ({ id: `crate_${i}`, name: `Crate ${i}`, parent: null,
      components: { Transform: { position: [i, 0.5, 0] }, Mesh: {}, Material: { color: "#8b5a3b" } } }));
    const message = buildSceneUserMessage(scene, "move the crates", { focusIds: scene.entities.map((entity) => entity.id), maxChars: 9_000 });
    expect(message.length).toBeLessThanOrEqual(9_000);
    expect(message).toContain("Bounded snapshot");
    expect(message).toMatch(/\(\+\d+ more selected\)/);
  });

  it("describes script parameters as managed data and serializes an existing scene", () => {
    const scene = createEmptyScene();
    scene.entities.push({
      id: "ball", name: "Ball", parent: null,
      components: { Transform: { position: [1, 2, 3] }, Script: { source: "param speed: float 0..10 = 3", parameters: { speed: 4 } } }
    });
    const message = buildSceneUserMessage(scene, "make it faster");

    expect(buildSystemPrompt()).toContain("parameters {settingName: value}");
    expect(message).toContain('- ball "Ball" script: {"Transform":{"position":[1,2,3]},"Script":');
    expect(message).toContain('"parameters":{"speed":4}');
  });
});

describe("AI response JSON schema", () => {
  it("allows all current operation kinds and strict field constraints", () => {
    const schema = buildResponseJsonSchema();
    const serialized = JSON.stringify(schema);

    for (const op of ["create", "update", "delete", "settings", "assemble", "repeat", "group"]) expect(serialized).toContain(`"const":"${op}"`);
    expect(serialized).toContain('"minimum":0.01');
    expect(serialized).toContain('"maximum":1000');
    expect(serialized).toContain('"enum":["box","sphere","cylinder","capsule","plane","cone"]');
    expect(serialized).toContain('"parameters"');
    expect(serialized).toContain('"additionalProperties":false');
  });

  it("requires a bounded plan string before ops", () => {
    const schema = buildResponseJsonSchema() as { properties: Record<string, { type?: string; maxLength?: number }>; required: string[] };
    const keys = Object.keys(schema.properties);
    expect(keys.indexOf("plan")).toBeLessThan(keys.indexOf("ops"));
    expect(keys[0]).toBe("plan");
    expect(schema.properties.plan).toMatchObject({ type: "string", maxLength: 1500 });
    expect(schema.required).toContain("plan");
  });
});
