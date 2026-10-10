# Project submission

## Project

- **Project name:** SimuStyle
- **Short description:** An AI-native 3D scene, simulation, and animation editor, being built milestone by milestone from a schema-validated scene core.
- **Code repository URL:** https://github.com/JakeOJeff/simustyle
- **Final submitted implementation commit SHA:** Pending final implementation commit.
- **Working demo URL or local demo steps:** Run `npm install` and `npm run dev`; open the Vite URL, create a 20-box stack, press Play/Pause/Stop, and verify Stop restores the scene. Also edit color/position/scale in the inspector and use W/E/R gizmos with undo/redo.
- **Demo access requirements:** Node.js 20.19+ and npm. M1 does not need an API key.

## Participants

Participate solo or in a team of up to 4. Fill in actual participant details before submission.

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| TODO | TODO | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node.js 20.19+ and npm.
- **Install command:** `npm install`.
- **Required environment variable names:** None for the M1 demo. AI settings will be added in M5/M8.
- **Start command:** `npm run dev`.
- **Demo walkthrough:** Create a 20-box stack, run and pause it, then stop and compare the restored hierarchy/transforms. Edit a box through inspector fields and gizmos, undo/redo, then save/open scene JSON.
- **Checks performed and results:** `npm run check` passed, including TypeScript, Svelte diagnostics (0 errors/warnings), 11 Vitest tests (including a settling 20-box simulation, exact stop restore, and rope joint creation), and Vite production build. Vite reports the three.js and Rapier chunks exceed 500 kB.
- **Known limitations or incomplete features:** This is the M3 checkpoint. Script compiler/runtime, AI agent, timeline, glTF/HTML/video exports, and Tauri packaging are not implemented yet.
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
