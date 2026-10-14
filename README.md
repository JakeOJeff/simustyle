# SimuStyle

SimuStyle is a 3D scene editor for building, scripting, animating, and simulating interactive scenes. It runs in a browser and can also be packaged as a Windows desktop app.

## Features

- Build scenes with a 3D viewport, hierarchy, and inspector.
- Apply nine built-in surface textures with adjustable tiling; maps load on demand and work in scene saves and exports.
- Add physics, collisions, lights, cameras, and parented objects.
- Use a default scene camera with perspective/orthographic lenses, follow and aim targets, fly controls, attachments, keyframes, and a `camera.*` scripting API.
- Write behaviors in a plain-English scripting language.
- Preview scenes with physics and animation, then undo or redo edits.
- Orbit with left-drag, pan with middle-drag, and right-click to add objects at the pointer or under a parent.
- Export scenes as GLB, standalone HTML, or WebM.
- Optionally use an AI assistant to create and edit scenes.
- Learn features through optional, self-paced interactive tutorial chapters in Docs; progress is saved on this device.

## Scripting

Select an object and open Script. Scripts expose `setting` values in Inspector and run during Play. This example makes the default camera movable and gives it an adjustable lens:

```
setting lens = 65 from 10 to 120
when game starts
  camera.set("fov", lens)
  camera.set("controls", "fly")
```

Click the Play view, then use WASD, Q/E, Shift, and left-drag. See the [camera guide](docs/USER_GUIDE.md#cameras) for following, switching, animation, and attachments.

## Run locally

**Requirements:** Node.js 20.19 or newer and npm.

```sh
npm install
npm run dev
```

Open the local address printed by Vite. The landing page is at `/` and the editor is at `/editor/`. The browser editor uses WebGL for its 3D viewport.

## Optional AI setup

The editor works without AI credentials. To enable AI features, copy `.env.example` to `.env` in the repository root and set `AI_API_KEY` and `AI_MODEL`. `AI_BASE_URL` is optional and defaults to `https://api.openai.com/v1`. Keep credentials in `.env`; do not commit them. AI requests are sent through the development server, which keeps the key out of the browser.

## Desktop app

Run the desktop app in development with:

```sh
npm run tauri:dev
```

Building the Windows installer requires Rust, the MSVC C++ build tools, WebView2, NSIS, and the `x86_64-pc-windows-msvc` Rust target. See the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) and [installer guide](https://v2.tauri.app/distribute/windows-installer/). Build with `npm run tauri:build`.

To publish desktop installers, create a GitHub release with a semantic version tag such as `v0.3.0` and publish it. The `Release desktop apps` workflow stamps the app with that version and attaches a Windows NSIS installer, a macOS DMG, and Linux DEB and AppImage packages to the release. Running the workflow by hand from the Actions tab builds each platform package as an artifact without touching a release. The site's `/download/windows` link continues to use the Windows installer attached to the newest release.

## Host on Cloudflare

The site (landing page, editor, and AI proxy) deploys as one Cloudflare Worker with static assets, configured in `wrangler.jsonc`.

```sh
npx wrangler login     # once
npm run deploy         # builds dist/ and deploys
npm run preview:cf     # builds and runs the Worker locally
```

The Worker serves `dist/` and handles two routes itself:

- `POST /api/ai/chat`: the same AI proxy as the dev server. It returns "AI is not configured" until you add secrets with `npx wrangler secret put AI_API_KEY` and `npx wrangler secret put AI_MODEL` (and optionally `AI_BASE_URL`). Each visitor gets `AI_DAILY_CREDITS` model calls per UTC day (default 30) and the whole site stops at `AI_GLOBAL_DAILY_CREDITS` (default 3000); both are set in `wrangler.jsonc` and counted by the `AiCreditLedger` Durable Object. Set a provider spending limit as well.
- `GET /api/ai/credits`: the visitor's remaining credits for today, shown in the Assistant window.
- `GET /download/windows`: redirects to the newest GitHub release's `-setup.exe`, or to the releases page if there is none. Change `GITHUB_REPO` in `wrangler.jsonc` if the repository moves.

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
