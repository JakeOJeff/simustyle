# SimuStyle

SimuStyle is a 3D scene editor for building, scripting, animating, and simulating interactive scenes. It runs in a browser and can also be packaged as a Windows desktop app.

## Features

- Build scenes with a 3D viewport, hierarchy, and inspector.
- Add physics, collisions, lights, cameras, and parented objects.
- Write behaviors in a plain-English scripting language.
- Preview scenes with physics and animation, then undo or redo edits.
- Orbit with left-drag, pan with middle-drag, and right-click to add objects at the pointer or under a parent.
- Export scenes as GLB, standalone HTML, or WebM.
- Optionally use an AI assistant to create and edit scenes.

## Run locally

**Requirements:** Node.js 20.19 or newer and npm.

```sh
npm install
npm run dev
```

Open the local address printed by Vite. The browser editor uses WebGL for its 3D viewport.

## Optional AI setup

The editor works without AI credentials. To enable AI features, copy `.env.example` to `.env` in the repository root and set `AI_API_KEY` and `AI_MODEL`. `AI_BASE_URL` is optional and defaults to `https://api.openai.com/v1`. Keep credentials in `.env`; do not commit them. AI requests are sent through the development server, which keeps the key out of the browser.

## Desktop app

Run the desktop app in development with:

```sh
npm run tauri:dev
```

Building the Windows installer requires Rust, the MSVC C++ build tools, WebView2, NSIS, and the `x86_64-pc-windows-msvc` Rust target. See the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) and [installer guide](https://v2.tauri.app/distribute/windows-installer/). Build with `npm run tauri:build`.

## Project docs

- [User guide](docs/USER_GUIDE.md): editor controls and workflows.
- [Demo walkthrough](docs/DEMO.md): presentation script and examples.
- [Script demo runbook](docs/DEMO_SCRIPTS.md): paste-ready script examples.
- [Technical decisions](DECISIONS.md): key implementation choices.
- [Change log](CHANGELOG.md): project milestones and validation notes.

## Checks

```sh
npm run check
npm run build
```

`npm run check` runs TypeScript checks, Svelte diagnostics, the test suite, and a production build. `npm run build` creates the browser app in `dist/`.

## Technology

SimuStyle uses Svelte 5, Three.js, Rapier, TypeScript, Vite, and Vitest. The desktop shell uses Tauri 2. See the linked documentation for each library and API.

## Current limitations

- Live AI provider requests require valid credentials and network access; they have not been verified without credentials.
- The Windows Tauri installer needs a Windows build environment with the prerequisites above.
- WebM export records the live viewport in real time. Standalone HTML includes the renderer and runtime, so exported files are several megabytes before compression.
