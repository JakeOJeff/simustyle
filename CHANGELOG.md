# Change log

Record meaningful project changes during the event, newest first.

## Event build log

### 2026-10-25 — `npm run ai:eval` quality runs, and floors no longer count as sunk objects

- Changed:
  - New `npm run ai:eval` (`scripts/ai-eval/`). It runs the real scene agent through the same proxy code, prompts and Luna/Sol routing as the editor, using keys from `.env`/`.env.local`. It starts from an empty scene for: "Build a cozy reading corner in warm wood and sage green", "Create the house from Up and decorate its insides with furniture", "A red sports car" and "A snowman in a snowy garden". Prompts passed after `--` replace the list. Each prompt gets a folder in `eval-output/<timestamp>/`: `screenshot.png` (1280×800, fixed 3/4 angle framed to the build, rendered in headless Chrome with the editor's own geometry, materials and lights), `scene.json`, and `result.json` (summary, ops, correction errors per call, geometry and design notes, and each call's model, tokens and cost). The run ends with a summary table, also saved as `summary.txt` and `summary.json`. `eval-output/` is git-ignored.
  - `src/ai/client.ts` now exports `sceneEditMessages` and `parseChatPayload`, so the eval builds and parses calls exactly as the editor does.
  - Geometry checker: a group containing a flat ground slab (at most 0.3 m thick, at least 1×1 m, top within 0.05 m of y=0) counts as resting on the ground, even though the slab extends below y=0.
  - `scripts/**/*.ts` is now type-checked.
  - Files: `scripts/ai-eval/run.ts`, `scripts/ai-eval/render.ts`, `scripts/ai-eval/report.ts`, `src/ai/client.ts`, `src/ai/geometry.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `README.md`, `tests/scripts/aiEval.test.ts`, `tests/ai/geometry.test.ts`.
- Why: Scene quality needed a repeatable, real-model check. The first smoke run showed that the empty-scene note makes the model add a ground slab, and the checker then flagged the whole composition as sunk, which wasted two paid correction calls.
- Validation: all 339 tests pass, including tests for the 3/4 framing, usage totals, the summary table and the ground-slab rule. One real run of the four prompts cost $0.14: three built (35, 23 and 47 parts) and screenshots were checked by eye.
- Limitations: Surface textures aren't drawn in screenshots. In that run, three of four first drafts were cut off at the 4,000-token output limit and needed a retry. The Up house failed after three cut-off replies. Fuller compositions need a higher `max_completion_tokens` or more compact replies.

### 2026-10-25 — Fuller first builds: keep props, compose empty scenes, filled shelves, real lamps and mood lighting

- Changed: Scene quality round 3.
  - The reviewer no longer removes "unrelated additions". It now keeps decorative details that support the request (props, clutter, small objects), removes only what contradicts the request or clearly wasn't wanted, and adds detail when the first build is sparse. The matching design rule ("never add unrelated props") now welcomes supporting props and rules out only unrelated objects and scripts.
  - When the scene has no entities, the request message asks for a full composition: a floor or ground, any walls the request implies, mood lighting, and a settings op for background and ambient light. The note goes in the per-call message, so the cached system prompt is unchanged for other builds.
  - New "Modeling well" rules: shelves get rows of 5–8 varied items and tables 2–4 props; light sources get a Light child at the bulb/flame and an emissive shade (intensity 1–3); "cozy"/"warm" and "bright"/"clean" set light color, ambient and background; "corner"/"nook"/"room" means two meeting walls with furniture within 1.5 m of the focal piece.
  - The chair few-shot example is replaced by a cozy reading corner: two walls, an armchair, a bookshelf with two rows of five varied books (one leaning, one stack), a side table with a mug and a book, a floor lamp with a truncated emissive shade and a warm point light inside, and dark-background, 0.3-ambient settings.
  - The scene tasks' input cap rises from 40,000 to 48,000 characters. The static system prompt grew from about 25,200 to 30,000 characters, and the higher cap keeps the same ~10,700 characters for scene context and history.
  - Files: `src/ai/agent.ts`, `src/ai/designRules.ts`, `src/ai/prompt.ts`, `src/ai/examples.ts`, `src/ai/tasks.ts`, `README.md`, `tests/ai/agent.test.ts`, `tests/ai/examples.test.ts`, `tests/ai/prompt.test.ts`, `tests/ai/placement.test.ts`.
- Why: Test builds were sparse. The reviewer stripped props, empty-scene requests produced loose objects on the grid, shelves were empty and lamps gave no light.
- Validation: all 336 tests pass. New tests check the reviewer wording, that the empty-scene note appears only for empty scenes and never in the system prompt, and that the new rules are present. The reading corner is checked like the other examples (valid, connected, grounded, at most 20 parts and 2–4 colors per object) plus: two walls meeting, each filled shelf row has 5–8 books varied in height, width and color with one tilted, 2–4 props on the table, a warm Light child inside an emissive, wide-end-down shade, ambient 0.3, a dark background, and furniture within 1.5 m of the armchair.
- Limitations: Every scene call now sends about 4,800 more characters, mostly cached input. A worst-case Sol review (48,000 characters in, 4,000 tokens out) can cost slightly more than the 30 credits held for it. The real charge is still settled from usage.

### 2026-10-25 — Turn on Sol scene reviews

- Changed: `AI_SOL_ENABLED` is now `"true"` in `wrangler.jsonc`, so qualifying scene reviews (3+ new objects, or a corrected draft) run on `gpt-6-sol`. Local dev sets it in the git-ignored `.env.local`.
- Why: Requested, to improve review quality.
- Validation: Config only; `tests/ai/chatProxy.test.ts` already covers the routing.
- Limitations: It takes effect on the next deploy. Sol reviews cost more per call (up to 30 credits held), so the daily and monthly caps are reached sooner.

### 2026-10-25 — Wedges, truncated cylinders/cones, an overlap check and stricter modeling rules

- Changed: Fixes scene quality problems seen in testing.
  - New mesh shape `wedge`: a triangular prism filling a 2·radius × height × 2·radius box, whose slope rises from the -X bottom edge to a vertical +X face. New optional Mesh field `radiusTop` (0–50) truncates cylinders and cones, for lampshades, pots and buckets. Unset, a cylinder's top equals its radius and a cone stays pointed. The viewport, both exports (GLB/HTML) and physics now share one geometry builder (`src/scene/meshGeometry.ts`). Wedges, truncated shapes and mirrored scales get a convex-hull collider. The Inspector shows `radiusTop` only for cylinders and cones, and the hierarchy has a Wedge icon.
  - The geometry checker now flags separately built top-level objects whose parts' bounds pass more than 0.03 m into each other ("FloorLamp overlaps SideTable by 0.2 m; move it apart."). Objects resting on or in another (bottom within 0.05 m of a part's top below it) and parts of one object are not flagged.
  - "Modeling well" rules: up to 60 parts for repeated small items, a defining feature on every part, hanging/floating things attached with a radius 0.01 cylinder, wedge-filled gables, stairs or a ladder for multi-floor buildings, and lampshades as truncated cones, wide end down. The mesh-size line in the system prompt describes `wedge` and `radiusTop`.
  - A fourth few-shot example, a two-story house with a wedge gable, roof slabs and outside stairs, uses `repeat` to stay compact. It is verified like the others: it must be valid, connected, grounded, 6–20 parts and 2–4 colors.
  - Files: `src/scene/meshGeometry.ts`, `src/registry/components/mesh.ts`, `src/registry/types.ts`, `src/scene/applyOps.ts`, `src/scene/serialize.ts`, `src/runtime/physics.ts`, `src/runtime/commands.ts`, `src/materials/mapping.ts`, `src/editor/Viewport.svelte`, `src/editor/Inspector.svelte`, `src/editor/Hierarchy.svelte`, `src/export/gltf.ts`, `src/export/standalone-runtime.ts`, `src/ai/geometry.ts`, `src/ai/examples.ts`, `src/ai/prompt.ts`, `src/ai/sceneContext.ts`, `src/ai/quality.ts`, tests.
- Why: Test builds had square gables, pointed lampshades, furniture passing through other furniture, floating balloons and lamps, and parts that couldn't be recognized alone.
- Validation: typecheck, svelte-check (0 errors), build, and all 330 tests pass. New tests cover wedge geometry, normals, bounds, export and sloped collider (including mirrored); `radiusTop` defaults, geometry, bounds, export, validation, saving and collider; the overlap check (flagged, apart, snug fit, resting, untouched); and the house example. Not checked visually in a browser.
- Limitations: The static system prompt grew from about 22,100 to 25,200 characters, which leaves less room for scene context in the 40,000-character request cap and costs more per call (mostly cached input). The overlap check uses axis-aligned bounds, so rotated or L-shaped parts can be reported as overlapping when only their boxes do. A cone's `radiusTop` defaults to 0, not to its radius, so existing cones stay pointed.

### 2026-10-25 — Apply what works instead of failing an AI build, with Retry and Continue

- Changed: "Could not complete after N AI calls" now only appears when no part of any attempt applies, or when the first call itself fails.
  - When every draft attempt is rejected, the assistant applies the largest part that still works. Failing ops are repaired first: a missing parent is detached to the root, or only the failing component (for example a broken Script) is dropped. Anything that still fails is skipped. The response lists what was left out.
  - When the review can't fix a draft's runtime script issues, the draft is applied with those issues listed, instead of failing.
  - Removed the 12,000-character reply limit. It rejected complete, valid replies, and the review and correction prompts already truncate long builds.
  - Every failed, held-back or partial response now has **Retry**. Partial builds also have **Continue**, which asks for only the missing parts.
  - A build held back because the scene changed while it loaded now has **Add what was built**. It applies to the current scene when the document is unchanged.
  - Salvaged builds are never cached, so Retry makes a fresh build.
  - Files: `src/ai/agent.ts`, `src/App.svelte`, `src/editor/AIPanel.svelte`, `docs/USER_GUIDE.md`, `tests/ai/agent.test.ts`.
- Why: Failed builds threw away paid calls and left users with no way forward but retyping the request.
- Validation: svelte-check (0 errors) and all 323 tests pass, including new tests for salvage, repair and no-cache. The Retry, Continue and Add buttons were not exercised in a browser.
- Limitations: A partial build is applied without the full review, and a draft can now be applied with runtime script issues (listed in its check details and undoable). The cause of the user's specific failures wasn't confirmed, because the error text wasn't available.

### 2026-10-25 — Offer the part of a failed AI build that still applies

- Changed: When every draft attempt is rejected ("Could not complete after 3 AI calls") or a later call fails, the assistant now looks at each rejected attempt and keeps the ops that still apply. An op is kept if it applies on top of the ones kept before it and adds no script compile errors. The failed message then shows an "Add what was built (N of M)" button, applied as one undoable edit. Previously the paid calls produced only an error. Files: `src/ai/agent.ts`, `src/editor/AIPanel.svelte`, `src/App.svelte`, `tests/ai/agent.test.ts`.
- Why: Users lost all of the work, and the credits, whenever a build failed validation on its last attempt.
- Validation: svelte-check (0 errors) and all 322 tests pass, including three new salvage tests. Not exercised in a browser.
- Limitations: Only ops that apply on their own are kept, so a part whose parent was dropped is dropped too. The partial build isn't reviewed and may show runtime issues. As with the existing draft button, it can only be added to the scene the request started from.

### 2026-10-25 — Describe money-based AI credits correctly in the docs

- Changed: The user guide and the in-app Docs panel said AI used "one credit per model call". They now say one credit is $0.00167 of AI spend, each call is charged for the tokens it used (rounded up), and a typical request costs about two to four credits. Files: `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`.
- Why: The docs were left over from before the switch to money-based credits.
- Validation: Docs text only. The two-to-four figure comes from the Luna prices and the task limits, not from measured usage.
- Limitations: Requests that retry, or reviews on Sol when `AI_SOL_ENABLED` is on, cost more than this.

### 2026-10-24 — Show the real AI error, and say what changed when a build is skipped

- Changed: A failed AI request now always shows its own error. Before, it was hidden behind "The scene changed while this request was loading" whenever the scene had changed. When a successful build is skipped, the message now says why (Play started, unsaved script edits, a different scene opened, or the build no longer applies) and lists up to three of the scene changes. File: `src/App.svelte`.
- Why: Users saw the generic "scene changed" message with no way to tell what changed or what had actually failed.
- Validation: svelte-check (0 errors) and all 319 tests pass. Not exercised in a browser.
- Limitations: None known.

### 2026-10-24 — Retry AI replies cut off at the output limit

- Changed: The proxy now detects `finish_reason: "length"` and returns the billed reply with `truncated: true`, including when all the tokens went to reasoning and no content came back. Before, that case was an error saying the provider returned no message content. The client raises `UnusableReplyError` for truncated or non-JSON replies. The agent treats that error as a correctable attempt: it retries with an instruction to return a much more compact build, within the existing caps of 2 draft retries and 1 review retry. Files: `src/ai/chatProxy.ts`, `src/ai/client.ts`, `src/ai/agent.ts`, and tests.
- Why: In the browser, a scene request failed with "Could not complete after 1 AI call" and was charged 2 credits, which matches a 4,000-token reply that was cut off. The client raised that as a hard error, so the agent never retried.
- Validation: tsc, svelte-check (0 errors), and all 319 tests pass. A live `gpt-6-luna` call for "add a red car" through the new proxy and agent succeeded: 2,693 completion tokens (1,021 reasoning), 98% of the prompt cached.
- Limitations: Reasoning tokens count against the 4,000-token cap, so large builds may still need a retry. If that happens often, consider a higher scene `maxCompletionTokens` or a lower reasoning effort for Luna.

### 2026-10-24 — Keep AI builds when the scene changed slightly while loading

- Changed: Before, an AI result was discarded whenever the scene object changed during the request: a camera move, a rename, any edit. Now the build's operations are replayed on the current scene and kept if they apply cleanly and add no script errors. It is still discarded when a different scene was opened or created, when Play is running or starting, or when a script has an unsaved draft. File: `src/App.svelte`.
- Why: With usage-priced credits, throwing away a finished build over an unrelated small edit wasted real money and showed "The scene changed while this request was loading" unexpectedly.
- Validation: `svelte-check` (0 errors) and all 314 tests pass. The replay path was not exercised in a browser.
- Limitations: The replay skips the agent's preflight checks on the edited scene; it only checks that the operations apply and add no script compile errors.

### 2026-10-24 — Luna/Sol task routing, money-based credits, cache-friendly prompts, modeling quality

- Changed: The browser now sends a `task` (`parse` / `scene_draft` / `scene_review`) instead of choosing a model. The server maps tasks to `AI_MODEL_LUNA` / `AI_MODEL_SOL` (Sol only behind `AI_SOL_ENABLED`), enforces per-task input caps and `max_completion_tokens`, and sends a stable `prompt_cache_key` per task. Credits are now money: usage-based cost from `src/ai/pricing.ts` (1 credit = $0.00167), a worst-case precheck with reserve-then-settle, and a monthly $150 budget spread per day with a $15 daily ceiling. Month-to-date spend is kept across daily rollovers, every call is logged, and admin `GET /api/ai/spend` is guarded by `AI_ADMIN_SECRET`. The system prompt is now static (scene, history, selection and reviewer instructions moved to the user message) and gained "## Modeling well" rules and three verified few-shot builds (car, chair, character). The response schema has a `plan` field before `ops`, which is ignored when applying. A new geometry checker (`src/ai/geometry.ts`) flags detached parts and objects not resting on y=0 as correction errors. The agent caps draft retries at 2 and review retries at 1. It escalates to the Sol review only for 3+ creates or corrected drafts, and skips review for clean drafts. Reply budget is now 12,000 characters. `AI_GLOBAL_DAILY_CREDITS` is removed.
- Why: Keep total AI cost under $150/month with gpt-6-luna doing most of the work, make cached input tokens apply, and improve the 3D objects the assistant builds.
- Validation: `npx tsc --noEmit`, `svelte-check` (0 errors/warnings), all 314 tests in 41 files, and `npm run build` pass. Worst-case draft/review/correction requests are tested to stay ≤ 40,000 characters. The real system prompt is about 22,200 characters.
- Limitations: Not exercised against a live provider. The gpt-6-sol cached-input price ($0.20/M) is from third-party listings, not the provider's page. With the larger static prompt, the draft's scene snapshot is limited to about 10k characters (large scenes get a bounded snapshot). The geometry checker does not flag a part resting on the floor beside its object, or a floating cluster of mutually touching parts. Setting `AI_MODEL_LUNA` in `wrangler.jsonc` takes priority over any live `AI_MODEL` secret on the next deploy.

### 2026-10-14 — Camera system

- New editor scenes include an active Camera. Play, camera preview, HTML, video, and GLB now use scene camera transforms and lens parameters.
- Added perspective/orthographic projection, clip planes, zoom, orthographic size, follow and look targets, world follow offsets, damping, and fly movement settings. Tracking updates live transforms after physics and animation; Pause freezes movement and Stop restores the snapshot.
- Added `camera.*` script calls for creation, switching, lens settings, movement, aiming, following, and child attachment/detachment. Camera switching is one operation batch; deleted targets clear their references with undo support. Script updates now preserve parent changes and fields reset to defaults.
- Added camera regression coverage for lens settings, parent rigs, tracking, damping, attachments, deletion/undo, exports, and Play/Step/Stop. Camera usage is documented in Docs and the user guide.
- Validation: `npm run check` passes TypeScript, Svelte diagnostics (0 errors/warnings), all 164 tests across 29 files, and the production build. Browser interaction was not manually exercised.

### 2026-10-13T01:00:00+05:30 — Product video: voiceover, story, and the agent shown as function calls

- Changed: Added an ElevenLabs voiceover in a young, upbeat female voice (Jessica, `eleven_multilingual_v2`), written as a short story. "You can picture it. Building it in 3D? That's the hard part." leads to "So, meet SimuStyle." and then through the product: "The agent calls functions, create, update, delete, right on your scene", "Hit play. It's live.", and on to "Your idea, made real." The video no longer calls itself game-building software. `audio/voiceover.mjs` generates one line per scene (one per card in Features), each with its neighbouring lines as context so the takes read as one performance. It caches the raw takes in `audio/takes/`, trims their silence, stretches a line by at most 1.15× if it overruns its slot, refuses lines that still don't fit, and writes content-hashed files to `public/voiceover/` plus `src/voiceover.json`. `ProductVideo` places each line 6 frames after its cut and ducks the music under it (0.5 → 0.2). The "Agent at work" scene was rebuilt to show what the agent really does (`src/ai/agent.ts`): the request, then one `CREATE` call per entity of the mini-golf scene with its shape and tags (physics, script, trigger, light), each ticking as the editor applies it, then "16 changes applied" and the undo line. It replaces the generic progress steps. Features cards are now 60 frames (one bar) each. The hook is 120 frames and the agent scene 150. Video is 52.6 s; the music was recomposed for the new cuts. Files: `my-video/src/**`, `my-video/audio/**`, `my-video/public/voiceover/*`, `my-video/public/music.mp3`, `my-video/.gitignore`.
- Why: Requests for a voiceover, a story, a female voice matching the music's energy, and a correct description of the agent (functions/JSON operations on the workspace), shown cleanly rather than as raw JSON. Feedback that the earlier voices sounded robotic, then overlapped. A render of the cold open measured exactly the music at its set volume, so no line was misplaced. The likely causes were v3's expressive mode improvising extra breaths and voices, and Studio replaying stale takes under reused file names. Both are fixed: a stable model with no stage cues, and hashed file names.
- Validation: `npm run lint` passes. Every line fits its slot (`node audio/voiceover.mjs` exits 0). Stills of the new agent scene were checked mid-stream and at the end. `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (52.65 s).
- Limitations: The voice and the mix were checked by measurement, not by ear. The ElevenLabs key lives in `my-video/.env` (git-ignored); it has text-to-speech access only, so voices can't be listed with it.

### 2026-10-13T00:30:00+05:30 — Product video: beat-locked music, cold open, Play shot crops to the viewport

- Changed: The music was rewritten as a faster track locked to the edit. One beat is exactly 15 frames (119.68 BPM at 29.92 fps), and every scene was retimed to a whole number of beats, so every cut lands on a beat. `audio/compose.mjs` now reads the cut list from `ProductVideo.tsx` and puts a hit (sub boom and crash) on each cut, with risers into Features, Export and the wordmark. The arrangement is Am–F–C–G with a 16th-note arp: full drums under a new cold open, a filtered groove under the hook and title, everything from Features through the footage, and drums out for the end card. Added a 2-second cold open before the hook: three beat-cut shots of real footage ("Build it." / "Play it." / "Fix it."). The Play shot now crops to the 3D viewport after Play is clicked: `EditorShot` frames footage by a source rect instead of Screen Recording's zoom, and a `focus` prop eases that rect onto one panel while the window reshapes to its aspect, so the scene tree, inspector and console slide out of frame. Assistant and Build were trimmed to 120 frames, and the title intro on the footage shots is now one beat (15 frames). The music's 29-frame Studio offset was removed, since the track now starts exactly on the first cut. Video is 49.1 s. Files: `my-video/src/**`, `my-video/audio/compose.mjs`, `my-video/public/music.mp3`.
- Why: Feedback that the music didn't line up with the edit and should be faster, that the video wasn't hooking, and that the Play demo should zoom cleanly into the play window instead of showing the inspector.
- Validation: `npm run lint` passes. Stills confirm the Play crop sequence (full editor, click Play, viewport only) and the cold-open shots. `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (12.9 MB, 49.15 s, stereo AAC). Music levels sit at about −10 dBFS RMS through the body.
- Limitations: The music was checked by measurement and beat arithmetic, not by ear. Retiming a scene to a length that isn't a multiple of 15 frames makes `compose.mjs` refuse to run.

### 2026-10-13T00:20:00+05:30 — Product video: editor shots and features rebuilt with remocn type, plus music

- Changed: The three editor footage shots no longer float a pill subtitle over the window. Each one now opens like the typographic scenes: a title alone on the page ("Press Play.", "Type commands", "Write it sloppy."). The title lifts into a one-line header, the editor window rises in beneath it (tilt, scale, blur to sharp, with a faint drifting accent glow), and the caption joins the title on the same line in the muted second color. At the end everything settles back into the page. Each shot uses a different title entrance (Soft Blur In, Tracking In, Spring Scale In), and "AI Parse fixes it." decodes out of code symbols. The Features beat no longer repeats one slide animation. "A 3D sandbox" blurs in by character under a purple marker sweep on "real physics". "AI agents" springs in word by word and blows away upward. "A script language" tracks in while "AI can fix." decodes. Each card also has its own exit and a slow push. Six remocn typography components were copied from the registry into `my-video/src/components/remocn/`, edited to render inline in DM Sans/DM Mono. Added an original music bed (100 BPM, Fmaj7–Am7–Cmaj7–G6; pad and plucks under the hook, kick and sub from the features, drums out for the end card). It is synthesized by `my-video/audio/compose.mjs` into `public/music.mp3`, so there's no licensing. Editor shots are 18 frames longer each; video is 48.8 s. Files: `my-video/src/**`, `my-video/audio/compose.mjs`, `my-video/public/music.mp3`, `my-video/package.json`, `my-video/.gitignore`.
- Why: Feedback that the editor scenes looked awkward and didn't blend with the rest (especially the subtitles), that the features scene reused one animation, and a request for smoother motion, remocn typography and background music.
- Validation: `npm run lint` passes. Stills of each new beat were checked. `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (11.2 MB, video plus stereo AAC). The music's section levels were measured (intro about −19 dBFS RMS, groove about −11, peak −1 dBFS).
- Limitations: The music was checked by level measurements only, not by ear. The Export scene (Capture Reveal) was not changed.

### 2026-10-12T23:55:00+05:30 — Product video repositioned and reskinned as SimuStyle UI

- Changed: The copy now presents SimuStyle as a 3D sandbox with AI agents and an AI parser for its own scripting language, not a game engine. The hook reads "Script in… English.", a new beat after the title says "A 3D sandbox with real physics. / AI agents that build with you. / A script language AI can fix.", and the footage captions were rewritten. The snapcn components are now skinned with the editor's own UI. Added Prompt Send as the Assistant composer, with `AIPanel.svelte`'s placeholder ("What should change?"), its three suggestions, its rounded purple ArrowUp send button and its #1c1c1f/#161618 surfaces; its source was edited to drop the gradient wash, square the send button and restyle the chips. It replaces Prompt Zoom. Agent Steps now shows the agent's real progress messages ("Building the first pass…", "Reviewing the first build and its Console output…") in DM Mono lavender, through a new `stepFontFamily` prop. `brand.ts` now holds the editor's colors and DM Sans/DM Mono, applied to every scene (Word Wheel, Punch Lines, Capture Reveal, Wordmark Cut, captions, end card). Video is 47 s. Files: `my-video/src/**`.
- Why: Feedback that the video described the product wrongly, and that the components should look like the editor's, starting with the Assistant chat window instead of a generic chat box.
- Validation: `npm run lint` passes. Stills of the hook, positioning, Assistant and agent scenes were checked. `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (9.2 MB).
- Limitations: The Assistant and agent beats are restyled motion graphics, not recordings of a live AI run. "Checking scripts before apply…" paraphrases the preflight check rather than quoting a message the app shows.

### 2026-10-12T23:45:00+05:30 — Product video uses real editor footage

- Changed: The video now cuts the snapcn motion-graphic beats against real footage of the SimuStyle editor. It has three recorded shots: pressing Play on a mini-golf scene (the ball rolls past the spinning windmill to the hole), typing `create a purple ball… called "Bouncy"`, `paint Bouncy yellow` and `move Bouncy up 1` into the console, and typing a sloppy script that ✦ Parse fixes locally ("no AI call"), applied with Use rewrite. Each shot plays in a floating window with snapcn Screen Recording camera pushes, a Cursor Track cursor placed on the real click positions, and a caption. Also added a Font Shuffle "Introducing SimuStyle" title. Capture Reveal now uses a frame of the real scene. The stylized terminal scene was removed because the real Parse shot replaces it. Video is 46 s. New capture rig in `my-video/capture/`: `capture.mjs` drives the editor in Remotion's headless Chrome under a stepped clock (one screenshot per 30 fps frame, so physics and the viewport are smooth), blocks `/api/ai/chat` so capturing never spends credits, encodes `public/clips/*.mp4` and writes the click logs to `src/clips/*.json`. `minigolf.json` is the scene it loads. Files: `my-video/capture/**`, `my-video/src/**`, `my-video/public/clips/*`, `my-video/public/editor-minigolf.jpg`, `my-video/tsconfig.json`, `my-video/package.json`.
- Why: Requested that the video show actual components from the editor, mixed with the motion-graphic style, so it feels like the product.
- Validation: All three clips were captured from the dev server and their key frames checked. Stills confirm the cursor lands on Play and Parse through the camera zooms. `npm run lint` passes and `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (8.8 MB).
- Limitations: The prompt and agent-steps beats are still motion graphics, not a live AI run, because the capture blocks AI calls. The ball's `say "Hole in one!"` doesn't show in the console during the play shot. Recapturing needs the dev server on port 5199 (`npm run dev -- --port 5199 --strictPort` at the repo root).

### 2026-10-12T23:35:00+05:30 — Product video loads in Studio from any folder

- Changed: The video's `@/…` imports (scenes, `brand.ts`, and the snapcn components) are now relative paths. Files: `my-video/src/**`.
- Why: Remotion Studio failed with "Cannot find module '@/components/snap-cn/agent-steps'". The bundler alias resolves `@` against the folder Studio was launched from, so it broke whenever that wasn't `my-video/`. Resolving against `__dirname` doesn't help either, because Remotion compiles the config somewhere else.
- Validation: Reproduced the error by rendering from the repository root. After the change, stills render from both the root and `my-video/`, and `npm run lint` passes.
- Limitations: Components added later with `npx shadcn add @snapcn/…` will use `@/` imports again. Those still work when Studio is started from `my-video/`, or can be converted the same way.

### 2026-10-12T23:20:00+05:30 — Product video rebuilt with snapcn components

- Changed: Replaced the first cut (logo, gradient glow, hand-built cards) with a minimal 29.5-second video on a flat near-black page in SimuStyle purple. It cuts between eight scenes built on snapcn Remotion components: a Word Wheel hook ("Make games in" spins through C++, JavaScript, Lua… and stops on "English."), Prompt Zoom typing a mini-golf prompt, Agent Steps narrating the build, Terminal Simulator for AI Parse, Capture Reveal with the editor screenshot ("ship it anywhere."), Punch Lines for features, then a Wordmark Cut and a plain end card with the URL. No logo. Set up the project for snapcn: `components.json`, the `@/` alias in `tsconfig.json` and `remotion.config.ts`, Tailwind v4, and `src/index.css`. The components' source is in `my-video/src/components/snap-cn/` and `my-video/src/lib/`. Files: `my-video/src/**`, `my-video/components.json`, `my-video/remotion.config.ts`, `my-video/tsconfig.json`, `my-video/package.json`.
- Why: Feedback that the first version was boring, the hook was weak, and it should drop the logo and gradient for a clean, modern look built on components like snapcn's.
- Validation: `npm run lint` (eslint + tsc) passes. Every scene was checked on a 16-frame contact sheet, and timing was fixed where text overflowed or a scene was cut early. `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (3.5 MB).
- Limitations: No music or voiceover. Prompt Zoom crops long prompts after its 2.5× push, so prompts over ~45 characters run off the edge. Terminal lines over ~28 characters are clipped too.

### 2026-10-12T23:05:00+05:30 — Product video made with Remotion

- Changed: Added the `my-video/` Remotion project with a 33-second 1920×1080 product video (`SimuStyleProduct`) in seven scenes: logo intro, "You describe it. We make it real.", AI Parse turning loose wording into valid code, the scene assistant typing a mini-golf prompt, an editor tour that highlights the hierarchy, physics, timeline and export, plain-English scripting with a live coin counter, and a closing call to action with the site URL. It uses the landing page's colors, DM Sans/DM Mono, the new logo and `editor.png`. Each scene is also registered as its own composition with editable text props. The empty `Composition.tsx` placeholder was removed. Files: `my-video/src/**`, `my-video/public/logo.png`, `my-video/public/editor.png`.
- Why: Requested a SaaS-style product video showing features from the landing page and editor.
- Validation: `npm run lint` (eslint + tsc) passes; still frames from every scene were checked; `npx remotion render SimuStyleProduct` produced `my-video/out/simustyle-product.mp4` (7.5 MB, git-ignored).
- Limitations: No music or voiceover. The editor scene uses the existing static screenshot, not a screen recording.

### 2026-10-12T22:35:00+05:30 — AI credits no longer refill on page refresh

- Changed: Credits were keyed only by the visitor's exact IP, so anything that changed the address between page loads (IPv4 vs IPv6, rotating IPv6 privacy addresses, `::1` vs `127.0.0.1` on the dev server) gave a fresh 30 credits. Each call is now charged under two ids: the address (IPv6 collapsed to its /64, IPv4-mapped and loopback forms unified) and a new HttpOnly `simustyle_cid` cookie (one year). The most-used id sets the balance, so a new address or cleared cookies alone does not refill credits. Files: `src/ai/credits.ts`, `worker/index.ts`, `vite.config.ts`, `tests/ai/credits.test.ts`.
- Why: Reported that refreshing the page reset the credit limit.
- Validation: New tests cover multi-id charging, address normalization and the cookie; `vitest` (49 tests), `tsc --noEmit` and `wrangler deploy --dry-run` pass. Not yet checked against the live site.
- Limitations: Someone who changes network and clears cookies at the same time still gets a new allowance; the site-wide daily cap still bounds total spend.

### 2026-10-12T04:00:00+05:30 — Build the Windows app on every GitHub release

- Changed: The `Release Windows app` workflow now runs when a GitHub release is published, not on tag pushes. It checks out the release tag, sets the app version from the tag (`v0.3.0` → `0.3.0`), builds the NSIS installer, and attaches it to that release. It also keeps the installer as a build artifact. Running it by hand builds the artifact without changing any release. Files: `.github/workflows/release-windows.yml`, `README.md`.
- Why: Requested a desktop build that starts whenever a release is made.
- Validation: The workflow YAML parses. It has not run on GitHub yet.
- Limitations: A tag that is not a version like `v1.2.3` fails the build with an error. Releases created by other workflows using the default `GITHUB_TOKEN` do not trigger it.

### 2026-10-12T03:40:00+05:30 — Landing donate links open the support popup

- Changed: The nav Donate button, the footer Donate link, and "Donate to keep it running" now open the editor's "SimuStyle is free, forever" popup (with today's credit limit from `/api/ai/credits`) instead of going straight to Razorpay; the popup's Donate button opens the payment page. Ctrl/middle-clicks and visits without JavaScript still follow the link. The popup code loads only on first click. Files: `index.html`, `src/landing/main.ts`.
- Why: Requested that Donate show the popup first.
- Validation: In headless Chrome against the dev server, clicking the nav Donate button opened the popup (showing 30 daily credits) without leaving the page and focused its Donate button; the footer link opened it too, and Maybe later closed it. `vite build` succeeds.
- Limitations: None known.

### 2026-10-12T03:25:00+05:30 — Landing donate button and new headline

- Changed: Added a Donate button (heart icon, opens the Razorpay page in a new tab) next to Open editor in the nav, and a Donate link in the footer links. Below 640 px the button shows only the heart. The hero headline is now "You describe it. We make it real." with the user's intro text. Files: `index.html`, `src/landing/landing.css`.
- Why: Requested a donate link and new hero copy.
- Validation: Headless Chrome screenshots at 1440 px and 390 px show the button, the footer link, and a two-line headline with no overlap.
- Limitations: None known.

### 2026-10-12T03:05:00+05:30 — Daily AI credits and a donation popup

- Changed: AI on the hosted site and dev server is now metered. Each visitor gets 30 credits per UTC day (one credit per model call), and the whole site stops at 3000 a day so the owner's key has a hard daily spending cap. Both numbers are `AI_DAILY_CREDITS` and `AI_GLOBAL_DAILY_CREDITS` in `wrangler.jsonc`. The Worker counts credits in a new `AiCreditLedger` Durable Object keyed by a hash of the visitor's IP. The dev server keeps the same counts in memory. A credit is refunded when the provider call fails. New `GET /api/ai/credits` endpoint. The Assistant shows "N/30 credits left today · Why?" under the prompt box and disables sending at zero. A new "SimuStyle is free, forever" dialog explains that the developer pays for the hosting and AI, that this is why there is a limit, and links to https://razorpay.me/@paulynshemy. It opens from a new heart button in the top bar or the "Why?" link, automatically when credits run out, and once per browser after the third successful AI request. The landing page says "Free forever" and has a footer note with the donation link. The desktop app uses the user's own key and is not metered. Files: `src/ai/credits.ts` (new), `src/ai/chatProxy.ts`, `src/ai/client.ts`, `worker/index.ts`, `wrangler.jsonc`, `vite.config.ts`, `src/editor/SupportDialog.svelte` (new), `src/editor/AIPanel.svelte`, `src/editor/TopBar.svelte`, `src/App.svelte`, `index.html`, `src/landing/landing.css`, `src/landing/main.ts`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, `tests/ai/credits.test.ts` (new).
- Why: Requested a spending limit with daily-resetting credits and a donation popup that makes clear SimuStyle is free forever and funded by its developer.
- Validation: New tests cover spending, the per-visitor and site-wide limits, the UTC reset, refunds, and the proxy's 429 and refund paths. `tsc --noEmit` and `svelte-check` report no errors. `vite build` succeeds. `wrangler deploy --dry-run` shows the `AI_CREDITS` Durable Object binding. Against the dev server, `/api/ai/credits` returned 30/30, and headless Chrome screenshots show the balance in the Assistant, the dialog at 1440 px and 390 px, and the landing footer. `tests/lang/sentences.test.ts` ("compiles the README example") was already failing and is unrelated.
- Limitations: No real AI call was made, to avoid spending the key. Visitors are identified by IP, so people sharing an IP share credits, and switching networks resets them. The counts are in one Durable Object, which is fine at this scale. In the desktop app, the Donate link may not open a browser because no opener plugin is installed.

### 2026-10-12T03:10:00+05:30 — Lead the landing hero with AI Parse

- Changed: The hero headline is now "Write it in your words. Watch it come alive." The intro explains that AI Parse turns rough, misspelled English into working code, checks every line with a real compiler, and runs it in a live 3D world. Page title and meta description updated to match. Files: `index.html`.
- Why: Requested hero copy that leads with AI parsing and sounds more impressive.
- Validation: Full-page headless Chrome screenshot at 1440 px; the headline fits on two lines and nothing overlaps.
- Limitations: "Free forever" under the buttons came from separate in-progress work and is not part of this commit.

### 2026-10-12T02:55:00+05:30 — Declutter the landing page

- Changed: The nav has four links. The hero intro is one sentence and the note under the buttons is shorter. Removed the "Built on" strip, the final repeated call-to-action, the assistant checklist, the scripting checklist, and the download tags and checklists. The AI Parse steps are plain text with a top rule that lights up as the demo plays. Features is one row of four calmer cards (the AI and scripting cards repeated other sections). The example script is shorter. Removed the pointer glow on cards. Page height at 1440 px went from about 5650 px to 4390 px. Files: `index.html`, `src/landing/landing.css`, `src/landing/main.ts`.
- Why: Requested a less cluttered landing page.
- Validation: `vite build` succeeds. Full-page headless Chrome screenshots at 1440 px and 390 px show no overlap or horizontal scroll.
- Limitations: None known.

### 2026-10-12T02:50:00+05:30 — Feature AI Parse on the landing page

- Changed: Added an AI section after the hero with an animated AI Parse demo (a casual script on the left; on the right, typo fixes, then AI fixes, then the parser check), a three-step explanation, and an AI scene assistant block. Updated the hero text and AI feature card to lead with AI and added an "AI Parse" nav link. Removed the version pill above the headline and the purple glows under buttons, behind the screenshot, behind the code card, and behind the final call to action. Files: `index.html`, `src/landing/landing.css`, `src/landing/main.ts`.
- Why: AI Parse is a headline feature, and the pill and glows looked cluttered.
- Validation: The demo's fixed script parses and type-checks with no errors using `parseScript` and `typecheckScript`. `tsc --noEmit` and `vite build` pass. Checked the hero and AI section at 1440 px and 390 px wide in headless Chrome, both mid-animation and when finished.
- Limitations: The demo shows example AI wording; real rewrites vary by model and run. With reduced motion turned on, the finished result appears without animation.

### 2026-10-12T02:35:00+05:30 — Drag objects with the mouse

- Changed: Press on an object in the viewport and drag to move it, like in Roblox Studio. It slides across the floor keeping the grab offset and rests its base on whatever surface is under the pointer. Dropping onto a side face places it beside that object instead. The cursor is an open hand over draggable objects and a closed hand while dragging. Snap rounds the drop point to 0.5 m. Each drag is one undo step. Dragging is off during Play, and gizmo handles take priority. Files: `src/editor/Viewport.svelte`, `src/App.svelte`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`.
- Why: Requested direct, Roblox-style object dragging with a hand cursor.
- Validation: `svelte-check` reports no errors or warnings. In headless Chrome against the dev server, hovering a new cube showed `grab`, dragging showed `grabbing`, the cube moved from (0, 0.5, 0) to (3.09, 0.5, -1.97) while staying on the floor, and one Ctrl+Z restored it.
- Limitations: Only the object under the pointer moves, even when several are selected. A left-drag that starts on an object no longer orbits; start on empty space to orbit. In Move mode the gizmo's plane handles can cover a small object's center, so grab it near an edge or switch to Select (Q). Stacking on other objects was not checked in the browser.

### 2026-10-12T02:20:00+05:30 — Redesign editor panel windows

- Changed: Panels are now rounded cards with a 6 px gap when docked. Each title bar has a grip, title, status text, and header actions (Scene: object count and New group; Console: Ready status and Clear). Scene panel: always-visible Filter field and a "No objects yet" empty state with Add object. Assistant: intro text, three one-click suggestions, and a composer with a round send button; Enter sends and Shift+Enter adds a new line. Console: short hint, play/pause/stop/help buttons, and a new `help` command. Inspector scene view: Physics (Collisions, Gravity, Earth/Moon/Zero presets, Step), Environment (Sky hex field, Ambient slider), and Grid (Snap, linked to the viewport snap). Timeline empty state: idle transport bar, seconds ruler, and "Nothing to animate yet". Added a K shortcut that keys the selected object's position at the playhead. Renamed the Hierarchy and AI panels to Scene and Assistant in tabs, docs, and the tutorial. Files: `src/App.svelte`, `src/app.css`, `src/editor/AIPanel.svelte`, `src/editor/Hierarchy.svelte`, `src/editor/Inspector.svelte`, `src/editor/Timeline.svelte`, `src/editor/DocsPanel.svelte`, `src/editor/tutorial/chapters.ts`, `docs/USER_GUIDE.md`.
- Why: Match the requested panel window design.
- Validation: `tsc --noEmit` and `svelte-check` pass with no errors or warnings. Vitest: 142 passed, 1 failed (`tests/lang/sentences.test.ts` README example, which was already failing). Headless Chrome screenshots of the default layout and of all five panels docked side by side match the design.
- Limitations: The Ambient slider covers 0–1, though the setting accepts up to 10; larger values pin the slider and still show the real number. The entity Inspector (with an object selected) keeps its earlier field layout.

### 2026-10-12T02:30:00+05:30 — Add landing page and Cloudflare hosting

- Changed: Added a landing page at `/` with a live three.js hero scene, an editor screenshot, feature and scripting sections, and "Open in browser" / "Download for Windows" buttons. Moved the editor to `/editor/` (Vite now builds two pages; the Tauri window opens `editor/index.html`). Added a Cloudflare Worker (`worker/index.ts`, `wrangler.jsonc`) that serves `dist/`, runs the AI proxy at `/api/ai/chat`, and redirects `/download/windows` to the latest GitHub release installer. Moved the AI proxy logic into `src/ai/chatProxy.ts` so the dev server and Worker share it. Added `npm run deploy` and `npm run preview:cf`, and a GitHub Actions workflow that builds and releases the Windows installer on `v*` tags. Files: `index.html`, `editor/index.html`, `src/landing/*`, `src/ai/chatProxy.ts`, `vite.config.ts`, `worker/index.ts`, `wrangler.jsonc`, `.github/workflows/release-windows.yml`, `src-tauri/tauri.conf.json`, `package.json`, `tsconfig.json`, `README.md`.
- Why: Give the project a public home page with both ways in, and host it on Cloudflare.
- Validation: `tsc --noEmit` and `vite build` pass. Under `wrangler dev`, `/` and `/editor/` load, `/editor` redirects to `/editor/`, a demo scene plays with physics, `/api/ai/chat` returns the "not configured" error without secrets, and `/download/windows` redirects to the releases page. Checked the landing page in headless Chrome at 1440 px and 390 px wide.
- Limitations: Not yet deployed; deploying needs `wrangler login`. The download link falls back to the releases page until the first tagged release. The release workflow and the Tauri `editor/index.html` window URL have not been run. A hosted AI key would be usable by any visitor.

### 2026-10-12T01:40:00+05:30 — Fix Play doing nothing on a fresh dev server

- Changed: Added `@dimforge/rapier3d-compat` to Vite's `optimizeDeps.include`. Files: `vite.config.ts`.
- Why: Physics loads lazily on the first Play. Without a cached pre-bundle, Vite discovered the library during that click, re-optimized it, and reloaded the page, so Play appeared to do nothing.
- Validation: In headless Chrome against a dev server with an empty dependency cache, the first Play click switches to Pause with no page reload; Stop restores the scene and Play works again. Repeated warm runs also start every time.
- Limitations: Only affects the dev server; production builds were not affected.

### 2026-10-12T00:40:00+05:30 — Unify editor UI styles and restyle sliders

- Changed: Moved older panels from purple-tinted greys onto the neutral palette used by the viewport menus and create shelf, and collapsed about 25 accent shades into one set (`#a99bff` text, `#7c6cf0` fill, `#8b7cf6` hover, `#3b3566` selected). Menus and popovers now share one surface, primary actions are solid accent buttons, secondary buttons and inputs share one style, and the purple gradient banners and buttons are flat. Added shared color tokens and a global range-slider style (slim filled track, white thumb, hover and drag halo, focus ring); the Inspector sets the fill through `--fill`. Files: `src/app.css`, `src/App.svelte`, all panels under `src/editor/`.
- Why: Remove style drift between older panels and the recently redesigned viewport UI.
- Validation: `tsc --noEmit`, `svelte-check`, and `vite build` pass. `tests/lang/sentences.test.ts` fails on the README scripting example, which this change does not touch.
- Limitations: Sliders outside the Inspector need `--fill` set to show progress; without it the fill sits at 50%.

### 2026-10-12T00:05:00+05:30 — Redesign the viewport create shelf

- Changed: Replaced the icon-only create shelf with labelled controls: a shape split button (last-used shape; menu adds other shapes, empty groups, and script objects), a light split button (point, sun, spot), Camera, an Import menu (scene file, recent scenes), and a Generate button that opens the AI panel. Removed the shelf's Animate button; presets stay in the timeline, Inspector header, and right-click menu. Files: `src/App.svelte`, `src/editor/DocsPanel.svelte`, `docs/USER_GUIDE.md`.
- Why: Match the requested shelf design and make the common create actions readable at a glance.
- Validation: `tsc --noEmit` and `svelte-check` report no errors.
- Limitations: Import opens a scene file in place of the current scene; it does not merge models or scenes. Below 1100 px the shelf hides its text labels.

### 2026-10-11T23:45:00+05:30 — Replace viewport view bar with view menus and axis gizmo

- Changed: Replaced the top-right camera view bar with a Perspective view menu (Perspective, Top, Bottom, Front, Back, Right, Left) and a Shaded/Wireframe menu in the top-left, next to the tool rail. Added a clickable axis gizmo in the top-right that follows the camera, with Frame selected and Reset camera buttons below it. Files: `src/editor/Viewport.svelte`, `docs/USER_GUIDE.md`.
- Why: Match the requested viewport header layout.
- Validation: `tsc --noEmit` and `svelte-check` report no errors.
- Limitations: Shading is per-session editor state and is not saved with the scene.

### 2026-10-11T23:20:00+05:30 — Add easing curves, animation presets, and iconized editor controls

- Changed: Added a shared easing engine (Sine, Quad, Cubic, Quart, Quint, Expo, Circ, Back, Elastic, Bounce in In/Out/In-Out, plus Linear, Smooth, Step, and custom cubic-bezier) used by the editor, animator, and HTML export. Rebuilt Timeline with icon transport, Loop and length controls, eased curves drawn on each segment, key shapes per easing, a selected-key bar, snapping key drags, and double-click insert-on-curve. Added an easing picker with a live motion preview and a draggable bezier editor, and 13 one-click animation presets with live preview cards. Added a viewport tool rail, create shelf, and camera view bar with eased transitions; icons in the context menu, bottom tabs, Inspector sections, and keyframe-state diamonds; and an Animate button in the top bar. Fixed `localPosition`, which multiplied a matrix by a vector and broke right-click placement under a parent. Files: `src/runtime/easing.ts`, `src/runtime/animationPresets.ts`, `src/editor/animation/*`, `src/editor/Timeline.svelte`, `src/editor/Viewport.svelte`, `src/editor/Inspector.svelte`, `src/editor/TopBar.svelte`, `src/App.svelte`, `src/scene/hierarchy.ts`.
- Why: Make animation and object creation faster and more visual, in the style of Unity and Panzoid.
- Validation: `tsc --noEmit` and `svelte-check` report no errors; 142 of 143 tests pass, including new easing and preset tests. The remaining failure (`compiles the README example`) predates this change. Drove the dev build in headless Chrome to add objects, apply presets, change easing, edit a bezier, and insert keys, with no page errors.
- Limitations: The AI scene context still lists only the original interpolation field; adding all easing names exceeded the prompt-size budget test. The tutorial's animation chapter still mentions only the original three easings.

### 2026-10-11T22:56:19+05:30 — Add optional interactive feature tutorials

- Changed: Added 14 self-paced chapters to Docs covering navigation, object creation, transforms, hierarchy, Inspector, physics and joints, scripts and Console, Play, animation, AI, scene files, export, desktop, and editing shortcuts. Users can choose chapters, skip steps, reset or resume progress; progress is stored locally. Kept the reference manual available alongside tutorials. Files: `src/editor/TutorialPanel.svelte`, `src/editor/DocsPanel.svelte`, and `README.md`.
- Why: Let users learn individual editor features by trying them in the app at their own pace.
- Validation: Reviewed the tutorial chapter coverage, user-controlled progress behavior, and documentation links; ran `git diff --check`. No tests were run.
- Limitations: Completion is self-reported by the user; the tutorial does not inspect scene state or automatically verify actions.

### 2026-10-11T22:47:49+05:30 — Add middle-button panning and contextual creation

- Changed: Mapped middle-drag to viewport panning and reserved right-click for context menus. Added the toolbar's object choices to the context menu, placing them at the viewport pointer or as children of the clicked object; empty Hierarchy space creates root objects. Updated the README and in-app guide.
- Why: Make viewport navigation and object creation work with the requested mouse controls and context.
- Validation: Reviewed pointer handling, placement parent transforms, and local documentation links; ran `git diff --check`. No tests were run.
- Limitations: Viewport placement projects onto the clicked object surface or the ground plane; clicking empty sky falls back to the existing spiral placement.

### 2026-10-11T22:12:11+05:30 — Restore and streamline the README

- Changed: Restored the root `README.md` with concise project, setup, AI configuration, desktop, documentation, checks, and limitation sections.
- Why: Make project setup and demo information easy to find after the previous root Markdown cleanup.
- Validation: Checked referenced local documentation paths and ran `git diff --check`. No tests were run because this was a documentation change.
- Limitations: The Windows desktop installer and live AI provider calls still depend on external prerequisites and credentials.

### 2026-10-11T21:58:41+05:30 — Remove root Markdown files

- Changed: Removed the root `AGENTS.md`, `AI_USAGE.md`, `app-build-prompt.md`, `README.md`, `RULES.md`, and `SUBMISSION.md`. Kept `CHANGELOG.md` and `DECISIONS.md` as requested.
- Why: Reduce the root Markdown files to the two requested files.
- Validation: Confirmed the root Markdown file list contains only `CHANGELOG.md` and `DECISIONS.md`; checked `git diff --check`.
- Limitations: Project setup, event rules, submission details, and AI usage notes formerly documented in the removed files are no longer available in the repository.

### 2026-10-11T08:30:00+05:30 — Add a script-focused demo runbook

- Changed: Added `docs/DEMO_SCRIPTS.md` with a click-to-animate example, a playable coin-collection scene, a back-and-forth patrol, setup steps, presenter cues, and recovery tips. Linked it from `docs/DEMO.md` and README.
- Why: Give the presenter a concise, repeatable script demo with setup and expected results alongside the broader walkthrough.
- Validation: Compared the example syntax with the scripting reference and the editor's shipped templates; checked Markdown links and ran `git diff --check`. No tests were run because this is a documentation change.
- Limitations: The new runbook was not rehearsed in the running app; physics and touch-event behavior depend on the described collision settings.

### 2026-10-11T08:15:00+05:30 — Add scene naming and a Scene Loader window

- Changed: Added a Rename scene dialog and persist scene names in scene JSON. Added a movable Scene Loader window with Open, Open Recent, recent-scene entries, and Save current scene as JSON. Browser recents cache scene contents in IndexedDB; desktop recents retain their file paths. Updated README, the user guide, and in-app Docs.
- Why: Make scenes nameable and provide a dedicated place to reopen and save individual scene files.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Automated tests were not run.
- Limitations: The loader lists the ten most recent scenes. Browser recents are local to this browser origin. The new window was not manually exercised in an interactive app.

### 2026-10-11T08:00:00+05:30 — Preserve valid scene drafts when review fails

- Changed: If the second-pass model request fails or exhausts corrections, apply the first draft automatically when it passes operation, script, and new runtime checks. When that draft has runtime issues, retain it in the AI panel with a visible **Apply first draft anyway** action and its preview details. Files: `src/ai/agent.ts`, `src/App.svelte`, `src/editor/AIPanel.svelte`, README, and `AI_USAGE.md`.
- Why: A failed independent review previously discarded the user's validated scene changes without a way to recover them.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Automated tests were not run.
- Limitations: A draft with runtime issues requires the user to choose the explicit fallback action. The preview does not include visual review or Rapier physics.

### 2026-10-11T07:54:00+05:30 — Increase scene assistant review retries

- Changed: Increased second-pass review correction retries from two to four in `src/ai/agent.ts`; documented the retry behavior in `README.md`.
- Why: The scene assistant was discarding otherwise valid drafts after exhausting its review correction budget.
- Validation: Reviewed the retry loop and documentation diff; `git diff --check` passed. Automated tests were not run.
- Limitations: More retries consume more provider requests and do not help when the configured model or provider rejects the request. A first draft that succeeds immediately can now use up to six AI calls total.

### 2026-10-11T07:45:00+05:30 — Fix random move coordinates and show color hover swatches

- Changed: The script parser now reads `random` after `move ... to` as a numeric coordinate expression, and the AI script guide shows the accepted random-range syntax. Hovering a color token now shows its swatch and hex value. Files: `src/lang/parser.ts`, `src/ai/prompt.ts`, `src/editor/ScriptEditor.svelte`, tests, README, and `docs/USER_GUIDE.md`.
- Why: The participant's Parse attempt returned “Unexpected text after statement” because `random` was treated as an object target; the participant also asked to preview colors on hover.
- Validation: Targeted parser/rewrite/prompt tests passed (24 tests); `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 130 tests, and production build. A second `npm run build` also passed. `git diff --check` passed.
- Limitations: The reported random syntax was reproduced with a mocked AI reply, not a live provider call. The hover tooltip was typechecked and built but not visually exercised in an interactive browser.

### 2026-10-11T07:26:00+05:30 — Parse always returns a runnable script

- Changed: AI line fixes are now checked top-down, with later line numbers adjusted when a fix spans several lines, so a broken line above can no longer hide a bad replacement below it. If lines are still broken after 4 AI calls, Parse comments them out as `-- Parse could not convert: <original text>` (and any event or block left with only comments), keeps every line it did fix, and lists each one in the review with the AI's last attempt. Files: `src/ai/scriptRewrite.ts`, `tests/ai/scriptRewrite.test.ts`, and `AI_USAGE.md`.
- Why: The participant asked how to stop Parse from failing. A live run showed a bad line-7 fix accepted while line 6 was still broken (the parser stops at its first error), which wasted an AI call.
- Validation: `npm run typecheck` and `npx vitest run` (all tests; 12 Parse tests) passed. The docs/DEMO.md broken script was run against the configured model twice: both runs produced a valid script in 2 calls.
- Limitations: Parse can still fail if the AI request itself fails (network, key, provider error). Commented-out lines change behavior until the user edits them. README, the user guide, and in-app Docs (being edited by Codex at the same time) still do not mention the comment-out fallback.

### 2026-10-11T07:11:00+05:30 — Keep Parse's fixed lines when one line cannot be fixed

- Changed: When lines are still broken after 4 AI calls, Parse now keeps the lines it did fix and lists the broken ones in the review ("Still broken, edit by hand"), each with the AI's last rejected attempt and its error, or a note that the AI returned no fix. It only fails outright when nothing changed, and that error now includes the same detail. The Parse prompt now says that something the user counts ("give me a point") becomes a variable (`increase score by 1`); the earlier "never add values" rule had discouraged that. Files: `src/ai/scriptRewrite.ts`, `tests/ai/scriptRewrite.test.ts`, and `AI_USAGE.md`.
- Why: The participant hit `AI rewrite failed: Parse could not fix every line after 4 AI calls: Line 8: Unexpected text after statement` on the demo script. Probing the parser showed that error comes from the untouched `give me a point`, so every AI fix for that line was rejected or missing, and the whole result was discarded with no hint why.
- Validation: `npm run typecheck` and `npx vitest run` (129 tests, 3 new or changed for this) passed.
- Limitations: The AI's actual rejected replies from the participant's run were not captured, so the prompt change addresses the likely cause rather than a confirmed one. Not retried against a live model.

### 2026-10-11T07:09:00+05:30 — Add AI second-pass scene review and Space Play shortcut

- Changed: The scene assistant now builds a draft, runs game-start scripts plus five isolated script ticks, captures print output and runtime issues, then requests an independent second pass against the player's intent and preflight output. The second scene is revalidated before it reaches the editor. The AI panel shows preflight details and progress. Space now starts Play while stopped, resumes while paused, and remains a script input during Play. Files: `src/ai/agent.ts`, `src/App.svelte`, `src/editor/AIPanel.svelte`, `src/editor/DocsPanel.svelte`, `tests/ai/agent.test.ts`, README, and `docs/USER_GUIDE.md`.
- Why: Catch script/runtime problems and mismatches before changing the live scene, and make Space a Play control while retaining the `when space is pressed` behavior.
- Validation: `npm run check` passed TypeScript, Svelte diagnostics (0 errors/0 warnings), all 129 tests, and the production build; `git diff --check` passed. The build reports the large-chunk warning.
- Limitations: The preview is isolated and does not render the scene or run Rapier physics; visual appearance, collisions, and physics behavior are not verified. No live AI provider request or browser visual review was made; the in-app browser was unavailable.

### 2026-10-11T07:04:00+05:30 — Add a demo walkthrough

- Changed: Added `docs/DEMO.md` with an AI scene prompt and follow-ups, a working Player/Coin script, a broken script for showing Parse, optional command-bar lines, and talking points. Files: `docs/DEMO.md` (new).
- Why: The participant asked for ready-to-use demo material.
- Validation: The Player and Coin scripts pass `scriptProblems` (parser, type checker, and word recognizer) with no problems. For the broken script, local autocorrect was run to confirm which words it fixes and that lines 2 and 5–8 are left for the AI.
- Limitations: AI prompts and the AI Parse result were not run against a live model, and the command-bar lines were not checked. Local autocorrect turns `bump` into `jump`; this is noted in the file. The README does not link to the file yet.

### 2026-10-11T06:58:00+05:30 — Add Console quick commands and object indexes

- Changed: The Console command bar now accepts `clear`, `play`/`run`/`start`, `pause`, and `stop`; `play` resumes a paused simulation. Script and Console object descriptions can include a zero-based index, such as `all balls[2]`, to select one ranked match. Updated the Console hint and feature documentation. Files: `src/App.svelte`, `src/lang/`, `src/runtime/`, `src/ai/prompt.ts`, `src/editor/DocsPanel.svelte`, README, `docs/USER_GUIDE.md`, and `AI_USAGE.md`.
- Why: Make simulation controls available in Console and let commands address one object in a matching group.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run.
- Limitations: Quick commands are recognized as exact words. Object indexes are zero-based and use the existing nearest-first target ranking; general-purpose array variables and loops over object collections are not supported.

### 2026-10-11T06:43:00+05:30 — Parse fixes only broken lines and makes sense of odd wording

- Changed: Removed Parse's full-script rewrite stage. After local typo fixes, the AI now gets the whole script as read-only context but may only replace the broken lines; replacements for valid lines are ignored. Each returned line is checked on its own: working fixes are kept, and failed ones are sent back with their errors on the next call (up to 4 AI calls). The prompt now tells the model to always return a valid line by working out what the user meant, mapping odd or unsupported words to the nearest supported ones, and never adding actions, events, or values the user did not write. Files: `src/ai/scriptRewrite.ts`, `src/editor/ScriptEditor.svelte`, `tests/ai/scriptRewrite.test.ts`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, and `AI_USAGE.md`.
- Why: The participant reported Parse failing on illogical wording instead of rewriting it, and asked that it rewrite only the errors rather than the whole script.
- Validation: `npm run typecheck`, `svelte-check` (0 errors/0 warnings), and `npx vitest run` (125 tests; rewrite tests replaced for the new flow) passed.
- Limitations: Not exercised against a live model. Parse still reports an error if no replacement compiles after 4 AI calls. When a kept fix splits one line into several, error feedback for later lines in the same call may cite their old line numbers.

### 2026-10-11T06:31:00+05:30 — Name changed objects in Console after each command

- Changed: After a command-bar command, Console now prints one line per created, changed, or removed object, using its name: `Created Ball2: red ball at 0 0.5 0`, `Crate: painted red`, `Crate: moved to 1 2 3`, `Crate: hidden`, `Removed Crate`. Moves, turns, scales, paint, hide/show, renames, reparenting, and added/removed components each have wording; any other field shows as `changed Component.field`. Named palette colors print by name, other colors as hex. Files: `src/scene/describeChanges.ts` (new), `src/App.svelte`, `tests/scene/describeChanges.test.ts` (new), `README.md`, `docs/USER_GUIDE.md`, and `AI_USAGE.md`.
- Why: The participant wanted to see the name of the object a command created (e.g. Ball2) so they can refer to it, and the same feedback for every command.
- Validation: `npx vitest run` (123 tests, 2 new), `npm run typecheck`, and `npx svelte-check` (0 errors/0 warnings) passed. Previewed output for add, scale, turn, and repeated `add red ball` through `ScriptRuntime.runOnce`.
- Limitations: Not checked in the running app. During Play, the lines compare the scene before and after the command, so they could include physics motion from the same step. AI-panel edits do not print these lines.

### 2026-10-11T06:23:00+05:30 — Stop the AI writing unsupported kill-brick commands

- Changed: The script spec in the agent prompt now states that kill, respawn, reset, teleport, and warp do not exist, shows the `when I touch player` / `move it to 0 2 0` reset idiom, and says `if ... then` bodies go on the next indented line. Script errors sent back to the model (and shown to the user) now quote the rejected line, e.g. `line 2, column 8 in "kill it"`. Files: `src/ai/prompt.ts`, `src/ai/agent.ts`, `tests/ai/agent.test.ts`, and `AI_USAGE.md`.
- Why: An obby request with kill bricks failed after 4 attempts with `Entity 'killbrick_1', line 2, column 8: Unexpected text after statement`. Probing the parser showed `kill it` produces exactly that error; the bare position gave the model nothing to correct.
- Validation: `npx vitest run` (121 tests, 2 new) and `npm run typecheck` passed.
- Limitations: Not retried against a live model; the cause is inferred from the error position because rejected replies are not logged.

### 2026-10-11T05:32:00+05:30 — Improve AI object creation and scene context

- Changed: The scene agent's system prompt now describes components as one compact line each and the scene as one line per object (children indented, defaults omitted, compact JSON) with each mesh's size, the y range it occupies, and four free floor spots. It adds short guidance on mesh dimensions, resting and stacking, free-spot placement, multi-part objects as groups with relative children, colors, physics, and ids/names. A new `tidyCreates` step fixes create operations before validation: clashing ids (with later parent/Joint references in the batch), duplicate names, a missing Transform, unpositioned top-level objects (moved to a free spot), objects below the floor (lifted), and falling bodies created inside another object (raised on top); adjustments are appended to the reply summary. Correction retries now include the model's rejected reply, so it can fix only the reported errors; the dev proxy accepts assistant messages (the desktop shell already did). Corrected the Transform description to say it is parent-relative. Files: `src/ai/sceneContext.ts` (new), `src/ai/placement.ts` (new), `src/ai/prompt.ts`, `src/ai/agent.ts`, `src/ai/client.ts`, `src/App.svelte`, `vite.config.ts`, `src/scene/serialize.ts`, `src/registry/components/transform.ts`, `tests/ai/prompt.test.ts`, `tests/ai/placement.test.ts` (new), `README.md`, `docs/USER_GUIDE.md`, and `AI_USAGE.md`.
- Why: The participant asked for better object creation and scene understanding without more input tokens. Previously the model saw pretty-printed JSON with no sizes or free space, objects without a position sank half into the floor at the origin, and retries resent only the error list without the reply being corrected.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npx vitest run` (119 tests, 7 new), `npm run build`, and `git diff --check` passed. Measured system prompt: empty scene 11,714 → 8,636 characters; eight boxes 14,156 → 9,776 (about 305 → 142 characters per object).
- Limitations: Not exercised against a live model. Placement fixes only apply to top-level, unrotated, non-plane meshes; bounds ignore rotation and parent transforms. Retries now send the previous reply, so each retry costs its output size in extra input.

### 2026-10-11T05:25:00+05:30 — Make the animation timeline easier to edit

- Changed: Added timeline Play/Pause and Stop preview controls, draggable keyframe diamonds, click-to-seek track lanes, and keyboard seeking with arrows and Home/End. Updated the animation instructions in README, the user guide, in-app Docs, and AI usage record. Files: `src/editor/Timeline.svelte`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, and `AI_USAGE.md`.
- Why: The participant wanted a more capable, Panzoid-style animation timeline with direct keyframe editing and preview controls.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run.
- Limitations: No graph-curve editor or zoom controls; preview operates on the selected entity's Animator tracks. The production build reports the existing large-chunk warning. Not manually exercised in a browser.

### 2026-10-11T05:19:00+05:30 — Make Parse adaptive and add object hover cards

- Changed: **✦ Parse** now runs in escalating stages instead of always rewriting the full script with AI. Stage 1 fixes typos (edit distance with swapped letters) and a short synonym list locally, keeping a change only if it adds no diagnostic on its line. Stage 2 sends AI only the remaining problem lines, each with its event line and problems, plus a compact one-line-per-object scene list, and splices back line replacements (up to two passes when a fix reveals an error the parser had masked). Stage 3 rewrites the full script only when the targeted fix fails or the model reports it needs context. All stages share one system prompt so providers can reuse cached prompt prefixes. The review dialog shows the stage, AI call count, and highlighted changed lines. Hovering an object name, quoted name, `me`/`my`, `my children`/`my parent`, or a shape noun in the script editor shows a card with the object's type, color, position, parent, children, and distance from the script owner. Files: `src/lang/autocorrect.ts` (new), `src/ai/scriptRewrite.ts`, `src/lang/fuzzy.ts`, `src/lang/highlight.ts`, `src/editor/ScriptEditor.svelte`, `src/editor/DocsPanel.svelte`, `tests/ai/scriptRewrite.test.ts` (new), `README.md`, `docs/USER_GUIDE.md`, and `AI_USAGE.md`.
- Why: The participant asked for a faster, cheaper Parse that targets mistakes precisely, fixes only what is needed, and adds context only when necessary, plus hover details for referenced objects.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npx vitest run` (112 tests, 8 new with a fake model for each stage), `npm run build`, and `git diff --check` passed.
- Limitations: Not exercised against a live model or in a browser; the hover card and stage escalation were verified only by type checks and unit tests. Hover positions assume the editor's monospace font with space indentation. The parser reports one parse error at a time, so a line-stage fix can reveal another error, which costs a second line pass. The older phrase-based `src/ai/scriptParse.ts` is still unused apart from its `ParseEntity` type and tests.

### 2026-10-11T05:08:00+05:30 — Replace physics presets with Physics and Collision switches

- Changed: Removed the Add menu's Physics ball and Physics box. Inspector now shows **Physics** and **Collision** switches for every selected object. Physics adds or removes the RigidBody (and a Joint, which requires one) in one undoable step; Collision sets `Collider.enabled`, adding a Collider when needed, and reflects RigidBody-only objects as colliding. Files: `src/editor/Inspector.svelte`, `src/editor/TopBar.svelte`, `src/App.svelte`, `tests/runtime/collisions.test.ts`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, and `AI_USAGE.md`.
- Why: The participant wanted physics and collision as toggles on any object instead of separate preset objects.
- Validation: `npx tsc --noEmit`, `npx svelte-check` (0 errors/0 warnings), and `npx vitest run` (104 tests, one new for a physics object with Collision off) passed. In headless Chrome, a new Sphere's switches went off/off → Physics on (on/on) → Collision off (on/off) → Physics off (off/off), with a screenshot of the Inspector.
- Limitations: Turning Physics off keeps any Collider, so the object stays solid if its Collision switch is on.

### 2026-10-11T04:58:00+05:30 — Add a switchable collision system and manual Add for everything

- Changed: Added the `collisions` scene setting (toolbar toggle and Scene settings) and a `Collider` component with Enabled, Trigger, Reaction (flash, shake, change color, jump, disappear, destroy other), and Reaction color. Colliders make non-physics objects solid and touchable; reactions compile to ordinary `when I touch anything` script handlers. Physics now uses Rapier collision events and collision groups (the floor stays solid when collisions are off), syncs kinematic rotation, and removes bodies of destroyed entities so physics keeps running after a script or reaction deletes an object. The Add menu gained Physics ball/box, Point/Sun/Spot lights, Camera, and Script object; Inspector shows Scene settings (collisions, gravity, background, ambient light, physics step) when nothing is selected, plus View → Scene settings…. The viewport now renders Light components with clickable markers for lights and cameras, and uses the ambient setting like the standalone export; Sun and Spot lights aim along their local down axis in both. Files: `src/registry/components/collider.ts`, `src/registry/index.ts`, `src/runtime/physics.ts`, `src/runtime/reactions.ts`, `src/runtime/scripts.ts`, `src/scene/types.ts`, `src/scene/validate.ts`, `src/scene/applyOps.ts`, `src/ai/prompt.ts`, `src/editor/TopBar.svelte`, `src/editor/Inspector.svelte`, `src/editor/Viewport.svelte`, `src/export/standalone-runtime.ts`, `src/App.svelte`, `src/editor/DocsPanel.svelte`, `tests/runtime/collisions.test.ts`, `README.md`, and `docs/USER_GUIDE.md`.
- Why: The participant asked for collisions that can be turned on and off with objects reacting, and for everything the AI agent can add (lights, scripts, cameras, settings) to be possible by hand.
- Validation: `npx tsc --noEmit`, `npx svelte-check` (0 errors/0 warnings), `npx vitest run` (103 tests, including 6 new collision tests), and `npm run build` passed. In headless Chrome against the dev server, the Add menu, Scene settings card, a lit Point light, and the Collisions toggle were checked by screenshot and DOM state.
- Limitations: Physics uses each entity's local Transform, so colliders inside moved groups are not offset by their parent (existing behavior). Scene settings edited during Play apply only on the next Play. The editor's built-in fill and key lights remain on alongside scene lights. The build keeps its large-chunk warning.

### 2026-10-11T04:37:00+05:30 — Run Console commands during Play

- Changed: Enabled Console commands while the simulation is playing or paused. Live commands update the running script scene, synchronize rigid body edits and impulses with physics, and Stop still restores the pre-Play scene. Updated the Console hint, README, user guide, and in-app Docs. Files: `src/App.svelte`, `src/runtime/physics.ts`, `src/runtime/scripts.ts`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, and `AI_USAGE.md`.
- Why: Allow users to try and adjust scene commands without stopping the simulation.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run. The build retains its large-chunk warning.
- Limitations: Commands remain temporary to the current Play session and are discarded by Stop.

### 2026-10-11T04:34:00+05:30 — Preserve object-added script triggers

- Changed: Added the `when [object] is added` event for objects created by scripts during Play. Tightened Parse instructions so event/condition intent cannot be replaced with an unrelated trigger, reduced scene context fields, and removed the automatic second model call after invalid output. Added the event to the script help and reference. Files: `src/lang/ast.ts`, `src/lang/parser.ts`, `src/lang/codegen.ts`, `src/runtime/scripts.ts`, `src/ai/prompt.ts`, `src/ai/scriptRewrite.ts`, `src/editor/Inspector.svelte`, `src/editor/ScriptEditor.svelte`, `README.md`, and `AI_USAGE.md`.
- Why: Prevent the incorrect conversion of an object-added trigger into a game-start trigger and reduce Parse latency by avoiding a retry round trip.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run. The build retains its large-chunk warning.
- Limitations: The creation event fires for objects created by running scripts during Play. AI response time still depends on the configured provider/model.

### 2026-10-11T04:29:00+05:30 — Select the newest scene object from Console

- Changed: Tab in the Console command input now selects the last entity in scene order (new entities are appended there), and prevents focus from tabbing away. Documented the shortcut in README, user guide, and in-app Docs. Files: `src/App.svelte`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, and `AI_USAGE.md`.
- Why: Let the user quickly select the most recently added object while working in Console.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run. The production build retains its large-chunk warning.
- Limitations: Selection uses the scene's entity insertion order as the creation order.

### 2026-10-11T04:25:00+05:30 — Remove the solid viewport ground

- Changed: Removed the large grey ground mesh while keeping the floor grid. Empty-space context menus now find the y=0 placement point with a ray/plane intersection, so viewport paste retains its ground placement. Updated README and both user guides. Files: `src/editor/Viewport.svelte`, `README.md`, `docs/USER_GUIDE.md`, `src/editor/DocsPanel.svelte`, and `AI_USAGE.md`.
- Why: Participant asked to remove the grey floor rectangle while keeping the grid.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run. The production build retains its large-chunk warning.
- Limitations: Scenes with an explicitly added plane object still render that plane.

### 2026-10-11T04:23:00+05:30 — Add the Console focus shortcut

- Changed: Pressing `/` outside text fields opens the Console panel and focuses its command input. Documented the shortcut in README, user guide, and in-app Docs. Files: `src/App.svelte`, `src/editor/DocsPanel.svelte`, `README.md`, `docs/USER_GUIDE.md`, and `AI_USAGE.md`.
- Why: Let the user start typing a Console command from the keyboard.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run. The production build retains its large-chunk warning.
- Limitations: The shortcut intentionally does not intercept `/` while an input, textarea, select, or contenteditable field is active.

### 2026-10-11T04:05:00+05:30 — Rewrite complete scripts with AI Parse

- Changed: Reworked **✦ Parse** to send the full script and scene context to AI, validate the complete replacement with the parser/type checker/word recognizer, and show the explanation and rewritten script for review before applying. Removed the previous single-phrase recolor special case. Improved the local AI connection error and updated README, user guide, and in-app Docs. Files: `src/ai/scriptRewrite.ts`, `src/ai/client.ts`, `src/editor/ScriptEditor.svelte`, `src/editor/DocsPanel.svelte`, `src/App.svelte`, `src/lang/`, `README.md`, and `docs/USER_GUIDE.md`.
- Why: Make Parse interpret loosely written scripts generally instead of hard-coding individual phrasings.
- Validation: `npm run typecheck`, `npx svelte-check --tsconfig ./tsconfig.json` (0 errors/0 warnings), `npm run build`, and `git diff --check` passed. Tests were not run. The production build retains its existing large-chunk warning.
- Limitations: AI rewrite still requires valid AI configuration and connectivity. Model interpretation cannot guarantee an ambiguous request's intent; the full result is shown for review before use.

### 2026-10-11T03:48:00+05:30 — Accept conversational recolor requests

- Changed: Added `make <object> <color>` as a paint command, with a short polite lead-in such as `can u like`; taught fuzzy-word detection that parser-supported click event wording and the request lead-in are understood. Documented the syntax in `README.md`. Files: `src/lang/parser.ts`, `src/lang/vocabulary.ts`, `src/lang/fuzzy.ts`, `README.md`, and `AI_USAGE.md`.
- Why: Resolve the editor's parse error for `when i click this` followed by `can u like make the box red`, and avoid offering an AI Parse request for those understood words.
- Validation: `npm run typecheck` and `npm run build` passed; `git diff --check` passed. Tests were not run. The build reports the existing large-chunk warning.
- Limitations: `make` currently means recolor an existing object and requires a named color.

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

