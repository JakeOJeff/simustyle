# Project submission

## Project

- **Project name:** SimuStyle
- **Short description:** An AI-native 3D scene, simulation, and animation editor, being built milestone by milestone from a schema-validated scene core.
- **Code repository URL:** https://github.com/JakeOJeff/simustyle
- **Final submitted implementation commit SHA:** Pending final implementation commit.
- **Working demo URL or local demo steps:** Run `npm install` and `npm run dev`; open the Vite URL, add a box from the hierarchy, edit color/position/scale in the inspector, use W/E/R gizmos, then undo/redo and save the scene.
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
- **Demo walkthrough:** Add a box from the hierarchy, select it, use inspector fields and viewport gizmos to edit it, undo/redo the edits, and save/open the scene JSON.
- **Checks performed and results:** `npm run check` passed, including TypeScript, Svelte diagnostics (0 errors/warnings), 8 Vitest tests, and Vite production build. The build emits a bundle-size warning for the current three.js viewport chunk.
- **Known limitations or incomplete features:** This is the M2 checkpoint. Physics, script compiler, AI agent, timeline, glTF/HTML/video exports, and Tauri packaging are not implemented yet.
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
