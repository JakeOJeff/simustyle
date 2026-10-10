# SimuStyle

SimuStyle is an AI-native 3D scene, simulation, and animation editor. The implementation is being built in the order defined by [`app-build-prompt.md`](app-build-prompt.md). The current checkpoint is **M4: scripting language and runtime**. The Svelte 5 browser app has a three.js viewport, editable scene tree, schema-driven inspector, Rapier simulation, and a typed scripting language; AI, timeline, export, and the Tauri shell are later milestones.

## Requirements

- Node.js 20.19 or newer
- npm
- A browser with WebGL for the later 3D viewport milestones

## Install and run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Add boxes from the hierarchy, select them, edit material and transform fields, or use W/E/R gizmos. Undo and redo apply to edits, inspector slider drags, gizmo drags, and hierarchy reparenting. Add a Script component and enter `param`, `let`, `on start`, `every frame`, `on collide(other)`, or `every <seconds>s` handlers. Ranged script parameters appear as inspector controls. Play runs scripts with Rapier physics; compile errors appear inline and in the console. Pause freezes stepping and Stop restores the exact scene from before Play. Scene files can be opened and saved as JSON. No API key is needed.

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

- **Implemented:** M1 registry, validation, atomic scene operations, undo/redo, serialization; M2 viewport, hierarchy, inspector, scene open/save; M3 fixed-step Rapier physics, joints, Play/Pause/Stop, and snapshot restore; M4 lexer/parser/type checker/code generator, inspector params, seeded random, runtime handlers, print output, rigidbody actions, and contact callbacks.
- **Not implemented yet:** AI scene agent, timeline, glTF/HTML/video exports, and Tauri packaging.
- **M4 limitations:** `every frame` runs once per rendered frame, while physics advances in fixed steps. Script source/parameter edits during Play do not update existing script instances; Stop restores the original scene. Runtime exceptions currently report line 1 because generated code has no source map.
- **Previous parser checkpoint:** the committed Node CLI/API prototype remains in the repository, but it is not wired into the current browser editor. The prompt-driven AI agent will be built in M5 using the editor's schema registry.

See [`CHANGELOG.md`](CHANGELOG.md) for completed work and [`AI_USAGE.md`](AI_USAGE.md) for Codex contributions.
