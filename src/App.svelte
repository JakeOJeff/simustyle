<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Inspector from "./editor/Inspector.svelte";
  import Hierarchy from "./editor/Hierarchy.svelte";
  import Viewport from "./editor/Viewport.svelte";
  import AIPanel, { type AIPanelMessage } from "./editor/AIPanel.svelte";
  import { requestSceneEdit } from "./ai/client";
  import { AI_RESPONSE_JSON_SCHEMA, buildSystemPrompt } from "./ai/prompt";
  import { runSceneAgent } from "./ai/agent";
  import Timeline from "./editor/Timeline.svelte";
  import ExportMenu from "./editor/ExportMenu.svelte";
  import SettingsPanel from "./editor/SettingsPanel.svelte";
  import ScriptEditor from "./editor/ScriptEditor.svelte";
  import { ScriptRuntime, scriptOps } from "./runtime/scripts";
  import { chooseSceneToOpen, chooseSceneToSave, getDesktopAiSettings, isDesktopRuntime, readSceneFile, saveDesktopAiSettings, writeSceneFile } from "./platform/desktop";
  import type { VideoExportConfig, VideoExportProgress } from "./export/video";
  import type { AnimationTrack, AnimationValue } from "./runtime/animator";
  import { AnimatorRuntime } from "./runtime/animator";
  import { componentSchemas } from "./registry";
  import { Box, Circle, Cone, Cylinder, FileCode2, Focus, FolderOpen, Grid3X3, Move3D, Pause, Play, Plus, Redo2, Rotate3D, Save, Scaling, Settings, Square, Undo2, X } from "@lucide/svelte";
  import { applyOps } from "./scene/applyOps";
  import { deserializeScene, serializeScene } from "./scene/serialize";
  import { createEmptyScene, type Entity, type Scene, type SceneOp, type Vec3 } from "./scene/types";
  import type { PlayState, SimulationController } from "./runtime/physics";

  type ToolMode = "translate" | "rotate" | "scale";
  type BottomTab = "console" | "ai" | "timeline";

  let scene: Scene = $state.raw(createEmptyScene());
  let selectedId: string | null = $state(null);
  let selectedIds: string[] = $state([]);
  let mode: ToolMode = $state("translate");
  let gridVisible = $state(true);
  let focusToken = $state(0);
  let primitiveMenuOpen = $state(false);
  let undoStack: SceneOp[][] = $state.raw([]);
  let redoStack: SceneOp[][] = $state.raw([]);
  let message = $state("Ready");
  let playState: PlayState = $state("stopped");
  let playStarting = $state(false);
  let simulationWarnings = $state<string[]>([]);
  let bottomTab = $state<BottomTab>("console");
  let frameToken = $state(0);
  let aiPrompt = $state("");
  let aiLoading = $state(false);
  let aiMessages: AIPanelMessage[] = $state([]);
  let aiUndoRecords: Record<string, SceneOp[]> = $state.raw({});
  let nextAIId = 1;
  let timelineTime = $state(0);
  let settingsOpen = $state(false);
  let aiSettings = $state({ apiKeyConfigured: false, model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" });
  let scenePath: string | null = null;
  // Script tabs open over the viewport, like script windows in Roblox Studio.
  let openScripts: string[] = $state([]);
  let activeTab: string = $state("scene");
  let scriptDrafts: Record<string, string> = $state({});
  let commandText = $state("");
  let commandHistory: string[] = [];
  let commandHistoryIndex = -1;
  let consoleLog: { kind: "info" | "error" | "print"; text: string }[] = $state([]);
  let contextMenu: { id: string | null; x: number; y: number; position: Vec3 | null; source: "object" | "viewport" | "hierarchy" } | null = $state(null);
  let renameTarget: { id: string; name: string } | null = $state(null);
  let entityClipboard: Entity[] | null = $state.raw(null);
  const animatorPreview = new AnimatorRuntime();
  let openInput: HTMLInputElement;
  let activeGesture: { id: string; initial: Scene; operation: SceneOp | null } | null = null;
  let simulation: SimulationController | null = null;
  let animationFrame = 0;
  let lastFrameTime = 0;

  function selectEntity(id: string | null) {
    selectedId = id;
    selectedIds = id ? [id] : [];
  }

  function selectEntities(ids: string[]) {
    selectedIds = ids;
    selectedId = ids[0] ?? null;
  }

  onMount(() => {
    if (isDesktopRuntime()) {
      void getDesktopAiSettings().then((settings) => aiSettings = settings).catch((error) => {
        message = error instanceof Error ? error.message : "Could not load AI settings";
      });
    }
  });

  let selectedEntity = $derived(scene.entities.find((entity) => entity.id === selectedId) ?? null);
  let viewportScene = $derived(bottomTab === "timeline" && playState === "stopped" ? animatorPreview.evaluate(scene, timelineTime).scene : scene);

  function tracksFor(entityId: string): AnimationTrack[] {
    const value = scene.entities.find((entity) => entity.id === entityId)?.components.Animator?.tracks;
    return Array.isArray(value) ? value as AnimationTrack[] : [];
  }

  function changeTracks(entityId: string, tracks: AnimationTrack[]) {
    apply([{ op: "update", id: entityId, components: { Animator: { tracks } } }]);
  }

  function addKeyframe(component: string, field: string) {
    if (!selectedId) return;
    const entity = scene.entities.find((candidate) => candidate.id === selectedId);
    const fieldSchema = componentSchemas[component]?.fields[field];
    if (!entity || !fieldSchema) return;
    const value = (entity.components[component]?.[field] ?? fieldSchema.default) as AnimationValue;
    const tracks = tracksFor(selectedId).map((track) => structuredClone(track));
    let track = tracks.find((candidate) => candidate.component === component && candidate.field === field);
    if (!track) { track = { component, field, keys: [] }; tracks.push(track); }
    const existing = track.keys.findIndex((key) => Math.abs(key.time - timelineTime) < 0.001);
    const key = { time: timelineTime, value: structuredClone(value), interpolation: "linear" as const };
    if (existing >= 0) track.keys[existing] = key;
    else track.keys.push(key);
    track.keys.sort((a, b) => a.time - b.time);
    changeTracks(selectedId, tracks);
    bottomTab = "timeline";
  }

  function pushAIMessage(aiMessage: AIPanelMessage) { aiMessages = [...aiMessages, aiMessage]; }

  async function submitAI(prompt: string) {
    if (aiLoading || !prompt.trim()) return;
    if (playState !== "stopped") { message = "Stop the simulation before asking the scene agent to edit."; return; }
    pushAIMessage({ id: `ai_${nextAIId++}`, role: "user", content: prompt });
    aiPrompt = "";
    aiLoading = true;
    bottomTab = "ai";
    try {
      const result = await runSceneAgent(scene, prompt, {
        buildSystemPrompt,
        responseSchema: AI_RESPONSE_JSON_SCHEMA.schema,
        complete: ({ systemPrompt, userPrompt, correctionErrors, responseSchema }) =>
          requestSceneEdit(systemPrompt, userPrompt, correctionErrors, responseSchema)
      });
      const id = `ai_${nextAIId++}`;
      if (!result.ok || !result.scene || !result.inverseOps) {
        pushAIMessage({ id, role: "assistant", content: result.errors.join(" · "), summary: `Could not apply the request after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}.` });
        message = result.errors.join(" · ") || "AI changes could not be validated";
        return;
      }
      scene = result.scene;
      undoStack = [...undoStack, result.inverseOps];
      redoStack = [];
      aiUndoRecords = { ...aiUndoRecords, [id]: result.inverseOps };
      const changed = result.ops.find((operation) => operation.op === "create" || operation.op === "update");
      if (changed && (changed.op === "create" || changed.op === "update")) selectEntity(changed.id);
      frameToken += 1;
      pushAIMessage({ id, role: "assistant", content: result.summary ?? "Scene updated.", summary: result.summary ?? "Scene updated.", operations: result.ops });
      message = result.summary ?? "AI changes applied";
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      pushAIMessage({ id: `ai_${nextAIId++}`, role: "assistant", content: reason, summary: `AI request failed: ${reason}` });
      message = reason;
    } finally {
      aiLoading = false;
    }
  }

  function undoAIChange(messageId: string) {
    const operations = aiUndoRecords[messageId];
    if (!operations) return;
    const result = applyOps(scene, operations);
    if (result.errors.length) { message = `Could not undo AI change: ${result.errors.join(" · ")}`; return; }
    scene = result.scene;
    undoStack = undoStack.filter((batch) => JSON.stringify(batch) !== JSON.stringify(operations));
    redoStack = [...redoStack, result.inverseOps];
    const { [messageId]: _removed, ...remaining } = aiUndoRecords;
    aiUndoRecords = remaining;
    message = "Undid AI change";
  }

  function apply(ops: SceneOp[]) {
    const result = applyOps(scene, ops);
    if (result.errors.length) {
      message = result.errors.join(" · ");
      return false;
    }
    scene = result.scene;
    if (playState === "stopped" && result.inverseOps.length) {
      undoStack = [...undoStack, result.inverseOps];
      redoStack = [];
    }
    message = "Scene updated";
    return true;
  }

  function createBox() { createPrimitive("box"); }

  function createPrimitive(shape: "box" | "sphere" | "cylinder" | "cone" | "plane" | "capsule") {
    const label = shape[0].toUpperCase() + shape.slice(1);
    let index = scene.entities.filter((entity) => entity.components.Mesh?.shape === shape).length + 1;
    while (scene.entities.some((entity) => entity.id === `${shape}_${index}`)) index += 1;
    const id = `${shape}_${index}`;
    // Place new primitives in a deterministic spiral so they remain visible and pickable.
    const placement = scene.entities.length;
    const angle = placement * 2.399963229728653;
    const radius = 1.5 * Math.sqrt(placement);
    if (apply([{ op: "create", id, name: `${label} ${index}`, parent: null, components: {
      Transform: { position: [radius * Math.cos(angle), shape === "plane" ? 0.01 : 0.5, radius * Math.sin(angle)], rotation: shape === "plane" ? [-90, 0, 0] : [0, 0, 0] }, Mesh: { shape }, Material: { color: "#8b7cff" }
    } }])) selectEntity(id);
    primitiveMenuOpen = false;
  }

  function descendantsInDeleteOrder(id: string): string[] {
    const children = scene.entities.filter((entity) => entity.parent === id);
    return [...children.flatMap((child) => descendantsInDeleteOrder(child.id)), id];
  }

  function deleteEntity(id: string): boolean {
    const ids = descendantsInDeleteOrder(id);
    if (apply(ids.map((entityId) => ({ op: "delete" as const, id: entityId })))) {
      if (ids.some((entityId) => selectedIds.includes(entityId))) selectEntities(selectedIds.filter((entityId) => !ids.includes(entityId)));
      return true;
    }
    return false;
  }

  function openEntityMenu(id: string | null, x: number, y: number, position: Vec3 | null = null, source: "object" | "viewport" | "hierarchy" = "object") {
    if (playState !== "stopped") { message = "Stop the simulation before editing entities."; return; }
    if (id) selectEntity(id);
    contextMenu = { id, position, source, x: Math.max(8, Math.min(x, window.innerWidth - 210)), y: Math.max(8, Math.min(y, window.innerHeight - 300)) };
  }

  function copyEntity(id: string) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    entityClipboard = descendantsInDeleteOrder(id).reverse().map((entityId) => structuredClone(scene.entities.find((candidate) => candidate.id === entityId)!));
    message = `Copied ${entity.name}`;
    contextMenu = null;
  }

  function cutEntity(id: string) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    const copied = descendantsInDeleteOrder(id).reverse().map((entityId) => structuredClone(scene.entities.find((candidate) => candidate.id === entityId)!));
    if (!deleteEntity(id)) return;
    entityClipboard = copied;
    message = `Cut ${entity.name}`;
    contextMenu = null;
  }

  function pasteEntity(position: Vec3 | null = contextMenu?.position ?? null) {
    if (!entityClipboard || playState !== "stopped") return;
    const sourceTree = entityClipboard;
    const idMap = new Map<string, string>();
    const usedIds = new Set(scene.entities.map((entity) => entity.id));
    for (const source of sourceTree) {
      let suffix = 1;
      let id = `${source.id}_copy`;
      while (usedIds.has(id)) id = `${source.id}_copy${++suffix}`;
      usedIds.add(id);
      idMap.set(source.id, id);
    }
    const root = sourceTree[0];
    const rootId = idMap.get(root.id)!;
    const operations: SceneOp[] = sourceTree.map((source, index) => {
      const components = structuredClone(source.components);
      if (index === 0) {
        const transform = components.Transform ?? (components.Transform = {});
        const current = Array.isArray(transform.position) && transform.position.length === 3 ? transform.position.map(Number) : [0, 0, 0];
        transform.position = position
          ? [position[0], current[1], position[2]]
          : [current[0] + 1.5, current[1], current[2] + 1.5];
      }
      const parent = index === 0
        ? (position || contextMenu?.source === "hierarchy" && contextMenu.id === null
          ? null
          : (source.parent && scene.entities.some((entity) => entity.id === source.parent) ? source.parent : null))
        : (source.parent ? idMap.get(source.parent) ?? source.parent : null);
      return { op: "create", id: idMap.get(source.id)!, name: index === 0 ? `${root.name} Copy` : source.name, parent, components };
    });
    if (apply(operations)) selectEntity(rootId);
    contextMenu = null;
  }

  function duplicateEntity(id: string) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    const previousClipboard = entityClipboard;
    entityClipboard = descendantsInDeleteOrder(id).reverse().map((entityId) => structuredClone(scene.entities.find((candidate) => candidate.id === entityId)!));
    pasteEntity();
    entityClipboard = previousClipboard;
  }

  function commitRename() {
    if (!renameTarget) return;
    const name = renameTarget.name.trim();
    if (!name) { message = "Entity name cannot be empty"; return; }
    if (apply([{ op: "update", id: renameTarget.id, components: {}, name }])) {
      message = `Renamed entity to ${name}`;
      renameTarget = null;
      contextMenu = null;
    }
  }

  function reparentEntity(id: string, parent: string | null) {
    if (scene.entities.some((entity) => entity.id === id)) apply([{ op: "update", id, components: {}, parent }]);
  }

  function undo() {
    const ops = undoStack.at(-1);
    if (!ops) return;
    const result = applyOps(scene, ops);
    if (result.errors.length) { message = result.errors.join(" · "); return; }
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, result.inverseOps];
    scene = result.scene;
    message = "Undid last change";
  }

  function redo() {
    const ops = redoStack.at(-1);
    if (!ops) return;
    const result = applyOps(scene, ops);
    if (result.errors.length) { message = result.errors.join(" · "); return; }
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, result.inverseOps];
    scene = result.scene;
    message = "Redid last change";
  }

  function preview(ops: SceneOp[]) {
    const result = applyOps(scene, ops);
    if (result.errors.length) { message = result.errors.join(" · "); return false; }
    scene = result.scene;
    return true;
  }

  function finishGesture() {
    const gesture = activeGesture;
    activeGesture = null;
    if (!gesture?.operation) return;
    const result = applyOps(gesture.initial, [gesture.operation]);
    if (result.errors.length) { message = result.errors.join(" · "); return; }
    if (playState === "stopped" && result.inverseOps.length) {
      undoStack = [...undoStack, result.inverseOps];
      redoStack = [];
    }
    message = "Scene updated";
  }

  function updateComponent(component: string, fields: Record<string, unknown>, phase?: "start" | "preview" | "end") {
    if (!selectedId) return;
    const id = selectedId;
    const operation: SceneOp = { op: "update", id, components: { [component]: fields } };
    if (phase === "start") {
      activeGesture = { id, initial: structuredClone(scene), operation };
      return;
    }
    if (phase === "preview" && activeGesture?.id === id) {
      activeGesture.operation = operation;
      preview([operation]);
      return;
    }
    if (phase === "end" && activeGesture?.id === id) {
      activeGesture.operation = operation;
      finishGesture();
      return;
    }
    apply([operation]);
  }

  function updateTransform(id: string, fields: Record<string, unknown>, phase: "start" | "change" | "end") {
    const operation: SceneOp = { op: "update", id, components: { Transform: fields } };
    if (phase === "start") {
      activeGesture = { id, initial: structuredClone(scene), operation };
    } else if (phase === "change" && activeGesture?.id === id) {
      activeGesture.operation = operation;
      preview([operation]);
    } else if (phase === "end" && activeGesture?.id === id) {
      activeGesture.operation = operation;
      finishGesture();
    } else if (phase === "change") {
      apply([operation]);
    }
  }

  function addComponent(component: string) {
    if (!selectedId) return;
    if (component === "Script") { openScript(selectedId); return; }
    apply([{ op: "update", id: selectedId, components: { [component]: {} } }]);
  }

  // --- Scripts ------------------------------------------------------------------

  let entityNames = $derived(new Set(scene.entities.flatMap((entity) => [entity.id.toLowerCase(), ...entity.name.toLowerCase().split(/s+/)])));

  function storedSource(id: string): string {
    const source = scene.entities.find((entity) => entity.id === id)?.components.Script?.source;
    return typeof source === "string" ? source : "";
  }

  function scriptTemplate(name: string, sceneScript: boolean): string {
    return sceneScript
      ? `-- Scene script: control any object by its name or a description.
-- Press Play to run it. Click examples on the right to insert them.
on start:
  say "Scene started"
`
      : `-- Script for ${name}. Press Play to run it.
on start:
  animate self like a gentle float
`;
  }

  /** Open an entity's script in a tab, adding a Script component first if it has none. */
  function openScript(id: string) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    if (!entity.components.Script) {
      const components: Record<string, Record<string, unknown>> = { Script: { source: scriptTemplate(entity.name, !entity.components.Mesh) } };
      if (!entity.components.Transform) components.Transform = {};
      if (!apply([{ op: "update", id, components }])) return;
      message = `Added a script to ${entity.name}`;
    }
    if (!openScripts.includes(id)) openScripts = [...openScripts, id];
    activeTab = id;
  }

  /** Toolbar Script button: the selected object's script, or a scene-wide script when nothing is selected. */
  function openScriptForSelection() {
    if (selectedId) { openScript(selectedId); return; }
    const existing = scene.entities.find((entity) => entity.components.Script && !entity.components.Mesh);
    if (existing) { selectEntity(existing.id); openScript(existing.id); return; }
    let index = 1;
    while (scene.entities.some((entity) => entity.id === `scene_script${index === 1 ? "" : `_${index}`}`)) index += 1;
    const id = `scene_script${index === 1 ? "" : `_${index}`}`;
    if (!apply([{ op: "create", id, name: "Scene Script", parent: null, components: { Transform: {}, Script: { source: scriptTemplate("the scene", true) } } }])) return;
    selectEntity(id);
    openScript(id);
  }

  function commitScript(id: string) {
    const draft = scriptDrafts[id];
    if (draft === undefined) return;
    const { [id]: _done, ...rest } = scriptDrafts;
    scriptDrafts = rest;
    if (draft !== storedSource(id) && apply([{ op: "update", id, components: { Script: { source: draft } } }])) message = "Script saved";
  }

  function commitAllScripts() { for (const id of Object.keys(scriptDrafts)) commitScript(id); }

  function closeScript(id: string) {
    commitScript(id);
    openScripts = openScripts.filter((candidate) => candidate !== id);
    if (activeTab === id) activeTab = openScripts.at(-1) ?? "scene";
  }

  // Close tabs whose entity was deleted (including by undo or the AI agent).
  $effect(() => {
    const alive = openScripts.filter((id) => scene.entities.some((entity) => entity.id === id && entity.components.Script));
    if (alive.length !== openScripts.length) {
      openScripts = alive;
      if (activeTab !== "scene" && !alive.includes(activeTab)) activeTab = "scene";
    }
  });

  function log(kind: "info" | "error" | "print", text: string) { consoleLog = [...consoleLog, { kind, text }].slice(-60); }

  /** Keep the newest console line in view. */
  function followLog(node: HTMLElement, _length: number) {
    node.scrollTop = node.scrollHeight;
    return { update() { node.scrollTop = node.scrollHeight; } };
  }

  /** Command bar: run script lines against the scene now, as one undoable edit. */
  function runCommandBar() {
    const text = commandText.trim();
    if (!text) return;
    if (playState !== "stopped") { message = "Stop the simulation to run commands on the scene."; return; }
    commandHistory = [text, ...commandHistory.filter((entry) => entry !== text)].slice(0, 30);
    commandHistoryIndex = -1;
    log("info", `> ${text}`);
    const result = ScriptRuntime.runOnce(scene, text);
    for (const entry of result.prints) log("print", entry.values.map(String).join(" "));
    for (const issue of result.issues) log("error", issue.message);
    const ops = scriptOps(scene, result.scene);
    if (ops.length && apply(ops)) message = `Ran: ${text}`;
    else if (!ops.length && !result.issues.length && !result.prints.length) log("info", "Nothing changed.");
    if (!result.issues.length) commandText = "";
  }

  function commandKey(event: KeyboardEvent) {
    if (event.key === "ArrowUp" && commandHistory.length) {
      event.preventDefault();
      commandHistoryIndex = Math.min(commandHistory.length - 1, commandHistoryIndex + 1);
      commandText = commandHistory[commandHistoryIndex]!;
    } else if (event.key === "ArrowDown" && commandHistoryIndex >= 0) {
      event.preventDefault();
      commandHistoryIndex -= 1;
      commandText = commandHistoryIndex >= 0 ? commandHistory[commandHistoryIndex]! : "";
    }
  }

  function newScene() {
    scriptDrafts = {};
    stopSimulation();
    activeGesture = null;
    scene = createEmptyScene();
    selectEntity(null);
    undoStack = [];
    redoStack = [];
    scenePath = null;
    message = "New scene";
  }

  async function saveScene() {
    commitAllScripts();
    if (isDesktopRuntime()) {
      try {
        const path = scenePath ?? await chooseSceneToSave("untitled.simu");
        if (!path) return;
        await writeSceneFile(path, serializeScene(scene));
        scenePath = path;
        message = `Saved ${path.split(/[\\/]/).at(-1) ?? "scene"}`;
      } catch (error) {
        message = error instanceof Error ? error.message : "Unable to save scene file";
      }
      return;
    }
    const file = new Blob([serializeScene(scene)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "untitled.scene.json";
    anchor.click();
    URL.revokeObjectURL(url);
    message = "Scene saved";
  }

  async function loadScene(event?: Event) {
    if (isDesktopRuntime()) {
      try {
        const path = await chooseSceneToOpen();
        if (!path) return;
        const loadedScene = deserializeScene(await readSceneFile(path));
        stopSimulation();
        scene = loadedScene;
        activeGesture = null;
        selectEntity(null);
        undoStack = [];
        redoStack = [];
        scenePath = path;
        message = `Opened ${path.split(/[\\/]/).at(-1) ?? "scene"}`;
      } catch (error) {
        message = error instanceof Error ? error.message : "Unable to open scene file";
      }
      return;
    }
    if (!event) return;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const loadedScene = deserializeScene(await file.text());
      stopSimulation();
      scene = loadedScene;
      scenePath = file.name;
      activeGesture = null;
      selectEntity(null);
      undoStack = [];
      redoStack = [];
      message = `Opened ${file.name}`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Unable to open scene file";
    } finally {
      input.value = "";
    }
  }

  async function saveAiSettings(settings: { model: string; baseUrl: string; apiKey: string }): Promise<void> {
    aiSettings = await saveDesktopAiSettings({ model: settings.model, baseUrl: settings.baseUrl, ...(settings.apiKey ? { apiKey: settings.apiKey } : {}) });
  }

  async function removeAiKey(): Promise<void> {
    aiSettings = await saveDesktopAiSettings({ ...aiSettings, apiKey: null });
  }

  function physicsFrame(time: number) {
    if (playState !== "playing" || !simulation) return;
    const elapsed = Math.max(0, (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    timelineTime += elapsed;
    scene = simulation.advance(scene, elapsed);
    const scriptMessages = simulation.takeScriptMessages();
    if (scriptMessages.length) {
      simulationWarnings = [...simulationWarnings, ...scriptMessages].slice(-30);
      for (const entry of scriptMessages) log(/^[^:s]*:d+:d+ /.test(entry) ? "error" : "print", entry);
    }
    animationFrame = requestAnimationFrame(physicsFrame);
  }

  async function startSimulation() {
    if (playStarting || playState !== "stopped") return;
    commitAllScripts();
    playStarting = true;
    activeGesture = null;
    timelineTime = 0;
    try {
      const { SimulationController: Controller } = await import("./runtime/physics");
      simulation ??= new Controller();
      const warnings = await simulation.play(scene);
      if (simulation.initialScene) scene = simulation.initialScene;
      simulationWarnings = warnings;
      if (simulation.state !== "playing") {
        message = warnings.join("; ") || "Could not start simulation";
        return;
      }
      playState = "playing";
      message = warnings.join("; ") || "Simulation playing";
      lastFrameTime = performance.now();
      animationFrame = requestAnimationFrame(physicsFrame);
    } catch (error) {
      message = error instanceof Error ? `Could not start simulation: ${error.message}` : "Could not start simulation";
    } finally {
      playStarting = false;
    }
  }

  async function exportVideo(config: VideoExportConfig, signal: AbortSignal, onProgress: (value: VideoExportProgress) => void): Promise<Blob> {
    const wasStopped = playState === "stopped";
    const wasPaused = playState === "paused";
    if (wasStopped) await startSimulation();
    else if (wasPaused) resumeSimulation();
    if (playState !== "playing") throw new Error("Start Play before exporting video; the simulation could not start.");
    const canvas = document.querySelector<HTMLCanvasElement>(".viewport canvas");
    if (!canvas) throw new Error("The 3D viewport canvas is unavailable.");
    try {
      const { exportCanvasVideo } = await import("./export/video");
      return await exportCanvasVideo(canvas, config, { signal, onProgress });
    } finally {
      if (wasStopped) stopSimulation();
      else if (wasPaused) pauseSimulation();
    }
  }

  function pauseSimulation() {
    simulation?.pause();
    if (!simulation) return;
    playState = simulation.state;
    cancelAnimationFrame(animationFrame);
    message = "Simulation paused";
  }

  function resumeSimulation() {
    simulation?.resume();
    if (!simulation) return;
    playState = simulation.state;
    lastFrameTime = performance.now();
    animationFrame = requestAnimationFrame(physicsFrame);
    message = "Simulation playing";
  }

  function stopSimulation() {
    cancelAnimationFrame(animationFrame);
    const snapshot = simulation?.stop() ?? null;
    if (snapshot) scene = snapshot;
    playState = "stopped";
    timelineTime = 0;
    playStarting = false;
    simulationWarnings = [];
    message = "Simulation stopped; scene restored";
  }

  onDestroy(() => {
    cancelAnimationFrame(animationFrame);
    simulation?.stop();
  });
</script>

<svelte:head><title>SimuStyle — Scene Editor</title></svelte:head>

<main class="editor" class:simulation-playing={playState === "playing"} class:simulation-paused={playState === "paused"}>
  <header class="toolbar">
    <div class="brand"><span class="brand-mark">S</span><span>SimuStyle</span></div>
    <div class="toolbar-group file-actions">
      <button title="New scene" aria-label="New scene" onclick={newScene}><Plus size={14} /> <span>New</span></button>
      <button title="Open scene" aria-label="Open scene" onclick={() => isDesktopRuntime() ? void loadScene() : openInput.click()}><FolderOpen size={14} /> <span>Open</span></button>
      <button title="Save scene" aria-label="Save scene" onclick={saveScene}><Save size={14} /> <span>Save</span></button>
      <input bind:this={openInput} class="file-input" type="file" accept=".json,.scene.json,application/json" onchange={loadScene} />
    </div>
    <div class="toolbar-group history-actions">
      <button title="Undo" disabled={undoStack.length === 0 || playState !== "stopped"} onclick={undo}><Undo2 size={15} /> <span>Undo</span></button>
      <button title="Redo" disabled={redoStack.length === 0 || playState !== "stopped"} onclick={redo}><Redo2 size={15} /> <span>Redo</span></button>
    </div>
    <ExportMenu scene={viewportScene} onVideoExport={exportVideo} />
    <div class="toolbar-spacer"></div>
    <div class="primitive-picker">
      <button class="add-primitive" aria-expanded={primitiveMenuOpen} onclick={() => primitiveMenuOpen = !primitiveMenuOpen}><Plus size={14} /> Add</button>
      {#if primitiveMenuOpen}
        <div class="primitive-menu" role="menu" aria-label="Add mesh primitive">
          <button role="menuitem" onclick={() => createPrimitive("box")}><Box size={15} /> Cube</button>
          <button role="menuitem" onclick={() => createPrimitive("sphere")}><Circle size={15} /> Sphere</button>
          <button role="menuitem" onclick={() => createPrimitive("cylinder")}><Cylinder size={15} /> Cylinder</button>
          <button role="menuitem" onclick={() => createPrimitive("capsule")}><Circle size={15} /> Capsule</button>
          <button role="menuitem" onclick={() => createPrimitive("cone")}><Cone size={15} /> Cone</button>
          <button role="menuitem" onclick={() => createPrimitive("plane")}><Square size={15} /> Plane</button>
        </div>
      {/if}
    </div>
    <button class="script-button" title="Open the selected object's script (or a scene script)" onclick={openScriptForSelection}><FileCode2 size={14} /> Script</button>
    <div class="toolbar-group tools" aria-label="Transform tool">
      <button class:active={mode === "translate"} aria-label="Move tool" title="Move (W)" onclick={() => mode = "translate"}><Move3D size={16} /></button>
      <button class:active={mode === "rotate"} aria-label="Rotate tool" title="Rotate (E)" onclick={() => mode = "rotate"}><Rotate3D size={16} /></button>
      <button class:active={mode === "scale"} aria-label="Scale tool" title="Scale (R)" onclick={() => mode = "scale"}><Scaling size={16} /></button>
    </div>
    <button class:active={gridVisible} class="view-toggle" title="Toggle floor grid" aria-label="Toggle floor grid" onclick={() => gridVisible = !gridVisible}><Grid3X3 size={15} /></button>
    <button class="view-toggle" title="Frame selected (F)" aria-label="Frame selected" disabled={!selectedId} onclick={() => focusToken += 1}><Focus size={15} /></button>
    {#if isDesktopRuntime()}<button class="view-toggle" title="AI settings" aria-label="AI settings" onclick={() => settingsOpen = true}><Settings size={15} /></button>{/if}
    {#if playState === "stopped"}
      <button class="play-button" disabled={playStarting} onclick={startSimulation}><Play size={14} fill="currentColor" /> <span>{playStarting ? "Starting…" : "Play"}</span></button>
    {:else}
      <div class="simulation-controls">
        <button class="play-button" onclick={playState === "playing" ? pauseSimulation : resumeSimulation}>{#if playState === "playing"}<Pause size={14} fill="currentColor" /> Pause{:else}<Play size={14} fill="currentColor" /> Resume{/if}</button>
        <button class="stop-button" onclick={stopSimulation}>■ Stop</button>
      </div>
    {/if}
  </header>

  <div class="editor-body">
    <Hierarchy scene={scene} {selectedIds} onSelect={selectEntity} onCreate={createBox} onDelete={deleteEntity} onReparent={reparentEntity} onOpenScript={openScript} onContextMenu={openEntityMenu} onContextMenuEmpty={(x, y) => openEntityMenu(null, x, y, null, "hierarchy")} />
    <section class="viewport-column">
      {#if openScripts.length}
        <div class="stage-tabs" role="tablist" aria-label="Open documents">
          <button role="tab" class="stage-tab" aria-selected={activeTab === "scene"} onclick={() => activeTab = "scene"}><Box size={13} /> Scene</button>
          {#each openScripts as id (id)}
            {@const entity = scene.entities.find((candidate) => candidate.id === id)}
            <div class="stage-tab" role="tab" tabindex="0" aria-selected={activeTab === id} onclick={() => { activeTab = id; selectEntity(id); }} onkeydown={(event) => { if (event.key === "Enter") activeTab = id; }}>
              <FileCode2 size={13} /> {entity?.name ?? id}{#if scriptDrafts[id] !== undefined}<i class="dirty-dot" title="Unsaved changes">●</i>{/if}
              <button class="close-tab" aria-label="Close {entity?.name ?? id} script" onclick={(event) => { event.stopPropagation(); closeScript(id); }}><X size={12} /></button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="stage">
        <Viewport scene={viewportScene} {selectedId} {selectedIds} {mode} {frameToken} {focusToken} {gridVisible} onSelect={selectEntity} onSelectMany={selectEntities} onTransform={updateTransform} onModeChange={(nextMode) => mode = nextMode} onContextMenu={(id, x, y, position) => openEntityMenu(id, x, y, position, id ? "object" : "viewport")} />
        {#if activeTab !== "scene" && openScripts.includes(activeTab)}
          {@const id = activeTab}
          {#key id}
            <ScriptEditor
              title={`${scene.entities.find((entity) => entity.id === id)?.name ?? id} — script`}
              source={scriptDrafts[id] ?? storedSource(id)}
              dirty={scriptDrafts[id] !== undefined}
              readOnly={playState !== "stopped"}
              {entityNames}
              onChange={(source) => scriptDrafts = { ...scriptDrafts, [id]: source }}
              onCommit={() => commitScript(id)}
            />
          {/key}
        {/if}
      </div>
      <div class="bottom-panel" class:ai-expanded={bottomTab === "ai"} class:timeline-expanded={bottomTab === "timeline"} class:console-expanded={bottomTab === "console"}>
        <div class="bottom-tabs">
          <button class:selected={bottomTab === "console"} onclick={() => bottomTab = "console"}>Console</button>
          <button class:selected={bottomTab === "ai"} onclick={() => bottomTab = "ai"}>AI</button>
          <button class:selected={bottomTab === "timeline"} onclick={() => bottomTab = "timeline"}>Timeline</button>
        </div>
        <div class="console-line"><span class="console-dot">●</span>{message}{#if simulationWarnings.length}<span> · {simulationWarnings.join(" · ")}</span>{/if}</div>
        {#if bottomTab === "ai"}
          <AIPanel messages={aiMessages} loading={aiLoading} prompt={aiPrompt} onPromptChange={(value) => aiPrompt = value} onSubmit={submitAI} onUndo={undoAIChange} />
        {:else if bottomTab === "timeline"}
          <Timeline {scene} {selectedId} playhead={timelineTime} onPlayheadChange={(value) => timelineTime = value} onTrackChange={(tracks) => selectedId && changeTracks(selectedId, tracks)} />
        {:else}
          <div class="console-log" aria-live="polite" use:followLog={consoleLog.length}>
            {#if !consoleLog.length}<div class="console-hint">Type a command below to change the scene right now, for example <code>move the box up 2</code> or <code>paint the sphere red</code>. Use the Script button to make it run on Play.</div>{/if}
            {#each consoleLog as entry}<div class="log-{entry.kind}">{entry.text}</div>{/each}
          </div>
          <form class="command-bar" onsubmit={(event) => { event.preventDefault(); runCommandBar(); }}>
            <span aria-hidden="true">›</span>
            <input aria-label="Run a script command" placeholder="move the red ball above the box" bind:value={commandText} onkeydown={commandKey} spellcheck="false" autocomplete="off" />
            <button type="submit" disabled={!commandText.trim() || playState !== "stopped"}>Run</button>
          </form>
        {/if}
      </div>
    </section>
    <Inspector {scene} entity={selectedEntity} onUpdate={updateComponent} onRemove={(component) => selectedId && apply([{ op: "update", id: selectedId, components: { [component]: null } }])} onAdd={addComponent} onKeyframe={addKeyframe} onOpenScript={() => selectedId && openScript(selectedId)} />
  </div>
  <footer class="statusbar"><span><i></i> SCENE CORE</span><span>{scene.entities.length} {scene.entities.length === 1 ? "ENTITY" : "ENTITIES"}</span><span>Y-UP · METERS</span></footer>
  {#if settingsOpen}
    <div class="settings-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) settingsOpen = false; }}>
      <SettingsPanel model={aiSettings.model} baseUrl={aiSettings.baseUrl} hasApiKey={aiSettings.apiKeyConfigured} onSave={saveAiSettings} onRemoveKey={removeAiKey} onClose={() => settingsOpen = false} />
    </div>
  {/if}
  {#if contextMenu}
    <button class="context-dismiss" type="button" aria-label="Close entity menu" onclick={() => contextMenu = null}></button>
    <div class="entity-context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`} role="menu" aria-label="Entity actions" tabindex="-1" oncontextmenu={(event) => event.preventDefault()}>
      {#if contextMenu.id}
        <button role="menuitem" onclick={() => cutEntity(contextMenu!.id!)} disabled={playState !== "stopped"}>Cut</button>
        <button role="menuitem" onclick={() => copyEntity(contextMenu!.id!)}>Copy</button>
      {/if}
      <button role="menuitem" onclick={() => pasteEntity(contextMenu?.position ?? null)} disabled={!entityClipboard || playState !== "stopped"}>Paste</button>
      {#if contextMenu.id}
        <div class="context-separator"></div>
        <button role="menuitem" onclick={() => duplicateEntity(contextMenu!.id!)} disabled={playState !== "stopped"}>Duplicate</button>
        <button role="menuitem" onclick={() => { const entity = scene.entities.find((candidate) => candidate.id === contextMenu!.id); if (entity) renameTarget = { id: entity.id, name: entity.name }; contextMenu = null; }} disabled={playState !== "stopped"}>Rename</button>
        <div class="context-separator"></div>
        <button class="context-delete" role="menuitem" onclick={() => { deleteEntity(contextMenu!.id!); contextMenu = null; }} disabled={playState !== "stopped"}>Delete</button>
      {/if}
    </div>
  {/if}
  {#if renameTarget}
    <div class="rename-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) renameTarget = null; }}>
      <div class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
        <h2 id="rename-title">Rename entity</h2>
        <form onsubmit={(event) => { event.preventDefault(); commitRename(); }}>
          <input aria-label="Entity name" bind:value={renameTarget.name} maxlength="100" />
          <div class="rename-actions"><button type="button" onclick={() => renameTarget = null}>Cancel</button><button type="submit" disabled={!renameTarget.name.trim()}>Rename</button></div>
        </form>
      </div>
    </div>
  {/if}
</main>

<style>
  .stage{position:relative;flex:1;min-height:0;display:flex}
  .stage-tabs{height:32px;display:flex;align-items:stretch;gap:1px;padding:0 6px;background:#15161c;border-bottom:1px solid #ffffff0e;overflow-x:auto}
  .stage-tab{display:flex;align-items:center;gap:6px;padding:0 6px 0 10px;border:0;border-top:2px solid transparent;background:transparent;color:#8a8896;font-size:10.5px;white-space:nowrap;cursor:pointer}
  button.stage-tab{padding-right:12px}
  .stage-tab[aria-selected="true"]{background:#1d1e26;color:#e6e3f1;border-top-color:#9585fa}
  .stage-tab:hover{color:#d6d3e0}
  .dirty-dot{font-style:normal;color:#ffd479;font-size:8px}
  .close-tab{display:grid;place-items:center;width:18px;height:18px;border:0;border-radius:4px;background:none;color:#777583;cursor:pointer}
  .close-tab:hover{background:#ffffff12;color:#fff}
  .script-button{height:30px;display:flex;align-items:center;gap:6px;padding:0 11px;border:1px solid #7fd1ff40;border-radius:6px;background:#1f2f3a;color:#a9def7;font-size:10px;cursor:pointer}
  .script-button:hover{background:#26394a}
  :global(.bottom-panel.console-expanded){height:172px;min-height:140px;display:flex;flex-direction:column}
  .console-log{flex:1;min-height:0;overflow:auto;padding:0 15px 4px;font:10.5px/17px 'DM Mono',monospace;color:#a9a7b5}
  .console-hint{color:#77757f;font-family:'DM Sans',sans-serif;font-size:10.5px}.console-hint code{color:#7fd1ff;font-family:'DM Mono',monospace}
  .log-info{color:#8a8896}.log-print{color:#d9d7e2}.log-error{color:#ff8992}
  .command-bar{display:flex;align-items:center;gap:8px;margin:0 10px 8px;padding:0 4px 0 10px;height:30px;border:1px solid #ffffff14;border-radius:6px;background:#111217}
  .command-bar:focus-within{border-color:#7fd1ff66}
  .command-bar span{color:#7fd1ff;font:13px 'DM Mono',monospace}
  .command-bar input{flex:1;min-width:0;height:100%;border:0;outline:none;background:transparent;color:#e6e3f1;font:11px 'DM Mono',monospace}
  .command-bar button{height:22px;padding:0 10px;border:0;border-radius:4px;background:#1f2f3a;color:#a9def7;font-size:10px;cursor:pointer}.command-bar button:disabled{opacity:.4;cursor:default}
  .settings-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:#09090dc9;backdrop-filter:blur(5px)}
  .context-dismiss{position:fixed;inset:0;z-index:30;border:0;background:transparent}
  .entity-context-menu{position:fixed;z-index:31;width:194px;padding:5px;border:1px solid #383845;border-radius:8px;background:#1b1b23;box-shadow:0 12px 36px #0009}
  .entity-context-menu button{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:#e6e3f1;text-align:left;font-size:11px;cursor:pointer}
  .entity-context-menu button:hover:not(:disabled){background:#302d40}
  .entity-context-menu button:disabled{opacity:.4;cursor:default}
  .entity-context-menu .context-delete{color:#ff9ba2}
  .context-separator{height:1px;margin:4px 3px;background:#ffffff18}
  .rename-overlay{position:fixed;inset:0;z-index:40;display:grid;place-items:center;padding:20px;background:#09090dc9;backdrop-filter:blur(4px)}
  .rename-dialog{width:min(360px,100%);padding:20px;border:1px solid #383845;border-radius:10px;background:#1b1b23;box-shadow:0 18px 50px #0009}
  .rename-dialog h2{margin:0 0 14px;color:#e6e3f1;font-size:14px}
  .rename-dialog input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:1px solid #454451;border-radius:5px;background:#111217;color:#e6e3f1;font:12px 'DM Sans',sans-serif;outline:none}
  .rename-dialog input:focus{border-color:#9585fa}
  .rename-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
  .rename-actions button{height:28px;padding:0 12px;border:1px solid #454451;border-radius:5px;background:#25252f;color:#d6d3e0;font-size:10px;cursor:pointer}
  .rename-actions button[type="submit"]{border-color:#7d6be6;background:#7562da;color:#fff}
  .rename-actions button:disabled{opacity:.45;cursor:default}
</style>
