# Technical decisions

- 2026-10-10: Scene settings are fully populated in memory and default values are omitted from saved JSON; loading fills defaults back in.
- 2026-10-10: Component updates merge field patches, while `null` removes a whole component; inverse batches capture the smallest restorable values.
- 2026-10-10: A batch validates against its final candidate scene and commits atomically, allowing related components to be created together.
- 2026-10-10: Animator `tracks` are registry-managed timeline data and stay out of the ordinary schema-driven inspector fields.
- 2026-10-10: Animation tracks reference registry float, vec3, and color fields; keys use seconds and optional linear, ease-in-out, or step interpolation (linear is the default). Scrubbing evaluates the saved scene without mutating it.
- 2026-10-10: During Play, scripts read the latest physics-synchronized scene, collision handler edits apply after physics sync, and animation applies last each rendered frame; Stop still restores the pre-play snapshot.
- 2026-10-10: Entity reparenting uses an optional `parent` field on update operations so hierarchy drag-and-drop stays validated, atomic, and undoable through `applyOps`.
- 2026-10-10: The physics world uses the scene's fixed timestep and a built-in static ground collider at y=0; Play owns a scene snapshot and Stop restores it exactly.
- 2026-10-10: Script source compiles from checked AST nodes into a restricted context API; generated code does not embed user source. Script mutations use `applyOps`, and `random()` uses an LCG reset to seed 1 on Play.
- 2026-10-10: Browser AI requests go through a Vite dev-server middleware that reads `AI_API_KEY`, `AI_MODEL`, and optional `AI_BASE_URL` from server environment/config; the browser never receives the key, and no `VITE_`-prefixed secret is used.
- 2026-10-10: Svelte 5, three.js, Rapier, Vite, TypeScript, and Vitest are the required app stack from `app-build-prompt.md`; no other app runtime dependency is added in M1.
