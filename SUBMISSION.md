# Project submission

## Project

- **Project name:** SimuStyle Scene Agent
- **Short description:** Converts plain-language scene requests into validated JSON operations that a 3D simulation editor can apply.
- **Code repository URL:** https://github.com/JakeOJeff/simustyle
- **Final submitted implementation commit SHA:** TODO — record after the final implementation commit.
- **Working demo URL or local demo steps:** Run `npm start`, then send a request to `POST http://localhost:3000/api/parse`; see [README.md](README.md) for the request example. Or run `npm run parse -- "A colorful tower of blocks that a wrecking ball swings into"`.
- **Demo access requirements:** Node.js 20+ and an OpenAI API key set as `OPENAI_API_KEY`. Do not include the key in the repository.

## Participants

Participate solo or in a team of up to 4. Fill in actual participant details before submission.

| Participant name | GitHub handle | Contribution |
| --- | --- | --- |
| TODO | TODO | TODO |

## Run and demonstrate

- **Prerequisites and versions:** Node.js 20+; no npm dependencies.
- **Install command:** None required.
- **Required environment variable names:** `OPENAI_API_KEY`; optional `OPENAI_MODEL`, `OPENAI_BASE_URL`, and `PORT`.
- **Start command:** `npm start` (HTTP API) or `npm run parse -- "<scene request>"` (CLI).
- **Demo walkthrough:** Start the server; check `GET /health`; post a plain-language scene request to `/api/parse`; inspect the returned summary and validated `create`/`update`/`delete` operations.
- **Checks performed and results:** `npm run check`, validator smoke checks, and local HTTP health/invalid-input smoke checks passed. Live API generation was not checked because no API key is configured in the workspace.
- **Known limitations or incomplete features:** A live API request needs a configured key and has not been verified in this workspace. This project returns operations but does not compile scripts, render a scene, or apply edits to a simulation.
- **Libraries, APIs, and public datasets used:** Node.js built-in modules; OpenAI Responses API ([API reference](https://developers.openai.com/api/reference/resources/responses/methods/create), [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)). No public datasets.
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
