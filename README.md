# SimuStyle

SimuStyle is a 3D scene editor for building, scripting, animating, and simulating interactive scenes. It runs in a browser and can also be packaged as a Windows desktop app.

## Features

- Build scenes with a 3D viewport, hierarchy, and inspector.
- Apply nine built-in surface textures with adjustable tiling; maps load on demand and work in scene saves and exports.
- Add physics, collisions, lights, cameras, and parented objects.
- Use a default scene camera with perspective/orthographic lenses, follow and aim targets, fly controls, attachments, keyframes, and a `camera.*` scripting API.
- Write behaviors in a plain-English scripting language.
- Preview scenes with physics and animation, then undo or redo edits.
- Orbit with right-drag, pan with middle-drag, and short right-click to add objects at the pointer or under a parent.
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

The editor works without AI credentials. To enable AI features, copy `.env.example` to `.env` in the repository root and set `AI_API_KEY` and `AI_MODEL_LUNA` (the older `AI_MODEL` still works). `AI_BASE_URL` is optional and defaults to `https://api.openai.com/v1`. Keep credentials in `.env`; do not commit them. AI requests are sent through the development server, which keeps the key out of the browser.

The assistant follows a [creation contract](src/ai/designRules.ts) covering silhouettes, proportions, palette, materials, spacing, lighting, camera composition, and meaningful folders. Describe your own style and colors in the request; those take priority over the default cohesive stylized approach. It keeps the last six successful requests as context within the current document and clears that context when you open or create a scene.

Its [building functions](src/ai/buildTools.ts) include `assemble` for multipart objects, `repeat` for complete object hierarchies, and `group` for organizing existing objects while preserving world positions. These compile to the ordinary validated, undoable scene operations. Builds are limited to 1,500 expanded operations, with up to 300 parts per assembly and 200 additional copies per repetition. Responses have a 36,000-character budget (smaller for long requests), so large arrays should use `repeat`. Bounded scene snapshots prioritize selected objects, requested subjects, and their folders; omitted details are marked explicitly. The assistant receives your selection to resolve requests such as "make this red".

Before applying a build, the assistant checks components and script compilation, previews scripts in isolation, measures world bounds and organization, then reviews the request against those results. Expand **Checked before apply** to see diagnostics and remaining design warnings. Geometry checks are advisory and use conservative bounds; they do not replace rendering or Rapier physics. Explicit positions are preserved for review, including intentional underground or underwater geometry.

To measure build quality against the real models, run `npm run ai:eval`. It uses the keys in `.env`/`.env.local` and runs the scene agent on an empty scene for four fixed prompts: a kitchen nook, the house from Up with furniture, a sports car, and a snowman garden. None of them is one of the prompt examples, so the run measures how well the rules generalize. Pass your own prompts after `--` to run those instead. Each run writes to `eval-output/<timestamp>/`: a screenshot from a fixed 3/4 angle, the scene, and a `result.json` with the ops, correction errors, geometry notes and every call's model, tokens and cost. It ends by printing a summary table. It spends real API credit (about $0.15 for the four prompts with Sol on) and needs Chrome (`CHROME_PATH` overrides the default Windows path).

Caching is bounded and held in memory: static prompt/schema text, scene descriptions, and up to 12 fully reviewed builds for five minutes. Build keys include the exact scene, request, recent request context, system instructions, and output schema. Cached builds are validated and previewed again before use. Rejected builds and unreviewed fallbacks are never cached. Opening/new scenes or changing desktop provider settings clears the build cache.

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

- `POST /api/ai/chat`: the same AI proxy as the dev server. The browser sends a `task` (`parse`, `scene_draft`, `scene_detail` or `scene_review`), never a model. The server maps parse, drafts and detail passes to `AI_MODEL_LUNA`, and maps reviews to `AI_MODEL_SOL` only when `AI_SOL_ENABLED` is `"true"`. Each task has an input cap (8,000 characters for parse, 48,000 for the scene tasks) and a `max_completion_tokens` (800 / 8,000 / 16,000 / 4,000). With `stream: true` the reply is relayed as newline-delimited JSON while the model writes it. It returns "AI is not configured" until you add the `AI_API_KEY` secret (`npx wrangler secret put AI_API_KEY`, optionally `AI_BASE_URL`). One credit is $0.00167. Each call is charged from the provider's reported token usage (see `src/ai/pricing.ts`), and a visitor must hold the task's worst case first (2 / 5 / 6 / 30 credits). Each visitor gets `AI_DAILY_CREDITS` per UTC day (default 30). The site spends at most `AI_MONTHLY_BUDGET_USD` per month (default 150), spread over the days left and never more than `AI_DAILY_MAX_USD` in a day (default 15). The `AiCreditLedger` Durable Object counts both. Set a provider spending limit as well.
- `GET /api/ai/spend`: month-to-date spend per task and today's cap. The `X-Admin-Secret` header must match the `AI_ADMIN_SECRET` secret; it answers 404 while that secret is unset.
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
