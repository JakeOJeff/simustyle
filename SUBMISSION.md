# Project submission

## Project

- **Project name:** SimuStyle
- **Short description:** An AI-native 3D scene, simulation, and animation editor with a schema-validated scene core, Rapier physics, and a typed scene scripting language.
- **Code repository URL:** https://github.com/JakeOJeff/simustyle
- **Final submitted implementation commit SHA:** Pending final implementation commit.
- **Working demo URL or local demo steps:** Run `npm install` and `npm run dev`; open the Vite URL, create a 20-box stack, press Play/Pause/Stop, and verify Stop restores the scene. Add Script to an entity and try `every frame:\n  self.transform.position.x += dt`; inspect inline errors and a ranged parameter control.
- **Demo access requirements:** Node.js 20.19+ and npm. M4 does not need an API key.

## Participants

Participate solo or in a team of up to 4. Fill in actual participant details before submission.

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| TODO | TODO | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node.js 20.19+ and npm.
- **Install command:** `npm install`.
- **Required environment variable names:** None for the M4 demo. AI settings are planned for M5/M8.
- **Start command:** `npm run dev`.
- **Demo walkthrough:** Create a 20-box stack, run and pause it, then stop and compare restored transforms. Add Script to an entity, enter `every frame:\n  self.transform.position.x += dt`, add a `param speed: float 0..10 = 3` declaration, then inspect its control and compile feedback.
- **Checks performed and results:** `npm run check` passed: TypeScript, Svelte diagnostics (0 errors/warnings), 26 Vitest tests including scripting and physics cases, and Vite production build. Vite reports the three.js and Rapier chunks exceed 500 kB.
- **Known limitations or incomplete features:** This is the M4 checkpoint. Script handlers run once per rendered frame rather than per fixed physics tick. Script source/parameter edits during Play do not update the active runtime, and runtime exceptions report line 1. AI agent, timeline, glTF/HTML/video exports, and Tauri packaging are not implemented yet.
- **Libraries, APIs, and public datasets used:** Svelte 5, Vite, TypeScript, Vitest, three.js, and Rapier are installed for the required app stack. No public datasets.
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
