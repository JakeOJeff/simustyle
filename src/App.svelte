<script lang="ts">
  import { onDestroy } from "svelte";
  import Inspector from "./editor/Inspector.svelte";
  import Hierarchy from "./editor/Hierarchy.svelte";
  import Viewport from "./editor/Viewport.svelte";
  import AIPanel, { type AIPanelMessage } from "./editor/AIPanel.svelte";
  import { requestSceneEdit } from "./ai/client";
  import { AI_RESPONSE_JSON_SCHEMA, buildSystemPrompt } from "./ai/prompt";
  import { runSceneAgent } from "./ai/agent";
  import Timeline from "./editor/Timeline.svelte";
  import ExportMenu from "./editor/ExportMenu.svelte";
  import type { VideoExportConfig, VideoExportProgress } from "./export/video";
  import type { AnimationTrack, AnimationValue } from "./runtime/animator";
  import { AnimatorRuntime } from "./runtime/animator";
  import { componentSchemas } from "./registry";
  import { Box, Circle, Cone, Cylinder, Focus, FolderOpen, Grid3X3, Move3D, Pause, Play, Plus, Redo2, Rotate3D, Save, Scaling, Square, Undo2 } from "@lucide/svelte";
  import { applyOps } from "./scene/applyOps";
  import { deserializeScene, serializeScene } from "./scene/serialize";
  import { createEmptyScene, type Scene, type SceneOp } from "./scene/types";
  import type { PlayState, SimulationController } from "./runtime/physics";

  type ToolMode = "translate" | "rotate" | "scale";
  type BottomTab = "console" | "ai" | "timeline";

  let scene: Scene = $state(createEmptyScene());
  let selectedId: string | null = $state(null);
  let mode: ToolMode = $state("translate");
  let gridVisible = $state(true);
  let focusToken = $state(0);
  let primitiveMenuOpen = $state(false);
  let undoStack: SceneOp[][] = $state([]);
  let redoStack: SceneOp[][] = $state([]);
  let message = $state("Ready");
  let playState: PlayState = $state("stopped");
  let playStarting = $state(false);
  let simulationWarnings = $state<string[]>([]);
  let bottomTab = $state<BottomTab>("console");
  let frameToken = $state(0);
  let aiPrompt = $state("");
  let aiLoading = $state(false);
  let aiMessages: AIPanelMessage[] = $state([]);
  let aiUndoRecords: Record<string, SceneOp[]> = $state({});
  let nextAIId = 1;
  let timelineTime = $state(0);
  const animatorPreview = new AnimatorRuntime();
  let openInput: HTMLInputElement;
  let activeGesture: { id: string; initial: Scene; operation: SceneOp | null } | null = null;
  let simulation: SimulationController | null = null;
  let animationFrame = 0;
  let lastFrameTime = 0;

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
      if (changed && (changed.op === "create" || changed.op === "update")) selectedId = changed.id;
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
    if (apply([{ op: "create", id, name: `${label} ${index}`, parent: null, components: {
      Transform: { position: [0, shape === "plane" ? 0.01 : 0.5, 0] }, Mesh: { shape }, Material: { color: "#8b7cff" }
    } }])) selectedId = id;
    primitiveMenuOpen = false;
  }

  function descendantsInDeleteOrder(id: string): string[] {
    const children = scene.entities.filter((entity) => entity.parent === id);
    return [...children.flatMap((child) => descendantsInDeleteOrder(child.id)), id];
  }

  function deleteEntity(id: string) {
    const ids = descendantsInDeleteOrder(id);
    if (apply(ids.map((entityId) => ({ op: "delete" as const, id: entityId })))) {
      if (ids.includes(selectedId ?? "")) selectedId = null;
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
    if (selectedId) apply([{ op: "update", id: selectedId, components: { [component]: {} } }]);
  }

  function newScene() {
    stopSimulation();
    activeGesture = null;
    scene = createEmptyScene();
    selectedId = null;
    undoStack = [];
    redoStack = [];
    message = "New scene";
  }

  function saveScene() {
    const file = new Blob([serializeScene(scene)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "untitled.scene.json";
    anchor.click();
    URL.revokeObjectURL(url);
    message = "Scene saved";
  }

  async function loadScene(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const loadedScene = deserializeScene(await file.text());
      stopSimulation();
      scene = loadedScene;
      activeGesture = null;
      selectedId = null;
      undoStack = [];
      redoStack = [];
      message = `Opened ${file.name}`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Unable to open scene file";
    } finally {
      input.value = "";
    }
  }

  function physicsFrame(time: number) {
    if (playState !== "playing" || !simulation) return;
    const elapsed = Math.max(0, (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    timelineTime += elapsed;
    scene = simulation.advance(scene, elapsed);
    const scriptMessages = simulation.takeScriptMessages();
    if (scriptMessages.length) simulationWarnings = [...simulationWarnings, ...scriptMessages].slice(-30);
    animationFrame = requestAnimationFrame(physicsFrame);
  }

  async function startSimulation() {
    if (playStarting || playState !== "stopped") return;
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
      <button title="Open scene" aria-label="Open scene" onclick={() => openInput.click()}><FolderOpen size={14} /> <span>Open</span></button>
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
          <button role="menuitem" onclick={() => createPrimitive("cone")}><Cone size={15} /> Cone</button>
          <button role="menuitem" onclick={() => createPrimitive("plane")}><Square size={15} /> Plane</button>
        </div>
      {/if}
    </div>
    <div class="toolbar-group tools" aria-label="Transform tool">
      <button class:active={mode === "translate"} aria-label="Move tool" title="Move (W)" onclick={() => mode = "translate"}><Move3D size={16} /></button>
      <button class:active={mode === "rotate"} aria-label="Rotate tool" title="Rotate (E)" onclick={() => mode = "rotate"}><Rotate3D size={16} /></button>
      <button class:active={mode === "scale"} aria-label="Scale tool" title="Scale (R)" onclick={() => mode = "scale"}><Scaling size={16} /></button>
    </div>
    <button class:active={gridVisible} class="view-toggle" title="Toggle floor grid" aria-label="Toggle floor grid" onclick={() => gridVisible = !gridVisible}><Grid3X3 size={15} /></button>
    <button class="view-toggle" title="Frame selected (F)" aria-label="Frame selected" disabled={!selectedId} onclick={() => focusToken += 1}><Focus size={15} /></button>
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
    <Hierarchy scene={scene} {selectedId} onSelect={(id) => selectedId = id} onCreate={createBox} onDelete={deleteEntity} onReparent={reparentEntity} />
    <section class="viewport-column">
      <Viewport scene={viewportScene} {selectedId} {mode} {frameToken} {focusToken} {gridVisible} onSelect={(id) => selectedId = id} onTransform={updateTransform} onModeChange={(nextMode) => mode = nextMode} />
      <div class="bottom-panel" class:ai-expanded={bottomTab === "ai"} class:timeline-expanded={bottomTab === "timeline"}>
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
        {/if}
      </div>
    </section>
    <Inspector {scene} entity={selectedEntity} onUpdate={updateComponent} onRemove={(component) => selectedId && apply([{ op: "update", id: selectedId, components: { [component]: null } }])} onAdd={addComponent} onKeyframe={addKeyframe} />
  </div>
  <footer class="statusbar"><span><i></i> SCENE CORE</span><span>{scene.entities.length} {scene.entities.length === 1 ? "ENTITY" : "ENTITIES"}</span><span>Y-UP · METERS</span></footer>
</main>
