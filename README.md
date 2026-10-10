# SimuStyle

SimuStyle is an AI-native 3D scene, simulation, and animation editor. The implementation is being built in the order defined by [`app-build-prompt.md`](app-build-prompt.md). The current checkpoint is **M5: AI scene agent**. The Svelte 5 browser app has a three.js viewport, editable scene tree, schema-driven inspector, Rapier simulation, a typed scripting language, and an AI prompt/retry/apply flow; timeline, export, and the Tauri shell are later milestones.

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

Open the local URL printed by Vite. Add boxes from the hierarchy, select them, edit material and transform fields, or use W/E/R gizmos. Undo and redo apply to edits, inspector slider drags, gizmo drags, and hierarchy reparenting. Add a Script component and enter `param`, `let`, `on start`, `every frame`, `on collide(other)`, or `every <seconds>s` handlers. Ranged script parameters appear as inspector controls. Play runs scripts with Rapier physics; compile errors appear inline and in the console. Pause freezes stepping and Stop restores the exact scene from before Play. Use the AI tab to request scene changes; generated operations and Script source are validated before a single undoable apply. AI requests need `AI_API_KEY` and `AI_MODEL`; credentials are read by the Vite dev server from `.env` in the repository root and never use a `VITE_` prefix. `AI_BASE_URL` is optional and defaults to OpenAI's `/v1` API. Scene files can be opened and saved as JSON.

## Check and build

```sh
npm run check
npm run build
```

`npm run check` runs TypeScript, Svelte diagnostics, Vitest, and a production build. `npm run build` writes the browser app to `dist/`.

## Scene core

The component registry lives in `src/registry/`. `applyOps(scene, ops)` validates and applies a complete batch atomically, returning inverse operations for undo. `SceneHistory` keeps undo and redo batches. `serializeScene` omits default component and settings values; `deserializeScene` restores defaults and validates loaded data.

Components in M1: Transform, Mesh, Material, RigidBody, Joint, Light, Camera, Script, and Animator. Script source is lexed, parsed, type-checked against the component registry, and compiled from AST nodes to a restricted runtime API. `random()` uses deterministic seeded state, and script scene changes go through `applyOps`. Animator timeline tracks are managed separately from raw inspector fields.

## Project status

- **Implemented:** M1 registry, validation, atomic scene operations, undo/redo, serialization; M2 viewport, hierarchy, inspector, scene open/save; M3 fixed-step Rapier physics, joints, Play/Pause/Stop, and snapshot restore; M4 lexer/parser/type checker/code generator, inspector params, seeded random, runtime handlers, print output, rigidbody actions, and contact callbacks; M5 live-registry AI prompt, server-side dev proxy, schema-structured output, validation retry loop, operation diff, and undoable scene changes.
- **Not implemented yet:** timeline, glTF/HTML/video exports, and Tauri packaging. Live AI calls require a configured key and model and have not been verified in this environment.
- **M4 limitations:** `every frame` runs once per rendered frame, while physics advances in fixed steps. Script source/parameter edits during Play do not update existing script instances; Stop restores the original scene. Runtime exceptions currently report line 1 because generated code has no source map.
- **M5 limitations:** The API key proxy is a Vite development-server middleware. Production/Tauri transport will be replaced by the Rust command in M8. Live generation has not been verified without credentials.
- **Previous parser checkpoint:** the committed Node CLI/API prototype remains in the repository as a separate earlier implementation; the current browser editor uses the TypeScript scene agent built from the live component registry.

See [`CHANGELOG.md`](CHANGELOG.md) for completed work and [`AI_USAGE.md`](AI_USAGE.md) for Codex contributions.
