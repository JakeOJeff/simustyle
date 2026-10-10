# Build: AI-native 3D Scene, Simulation & Animation Editor

You are building a desktop app where users create 3D scenes, physics simulations and animations. Every object is made of components; every component field is editable in an auto-generated inspector. An AI agent can create and edit scenes from plain-English prompts. Scenes export to glTF and to a standalone web page.

Build it milestone by milestone (see bottom). After each milestone the app must run, and you must verify the acceptance criteria before moving on. Do not skip ahead.

---

## 1. Stack (do not substitute)

- **Language:** TypeScript, `strict: true`
- **Build:** Vite
- **UI:** Svelte 5
- **Renderer:** three.js (WebGLRenderer), `OrbitControls`, `TransformControls`
- **Physics:** `@dimforge/rapier3d-compat`
- **Inspector widgets:** hand-built Svelte components driven by schemas (no Tweakpane)
- **Desktop shell:** Tauri 2 (added in the final milestone — the app must run in a normal browser until then)
- **Tests:** Vitest
- **AI provider:** OpenAI-compatible Chat Completions API with JSON-schema structured output. Model name and base URL come from settings/env (`AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY`). Never hardcode a model name.

Do not add other runtime dependencies without a written reason in `DECISIONS.md`.

---

## 2. Core architecture: the schema registry

Everything flows from one registry of component schemas. This is the most important design rule in the project.

```ts
type FieldSchema =
  | { type: "float"; min: number; max: number; default: number; step?: number }
  | { type: "int"; min: number; max: number; default: number }
  | { type: "bool"; default: boolean }
  | { type: "color"; default: string }               // "#rrggbb"
  | { type: "vec3"; default: [number, number, number]; min?: number; max?: number }
  | { type: "enum"; options: string[]; default: string }
  | { type: "string"; default: string; multiline?: boolean }
  | { type: "entityRef"; default: string | null };

interface ComponentSchema {
  name: string;                 // "RigidBody"
  description: string;          // one line, shown in the AI prompt and as tooltip
  fields: Record<string, FieldSchema>;
  requires?: string[];          // e.g. RigidBody requires Transform
}
```

The registry drives, with no per-component special-casing:
1. **Inspector** — fields render from schema type.
2. **Validation** — every scene mutation is checked against schemas (types, ranges, enums, requires).
3. **AI prompt** — the component section of the system prompt is generated from the registry.
4. **Script type-checking** — `self.<component>.<field>` resolves against schemas.
5. **Animation** — any `float`, `vec3`, `color` field can be keyframed.
6. **Serialization** — scenes save only non-default fields.

Adding a new component must require: one schema file + one runtime system file. Nothing else.

---

## 3. Components (v1)

| Component | Fields |
|---|---|
| **Transform** | position vec3, rotation vec3 (degrees, Euler XYZ), scale vec3 (default 1,1,1) |
| **Mesh** | shape enum [box, sphere, cylinder, capsule, plane, cone], radius float 0.01..50 =0.5, height float 0.01..50 =1 |
| **Material** | color color, metalness float 0..1 =0, roughness float 0..1 =0.6, emissive color =#000000, emissiveIntensity float 0..20 =0, opacity float 0..1 =1 |
| **RigidBody** | bodyType enum [dynamic, static, kinematic], mass float 0.01..1000 =1, friction float 0..2 =0.5, restitution float 0..1 =0.2, linearDamping float 0..10 =0, initialVelocity vec3 |
| **Joint** | type enum [rope, fixed, spherical, revolute], target entityRef (null = world), anchor vec3, length float 0..100 =2 |
| **Light** | type enum [directional, point, spot], color color =#ffffff, intensity float 0..100 =1, castShadow bool =true |
| **Camera** | fov float 10..120 =50, isActive bool =false |
| **Script** | source string multiline |
| **Animator** | tracks (managed by the timeline, not shown as raw fields), loop bool =true, duration float 0.1..600 =5 |

Scene settings (not a component): gravity vec3 = (0,-9.81,0), background color, fixed timestep 1/60, ambient light intensity.

World conventions: Y-up, right-handed, meters, seconds, kilograms. Ground at y = 0.

---

## 4. Data model

```ts
interface Entity {
  id: string;                   // stable, human-readable: "ball", "block_3"
  name: string;
  parent: string | null;
  components: Record<string, Record<string, unknown>>;  // only non-default fields
}
interface Scene {
  version: 1;
  settings: SceneSettings;
  entities: Entity[];
}
```

### Operations — the only way to mutate a scene
```ts
type Op =
  | { op: "create"; id: string; name: string; parent: string | null; components: Record<string, Record<string, unknown>> }
  | { op: "update"; id: string; components: Record<string, Record<string, unknown> | null> } // null removes component
  | { op: "delete"; id: string }
  | { op: "settings"; settings: Partial<SceneSettings> };
```

- The inspector, gizmos, hierarchy drag-drop, AI agent and undo/redo ALL go through `applyOps(scene, ops) -> { scene, inverseOps, errors }`.
- `applyOps` validates everything first and applies nothing if any op is invalid.
- Undo/redo = stack of inverse op batches. Slider drags coalesce into one undo step (commit on pointer-up).

---

## 5. Editor UI layout

```
┌──────────────────────────────────────────────────────────────┐
│ Toolbar: New Open Save | Undo Redo | ▶ Play ⏸ Pause ⏹ Stop | Export ▾ │
├───────────┬──────────────────────────────────┬───────────────┤
│ Hierarchy │            Viewport              │   Inspector   │
│ (tree,    │  (orbit, select, move/rotate/    │ (selected     │
│  drag to  │   scale gizmo W/E/R, F = focus)  │  entity's     │
│  reparent)│                                  │  components,  │
│ + Add ▾   │                                  │  + Add Comp.) │
├───────────┴──────────────────────────────────┴───────────────┤
│ Bottom tabs: [AI] [Timeline] [Console]                         │
└──────────────────────────────────────────────────────────────┘
```

- **Dark theme**, clean, consistent 4px spacing grid. Should feel like a real tool, not a demo.
- **Inspector widgets by type:** float → slider + number box (drag on label to scrub), int → stepper, bool → toggle, color → swatch + picker, vec3 → three number boxes colored X/Y/Z, enum → dropdown, string multiline → code editor (for Script), entityRef → dropdown of entities.
- Each component card: collapsible, title, ⋮ menu (reset to defaults, remove).
- **Script `param`s appear in the inspector** as their own section under the Script component, as normal widgets.
- Edits during Play mode are live but are discarded on Stop (show a tinted border while playing to make that obvious).
- **Console:** compile errors, validation errors, AI activity, script `print()` output.

---

## 6. Simulation

- Rapier world built from entities with RigidBody/Joint on Play. Fixed timestep accumulator (1/60), render interpolated.
- **Play** snapshots the scene. **Stop** restores the snapshot exactly. **Pause** freezes stepping; inspector still works.
- Systems run in this order each tick: scripts (`every frame`) → physics step → sync transforms → animator → render.
- Determinism: same scene + same seed = same result. `random()` in scripts uses a seeded PRNG reset on Play.
- Collision events forwarded to scripts' `on collide(other)`.
- Cap: warn in console above 500 dynamic bodies.

---

## 7. The scripting language

Small, Scratch-level, indentation-based. Hand-written lexer + recursive-descent parser in `src/lang/`. Compiles to a JS function; never use `eval` on user text directly — compile to an AST, then generate JS that only calls a whitelisted runtime API.

```
param speed: float 0..10 = 3
param tint: color = #ff5500

let count = 0

on start:
  self.material.color = tint

every frame:
  self.transform.position.x += speed * dt
  if self.transform.position.x > 10:
    self.transform.position.x = -10
    count += 1
    print("lap", count)

on collide(other):
  if other.name == "Ground":
    self.rigidbody.applyImpulse(0, 5, 0)
```

**Grammar:** `param`, `let`, assignment (`=`, `+=`, `-=`, `*=`, `/=`), `if` / `else if` / `else`, `while` (with a 10,000 iteration guard), `on start:`, `every frame:`, `on collide(<name>):`, `every <seconds>s:`, expressions with `+ - * / %`, comparisons, `and or not`, member access, function calls, numbers, strings, `true/false`, hex colors.

**Built-ins:** `time`, `dt`, `random(a,b)`, `sin cos abs min max clamp lerp sqrt`, `print(...)`, `spawn(prefabId, x, y, z)`, `destroy(entity)`, `find(name)`, `self`.

**Entity API:** `self.<component>.<field>` (type-checked against registry), `self.rigidbody.applyImpulse(x,y,z)`, `self.rigidbody.setVelocity(x,y,z)`, `self.name`.

**Errors:** every error has line + column + a plain-English message ("`self.rigidbdy` — no component named rigidbdy. Did you mean rigidbody?"). Show inline in the code editor and in the console. A script that fails to compile does not run; the rest of the scene still runs.

**Tests:** lexer, parser, type-checker and codegen each have Vitest tests, including error cases.

---

## 8. The AI agent

Bottom panel **[AI]**: chat-style log + input box. Each turn shows the agent's one-line summary and an expandable diff ("+3 entities, ~1 updated").

### Flow
1. Build the system prompt (below) with the current component registry and current scene.
2. Call the model with structured output (JSON schema for `{ summary: string, ops: Op[] }`).
3. Validate ops with `applyOps` in dry-run mode + compile any Script sources.
4. If errors: send the exact error list back as the next message, ask for a corrected full response. Max 3 retries. Show retries in the log ("fixing 2 errors…").
5. On success, apply as ONE undo step, select the created/changed entities, frame them in the viewport.
6. User can hit Undo to reject the whole AI change.

API calls go through a single module `src/ai/client.ts`. In browser dev, call via a Vite dev-server proxy that reads `AI_API_KEY` from env. In Tauri, call from a Rust command. The key never ships in frontend code.

### System prompt (generate `{{COMPONENT_SCHEMAS}}`, `{{SCRIPT_SPEC}}` and `{{SCENE}}` at runtime)

```
You are the scene agent inside a 3D simulation and animation editor.
You build and edit scenes by returning operations that follow the component
schemas below. You never write UI code, HTML, or three.js code.

World: Y-up, right-handed, meters/seconds/kilograms. Ground is y = 0.
Gravity defaults to (0, -9.81, 0). Default camera looks at the origin from (0, 4, 10).

## Component schemas
{{COMPONENT_SCHEMAS}}

## Script language
{{SCRIPT_SPEC}}

## Current scene
{{SCENE}}

## Output
Return { "summary": string, "ops": Op[] }.
summary: one plain-English sentence describing what you built or changed.

## Rules
1. Use only listed components and fields. Respect every min/max and enum.
2. Omit fields that should stay at default.
3. For edits, change as little as possible. Never recreate entities that exist;
   use "update" with only the changed fields.
4. Use readable ids: "ball", "block_0", "block_1".
5. Every visible object needs Transform + Mesh + Material. Add a Light if the scene has none.
6. When a scene has interesting tunable values, put them in a Script as 2–5
   `param`s with ranges where the whole slider looks reasonable — they become
   inspector sliders for the user.
7. Max 500 dynamic rigid bodies.
8. If the request can't be done exactly, build the closest version and say what
   you approximated in summary.
9. If you receive validation or compile errors, fix only those and return the
   full corrected response.
```

---

## 9. Animation (timeline)

- Bottom tab **[Timeline]**: tracks for the selected entity, playhead, scrub, keyframe diamonds.
- Any `float`/`vec3`/`color` field in the inspector has a ◆ button: adds a keyframe at the playhead.
- Interpolation per key: linear, ease-in-out, step.
- Animator runs during Play and also while scrubbing in edit mode (preview without physics).
- If an entity has both a dynamic RigidBody and an animated Transform, the console warns; animation wins only for kinematic bodies.

---

## 10. Save, load, export

- **Save/Open:** `.scene.json` (the `Scene` type, pretty-printed). Autosave to local storage every 30s while dirty; recovery prompt on launch.
- **Export ▾**
  1. **glTF (.glb)** — current frame, via `GLTFExporter`.
  2. **Web page (.html)** — single self-contained file: inlined slim runtime (renderer + physics + script runtime + animator, no editor code) + scene JSON. Opens in any browser, autoplays, orbit camera, optional `?controls=1` shows the script params as sliders. Lazy-load Rapier only if the scene has rigid bodies.
  3. **Video (.webm)** — step at fixed timestep, render each frame offscreen at chosen resolution (720p/1080p) and duration, encode with WebCodecs / MediaRecorder. Progress bar, cancel button.

The runtime used by the web export must be the exact same code path as Play mode in the editor (shared `src/runtime/`). No separate implementation.

---

## 11. Project structure

```
src/
  registry/        component schemas, one file per component, index.ts
  scene/           types, applyOps, validate, serialize, undo
  runtime/         systems: scripts, physics, transforms, animator, render loop (shared with export)
  lang/            lexer, parser, checker, codegen, errors, spec.ts (text for AI prompt)
  ai/              client.ts, prompt.ts, agent.ts (retry loop)
  editor/          Svelte: Toolbar, Hierarchy, Viewport, Inspector, widgets/, AIPanel, Timeline, Console
  export/          gltf.ts, html.ts, video.ts
  App.svelte, main.ts
src-tauri/         (final milestone)
tests/
DECISIONS.md
README.md
```

---

## 12. Milestones (build in order, verify each)

**M1 — Registry + scene core.** Schemas for all components, `applyOps`, validation, undo/redo, serialization. *Accept:* Vitest covers create/update/delete/invalid ops/undo round-trip.

**M2 — Viewport + hierarchy + inspector.** Render scene, select by click, gizmos, auto-generated inspector edits through ops, add/remove entities and components. *Accept:* add a box, change its color/position/scale from the inspector and gizmo, undo every step.

**M3 — Physics + Play/Pause/Stop.** *Accept:* a stack of 20 boxes falls and settles; Stop restores the exact pre-play scene.

**M4 — Scripting language.** Lexer → codegen, params in inspector, inline errors, collision events. *Accept:* the sample script in §7 runs; a typo produces a line/column error with a suggestion; tests pass.

**M5 — AI agent.** Prompt generation, structured output, validation + retry loop, single undo step. *Accept:* these prompts all work end to end:
- "A tower of 10 colorful blocks and a wrecking ball that swings into it"
- "Make the ball twice as heavy and red"
- "Add a slider to control how many balls rain from the sky"
- "Solar system with 4 planets orbiting a glowing sun"

**M6 — Timeline animation.** *Accept:* keyframe a cube's position and color over 3s, scrub and play.

**M7 — Export.** glb, standalone HTML, webm. *Accept:* exported HTML of the wrecking-ball scene opens offline in a browser and behaves the same as Play mode.

**M8 — Tauri.** Wrap the app, native open/save dialogs, AI calls via Rust command, settings screen for API key/model/base URL. *Accept:* `tauri build` produces an installer; the full flow works offline except AI.

---

## 13. Quality bar

- No `any` except at JSON parse boundaries (validate immediately after).
- No feature may bypass `applyOps` to mutate the scene.
- 60 fps with 200 dynamic bodies on a mid-range laptop.
- Every error the user can cause has a human-readable message.
- Keep a short `DECISIONS.md`: every non-obvious choice, one line each.
- README: how to run dev, set the API key, build the desktop app.

Start with M1. Before writing code, list the files you will create for M1 and the tests that will prove it works.
