# Change log

Record meaningful project changes during the event, newest first.

## Event build log

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
