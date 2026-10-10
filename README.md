# SimuStyle

SimuStyle is an AI-native 3D scene, simulation, and animation editor. The implementation is being built in the order defined by [`app-build-prompt.md`](app-build-prompt.md). The current checkpoint is **M3: physics and Play/Pause/Stop**. The Svelte 5 browser app has a three.js viewport, editable scene tree, schema-driven inspector, and Rapier simulation; scripting, AI, timeline, export, and the Tauri shell are later milestones.

## Requirements

- Node.js 20.19 or newer
- npm
- A browser with WebGL for the later 3D viewport milestones

## Install and run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Add boxes from the hierarchy, select them, edit material and transform fields, or use W/E/R gizmos. Undo and redo apply to edits, inspector slider drags, gizmo drags, and hierarchy reparenting. Press Play to run Rapier physics, Pause to freeze it, and Stop to restore the exact scene from before Play. Scene files can be opened and saved as JSON. No API key is needed at this milestone.

## Check and build

```sh
npm run check
npm run build
```

`npm run check` runs TypeScript, Svelte diagnostics, Vitest, and a production build. `npm run build` writes the browser app to `dist/`.

## Scene core

The component registry lives in `src/registry/`. `applyOps(scene, ops)` validates and applies a complete batch atomically, returning inverse operations for undo. `SceneHistory` keeps undo and redo batches. `serializeScene` omits default component and settings values; `deserializeScene` restores defaults and validates loaded data.

Components in M1: Transform, Mesh, Material, RigidBody, Joint, Light, Camera, Script, and Animator. Scripts are stored as source text at this milestone; their language is implemented in M4. Animator timeline tracks are managed separately from raw inspector fields.

## Project status

- **Implemented:** M1 registry, validation, atomic scene operations, undo/redo, serialization; M2 viewport, hierarchy, inspector, scene open/save; M3 fixed-step Rapier physics, joints, Play/Pause/Stop, and snapshot restore.
- **Not implemented yet:** script compiler/runtime, AI scene agent, timeline, glTF/HTML/video exports, and Tauri packaging.
- **Previous parser checkpoint:** the committed Node CLI/API prototype remains in the repository, but it is not wired into the current browser editor. The prompt-driven AI agent will be built in M5 using the editor's schema registry.

See [`CHANGELOG.md`](CHANGELOG.md) for completed work and [`AI_USAGE.md`](AI_USAGE.md) for Codex contributions.
