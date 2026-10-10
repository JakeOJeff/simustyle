# SimuStyle

SimuStyle is an AI-native 3D scene, simulation, and animation editor. The implementation follows [`app-build-prompt.md`](app-build-prompt.md). It includes a three.js viewport, editable scene tree, schema-driven inspector, Rapier simulation, typed scripting, an AI prompt/retry/apply flow, an animation timeline, GLB/standalone HTML/WebM export, and a Tauri desktop shell.

## Requirements

- Node.js 20.19 or newer
- npm
- A browser with WebGL for the later 3D viewport milestones
- For the Windows desktop build: Rust, Visual Studio C++ Build Tools, WebView2, and NSIS (see [Tauri's Windows prerequisites](https://v2.tauri.app/start/prerequisites/) and [installer guide](https://v2.tauri.app/distribute/windows-installer/))

## Install and run

```sh
npm install
cp .env.example .env
npm run dev
```

Edit `.env` in the repository root to set `AI_API_KEY` and `AI_MODEL` before using the AI tab. The file is ignored by Git; `.env.example` is the safe template.

Open the local URL printed by Vite. The editor uses a docked hierarchy, viewport, timeline, and inspector layout. Use **Add** to create a cube, sphere, cylinder, capsule, cone, or plane; new primitives appear around the origin so they do not cover each other. Select objects in the hierarchy or viewport, then edit material and transform fields in the Inspector. Hold Ctrl and drag in the viewport to select every object whose visible bounds intersect the selection box. Right-click an object in the viewport or its hierarchy row for Cut, Copy, Paste, Duplicate, Rename, and Delete. Right-click empty viewport space or empty hierarchy space for Paste. A viewport paste uses the ground point under the pointer; a hierarchy paste creates a root-level copy. Clipboard actions include the selected entity and its descendants; deleting an entity also removes its descendants. Paste and Duplicate place the copied hierarchy offset from its source. Console, AI, and Timeline are independent panels: use the buttons below the viewport to open or close each one, drag its title bar to float it or snap it to an edge, and resize floating panels from their lower-right corner. The workspace arrangement is saved on this device. The Move, Rotate, and Scale gizmos use W/E/R; **Frame selected** focuses the viewport (F), and the grid button toggles the floor grid. Undo and redo apply to edits, inspector slider drags, gizmo drags, and hierarchy reparenting. Click the keyframe diamond beside an animatable inspector field to add a key at the current playhead, then scrub the Timeline panel or press Play to preview it. Animator tracks support linear, ease-in-out, and step interpolation; dynamic rigid body Transform tracks are skipped with a console warning. Scripts are covered in [Scripting](#scripting) below. Ranged script parameters appear as inspector controls. Play runs scripts, animation, and Rapier physics; compile errors appear inline and in the console. Pause freezes stepping and Stop restores the exact scene from before Play. Use the Export menu for a GLB snapshot, an offline standalone HTML page, or a WebM capture of Play at 720p or 1080p. The standalone page autoplays and accepts `?controls=1` to display script parameter sliders. Use the AI tab to request scene changes; generated operations and Script source are validated before a single undoable apply. AI requests need `AI_API_KEY` and `AI_MODEL`; credentials are read by the Vite dev server from `.env` in the repository root and never use a `VITE_` prefix. `AI_BASE_URL` is optional and defaults to OpenAI's `/v1` API. Scene files can be opened and saved as JSON.

## Scripting

Scripts use a small, Scratch-like language with plain-English commands.

- **Open a script:** select an object and click **Script** in the toolbar, or click the `</>` badge in the Hierarchy, or **Open in script editor** in the Inspector. With nothing selected, **Script** creates a *Scene Script* object for scene-wide logic. Scripts open as tabs over the viewport; switch back with the **Scene** tab.
- **Editor:** syntax highlighting, line numbers, inline problems (click one to jump to it), Tab/Shift+Tab indent, Enter auto-indent, Ctrl+/ comments, and a **Reference** panel whose examples insert at the cursor. Edits apply on Ctrl+S, **Apply**, leaving the editor, Save, or Play.
- **Try commands instantly:** type a command in the Console tab's command bar (for example `move the red ball above the box`) and press Enter. It changes the scene now as one undoable edit; ↑/↓ recall history.

```
-- comments start with two dashes
on start:
  animate self like a bouncing ball
  paint the nearest cube red
every 2s:
  move the cube right 1 over 0.5s
on collide(other):
  destroy other
```

| Command | Examples |
| --- | --- |
| `move` / `glide` | `move ball to 0 2 0`, `move ball by 1 0 0`, `move ball up 2 over 1s`, `move the ball above the box` (also below, beside, left of, right of, in front of, behind), `glide ball to 3 1 0 in 2s` |
| `turn` / `scale` | `turn ball left 90`, `turn ball by 0 45 0 over 1s`, `scale ball by 2`, `scale ball to 0.5` |
| `paint` / `hide` / `show` | `paint the cube red`, `paint ball #33aaff`, `hide ball` |
| `destroy` / `push` / `say` | `destroy the one above the box`, `push ball up 5` (needs a dynamic RigidBody), `say "score", 10` |
| `animate` / `stop` | `animate self like a bouncing ball`, `animate the box as spinning slowly`; styles: bounce, spin, float, pulse, shake, wobble, sway, orbit, flash, grow, shrink, tumble; `stop animating self` |

Objects can be named by id or name (`ball`, `"Box 1"`), by `self`, by a variable, or described: `the [nearest|biggest|smallest|highest|lowest] [color] <ball|box|cube|cylinder|cone|plane|light|name word|one> [above|below|beside|… <object>]`. Colors are matched by hue, so `#e5484d` counts as red. When several objects match, the one nearest the script's object wins. Descriptions also work as values: `let target = the nearest red ball`. Coordinates may be separated by spaces or commas; wrap arithmetic in parentheses (`move self to (x + 1) 0 0`). The original `param`, `let`, `if`/`else`, `while`, `every frame`, `every <n>s`, `on collide(other)`, `self.<component>.<field>`, and built-in functions are unchanged. Unknown animation words and malformed commands are compile errors; an object that cannot be found at run time is reported in the console with its line number.

## Check and build

```sh
npm run check
npm run build
```

`npm run check` runs TypeScript, Svelte diagnostics, Vitest, and a production build. `npm run build` writes the browser app to `dist/`.

## Desktop application

Run `npm run tauri:dev` to launch the Tauri desktop app during development. **Open** and **Save** use native file dialogs and store validated scene JSON in `.simu` or `.json` files. Open **AI Settings** in the toolbar to configure the model, base URL, and API key. The key is saved in the operating system credential store; model and base URL are saved in the app config directory. AI requests run through a Rust command and need network access; scene editing, simulation, animation, and exports run locally.

On Windows, run `npm run tauri:build` to create the NSIS setup executable under `src-tauri/target/release/bundle/nsis/`. The app build needs the Tauri prerequisites above and the `x86_64-pc-windows-msvc` Rust target. Tauri's [dialog plugin](https://v2.tauri.app/plugin/dialog/) supplies native open/save dialogs. Rust uses [`keyring`](https://crates.io/crates/keyring) for API-key storage and [`reqwest`](https://docs.rs/reqwest/latest/reqwest/) for AI calls.

## Libraries and APIs

| Library/API | Use in SimuStyle | Source |
| --- | --- | --- |
| Svelte 5 | Editor UI and components | [Svelte docs](https://svelte.dev/docs) |
| Three.js | Scene viewport, GLB export, standalone renderer | [Three.js docs](https://threejs.org/docs/) |
| Rapier 3D | Fixed-step rigid-body simulation | [Rapier JavaScript docs](https://rapier.rs/docs/user_guides/javascript/) |
| Vite and Vitest | Development/build and automated checks | [Vite docs](https://vite.dev/guide/), [Vitest docs](https://vitest.dev/guide/) |
| esbuild | Inline the standalone web runtime | [esbuild docs](https://esbuild.github.io/) |
| Lucide Svelte | Toolbar icons | [Lucide Svelte docs](https://lucide.dev/guide/packages/lucide-svelte) |
| OpenAI-compatible Chat Completions API | Optional natural-language scene edits | [OpenAI API reference](https://platform.openai.com/docs/api-reference/chat) |
| Tauri 2 | Desktop webview shell and Rust commands | [Tauri docs](https://v2.tauri.app/) |
| Tauri dialog plugin | Native scene open/save dialogs | [Tauri dialog docs](https://v2.tauri.app/plugin/dialog/) |
| Rust `keyring` and `reqwest` | OS credential storage and desktop AI transport | [keyring](https://crates.io/crates/keyring), [reqwest](https://docs.rs/reqwest/latest/reqwest/) |

## Scene core

When dragging a selected object with the viewport transform gizmo, camera orbit is paused for the duration of that drag and restored when it ends.

The component registry lives in `src/registry/`. `applyOps(scene, ops)` validates and applies a complete batch atomically, returning inverse operations for undo. `SceneHistory` keeps undo and redo batches. `serializeScene` omits default component and settings values; `deserializeScene` restores defaults and validates loaded data.

Components in M1: Transform, Mesh, Material, RigidBody, Joint, Light, Camera, Script, and Animator. Script source is lexed, parsed, type-checked against the component registry, and compiled from AST nodes to a restricted runtime API. `random()` uses deterministic seeded state, and script scene changes go through `applyOps`. Animator timeline tracks are managed separately from raw inspector fields.

## Project status

- **Implemented:** M1 registry, validation, atomic scene operations, undo/redo, serialization; M2 viewport, hierarchy, inspector, scene open/save; M3 fixed-step Rapier physics, joints, Play/Pause/Stop, and snapshot restore; M4 lexer/parser/type checker/code generator, inspector params, seeded random, runtime handlers, print output, rigidbody actions, and contact callbacks; M5 live-registry AI prompt, server-side dev proxy, schema-structured output, validation retry loop, operation diff, and undoable scene changes; M6 inspector keyframing, timeline scrubbing, linear/ease-in-out/step animation, and animation during Play; M7 GLB, self-contained HTML, and WebM exports; M8 Tauri desktop shell, native scene dialogs, Rust AI transport, OS keyring-backed API-key storage, and configurable AI model/base URL.
- **Not verified yet:** The Windows Tauri installer build could not run because Cargo is unavailable in this environment. Live provider calls also remain unverified because no API credentials are configured.
- **Script commands:** `animate` styles are procedural presets chosen by keyword, not free-form motion generation. Animating or teleporting a dynamic RigidBody conflicts with physics (moves teleport the body; animations warn). Animations need Play; the command bar runs everything else immediately and finishes glides at once. `--` starts a comment, so `a --b` must be written `a - -b`.
- **M4 limitations:** `every frame` runs once per rendered frame, while physics advances in fixed steps. Script source/parameter edits during Play do not update existing script instances; Stop restores the original scene. Runtime exceptions currently report line 1 because generated code has no source map.
- **M5 limitations:** The Vite development build uses server middleware for AI transport. The Tauri desktop app sends provider requests through the Rust command. Live generation has not been verified without credentials.
- **M6 limitations:** Timeline edits are stored in Animator tracks and scrub/play in the editor. Transform tracks on dynamic bodies are skipped with a warning; animate static or kinematic transforms instead. Track/key selection controls are intentionally small and do not provide graph curves or key dragging.
- **M7 limitations:** WebM uses MediaRecorder to capture the live Play viewport in real time; recording duration follows wall-clock time and physics uses its configured fixed timestep. Standalone HTML embeds the full renderer/runtime bundle (about 5 MB before compression) and needs a WebGL-capable browser.
- **M8 limitations:** Tauri app packaging and native calls need validation on a Windows desktop. API keys are stored in the platform credential manager and are not returned to the frontend; live AI provider requests require network access.
- **Previous parser checkpoint:** the committed Node CLI/API prototype remains in the repository as a separate earlier implementation; the current browser editor uses the TypeScript scene agent built from the live component registry.

See [`CHANGELOG.md`](CHANGELOG.md) for completed work and [`AI_USAGE.md`](AI_USAGE.md) for Codex contributions.
