export const DEFAULT_COMPONENT_SCHEMAS = {
  Transform: {
    position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z] position in meters" },
    scale: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z] scale; defaults to [1, 1, 1]" }
  },
  Mesh: {
    shape: { type: "string", enum: ["box", "sphere"] },
    radius: { type: "number", exclusiveMinimum: 0, description: "sphere radius in meters" }
  },
  Material: {
    color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "hex color such as #ff5a5f" },
    metalness: { type: "number", minimum: 0, maximum: 1 }
  },
  RigidBody: {
    isStatic: { type: "boolean" },
    mass: { type: "number", exclusiveMinimum: 0, description: "mass in kilograms" }
  },
  Joint: {
    type: { type: "string", enum: ["rope"] },
    anchor: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "[x, y, z] world anchor in meters" },
    length: { type: "number", exclusiveMinimum: 0, description: "rope length in meters" }
  },
  Script: {
    source: { type: "string", description: "script in the restricted scene script language" }
  }
};

export const SCRIPT_LANGUAGE = `Scripts are a Script component with source in this language:
  param <name>: <type> <min>..<max> = <default>
  on start: ...
  every frame: ...
  on collide(other): ...
  if / else, let, self.<component>.<field>, spawn(<prefab>), destroy(self)
Built-ins: time, dt, random(a, b), sin, cos, lerp
Use only these constructs. Do not invent component fields or script functions.`;

export function buildSystemPrompt({ componentSchemas, scriptLanguage } = {}) {
  const schemas = componentSchemas ?? DEFAULT_COMPONENT_SCHEMAS;
  const script = scriptLanguage ?? SCRIPT_LANGUAGE;
  return `You are the scene agent for a 3D simulation and animation editor. Return only one JSON object with exactly these top-level fields: summary (one plain-English sentence) and ops (an array of operations).

World: Y-up, right-handed, meters, seconds, kilograms. Ground is y=0. Gravity defaults to [0,-9.81,0]. The camera looks at the origin from [0,4,10].

Component schemas (only these components and fields are available):
${JSON.stringify(schemas, null, 2)}

${script}

Operations:
- create: {op:"create", id:string, name:string, parent:string|null, components:object}
- update: {op:"update", id:string, components:object containing only changed fields}
- delete: {op:"delete", id:string}

Rules:
1. Use only registered components and fields. Omit fields that should stay at defaults.
2. For edits, change as little as possible; never recreate existing objects. The current scene is supplied in the request.
3. Put 2 to 5 useful user-adjustable param declarations in Script sources when scripts are needed.
4. Keep rigid bodies at or below 500 total.
5. If a request is impossible, build the closest supported version and explain the approximation in summary.
6. IDs in create operations must be unique and operations must be directly applicable to the supplied scene.
7. Do not include markdown fences or prose outside the JSON object.`;
}
