# Change log

Record meaningful project changes during the event, newest first.

## Event build log

### 2026-10-11T03:40:00+05:30 — Focus the camera only on F

- Changed: Clicking or selecting an object no longer moves the camera. The viewport's focus effects called `focusSelected()` inside a reactive effect, so reading the selection made them re-run on every selection or scene change; they are now `untrack`ed and only fire when F, View → Frame selected, or an AI apply requests it. Files: `src/editor/Viewport.svelte`.
- Why: Participant asked for focus to happen only when F is pressed.
- Validation: `svelte-check` (0 errors/0 warnings) and all 97 tests passed.
- Limitations: Not clicked through in a browser. Applying an AI change still frames the changed object, as before.

### 2026-10-11T03:39:00+05:30 — Add an in-app Docs window

- Changed: Added a resizable, draggable Docs window with navigation and user instructions for the editor, scene editing, scripts, AI, animation, exporting, shortcuts, and troubleshooting. Added a Docs button in the top bar and View menu; included Docs in the panel tabs and saved workspace layout. Updated `src/App.svelte`, `src/editor/TopBar.svelte`, `src/editor/DocsPanel.svelte`, `README.md`, and `docs/USER_GUIDE.md`.
- Why: Make the instructions available from inside the editor.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 97 tests, and the production build. The existing large-chunk warning remains.
- Limitations: The docs window was not manually exercised in a browser. Its content is maintained in the in-app panel and Markdown guide, so updates to one need to be reflected in the other.

### 2026-10-11T03:34:00+05:30 — Add a complete user guide

- Changed: Added `docs/USER_GUIDE.md` covering editor layout, object editing, hierarchy, Inspector, Console, scripts, AI, animation, simulation, exports, shortcuts, and troubleshooting. Linked it from the README.
- Why: Put the editor's instructions in one dedicated page that is easy to find.
- Validation: Checked Markdown links and whitespace; no application code changed.
- Limitations: Instructions describe the current editor UI and may need updates as features change.

### 2026-10-11T03:00:00+05:30 — AI Parse for loosely written scripts

- Changed: The script editor draws a dashed box around words the language does not know (synonyms, misspelled names, descriptions like "the object near this") and around broken lines. A new **✦ Parse** button sends the script, the unclear words, and a summary of scene objects to the AI, which returns ranked replacements per phrase. Each box then shows its best guess, selects the object it refers to, and opens a confirm card; clicking a box lists the other options. **Confirm all** applies every chosen option. Options are kept only if their words are known and the line passes the parser and checker; if none survive, the model is retried once with the rejections. Added a shared `requestJson` helper to the AI client. Files: `src/lang/fuzzy.ts` (new), `src/ai/scriptParse.ts` (new), `src/ai/client.ts`, `src/editor/ScriptEditor.svelte`, `src/App.svelte`, `tests/lang/fuzzy.test.ts`, `tests/ai/scriptParse.test.ts`, `README.md`.
- Why: Participant asked for an AI parser that turns loose wording, synonyms, and object descriptions into project object names and syntax, with a visible box and a confirm/choose step.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 97 tests (8 new), and the production build. One live model call through the dev proxy turned `when game begins` / `colour the object near this crimson` / `make it go up 2` into `starts`, `Box1`, `red`, and `move Box1 up 2`, all passing validation.
- Limitations: The boxes, popover, and selection preview were not clicked through in a browser. Unclear-word detection is vocabulary-based, so a valid-looking sentence with the wrong meaning is not boxed. The object preview uses the existing selection highlight; the viewport is behind the script tab while it is open. The prompt was changed afterwards to always list other nearby objects as options; that change was not re-run against the live model.

### 2026-10-11T02:45:00+05:30 — Restyle editor scrollbars

- Changed: Added thin dark scroll tracks with a brighter violet hover and active thumb, including Firefox scrollbar colors and WebKit scrollbar styling. Files: `src/app.css`.
- Why: Make scrolling controls fit the editor theme and easier to spot when interacting.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 89 tests, and the production build. The existing large-chunk warning remains.
- Limitations: Browser-specific scrollbar rendering can vary by operating system.

### 2026-10-11T02:45:00+05:30 — Redesign the top bar

- Changed: Replaced the toolbar with a new top bar component matching the participant's mockup: scene name with Saved/Unsaved state and a New/Open/Save menu; File, Edit (undo/redo, cut/copy/paste, duplicate, rename, delete, group), and View (panel toggles, grid, frame selected, AI settings) menus; undo/redo; a Select/Move/Rotate/Scale tool group (new Select tool, Q, hides the gizmo); a World/Local gizmo-space toggle; a snap toggle (0.5 m, 15°, 0.1 scale); the grid toggle; Add and Script; a Play clock (time and 60 fps frame) with Stop, Step one frame, and Play/Pause/Resume; and an Export button. Added Ctrl+S to save. Removed the old toolbar styles. Files: `src/editor/TopBar.svelte` (new), `src/App.svelte`, `src/editor/Viewport.svelte`, `src/editor/ExportMenu.svelte`, `src/app.css`, `README.md`.
- Why: Participant asked for the top navigation to follow their supplied design.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 89 tests, and the production build. Headless Chrome screenshots at 1600 px and 1000 px widths showed the new bar laid out as designed.
- Limitations: Menus, Step, snapping, and World/Local were not clicked through in a browser. Saved state compares undo history, so redoing back to the saved point still shows Unsaved. The scene name comes from the opened/saved file name and cannot be edited in the bar.

### 2026-10-11T02:20:00+05:30 — Add objects with `add` and target them by name

- Changed: `add box`, `add a red ball named big rock at 1 2 3`, `add 3 boxes named crate`, and `add box named crate if not exists` now create objects from the Console or scripts; clauses after the shape stack in any order, and `add 1 to score` still does arithmetic. `named` accepts bare (multi-word) names. New objects get unique names without a space (Box1, Box2; crate, crate2), from both commands and the toolbar Add menu, so `move box1 at 1 2 3`, `rotate box1 to 0 90 0`, `paint box2 blue`, and `delete box2` reach them. `rotate … to` sets an absolute rotation and `move … at x y z` is an alias for `to`. Files: `src/lang/ast.ts`, `src/lang/parser.ts`, `src/lang/codegen.ts`, `src/runtime/commands.ts`, `src/runtime/scripts.ts`, `src/App.svelte`, `tests/lang/commands.test.ts`, `README.md`.
- Why: Participant asked for an `add` command with stackable position/name options, name-based targeting for the other commands, and `Box1`-style names.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics, all 89 tests (4 new), and the production build (existing large-chunk warning).
- Limitations: `if not exists` applies to `add` only; other commands still report a missing object. Names containing clause words (`at`, `on`, `to`, …) need quotes. Lights and cameras cannot be added by command. Duplicate still names copies "<name> Copy". Not exercised in the browser.

### 2026-10-11T02:11:00+05:30 — Add visible panel resize edges and square styling

- Changed: Added resize handles to every floating panel edge and corner, plus center-facing handles for docked panels. Removed panel window corner rounding and shadows, and kept toolbar menus above panels. Added `src/editor/PanelResizeHandles.svelte`; updated `src/App.svelte` and `README.md`.
- Why: Make resizing discoverable and keep overlapping controls accessible.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 85 tests, and the production build. The existing large-chunk warning remains.
- Limitations: Resize handles have not been manually exercised in the browser.

### 2026-10-11T02:08:00+05:30 — Fill the dock corners without overlap

- Changed: Side-docked panels now fill their full edge; top and bottom panels fit between the side docks. This removes the unused lower corner gaps while keeping the dock windows separate. Updated `src/App.svelte`.
- Why: The prior dock sizing left blank areas under the side panels beside Timeline.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 85 tests, and the production build.
- Limitations: Floating panels remain independent and may overlap the workspace.

### 2026-10-11T02:02:00+05:30 — Fit Scene and Script between docked windows

- Changed: Made the Scene viewport and Script editor use the same remaining center bounds between snapped side and top/bottom panels. Updated `src/App.svelte`.
- Why: Keep docked panels from covering the active Scene or Script workspace.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 85 tests, and the production build. The build retains the existing large-chunk warning.
- Limitations: Floating panels can still overlap the center workspace by design.

### 2026-10-11T02:12:00+05:30 — Explain where scripts live in the Inspector and script editor

- Changed: The Inspector names can now be edited, an **Inside** menu sets the parent (keeping world position), and components use plain titles with hints (Shape, Look, Physics, Position/rotation & size); field labels read as words ("Emissive intensity"). The Script card says which object the script runs on and what `me` (and `my children`) mean, lists its event lines as chips, and calls parameters **Settings**; objects without a script show a **+ Add a script** card. The script editor shows a bar saying which object owns the script, a **Start from…** menu with six ready-made scripts, and a **Help** panel with a "scripts in one minute" guide and examples rewritten for the sentence syntax. New scripts start with a sentence-syntax template, and groups get the object template rather than the scene-script one. Fixed the parser treating a number followed by a bracket as a function call (`at (random -3 to 3) 6 (random -3 to 3)` failed), and an unknown name now suggests `set <name> to 0`. A new test compiles every editor example and template. Files: `src/editor/Inspector.svelte`, `src/editor/ScriptEditor.svelte`, `src/App.svelte`, `src/lang/parser.ts`, `src/lang/checker.ts`, `tests/lang/sentences.test.ts`, `README.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: It was unclear where scripts go and what they act on, and the editor's examples still taught the older programming-style syntax.
- Validation: `svelte-check` passed with 0 errors and 0 warnings; Vitest passed 85 tests, including the new examples-and-templates compile test (it found the bracket bug). A headless Chrome run against the Vite dev server added a cube, used **+ Add a script** (owner bar read "This script belongs to Box 1…"), appended `when space is pressed` / `paint red` with no problems reported, saved with Ctrl+S, pressed Play, clicked the cube in the viewport (its Y rotation began changing from the template's `when clicked` / `spin fast`), and pressed Space (its color became red).
- Limitations: With the new floating Hierarchy, Inspector, and Console windows docked over the stage, those windows cover much of the script editor; closing or moving them reveals it.

### 2026-10-11T01:57:00+05:30 — Keep the Scene viewport clear around docked windows

- Changed: Docked windows now reserve matching space around the Scene viewport, so side and top/bottom docks no longer cover the scene; multiple docks sharing an edge fit without overlapping corners. All side docks use one responsive width. Updated `src/App.svelte` and `README.md`.
- Why: Keep the main Scene visible while panels are snapped and make dock widths consistent as the workspace changes size.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 84 tests, and the production build. The build retains the existing large-chunk warning.
- Limitations: Floating windows keep their individually saved, user-resizable widths and can cover the Scene by design.

### 2026-10-11T01:44:00+05:30 — Make Hierarchy and Inspector movable windows

- Changed: Moved Hierarchy and Inspector into the shared panel workspace with independent show/hide controls, floating and edge-docked layouts, and saved positions/sizes. Floating panel windows, including Hierarchy and Inspector, can be resized from the lower-right corner. Updated `src/App.svelte` and `README.md`.
- Why: Let the scene tree and property editor be arranged alongside Console, AI, and Timeline instead of occupying fixed sidebars.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 84 tests, and the production build. Build retains the existing large JavaScript chunk warning.
- Limitations: Docked panels use automatic sizing; manual resizing applies while a panel is floating. Interactive browser review has not been performed.

### 2026-10-11T01:52:00+05:30 — Add groups, parenting, and a clearer Scene panel

- Changed: Added parent/child helpers that keep an object's world position when it changes parent, wrap objects in a group placed at their center, and ungroup back to the parent level (`src/scene/hierarchy.ts`). The Hierarchy is now a **Scene** panel with shape/group/light/script icons, collapsible groups with guide lines, Ctrl/Shift multi-select, double-click or F2 inline rename, drag into/next to/out of objects with drop highlighting, a per-row script button that adds or opens that object's script, a search box for larger scenes, and a tips footer. **Ctrl+G** groups the selection (or adds an empty group), **Ctrl+Shift+G** ungroups, and the context menu gains Group, Ungroup, and Move out to top level; right-clicking inside a multi-selection keeps it. Added **Add → Empty group** and editor shortcuts (Ctrl+Z/Ctrl+Y, Ctrl+D, Delete, F2). The viewport now renders mesh-less objects as invisible groups, so children follow their parent's Transform and a selected group gets the gizmo; box selection skips groups. During Play, viewport clicks and key presses go to scripts (`when clicked`, `when space is pressed`, `key left is pressed`). Fixed two regular expressions that had lost their backslashes, so multi-word object names highlight in the script editor and script errors are colored as errors in the console. Files: `src/scene/hierarchy.ts`, `src/editor/Hierarchy.svelte`, `src/editor/Viewport.svelte`, `src/App.svelte`, `tests/scene/hierarchy.test.ts`, `README.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Grouping and parent/child organization were missing, and reparenting moved objects because the viewport ignored mesh-less parents.
- Validation: `npx tsc --noEmit` and `svelte-check` passed with 0 errors and 0 warnings; Vitest passed 84 tests, including 4 new hierarchy tests (world position kept on reparent, cycle refusal, group/ungroup in place, nested selection). A headless Chrome run against the Vite dev server added a cube and sphere, Ctrl+clicked both, grouped with Ctrl+G (tree showed the group with two children and the gizmo at the group center), collapsed and expanded the group, ungrouped with Ctrl+Shift+G, and restored the group with Ctrl+Z.
- Limitations: Sibling order is not stored, so dropping on a row edge sets the parent but not the position in the list. Physics bodies use their local Transform as a world position, so keep rigid bodies at the top level. Clicks and key presses during Play were wired but not exercised in the browser in this change.

### 2026-10-11T01:31:00+05:30 — Make scripts read as plain sentences

- Changed: Scripts can now be written as indented plain sentences with optional colons. Event lines: `when game starts`, `forever`, `every 2 seconds`, `when clicked`, `when space is pressed` (several phrasings), `when I touch [object]` (with `it` meaning the touched object), and `when I receive "message"`. New sentences: `set`/`change`/`increase`/`decrease`/`add … to` variables (shared by every event, numbers start at 0), `wait 1 second` (handlers now run as coroutines), `repeat 3 times`, `repeat until …`, `forever` loops, `if … then` / `otherwise`, `broadcast "message"`, `create a red ball at 0 3 0 called "Coin"`, `setting speed = 3 from 0 to 10`, and one-word animations (`spin slowly`, `bounce`). Commands default to the script's own object (`move up 2`, `paint red`, `turn left`, `hide`). New objects and values: `my children`, `my parent`, `all red balls`, `a coin`, `my x`/`y`/`z`/`size`/`color`, `x of the ball`, `distance to …`, `random 1 to 10`, `key left is pressed`, and word comparisons (`is`, `is not`, `is more than`, `is at least`, …). Loops that never wait stop after 10,000 iterations with the line number. The simulation controller and standalone HTML export forward key presses; the controller also forwards clicks. The AI agent prompt documents the sentence syntax. The original syntax still compiles. Files: `src/lang/` (`ast.ts`, `parser.ts`, `checker.ts`, `codegen.ts`, `vocabulary.ts`, `highlight.ts`), `src/runtime/scripts.ts`, `src/runtime/commands.ts`, `src/runtime/physics.ts`, `src/export/standalone-runtime.ts`, `src/ai/prompt.ts`, `tests/lang/sentences.test.ts`, `tests/lang/codegen.test.ts`, `tests/ai/prompt.test.ts`, `README.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Scripting should be learnable in about a minute and read like sentences, while still covering games (keys, clicks, touches, messages, timing, variables).
- Validation: `npx tsc --noEmit` passed; Vitest passed 84 tests, including 11 new sentence tests covering parsing, key phrasing, shared variables with `wait`, `repeat`, word comparisons, `all …` targets, key/click/broadcast delivery, touch filters, `create`, property setting, the loop limit, the command bar, and compiling the README example. Existing script tests pass unchanged apart from the code generator's new handler-list shape.
- Limitations: The editor does not yet send viewport clicks or key presses to the running simulation (wired in a follow-up). The standalone export has no click events. Objects created during Play have no physics body. Positions read and written by scripts are local to the object's parent.

### 2026-10-11T01:28:00+05:30 — Make Console, AI, and Timeline movable panels

- Changed: Console, AI, and Timeline now open as independent windows. Drag a title bar to float a panel or snap it to the viewport's left, right, top, or bottom edge; floating panels can be resized. Panel visibility and layout persist in local storage. Updated `src/App.svelte`, `README.md`, and event records.
- Why: Let users customize the editor workspace instead of keeping the three tools fixed in one tabbed strip.
- Validation: TypeScript passed; `svelte-check` reported 0 errors and 0 warnings; `npm run build` passed with the existing large-chunk warning. Vitest ran 83 tests: 82 passed and one AI prompt expectation failed because concurrent prompt changes no longer include `self.rigidbody.applyImpulse`. In-app browser drag and resize behavior has not been manually checked.
- Limitations: Docked panels sharing an edge divide that dock area evenly. The current test suite has one failure in the concurrent AI prompt changes.

### 2026-10-11T01:23:00+05:30 — Make delete actions explicit and reliable

- Changed: Kept Hierarchy row delete controls visible, made deletion reject missing entities or active Play with a status message, and keep the context menu open if deletion fails. Files: `src/App.svelte`, `src/editor/Hierarchy.svelte`, and event records.
- Why: Make the delete action visible and ensure failed deletion attempts explain why the object remains.
- Validation: All 72 Vitest tests passed and `npm run build` passed with the existing large-chunk warning. `svelte-check` reported 12 errors in concurrent scripting changes (`src/runtime/scripts.ts` and `tests/lang/codegen.test.ts`), with no warnings in the changed editor components. In-app browser interaction could not be verified in this environment.
- Limitations: Type checking is currently blocked by the concurrent scripting changes.

### 2026-10-11T01:17:00+05:30 — Add marquee selection and empty-space paste

- Changed: Ctrl-drag in the viewport now selects intersecting objects and highlights the full selection in the viewport and Hierarchy. Right-clicking empty viewport space opens the Paste menu at the pointer's ground position; right-clicking empty Hierarchy space opens a root-level Paste menu. Files: `src/App.svelte`, `src/editor/Viewport.svelte`, `src/editor/Hierarchy.svelte`, `README.md`, and `CHANGELOG.md`.
- Why: Support selecting groups of objects and placing copies directly where the user points.
- Validation: All 72 Vitest tests passed and `npm run build` passed with the existing large-chunk warning. `npm run check` is currently blocked by 6 TypeScript/Svelte diagnostics in the concurrent scripting changes (`src/lang/ast.ts`, `src/lang/checker.ts`, and `src/lang/codegen.ts`); the changed editor files produced no Svelte warnings. In-app browser interaction was unavailable for manual verification.
- Limitations: The viewport gizmo still transforms the primary selected entity; group transforms are not implemented. The full type check remains blocked by the unrelated scripting changes described above.

### 2026-10-11T01:02:00+05:30 — Add entity context actions

- Changed: Right-clicking an entity in the Hierarchy or on its mesh in the viewport opens a shared menu with Cut, Copy, Paste, Duplicate, Rename, and Delete. Rename is undoable through scene operations; paste and duplicate create an offset copy, and hierarchy deletion includes descendants. Updated `src/App.svelte`, `src/editor/Hierarchy.svelte`, `src/editor/Viewport.svelte`, `src/scene/types.ts`, `src/scene/applyOps.ts`, and `tests/scene/applyOps.test.ts`.
- Why: Provide expected direct object actions in both editor views.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 68 Vitest tests, and Vite production build. The in-app browser was unavailable for manual interaction verification. Build retains the existing large-chunk warning.
- Limitations: Clipboard contents are local to the current editor session. Interactive viewport menu behavior has not yet been manually checked.

### 2026-10-11T00:55:00+05:30 — Add plain-English script commands and an in-app script editor

- Changed: Fixed the Add menu and Hierarchy **+** buttons, which threw `structuredClone` errors on Svelte 5 state proxies (scene and undo stacks are now `$state.raw`). Completed the Scratch-style command language: `move`/`glide` (coordinates, offsets, directions, or above/below/beside/… another object, optionally `over Ns`), `turn`, `scale`, `paint`, `hide`/`show`, `destroy`, `push`, `say`, `animate … like <description>` with twelve keyword-matched styles, and `stop`; object descriptions such as `the nearest red ball above the box`; `--` comments. Added a tabbed script editor over the viewport with syntax highlighting, line numbers, inline problems, indentation keys, and a clickable reference; a toolbar **Script** button, Hierarchy script badges, an Inspector **Open in script editor** button, and a Console command bar that runs commands immediately as one undo step. The AI agent prompt documents the commands. Files: `src/App.svelte`, `src/editor/ScriptEditor.svelte`, `src/editor/Hierarchy.svelte`, `src/editor/Inspector.svelte`, `src/lang/` (`vocabulary.ts`, `highlight.ts`, `parser.ts`, `lexer.ts`, `checker.ts`, `codegen.ts`, `ast.ts`), `src/runtime/commands.ts`, `src/runtime/scripts.ts`, `src/runtime/physics.ts`, `src/ai/prompt.ts`, `tests/lang/commands.test.ts`, `README.md`, and `CHANGELOG.md`.
- Why: Adding objects did not work, and scripting was hard to find and limited to programmer-style syntax.
- Validation: `npx tsc --noEmit` and `svelte-check` passed with 0 errors and 0 warnings; Vitest passed 67 tests, including 14 new command parser/checker/runtime tests. A headless Chrome run against the Vite dev server added a cube and sphere, ran command-bar commands (paint, relative move, and a not-found report), opened a script tab, showed inline errors, saved with Ctrl+S, and pressed Play: the sphere bounced, and `say` output reached the console.
- Limitations: Animation styles are presets selected by keywords. Animations only run during Play. Dynamic rigid bodies are teleported by `move`, and physics competes with `animate`. `npm run build` passed; the standalone HTML export of command scripts and the Tauri desktop shell were not re-verified in this change.

### 2026-10-11T00:50:00+05:30 — Keep camera still during gizmo drags

- Changed: Orbit controls are disabled while TransformControls is dragging and re-enabled when the gizmo drag ends. The listener is removed during viewport cleanup. Documented this interaction in README. Files: `src/editor/Viewport.svelte`, `README.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Prevent dragging a selected object from also changing the camera orbit.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 67 Vitest tests, and Vite production build. No interactive browser check was performed.
- Limitations: The change covers object transformations through the viewport gizmo; direct dragging on the mesh body does not move the object.

### 2026-10-11T00:36:00+05:30 — Reconcile AI and submission verification notes

- Changed: Updated AI usage, M8 verification notes, and submission limitations to reflect the successful browser check, unavailable Cargo toolchain, untested live AI connection, missing visual review, and local WIP commit `76f4a72`. Files: `AI_USAGE.md`, `SUBMISSION.md`, and `CHANGELOG.md`.
- Why: Keep the event record and submission claims aligned with the checks actually run and the remaining gaps.
- Validation: Cross-checked the recorded check results, Cargo failure, Git commit SHA, and current Git state. No code changed, so no new test run was needed.
- Limitations: The Windows installer, live provider call, and interactive visual review remain unverified.

### 2026-10-11T00:33:00+05:30 — Fix primitive placement and script command validation

- Changed: New primitives use distinct deterministic positions, the Add menu includes capsules, and README demo instructions match. Completed type checking and AST code generation for the pending natural-language script commands; scene mutations use `applyOps`, and unsupported animation commands or ignored durations produce console issues. Files: `src/App.svelte`, `src/lang/checker.ts`, `src/lang/codegen.ts`, `src/runtime/scripts.ts`, `README.md`, `SUBMISSION.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Prevent newly added objects from covering one another and repair the incomplete script-command path that caused TypeScript errors and silent missing behavior.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 53 Vitest tests, and Vite production build. `cargo check --manifest-path src-tauri/Cargo.toml` could not run because Cargo is not installed.
- Limitations: Timed scene commands apply immediately; `animate` and `stop` script commands report as unsupported. The Windows Tauri installer remains unverified without Cargo and the Windows build prerequisites. Live AI provider calls remain unverified without credentials.

### 2026-10-11T00:14:00+05:30 — Add the Tauri desktop app

- Changed: Added a Tauri v2 desktop shell, native scene open/save dialogs, bounded Rust scene file commands, a Rust AI chat command, model/base URL settings, and OS keyring storage for the API key. Added a settings screen, app icon, Tauri scripts, Windows NSIS bundle config, desktop setup instructions, and ignores for Rust build output. Files: `src-tauri/`, `src/platform/desktop.ts`, `src/editor/SettingsPanel.svelte`, `src/App.svelte`, `src/ai/client.ts`, `package.json`, `.gitignore`, `README.md`, `SUBMISSION.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Provide a native desktop build with local scene workflows and keep provider credentials out of frontend storage.
- Validation: Pending final Windows installer build and full app check.
- Limitations: Live AI provider calls require a valid API key and network; no live provider request has been made. The installer and packaged app flow are awaiting build verification.

### 2026-10-11T00:06:00+05:30 - Refine 3D editor workspace

- Changed: Restyled the editor chrome around a clear docked 3D workspace, added Lucide controls, a primitive creation menu (cube, sphere, cylinder, cone, plane), a floor-grid toggle, and a Frame Selected viewport action. Documented the new controls. Files: `src/App.svelte`, `src/app.css`, `src/editor/Viewport.svelte`, `package.json`, `package-lock.json`, `README.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Make common scene creation and viewport navigation easier to find, using interaction patterns familiar to 3D editors.
- Validation: `npm run typecheck` passed; `npx svelte-check --tsconfig ./tsconfig.json` passed with 0 errors and 0 warnings; `npm run build` passed; a fresh Vite server returned HTTP 200 for `/`, `/src/App.svelte`, and the optimized Lucide module. No tests were run. Initial sandbox build/diagnostics hit a process-spawn restriction and passed when run outside the sandbox.
- Limitations: Primitive creation currently covers the built-in mesh types; lights and cameras remain available through Inspector components. Visual review in an interactive browser has not been performed.

### 2026-10-11T00:04:00+05:30 — Build M7 scene exports

- Changed: Added GLB conversion/export for scene meshes, materials, transforms, hierarchy, lights, and cameras; a standalone HTML exporter that bundles Three.js, OrbitControls, ScriptRuntime, AnimatorRuntime, and the shared SimulationController; and a WebM recorder with duration, resolution, progress, and cancellation controls. Added a toolbar export menu and script parameter controls for standalone pages. Files: `src/export/`, `src/editor/ExportMenu.svelte`, `src/editor/Viewport.svelte`, `src/App.svelte`, `src/runtime/scripts.ts`, `src/runtime/physics.ts`, `vite.config.ts`, `src/svelte.d.ts`, `tsconfig.json`, `package.json`, `package-lock.json`, `@lucide/svelte`, `tests/export/`, `README.md`, `SUBMISSION.md`, `DECISIONS.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Complete the M7 scene export flow while reusing the editor's runtime modules for standalone Play behavior.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), 53 Vitest tests, and Vite production build. The generated standalone runtime is bundled into the lazy HTML export chunk.
- Limitations: WebM captures the live viewport with MediaRecorder, so duration follows wall-clock capture and physics uses the configured fixed timestep. The standalone HTML export embeds a roughly 5 MB renderer/runtime bundle. Large Three.js/Rapier/export chunks trigger Vite size warnings.

### 2026-10-10T23:48:00+05:30 — Build M6 timeline animation

- Changed: Added schema-validated Animator tracks, float/vector/color interpolation, an animation runtime for scrubbing and Play, inspector keyframe buttons, and the timeline panel with playhead, tracks, and interpolation controls. Rebased script state against physics updates and applied collision-triggered scene operations after physics sync so their changes persist. Files: `src/runtime/animator.ts`, `src/runtime/physics.ts`, `src/runtime/scripts.ts`, `src/scene/validate.ts`, `src/editor/Timeline.svelte`, `src/editor/Inspector.svelte`, `src/App.svelte`, `src/app.css`, `tests/runtime/animator.test.ts`, `tests/scene/validate-animations.test.ts`, `README.md`, `SUBMISSION.md`, `DECISIONS.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Complete the M6 keyframe, scrub, and Play acceptance flow on the shared scene operation path.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 45 Vitest tests, and Vite production build.
- Limitations: Dynamic rigid body Transform tracks are skipped with a console warning. No graph editor or key dragging is included. Production build still reports large three.js and Rapier chunks.

### 2026-10-10T23:41:00+05:30 — Build M5 AI scene agent

- Changed: Added registry-driven component/script prompts and JSON Schema output, a Vite dev-server proxy that reads credentials server-side, browser transport, operation/script validation with up to three correction retries, an AI chat panel with expandable operation diffs and per-change undo, and viewport framing for the first changed entity. Added `.env.example` and prompt/transport/agent tests. Files: `src/ai/`, `src/editor/AIPanel.svelte`, `src/App.svelte`, `src/editor/Viewport.svelte`, `src/app.css`, `vite.config.ts`, `.env.example`, `tests/ai/`, `tests/ai-client.test.ts`, `README.md`, `SUBMISSION.md`, `DECISIONS.md`, `AI_USAGE.md`, and `CHANGELOG.md`.
- Why: Complete the M5 natural-language scene editing flow while keeping generated changes on the validated, undoable operation path.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 36 Vitest tests, and Vite production build. A local proxy smoke request returned the expected HTTP 503 while AI credentials were unset.
- Limitations: Live provider generation is unverified without credentials. The key proxy is Vite development middleware and will move to a Tauri Rust command at M8. Large three.js and Rapier chunks still trigger Vite's size warning.

### 2026-10-10T23:33:21+05:30 — Build M4 scripting language and runtime

- Changed: Added indentation-aware lexer and parser, source-located type diagnostics using the component registry, AST-generated restricted JavaScript, script parameter controls, deterministic `random()`, `on start`, `every frame`, interval and collision handlers, scene field edits through `applyOps`, built-ins, print output, and rigidbody impulse/velocity actions. Added parser, checker, codegen, and runtime tests. Files: `src/lang/`, `src/runtime/scripts.ts`, `src/runtime/physics.ts`, `src/editor/Inspector.svelte`, `src/registry/`, `src/scene/validate.ts`, `tests/`, `README.md`, `SUBMISSION.md`, `DECISIONS.md`, and `AI_USAGE.md`.
- Why: Complete the M4 scripting milestone so scene behavior can be authored and inspected in the editor.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/warnings), all 26 Vitest tests, and Vite production build.
- Limitations: Script frame handlers currently run once per rendered frame, not once per fixed physics step. Script source and parameter changes during Play do not update running instances. Runtime exceptions are reported at line 1 because source maps are not generated. Vite still warns that three.js and Rapier chunks exceed 500 kB.

### 2026-10-10T23:21:41+05:30 — Build M3 Play/Pause/Stop physics

- Changed: Added `PhysicsRuntime` with Rapier rigid bodies/colliders/joints, fixed-step accumulation, scene transform sync through `applyOps`, and `SimulationController` snapshot/pause/stop state. Connected toolbar controls and a tinted simulation viewport. Added tests for a settling stack of 20 boxes, pause, and exact snapshot restore. Files: `src/runtime/physics.ts`, `src/App.svelte`, `src/app.css`, `tests/runtime/physics.test.ts`, `README.md`, `SUBMISSION.md`, `DECISIONS.md`, and `AI_USAGE.md`.
- Why: Complete the M3 simulation milestone while preserving scene edits as validated transient operations during Play.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors, 0 warnings), 11 Vitest tests including a settling stack, exact snapshot restore, and rope joint creation, and Vite production build. The Vite dev server returned HTTP 200 for `/`, `/src/App.svelte`, and `/src/runtime/physics.ts`.
- Limitations: Edits made during Play are discarded on Stop; inspector edits are reflected in the scene but do not rebuild existing Rapier bodies or change their physics parameters live. Rendering uses the latest fixed-step body transform without interpolation. Script and collision-event systems are later milestones. Build emits >500 kB chunk warnings for three.js and Rapier.

### 2026-10-10T23:11:07+05:30 — Build M2 viewport, hierarchy, and inspector

- Changed: Added the three.js WebGL viewport with OrbitControls, selection, TransformControls, W/E/R tools and F focus; entity hierarchy with add/delete/reparent; schema-driven inspector widgets; editor undo/redo and JSON open/save. Extended update ops with optional parent changes so reparenting uses the same validated mutation path. Files: `src/editor/`, `src/App.svelte`, `src/app.css`, `src/scene/types.ts`, `src/scene/applyOps.ts`, `tests/scene/applyOps.test.ts`, `package.json`, `package-lock.json`, `README.md`, `DECISIONS.md`, `AI_USAGE.md`, and `SUBMISSION.md`.
- Why: Complete the M2 editor shell and make visual scene edits go through the shared operation/history layer.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors, 0 warnings), 8 Vitest tests, and Vite production build. The Vite server returned HTTP 200 for `/`, `/src/App.svelte`, and `/src/editor/Viewport.svelte`.
- Limitations: No physics, script runtime, AI panel, timeline, export, or Tauri packaging yet. Vite warns that the current three.js chunk is over 500 kB; visual behavior has been checked by compilation but not through an interactive browser session.

### 2026-10-10T23:00:28+05:30 — Build M1 scene registry and core

- Changed: Added TypeScript schemas for all nine components, scene/settings validation, atomic `applyOps`, inverse operations, undo/redo history, JSON serialization, and a Svelte 5 browser starter. Added Vitest, Vite, TypeScript, and Svelte tooling plus setup and status docs. Files: `src/registry/`, `src/scene/`, `src/App.svelte`, `src/main.ts`, `src/app.css`, `tests/scene/`, `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `README.md`, `DECISIONS.md`, `AI_USAGE.md`, and `SUBMISSION.md`.
- Why: Follow `app-build-prompt.md` in milestone order, establishing the shared schema and mutation path before editor features. Tauri remains scheduled for M8.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors, 0 warnings), 7 Vitest tests, and a Vite production build. The Vite dev server also served the app and its entry module with HTTP 200.
- Limitations: M1 has no viewport, inspector, physics runtime, script compiler, AI agent, timeline, exports, or Tauri packaging. Animator tracks are only reserved as managed data and have no timeline behavior yet.

### 2026-10-10T22:33:18+05:30 — Record the implementation checkpoint

- Changed: Recorded the implementation commit SHA and clarified it should be updated if the code changes before submission. Files: `SUBMISSION.md`, `CHANGELOG.md`, and `AI_USAGE.md`.
- Why: Make the demo's code reference reviewable while keeping the submission details tied to the implementation that was committed.
- Validation: Confirmed the recorded SHA with `git log`; checked the repository status after the implementation commit.
- Limitations: Participant names and the organizers' final submission method remain unknown and need the team's input.

### 2026-10-10T22:27:55+05:30 — Build the scene parser MVP

- Changed: Added the Node.js CLI and HTTP API, OpenAI Responses API integration, scene prompt construction, runtime component registry support, local operation validation, and setup/demo documentation. Files: `package.json`, `src/cli.js`, `src/openai.js`, `src/prompts.js`, `src/server.js`, `src/validate.js`, `README.md`, `AI_USAGE.md`, and `SUBMISSION.md`.
- Why: Turn plain-language scene edits into safe-to-review JSON operations for a host simulation.
- Validation: `npm run check` passed. A Node smoke check accepted a valid operation, rejected an unsupported field, and rejected a dangling scene parent. A local HTTP smoke check passed `/health` and confirmed malformed scene input returns HTTP 400.
- Limitations: Live generation requires an OpenAI API key and is unverified here. Script compilation and simulator application are outside this MVP.

## Template setup — 10 October 2026

- Changed: Added the event README, rules, agent guide, change log, AI usage record, submission checklist, Git ignore rules, and pull request checklist.
- Why: Give participants a consistent starting point for event rules, basic coding patterns, documented changes, and regular commits.
- Validation: Checked local Markdown links, event detail consistency, required documents, and diff whitespace before publishing.
- Limitations: Documentation scaffolding only; no participant project, application, or working demo was included at template setup.
