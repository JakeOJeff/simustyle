# SimuStyle

SimuStyle is an AI-native 3D scene, simulation, and animation editor. The implementation follows [`app-build-prompt.md`](app-build-prompt.md). It includes a three.js viewport, editable scene tree, schema-driven inspector, Rapier simulation, typed scripting, an AI prompt/retry/apply flow, an animation timeline, GLB/standalone HTML/WebM export, and a Tauri desktop shell.

For step-by-step editor instructions, see the [SimuStyle User Guide](docs/USER_GUIDE.md).

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

Open **Docs** in the editor's top bar for the complete in-app guide. Hierarchy, Inspector, Console, AI, Timeline, and Docs are independent windows; the window layout is saved on this device.

Open the local URL printed by Vite. Hierarchy, Inspector, Console, AI, and Timeline are independent editor windows. Use the buttons below the viewport to show or hide them, drag a title bar to float a window or snap it to an edge, and resize floating windows from any edge or corner, or docked windows from their inner edge. Docked windows reserve space around the Scene viewport and script editor, which fit between the snapped bounds. Side docks fill their edges, while top/bottom docks fit between the side docks; all side docks share a responsive width. Floating windows can overlap the viewport. The layout is saved on this device. The top bar holds the scene name and save state (click it for New/Open/Save), File/Edit/View menus, undo/redo, the Select/Move/Rotate/Scale tools (Q/W/E/R), a World/Local gizmo-space toggle, snapping (0.5 m, 15°, 0.1 scale), the grid toggle, Add, Script, the Play clock with Stop, Step (one 60 fps frame), and Play/Pause, and Export. Ctrl+S saves. Use **Add** to create a cube, sphere, cylinder, capsule, cone, or plane; new primitives appear around the origin so they do not cover each other. Select objects in Hierarchy or the viewport, then edit material and transform fields in Inspector. Hold Ctrl and drag in the viewport to select every object whose visible bounds intersect the selection box. Right-click an object in the viewport or its Hierarchy row for Cut, Copy, Paste, Duplicate, Rename, and Delete. Right-click empty viewport space or empty Hierarchy space for Paste. A viewport paste uses the ground point under the pointer; a Hierarchy paste creates a root-level copy. Clipboard actions include the selected entity and its descendants; deleting an entity also removes its descendants. Paste and Duplicate place the copied hierarchy offset from its source. The Move, Rotate, and Scale gizmos use W/E/R; **Frame selected** focuses the viewport (F), and the grid button toggles the floor grid. The viewport shows the grid without a solid ground plane. Undo and redo apply to edits, Inspector slider drags, gizmo drags, reparenting, and grouping (see [Groups and parents](#groups-and-parents)). Click the keyframe diamond beside an animatable Inspector field to add a key at the current playhead, then scrub Timeline or press Play to preview it. Animator tracks support linear, ease-in-out, and step interpolation; dynamic rigid body Transform tracks are skipped with a console warning. Scripts are covered in [Scripting](#scripting) below. Ranged script parameters appear as Inspector controls. Play runs scripts, animation, and Rapier physics; compile errors appear inline and in Console. Pause freezes stepping and Stop restores the exact scene from before Play. Use Export for a GLB snapshot, an offline standalone HTML page, or a WebM capture of Play at 720p or 1080p. The standalone page autoplays and accepts `?controls=1` to display script parameter sliders. Use AI to request scene changes; generated operations and Script source are validated before a single undoable apply. AI requests need `AI_API_KEY` and `AI_MODEL`; credentials are read by the Vite dev server from `.env` in the repository root and never use a `VITE_` prefix. `AI_BASE_URL` is optional and defaults to OpenAI's `/v1` API. Scene files can be opened and saved as JSON.

## Groups and parents

Any object can hold other objects. A child moves, turns, and scales with its parent, and its Transform in the Inspector is relative to that parent.

- **Group objects:** select several (Ctrl+click or Shift+click in the Scene panel, or Ctrl+drag a box in the viewport) and press **Ctrl+G**, use the folder button at the top of the Scene panel, or right-click → **Group**. The new group sits at the center of its objects. **Add → Empty group** makes an empty one.
- **Make a child:** drag a row onto another object in the Scene panel, or pick a parent in the Inspector's **Inside** menu. Drop on a row's top or bottom edge to place it next to that object instead, or on empty space to move it to the top level. Objects keep their place in the world when their parent changes.
- **Ungroup:** select a group and press **Ctrl+Shift+G** (or right-click → **Ungroup**). Its children move up a level and the empty group is removed. Right-click → **Move out to top level** pulls one child out.
- **Scene panel:** click the arrow to collapse a group, double-click (or F2) to rename, use the file icon on a row to add or open that object's script, and type in the search box (shown once the scene has a few objects) to find an object. Groups are invisible in the viewport; select one in the Scene panel to move it with the gizmo.
- **Shortcuts:** `/` focuses the Console command bar; Tab in Console selects the most recently added scene object; Ctrl+Z / Ctrl+Y undo and redo, Ctrl+D duplicates, Delete removes the selection (and everything inside it), F2 renames.
- **In scripts:** a script on a group can use `my children` (`paint my children red`), `my parent`, and `when clicked`, which also fires when one of its children is clicked during Play.

## Scripting

Scripts are short plain-English sentences. Learn it in a minute:

1. **A script lives on an object.** Select an object and click **Script** in the toolbar, **+ Add a script** in the Inspector, or the file icon on its row in the Scene panel. The editor shows which object the script belongs to. In that script, `me`, `I`, and `my` mean that object. A script on a group can move the group and talk to `my children`. With nothing selected, **Script** makes a *Scene Script* object for scene-wide rules.
2. **Start with an event line** such as `when game starts`, `forever`, `every 2 seconds`, `when clicked`, `when space is pressed`, `when I touch the floor`, or `when I receive "win"`.
3. **Indent one sentence per line under it:** a verb, then (optionally) who, then how. Leave out who and it means `me`.

```
-- comments start with two dashes
setting speed = 2 from 0 to 10

when game starts
  set score to 0
  spin slowly

when space is pressed
  move up 2 over 0.5 seconds
  wait 0.5 seconds
  move down 2 over 0.5 seconds

forever
  if key right is pressed
    move right 0.1

when I touch a coin
  destroy it
  change score by 1
  if score is at least 3
    broadcast "win"

when I receive "win"
  say "You win!"
  paint all balls yellow
```

| Kind | Sentences |
| --- | --- |
| Events | `when game starts` · `forever` · `every 2 seconds` · `when clicked` · `when space is pressed` (also `when I press left`, `when the a key is pressed`) · `when I touch [something]` · `when I receive "message"` · `when a box is added` (during Play) |
| Move | `move up 2`, `move to 0 2 0`, `move box1 at 1 2 3`, `move by 1 0 0`, `move above the box` (below, beside, left of, right of, in front of, behind), `go to 3 1 0`, add `over 1 second` to glide |
| Turn and size | `turn left`, `turn right 45`, `turn around`, `rotate box1 by 0 90 0`, `rotate box1 to 0 45 0`, `scale by 2`, `grow by 2`, `shrink by 2`, `scale to 0.5` |
| Look | `paint red`, `paint the cube #33aaff`, `hide`, `show`, `spin`, `bounce`, `float`, `pulse`, `shake`, `wobble`, `sway`, `orbit`, `flash`, `tumble` (add `slowly`, `fast`, `gently`, `wildly`), `animate the box like a bouncing ball`, `stop` |
| Make and remove | `add box`, `add a red ball named big rock at 1 2 3`, `add 3 boxes named crate` (crate1, crate2, crate3), `add box named crate if not exists`, `create a box above me called "Crate"`, `delete box1`, `destroy all cones`. Clauses after the shape (`at`, `named`, `colored`, a place, `if not exists`) stack in any order. Unnamed objects are numbered without a space: Box1, Box2. |
| Remember | `set score to 0`, `change score by 1`, `increase speed by 2`, `decrease lives`, `set my y to 3`, `set my color to green` |
| Control | `wait 1 second`, `repeat 3 times`, `repeat until my y is more than 5`, `forever` (inside an event; needs a `wait`), `if … then` / `otherwise if` / `otherwise` |
| Talk | `say "hi" score`, `broadcast "win"` |
| Physics | `push up 5` (needs a dynamic RigidBody) |

**Who:** `me`, `it` (the object just touched or clicked), a name (`ball`, `box1`, `"big rock"`), `my children`, `my parent`, `all red balls`, or a description: `the [nearest|biggest|smallest|highest|lowest] [color] <ball|box|cube|cylinder|cone|plane|light|group|name word|one> [above|below|beside|… <object>]`. Colors are matched by hue, so `#e5484d` counts as red. When several objects match a single-object command, the one nearest the script's object wins; `all …` acts on every match.

**Write it loosely, then Parse:** write the complete script in casual language, even when the wording is not valid syntax. Press **✦ Parse** and AI interprets the whole script with the script owner and scene objects as context, then proposes a complete rewrite. Review the rewritten script and its explanation before choosing **Use rewrite**; the result is checked with the real parser and type checker first. Parse uses the same `AI_API_KEY`/`AI_MODEL` setup as the AI tab.

**Values:** numbers, `"text"`, colors, `true`/`false`, variables, `my x`/`y`/`z`/`size`/`color`/`name`, `x of the ball`, `distance to the player`, `random 1 to 10`, `key space is pressed`, and `time`. Compare with `is`, `is not`, `is more than`, `is less than`, `is at least`, `is at most`, and combine with `and`, `or`, `not`, and `+ - * /`. Colons at the end of event and `if` lines are optional.

**Settings:** `setting speed = 3 from 0 to 10` becomes a slider in the Inspector (true/false becomes a checkbox, a color a color picker). The Inspector's Script card lists the script's event lines and any problems.

**Editor:** a **Start from…** menu with ready-made scripts (spin when clicked, arrow-key movement, collecting coins, falling balls, patrolling, lighting up a group), a **Help** panel with a one-minute guide and clickable examples, syntax highlighting, line numbers, inline problems (click one to jump to it), Tab/Shift+Tab indent, Enter auto-indent, Ctrl+/ comments. Edits apply on Ctrl+S, **Apply**, leaving the editor, Save, or Play.

**Try sentences instantly:** type one in the Console command bar (for example `move the red ball above the box`) and press Enter. It changes the scene now as one undoable edit; waits and glides finish instantly. ↑/↓ recall history.

The original syntax (`param`, `let`, `on start:`, `every frame:`, `on collide(other):`, `while`, `self.<component>.<field>`, `print(...)`, and the built-in functions) still works. Unknown words and malformed sentences are compile errors with a line number; an object that cannot be found at run time is reported in the console.

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
