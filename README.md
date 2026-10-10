# SimuStyle

SimuStyle is an AI-native 3D scene, simulation, and animation editor. The implementation is being built in the order defined by [`app-build-prompt.md`](app-build-prompt.md). The current checkpoint is **M7: scene export**. The Svelte 5 browser app has a three.js viewport, editable scene tree, schema-driven inspector, Rapier simulation, a typed scripting language, an AI prompt/retry/apply flow, an animation timeline, and GLB/standalone HTML/WebM export; Tauri packaging is the remaining milestone.

## Requirements

- Node.js 20.19 or newer
- npm
- A browser with WebGL for the later 3D viewport milestones

## Install and run

```sh
npm install
cp .env.example .env
npm run dev
```

Edit `.env` in the repository root to set `AI_API_KEY` and `AI_MODEL` before using the AI tab. The file is ignored by Git; `.env.example` is the safe template.

Open the local URL printed by Vite. Add boxes from the hierarchy, select them, edit material and transform fields, or use W/E/R gizmos. Undo and redo apply to edits, inspector slider drags, gizmo drags, and hierarchy reparenting. Click the keyframe diamond beside an animatable inspector field to add a key at the current playhead, then scrub the Timeline tab or press Play to preview it. Animator tracks support linear, ease-in-out, and step interpolation; dynamic rigid body Transform tracks are skipped with a console warning. Add a Script component and enter `param`, `let`, `on start`, `every frame`, `on collide(other)`, or `every <seconds>s` handlers. Ranged script parameters appear as inspector controls. Play runs scripts, animation, and Rapier physics; compile errors appear inline and in the console. Pause freezes stepping and Stop restores the exact scene from before Play. Use the Export menu for a GLB snapshot, an offline standalone HTML page, or a WebM capture of Play at 720p or 1080p. The standalone page autoplays and accepts `?controls=1` to display script parameter sliders. Use the AI tab to request scene changes; generated operations and Script source are validated before a single undoable apply. AI requests need `AI_API_KEY` and `AI_MODEL`; credentials are read by the Vite dev server from `.env` in the repository root and never use a `VITE_` prefix. `AI_BASE_URL` is optional and defaults to OpenAI's `/v1` API. Scene files can be opened and saved as JSON.

## Check and build

```sh
npm run check
npm run build
```

`npm run check` runs TypeScript, Svelte diagnostics, Vitest, and a production build. `npm run build` writes the browser app to `dist/`.

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

## Scene core

The component registry lives in `src/registry/`. `applyOps(scene, ops)` validates and applies a complete batch atomically, returning inverse operations for undo. `SceneHistory` keeps undo and redo batches. `serializeScene` omits default component and settings values; `deserializeScene` restores defaults and validates loaded data.

Components in M1: Transform, Mesh, Material, RigidBody, Joint, Light, Camera, Script, and Animator. Script source is lexed, parsed, type-checked against the component registry, and compiled from AST nodes to a restricted runtime API. `random()` uses deterministic seeded state, and script scene changes go through `applyOps`. Animator timeline tracks are managed separately from raw inspector fields.

## Project status

- **Implemented:** M1 registry, validation, atomic scene operations, undo/redo, serialization; M2 viewport, hierarchy, inspector, scene open/save; M3 fixed-step Rapier physics, joints, Play/Pause/Stop, and snapshot restore; M4 lexer/parser/type checker/code generator, inspector params, seeded random, runtime handlers, print output, rigidbody actions, and contact callbacks; M5 live-registry AI prompt, server-side dev proxy, schema-structured output, validation retry loop, operation diff, and undoable scene changes; M6 inspector keyframing, timeline scrubbing, linear/ease-in-out/step animation, and animation during Play; M7 GLB, self-contained HTML, and WebM exports.
- **Not implemented yet:** Tauri packaging and native settings/file dialogs. Live AI calls require a configured key and model and have not been verified in this environment.
- **M4 limitations:** `every frame` runs once per rendered frame, while physics advances in fixed steps. Script source/parameter edits during Play do not update existing script instances; Stop restores the original scene. Runtime exceptions currently report line 1 because generated code has no source map.
- **M5 limitations:** The API key proxy is a Vite development-server middleware. Production/Tauri transport will be replaced by the Rust command in M8. Live generation has not been verified without credentials.
- **M6 limitations:** Timeline edits are stored in Animator tracks and scrub/play in the editor. Transform tracks on dynamic bodies are skipped with a warning; animate static or kinematic transforms instead. Track/key selection controls are intentionally small and do not provide graph curves or key dragging.
- **M7 limitations:** WebM uses MediaRecorder to capture the live Play viewport in real time; recording duration follows wall-clock time and physics uses its configured fixed timestep. Standalone HTML embeds the full renderer/runtime bundle (about 5 MB before compression) and needs a WebGL-capable browser. Tauri packaging and native file dialogs/settings remain for M8.
- **Previous parser checkpoint:** the committed Node CLI/API prototype remains in the repository as a separate earlier implementation; the current browser editor uses the TypeScript scene agent built from the live component registry.

See [`CHANGELOG.md`](CHANGELOG.md) for completed work and [`AI_USAGE.md`](AI_USAGE.md) for Codex contributions.
