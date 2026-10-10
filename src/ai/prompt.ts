import { componentSchemas } from "../registry";
import type { ComponentSchema, FieldSchema } from "../registry/types";
import { serializeScene } from "../scene/serialize";
import type { Scene } from "../scene/types";

/** The script syntax and runtime API available to the scene agent. */
export const SCRIPT_AGENT_SPEC = `Scripts use the restricted, indentation-based language below. Put source in a Script component's source field.

Declarations and handlers:
- param <name>: <type> [<min>..<max>] = <literal> (types: float, int, bool, color, string)
- let <name> = <expression>
- on start:
- every frame:
- on collide(<name>):
- every <positive-seconds>s:
- if / else if / else, while (maximum 10,000 iterations per loop)
- assignments: =, +=, -=, *=, /=

Expressions support numbers, strings, booleans, #RRGGBB or #RRGGBBAA colors, member access, function calls, + - * / %, comparisons, and, or, not.

Built-ins: time, dt, random(a,b), sin, cos, abs, min, max, clamp, lerp, sqrt, print(...), spawn(prefabId,x,y,z), destroy(entity), find(name), self.
Entity access: self.<component>.<field> (fields are checked against the component schemas), self.name, self.rigidbody.applyImpulse(x,y,z), self.rigidbody.setVelocity(x,y,z).
Scripts are compiled from this language to a restricted runtime API. Do not put JavaScript, HTML, or any unsupported syntax in source.`;

function fieldDescription(field: FieldSchema): Record<string, unknown> {
  switch (field.type) {
    case "float":
    case "int":
      return { type: field.type, min: field.min, max: field.max, default: field.default, ...(field.type === "float" && field.step !== undefined ? { step: field.step } : {}) };
    case "vec3":
      return { type: "vec3", min: field.min, max: field.max, default: field.default, units: "meters or axis values as applicable" };
    case "enum":
      return { type: "enum", options: field.options, default: field.default };
    case "string":
      return { type: "string", default: field.default, ...(field.multiline ? { multiline: true } : {}) };
    default:
      return { type: field.type, default: field.default };
  }
}

/** Stable, readable schema payload derived from the same registry used by validation. */
export function describeComponentSchemas(schemas: Record<string, ComponentSchema> = componentSchemas): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [name, {
    description: schema.description,
    ...(schema.requires?.length ? { requires: schema.requires } : {}),
    fields: Object.fromEntries(Object.entries(schema.fields).map(([fieldName, field]) => [fieldName, fieldDescription(field)])),
    ...(schema.managedFields ? { managedFields: schema.managedFields } : {})
  }]));
}

/** Build the complete system prompt for one turn, including a compact valid scene snapshot. */
export function buildSystemPrompt(scene: Scene): string {
  const schemaText = JSON.stringify(describeComponentSchemas(), null, 2);
  const sceneText = serializeScene(scene);
  return `You are the scene agent inside a 3D simulation and animation editor.
Build or edit scenes by returning operations that follow the component schemas below. You never write UI code, HTML, or three.js code.

World: Y-up, right-handed. Units are meters, seconds, kilograms. Ground is y = 0. Gravity defaults to [0, -9.81, 0]. The default camera looks at the origin from [0, 4, 10].

## Component schemas
Use only these registered components and fields. Fields shown with defaults may be omitted; include only non-default values when possible.
${schemaText}

## Script language
${SCRIPT_AGENT_SPEC}

## Current scene
${sceneText}

## Output format
Return only a JSON object with exactly these fields:
{ "summary": "one plain-English sentence describing what you built or changed", "ops": [ ...operations ] }
Operations:
- create: { "op": "create", "id": string, "name": string, "parent": string|null, "components": object }
- update: { "op": "update", "id": string, "components": object containing only changed fields; component value null removes that component, and optional parent reparents }
- delete: { "op": "delete", "id": string }
- settings: { "op": "settings", "settings": object containing changed scene settings }

## Rules
1. Use only listed components and fields. Respect every minimum, maximum, enum, and required component.
2. Omit fields that should stay at their defaults.
3. For edits, change as little as possible. Never recreate entities that already exist; update them using their existing IDs.
4. Use readable, unique IDs such as ball, block_0, block_1.
5. Every visible object needs Transform, Mesh, and Material. Add a Light if the scene has none and the request needs a lit scene.
6. When useful adjustable values or scripted behavior are requested, put 2–5 user-adjustable param declarations with sensible ranges in Script source. Script params can be exposed as inspector values.
7. Keep the scene at or below 500 dynamic rigid bodies.
8. If the request cannot be done exactly with these components, build the closest supported version and explain the approximation in summary.
9. For validation or script errors, correct only the reported problems and return the full corrected response.
10. Do not include markdown fences or prose outside the JSON object.`;
}

function fieldJsonSchema(field: FieldSchema): Record<string, unknown> {
  switch (field.type) {
    case "float":
      return { type: "number", minimum: field.min, maximum: field.max };
    case "int":
      return { type: "integer", minimum: field.min, maximum: field.max };
    case "bool":
      return { type: "boolean" };
    case "color":
      return { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };
    case "vec3":
      return {
        type: "array", items: { type: "number", ...(field.min === undefined ? {} : { minimum: field.min }), ...(field.max === undefined ? {} : { maximum: field.max }) }, minItems: 3, maxItems: 3
      };
    case "enum":
      return { type: "string", enum: field.options };
    case "string":
      return { type: "string" };
    case "entityRef":
      return { type: ["string", "null"] };
  }
}

function componentJsonSchema(schema: ComponentSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = Object.fromEntries(Object.entries(schema.fields).map(([name, field]) => [name, fieldJsonSchema(field)]));
  if (schema.managedFields?.tracks === "animationTracks") properties.tracks = { type: "array", items: { type: "object" } };
  if (schema.managedFields?.parameters === "scriptParameters") properties.parameters = { type: "object", additionalProperties: { type: ["number", "boolean", "string"] } };
  return { type: "object", properties, additionalProperties: false };
}

const settingsSchema = {
  type: "object",
  properties: {
    gravity: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    background: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
    fixedTimestep: { type: "number", minimum: 0.001, maximum: 0.1 },
    ambientLightIntensity: { type: "number", minimum: 0, maximum: 10 }
  },
  additionalProperties: false
};

function componentsSchema(nullable: boolean): Record<string, unknown> {
  const properties = Object.fromEntries(Object.entries(componentSchemas).map(([name, schema]) => [
    name,
    nullable ? { anyOf: [componentJsonSchema(schema), { type: "null" }] } : componentJsonSchema(schema)
  ]));
  return { type: "object", properties, additionalProperties: false };
}

/** Raw JSON Schema accepted by Chat Completions structured output (strict mode is disabled because op payloads are sparse patches). */
export function buildResponseJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      ops: {
        type: "array",
        items: {
          anyOf: [
            {
              type: "object", properties: {
                op: { const: "create" }, id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 },
                parent: { type: ["string", "null"] }, components: componentsSchema(false)
              }, required: ["op", "id", "name", "parent", "components"], additionalProperties: false
            },
            {
              type: "object", properties: {
                op: { const: "update" }, id: { type: "string", minLength: 1 }, components: componentsSchema(true), parent: { type: ["string", "null"] }
              }, required: ["op", "id", "components"], additionalProperties: false
            },
            {
              type: "object", properties: { op: { const: "delete" }, id: { type: "string", minLength: 1 } },
              required: ["op", "id"], additionalProperties: false
            },
            {
              type: "object", properties: { op: { const: "settings" }, settings: settingsSchema },
              required: ["op", "settings"], additionalProperties: false
            }
          ]
        }
      }
    },
    required: ["summary", "ops"],
    additionalProperties: false
  };
}

/** Chat Completions `response_format` value, with the raw schema available separately for other providers. */
export const AI_RESPONSE_JSON_SCHEMA = {
  name: "scene_operations",
  strict: false,
  schema: buildResponseJsonSchema()
} as const;
