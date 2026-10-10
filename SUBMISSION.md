# Project submission

## Project

- **Project name:** SimuStyle
- **Short description:** An AI-native 3D scene, simulation, and animation editor with a schema-validated scene core, Rapier physics, typed scripts, and an AI-powered scene editing flow.
- **Code repository URL:** https://github.com/JakeOJeff/simustyle
- **Final submitted implementation commit SHA:** Pending final implementation commit.
- **Working demo URL or local demo steps:** Run `npm install`, copy `.env.example` to `.env` in the repository root, set `AI_API_KEY` and `AI_MODEL`, then run `npm run dev`. Open the Vite URL and ask the AI tab to create a colorful tower. Review the operation diff and undo it. Add an Animator and key the cube Transform position and Material color, scrub the Timeline tab, and play. Export the scene as GLB and standalone HTML, open the HTML offline, then capture a short WebM. Also create a 20-box stack, verify Play/Pause/Stop, and try `every frame:\n  self.transform.position.x += dt` in a Script component.
- **Demo access requirements:** Node.js 20.19+ and npm. The AI walkthrough needs an OpenAI-compatible API key/model in the local `.env`; non-AI editing and scripting do not.

## Participants

Participate solo or in a team of up to 4. Fill in actual participant details before submission.

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| TODO | TODO | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node.js 20.19+ and npm.
- **Install command:** `npm install`.
- **Required environment variable names:** `AI_API_KEY` and `AI_MODEL`; optional `AI_BASE_URL` (defaults to `https://api.openai.com/v1`). The Vite server reads them and the key never goes to browser code.
- **Start command:** `npm run dev`.
- **Demo walkthrough:** Use the AI tab to create a tower, inspect the returned summary and operation diff, and undo it. Add an Animator and key the cube position and color over 3 seconds, scrub and Play. Export a GLB, save the standalone HTML and open it with networking disabled, then record a short WebM. Finally create a 20-box stack, run and pause it, then stop and compare restored transforms. Add a Script with `param speed: float 0..10 = 3` and an `every frame` movement handler.
- **Checks performed and results:** `npm run check` passed: TypeScript, Svelte diagnostics (0 errors/warnings), 53 Vitest tests including export, animation, AI prompt/transport/agent, scripting, and physics cases, and Vite production build. A local Vite proxy smoke test returned HTTP 503 with the expected unconfigured-key message. Live provider generation was not run because credentials are not configured. Vite reports the three.js and Rapier chunks exceed 500 kB.
- **Known limitations or incomplete features:** This is the M7 checkpoint. Live AI generation requires a configured key/model and has not been verified. The AI key proxy is dev-server middleware until M8 adds the Tauri Rust command. Script handlers run once per rendered frame rather than per fixed physics tick; runtime exceptions report line 1. Dynamic rigid body Transform animation is skipped with a warning. WebM records the live viewport in real time, and the standalone HTML embeds a roughly 5 MB renderer/runtime bundle. Tauri packaging is not implemented yet.
- **Libraries, APIs, and public datasets used:** Svelte 5, Vite, TypeScript, Vitest, three.js, Rapier, @lucide/svelte, and esbuild are installed for the required app and standalone bundle. No public datasets.
- **AI usage record:** [AI_USAGE.md](AI_USAGE.md)
- **Development change log:** [CHANGELOG.md](CHANGELOG.md)

## Submission checklist

- [ ] The project implementation started from scratch at the event.
- [ ] I participated solo or with no more than 4 team members in total.
- [ ] Codex was used during development and its usage is documented.
- [ ] The code repository URL, short project description, and working demo are provided.
- [ ] README setup and demo instructions match the submitted code.
- [ ] Actual checks and known limitations are documented.
- [ ] Meaningful changes are documented and committed throughout development.
- [ ] The final implementation is committed and pushed, and its SHA is recorded above.
- [ ] No credentials or private data are included in the repository or demo instructions.
- [ ] The organizers' announced submission method and timing have been followed.

The event wraps up by **10:00 AM IST on 11 October 2026**. Follow the submission method announced by the organizers.
