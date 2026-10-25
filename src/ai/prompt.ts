import { componentSchemas } from "../registry";
import type { ComponentSchema, FieldSchema } from "../registry/types";
import type { Scene } from "../scene/types";
import { TEXTURE_AGENT_RULES } from "../materials/catalog";
import { componentSchemaText, sceneText, type SceneContextOptions } from "./sceneContext";
import { BUILD_TOOL_SPEC, DESIGN_RULES } from "./designRules";
import { BuildCache } from "./cache";
import { MODELING_RULES, examplesText, fewShotText, selectExamples } from "./examples";

/** The script syntax and runtime API available to the scene agent. */
export const SCRIPT_AGENT_SPEC = `Scripts: one sentence per line, indented under events; optional colons. Store in Script.source. "me"/"I"/"my" mean the owner; "it" means the touched/clicked object.

Event lines (not indented):
- when game starts · forever (every frame) · every <n> seconds · when clicked · when <key> is pressed (keys: space, enter, left, right, up, down, a-z, 0-9) · when I touch [<obj>] · when I receive "<message>" · when [<obj>] is added (when an object is created during Play)

Statements (prefer these; most commands default to "me" when the object is left out):
- move [<obj>] up|down|left|right|forward|back <n> | to <x> <y> <z> | by <dx> <dy> <dz> | above|below|beside|left of|right of|in front of|behind <obj>; add "over <n> seconds" to glide; go ... = move me
- turn [<obj>] left|right [<degrees>] | turn around | turn [<obj>] by <x> <y> <z>; scale|grow|shrink [<obj>] to|by <n>
- paint [<obj>] <colorname|#rrggbb>; hide/show/destroy [<obj>]; push [<obj>] up <n> (dynamic RigidBody only); say <values...>
- spin|bounce|float|pulse|shake|wobble|sway|orbit|flash|tumble [<obj>] [slowly|fast|gently|wildly]; animate <obj> like <description>; stop [animating <obj>]
- create a [color] ball|box|cylinder|cone|capsule|plane [at <x> <y> <z> | above <obj>] [called "<name>"]
- set <var> to <value> · change <var> by <n> · increase/decrease <var> by <n> · set my x|y|z|size|color to <value>
- wait <n> seconds · repeat <n> times · repeat until <condition> · forever (loop; needs a wait inside; loops stop after 10,000 iterations without a wait)
- if <condition> [then] / otherwise if / otherwise
- broadcast "<message>" (runs every "when I receive" handler)
- setting <name> = <literal> [from <min> to <max>] (becomes an Inspector control)

Targets: me, it, names, variables, my children/parent, all <description>, or [superlative] [color] <ball|box|cube|cylinder|cone|plane|light|group|one> [index] [relation <obj>]. Indexes start at 0 and sort nearest-first unless a superlative is used.
Values: numbers, "text", colors, true/false, variables, my x|y|z|size|color|name, x of <obj>, distance to <obj>, random 1 to 10, key <name> is pressed, time. Combine with + - * / and compare with: is, is not, is more than, is less than, is at least, is at most, and, or, not.
Coordinates use spaces or commas; parenthesize arithmetic. Random example: move to random -5 to 5 0 0. Comments start with --.
Only listed commands exist; there is no kill, respawn, reset, teleport, or warp. For checkpoints or kill bricks, move to fixed coordinates:
  when I touch player
    move it to 0 2 0
After "if <condition> then", put statements on new, further-indented lines.
Older syntax (param, let, on start:, every frame:, on collide(other):, self.<component>.<field>, self.rigidbody.applyImpulse(x,y,z), self.rigidbody.setVelocity(x,y,z), print(...)) still works but prefer the sentences above.
Camera calls (any script/Console): camera() returns active handle; camera.create("Name",x,y,z) returns a camera; camera.use(find("Name")) switches it; camera.set("fov",65)/camera.get("fov") write/read fields. camera.position(x,y,z) sets world position; camera.move(dx,dy,dz) moves locally (-Z forward); camera.rotate(pitch,yaw,roll) adds degrees; camera.aim(x,y,z) aims once. camera.lookAt(find("Player")) tracks; camera.follow(find("Player"),0,3,6,5) uses world offset and optional damping (0 snaps; higher catches faster); camera.unfollow() clears tracking. camera.attach(find("Lamp"),0,0,-1)/camera.detach(find("Lamp")) carry/release objects. One active camera; near < far; no target/parent cycles or dynamic physics on rigs. Lens/Transform fields support keyframes.
Scripts are compiled from this language to a restricted runtime API. Do not put JavaScript, HTML, or any unsupported syntax in source.`;

const promptPrefixCache = new BuildCache<string>(2);

/**
 * The scene agent's whole system prompt. It is byte-identical for every scene call (draft, review and
 * corrections) so provider prompt caching reuses it; everything per-call goes in the user message.
 */
export function buildSystemPrompt(): string {
  const registryKey = JSON.stringify(componentSchemas);
  let prompt = promptPrefixCache.get(registryKey);
  if (!prompt) {
    prompt = buildStaticPrompt();
    promptPrefixCache.set(registryKey, prompt);
  }
  return prompt;
}

export interface SceneUserMessageOptions extends Pick<SceneContextOptions, "focusIds" | "expand"> {
  /** Successful earlier requests in this document; trimmed to a small style-context budget. */
  previousRequests?: readonly string[];
  /** Budget for the whole message; the scene snapshot gets whatever the other parts leave. */
  maxChars?: number;
  /** What the request refers to, from the reference step (resolutionText in references.ts); goes just before the request. */
  resolution?: string;
}

/** Earlier requests kept as style context: the latest six, at most 2,500 JSON characters. */
export function requestHistory(previousRequests: readonly string[] = []): string[] {
  const history = previousRequests.slice(-6).map((request) => request.slice(0, 600));
  while (history.length && JSON.stringify(history).length > 2_500) history.shift();
  return history;
}

/** How a reply hands objects to detail passes; the detail pass itself is described in its own message (detailPass.ts). */
export const DETAIL_RULES = `## Rich scenes: lay out, then detail
The editor builds each substantial object in its own pass, so a scene can hold more objects and props than one reply allows. Spend that on more objects and props, not on finer detail.
- When the request creates a scene, or any object that deserves more than ~15 parts, put that object in "detail" instead of modeling it in ops. ops then holds only settings, floor/ground, walls, room lights and simple pieces.
- Each detail item: {"id","name","description","position","rotation","size","parent"}. position is the center of its base; size [w,h,d] (m) is the box it must fit, front facing +z before rotation; description names its key features, sub-parts, materials and colors so the detail pass can model them (e.g. "oak dresser: 3 drawers with brass pulls, plinth, carved top edge, a lamp and two framed photos on top").
- Fill a scene with 6–20 detail items: every object the request implies, then the props that make it lived-in. Group small props on one surface into one item ("desk clutter"). Give boxes clearance; an object standing on another sits at the top of that one's box. Size the floor to the items' footprint + about 1 m.
- Glowing parts of a detail object (bulbs, flames, screens) get their Light in its detail pass. ops holds at most the directional sun; every other light belongs to a lamp, candle or window.
- Small edits and recolors never use detail.`;

/** Heading for the library examples chosen for one request (see selectExamples). */
export const EXAMPLES_HEADING = "## Examples close to this request (illustrations of the rules, not templates to copy)";
/** Scene snapshot room kept before any library example is added to a build message. */
const MIN_SCENE_CHARS = 4_000;

/** Added to the request when the scene has no entities, so a first build is a whole composition. */
export const EMPTY_SCENE_NOTE = "The scene is empty, so build a full composition, not loose objects on the grid: every object the request implies plus lived-in props, a floor or ground sized to them + about 1 m, any walls the request implies, lights from visible sources that match the mood, and a settings op for background and ambientLightIntensity to match, with every substantial object listed in detail.";

/** Selected ids as JSON, bounded so a select-all on a big scene cannot crowd out the scene itself. */
function selectionText(focusIds: readonly string[]): string {
  const shown: string[] = [];
  for (const id of focusIds) {
    if (JSON.stringify([...shown, id]).length > 1_500) break;
    shown.push(id);
  }
  return `${JSON.stringify(shown)}${shown.length < focusIds.length ? ` (+${focusIds.length - shown.length} more selected)` : ""}`;
}

/**
 * Per-call user message: "## Current scene" first, then style history, selection and the request. The scene
 * snapshot shrinks to fit maxChars; the message is longer than maxChars only when the non-scene parts alone
 * do not fit, which callers treat as "request too large".
 */
export function buildSceneUserMessage(scene: Scene, request: string, options: SceneUserMessageOptions = {}): string {
  const history = requestHistory(options.previousRequests);
  const focusIds = options.focusIds ?? [];
  const tail = `${history.length ? `\n\nEarlier successful requests (context only; current request overrides these):\n${JSON.stringify(history)}` : ""}${focusIds.length ? `\n\nSelected object ids (resolve this/these using this selection): ${selectionText(focusIds)}` : ""}${scene.entities.length ? "" : `\n\n${EMPTY_SCENE_NOTE}`}${options.resolution ? `\n\n${options.resolution}` : ""}\n\n## Request\n${request}`;
  // Relevant worked examples go first: a repeated example extends the provider's cached prefix. Each is dropped
  // (least relevant first) when keeping it would leave the scene snapshot less than MIN_SCENE_CHARS.
  const examples = selectExamples(request, scene.entities.length === 0);
  const room = (options.maxChars ?? Infinity) - tail.length - 70;
  while (examples.length && room - examplesText(examples, EXAMPLES_HEADING).length < MIN_SCENE_CHARS) examples.pop();
  const head = `${examples.length ? `${examplesText(examples, EXAMPLES_HEADING)}\n\n` : ""}## Current scene\n`;
  const sceneBudget = Math.max(0, Math.min(23_000, (options.maxChars ?? Infinity) - head.length - tail.length - 50));
  return `${head}${sceneText(scene, { maxChars: sceneBudget, query: request, focusIds, ...(options.expand ? { expand: options.expand } : {}) })}${tail}`;
}

/** Static rules, then schemas/specs, then modeling guidance and examples, then the output format. Nothing per-call. */
function buildStaticPrompt(): string {
  return `You are the scene agent inside a 3D simulation and animation editor.
Build or edit scenes by returning operations that follow the component schemas below. You never write UI code, HTML, or three.js code.
Each build message starts with "## Current scene" (the scene your operations apply to), may list earlier requests, selected ids and what the request refers to, and ends with "## Request". Review messages describe a first build to check instead.
The scene may be an outline: groups the request doesn't involve are collapsed to one line with their world bounding box, and their parts are hidden. Treat a collapsed group as one solid object that fills its box: move, rotate, scale, delete or place things against it by its id, and never reference or guess the ids of its hidden parts. "What the request refers to" resolves pronouns and vague references against the scene; follow it unless the request plainly says otherwise.

World: Y-up, right-handed; meters, seconds, kilograms, degrees. Ground y=0; gravity [0,-9.81,0]. "collisions" disables object collisions/touch events, keeping the floor solid. Objects need RigidBody or Collider to collide. Default Camera [7,6,9] aims near origin; preserve unless asked. Cameras face local -Z; Play/exports use world transforms.

${DESIGN_RULES}

## Building objects
- Mesh: box width/depth=2·radius, height=height; sphere diameter=2·radius; cylinder/cone width=2·radius at the base, radiusTop sets the top (unset: cylinder=radius, cone=0; set it to truncate pots, buckets, lampshades); wedge is a 2·radius×height×2·radius triangular prism whose slope rises from the -X bottom edge to a vertical +X face (rotation [0,180,0] mirrors it); capsule total height=height; plane is a 2·radius XY square (rotation [-90,0,0] lies flat); torus: XY ring, radius to tube center, height=tube thickness; text: reads +X facing +Z, height=letter height, depth=2·radius. Transform.scale multiplies size.
- bevel: soft or manufactured things (cushions, sofas, phones); size those with radius/height, as scale squashes it.
- sides 4: pyramids/roofs; 6/8: nuts, pencils; ≤12 radius reaches the faces.
- arc 180: domes, bowls (flipped), half-pipes, arches (torus).
- hollow: containers, pipes; open ends, add a disc floor.
- torus: handles, wheels, rings; text: signs.
- Position is center: floor y=half height; stacking y=lower object's top+half height. Use reported y ranges.
- Place new root objects at free floor spots unless specified; leave 0.3 m gaps. Missing positions are placed automatically.
- Multi-part objects use a Transform-only parent group with locally positioned children, preferably assemble.
- Visible parts need Transform/Mesh/Material. RigidBody enables falling/rolling; anchored:true or static for fixed solids.
- Use unique snake_case ids and readable names; reference existing ids.

## Rules
1. Respect schema fields, ranges, options and requirements.
2. Make minimal edits; update existing ids instead of recreating them.
3. For adjustable/scripted behavior, add 2–5 settings with ranges (setting speed = 3 from 0 to 10) for Inspector controls.
4. At most 500 dynamic bodies.
5. Approximate unsupported requests and explain in summary.
6. Fix reported validation, script and geometry errors and return the full corrected response.
7. No markdown or prose outside JSON.

## Component schemas
Format: field type range =default. Omit fields that stay at their default.
${componentSchemaText()}

${TEXTURE_AGENT_RULES}

## Script language
${SCRIPT_AGENT_SPEC}

${BUILD_TOOL_SPEC}

${MODELING_RULES}

${DETAIL_RULES}

${fewShotText()}

## Output format
Return only JSON with keys in this order:
{ "requested": ["every object the player explicitly named"], "plan": "every part you will build with its size and position (at most 1500 characters)", "summary": "one plain-English sentence describing what you built or changed", "ops": [ ...operations ], "detail": [ ...objects for detail passes, optional ] }
List requested first (each one is checked by name: name its object or group for it), then plan, then ops that follow it. Build every requested object before any extras. Keep the whole reply under 12,000 characters: use assemble/repeat for repeated detail.
Operations:
- create: { "op": "create", "id": string, "name": string, "parent": string|null, "components": object }
- update: { "op": "update", "id": string, "components": changed fields (null removes component), optional "parent": string|null, optional "name": string }
- delete: { "op": "delete", "id": string }
- settings: { "op": "settings", "settings": object containing changed scene settings }
High-level assemble/repeat/group operations are also allowed as documented above. Create parents before their children.`;
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
      return { type: "string", ...(field.maxLength === undefined ? {} : { maxLength: field.maxLength }) };
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
    ambientLightIntensity: { type: "number", minimum: 0, maximum: 10 },
    collisions: { type: "boolean" }
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
      // First so the model commits to every named object, then lays out parts and measurements, before any operation.
      requested: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 60 }, description: "Every object the player explicitly named, in their words." },
      plan: { type: "string", maxLength: 1500, description: "Every part to build with its size and position in meters, and what it rests on or attaches to." },
      summary: { type: "string", minLength: 1, maxLength: 2000 },
      detail: { type: "array", maxItems: 24, items: detailItemSchema },
      ops: {
        type: "array",
        maxItems: 1500,
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
                op: { const: "update" }, id: { type: "string", minLength: 1 }, components: componentsSchema(true), parent: { type: ["string", "null"] }, name: { type: "string", minLength: 1 }
              }, required: ["op", "id", "components"], additionalProperties: false
            },
            {
              type: "object", properties: { op: { const: "delete" }, id: { type: "string", minLength: 1 } },
              required: ["op", "id"], additionalProperties: false
            },
            {
              type: "object", properties: { op: { const: "settings" }, settings: settingsSchema },
              required: ["op", "settings"], additionalProperties: false
            },
            {
              type: "object", properties: {
                op: { const: "assemble" }, id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 },
                parent: { type: ["string", "null"] }, transform: componentJsonSchema(componentSchemas.Transform!),
                parts: { type: "array", minItems: 1, maxItems: 300, items: {
                  type: "object", properties: { id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 },
                    parent: { type: "string", minLength: 1 }, components: componentsSchema(false) },
                  required: ["id", "name", "components"], additionalProperties: false
                } }
              }, required: ["op", "id", "name", "parent", "parts"], additionalProperties: false
            },
            {
              type: "object", properties: {
                op: { const: "repeat" }, source: { type: "string", minLength: 1 }, idPrefix: { type: "string", minLength: 1 },
                name: { type: "string", minLength: 1 }, count: { type: "integer", minimum: 1, maximum: 200 },
                step: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
                rotationStep: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }
              }, required: ["op", "source", "idPrefix", "name", "count", "step"], additionalProperties: false
            },
            {
              type: "object", properties: {
                op: { const: "group" }, id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 },
                ids: { type: "array", minItems: 1, maxItems: 1500, items: { type: "string", minLength: 1 } }
              }, required: ["op", "id", "name", "ids"], additionalProperties: false
            }
          ]
        }
      }
    },
    required: ["plan", "summary", "ops"],
    additionalProperties: false
  };
}

/** One object left to a detail pass (see DETAIL_RULES and detailPass.ts). */
const detailItemSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, description: { type: "string", maxLength: 600 },
    position: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    rotation: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
    size: { type: "array", items: { type: "number", exclusiveMinimum: 0, maximum: 100 }, minItems: 3, maxItems: 3 },
    parent: { type: ["string", "null"] }
  },
  required: ["id", "name", "description", "position", "size"],
  additionalProperties: false
};

/** Chat Completions `response_format` value, with the raw schema available separately for other providers. */
export const AI_RESPONSE_JSON_SCHEMA = {
  name: "scene_operations",
  strict: false,
  schema: buildResponseJsonSchema()
} as const;
