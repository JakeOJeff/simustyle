# AI usage record

## Event build log

| Date and time with timezone | Tool / model, if known | Task | Assistance and affected files | Human review / corrections | Validation and result |
| --- | --- | --- | --- | --- | --- |
| 2026-10-10 22:27 IST | Codex | Build the SimuStyle scene parser | Implemented the Node CLI/API, prompt assembly, OpenAI Responses API call, bounded correction attempt, runtime schema validation, setup/demo docs, and event records across `package.json`, `src/`, `README.md`, `CHANGELOG.md`, and `SUBMISSION.md`. | Pending participant review; code adjusted to validate generated operations against the runtime component registry and never store API keys. | `npm run check`, validator smoke checks, and local HTTP health/invalid-input smoke checks passed; live model generation is unverified because no API key is configured. |
| 2026-10-10 22:33 IST | Codex | Record the implementation checkpoint | Added the current implementation SHA to `SUBMISSION.md` and documented the checkpoint. | Pending participant review; no code correction was needed. | Confirmed the SHA using `git log`; repository was clean after the implementation commit. |
| 2026-10-10 23:00 IST | Codex | Build M1 scene core from `app-build-prompt.md` | Added strict TypeScript component schemas, scene validation/operations/history/serialization, a Svelte 5 browser starter, Vitest tests, and setup/status documentation. Replaced the uncommitted partial vanilla Tauri shell so Tauri remains at M8 as specified. | Pending participant review. The prompt's explicit M1 order and required stack guided the correction. | `npm run check` passed: TypeScript, Svelte diagnostics, 7 Vitest tests, and Vite production build. The Vite dev server served the app and entry module with HTTP 200. No live AI calls are part of M1. |
| 2026-10-10 23:11 IST | Codex with delegated Codex agents | Build M2 viewport, hierarchy, and inspector | Added the three.js viewport with selection, orbit controls, transform gizmos and focus; hierarchy add/delete/reparent; schema-rendered inspector widgets; editor history and JSON open/save; plus reparent support in `applyOps`. | Pending participant review. The hierarchy and viewport were implemented in separate files and integrated by the primary agent; slider/gizmo drag history was coalesced after review. | `npm run check` passed: TypeScript, Svelte diagnostics (0 errors/warnings), 8 Vitest tests, and Vite production build. The Vite server returned HTTP 200 for the app, App.svelte, and Viewport.svelte. The 3D bundle triggers Vite's >500 kB chunk warning. |

## Template preparation

On 10 October 2026, Codex prepared the initial documentation template from the organizer's supplied rules. That template setup predates the participant implementation recorded above.
