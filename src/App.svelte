<script lang="ts">
  import { onDestroy } from "svelte";
  import Inspector from "./editor/Inspector.svelte";
  import Hierarchy from "./editor/Hierarchy.svelte";
  import Viewport from "./editor/Viewport.svelte";
  import AIPanel, { type AIPanelMessage } from "./editor/AIPanel.svelte";
  import { requestSceneEdit } from "./ai/client";
  import { AI_RESPONSE_JSON_SCHEMA, buildSystemPrompt } from "./ai/prompt";
  import { runSceneAgent } from "./ai/agent";
  import { applyOps } from "./scene/applyOps";
  import { deserializeScene, serializeScene } from "./scene/serialize";
  import { createEmptyScene, type Scene, type SceneOp } from "./scene/types";
  import type { PlayState, SimulationController } from "./runtime/physics";

  type ToolMode = "translate" | "rotate" | "scale";
  type BottomTab = "console" | "ai" | "timeline";

  let scene: Scene = $state(createEmptyScene());
  let selectedId: string | null = $state(null);
  let mode: ToolMode = $state("translate");
  let undoStack: SceneOp[][] = $state([]);
  let redoStack: SceneOp[][] = $state([]);
  let message = $state("Ready");
  let playState: PlayState = $state("stopped");
  let playStarting = $state(false);
  let simulationWarnings = $state<string[]>([]);
  let bottomTab: BottomTab = $state("console");
  let frameToken = $state(0);
  let aiPrompt = $state("");
  let aiLoading = $state(false);
  let aiMessages: AIPanelMessage[] = $state([]);
  let aiUndoRecords: Record<string, SceneOp[]> = $state({});
  let nextAIId = 1;
  let openInput: HTMLInputElement;
  let activeGesture: { id: string; initial: Scene; operation: SceneOp | null } | null = null;
  let simulation: SimulationController | null = null;
  let animationFrame = 0;
  let lastFrameTime = 0;

  let selectedEntity = $derived(scene.entities.find((entity) => entity.id === selectedId) ?? null);

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

  function createBox() {
    let index = scene.entities.length + 1;
    while (scene.entities.some((entity) => entity.id === `box_${index}`)) index += 1;
    const id = `box_${index}`;
    if (apply([{ op: "create", id, name: `Box ${index}`, parent: null, components: {
      Transform: { position: [0, 0.5, 0] }, Mesh: { shape: "box" }, Material: { color: "#8b7cff" }
    } }])) selectedId = id;
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
    scene = simulation.advance(scene, elapsed);
    const scriptMessages = simulation.takeScriptMessages();
    if (scriptMessages.length) simulationWarnings = [...simulationWarnings, ...scriptMessages].slice(-30);
    animationFrame = requestAnimationFrame(physicsFrame);
  }

  async function startSimulation() {
    if (playStarting || playState !== "stopped") return;
    playStarting = true;
    activeGesture = null;
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
      <button onclick={newScene}>New</button>
      <button onclick={() => openInput.click()}>Open</button>
      <button onclick={saveScene}>Save</button>
      <input bind:this={openInput} class="file-input" type="file" accept=".json,.scene.json,application/json" onchange={loadScene} />
    </div>
    <div class="toolbar-group history-actions">
      <button title="Undo" disabled={undoStack.length === 0 || playState !== "stopped"} onclick={undo}>↶ <span>Undo</span></button>
      <button title="Redo" disabled={redoStack.length === 0 || playState !== "stopped"} onclick={redo}>↷ <span>Redo</span></button>
    </div>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-group tools" aria-label="Transform tool">
      <button class:active={mode === "translate"} title="Move (W)" onclick={() => mode = "translate"}>↔</button>
      <button class:active={mode === "rotate"} title="Rotate (E)" onclick={() => mode = "rotate"}>⟳</button>
      <button class:active={mode === "scale"} title="Scale (R)" onclick={() => mode = "scale"}>⤢</button>
    </div>
    {#if playState === "stopped"}
      <button class="play-button" disabled={playStarting} onclick={startSimulation}>▶ <span>{playStarting ? "Starting…" : "Play"}</span></button>
    {:else}
      <div class="simulation-controls">
        <button class="play-button" onclick={playState === "playing" ? pauseSimulation : resumeSimulation}>{playState === "playing" ? "Ⅱ Pause" : "▶ Resume"}</button>
        <button class="stop-button" onclick={stopSimulation}>■ Stop</button>
      </div>
    {/if}
  </header>

  <div class="editor-body">
    <Hierarchy scene={scene} {selectedId} onSelect={(id) => selectedId = id} onCreate={createBox} onDelete={deleteEntity} onReparent={reparentEntity} />
    <section class="viewport-column">
      <Viewport {scene} {selectedId} {mode} {frameToken} onSelect={(id) => selectedId = id} onTransform={updateTransform} onModeChange={(nextMode) => mode = nextMode} />
      <div class="bottom-panel" class:ai-expanded={bottomTab === "ai"}>
        <div class="bottom-tabs">
          <button class:selected={bottomTab === "console"} onclick={() => bottomTab = "console"}>Console</button>
          <button class:selected={bottomTab === "ai"} onclick={() => bottomTab = "ai"}>AI</button>
          <button disabled>Timeline <small>M6</small></button>
        </div>
        <div class="console-line"><span class="console-dot">●</span>{message}{#if simulationWarnings.length}<span> · {simulationWarnings.join(" · ")}</span>{/if}</div>
        {#if bottomTab === "ai"}
          <AIPanel messages={aiMessages} loading={aiLoading} prompt={aiPrompt} onPromptChange={(value) => aiPrompt = value} onSubmit={submitAI} onUndo={undoAIChange} />
        {/if}
      </div>
    </section>
    <Inspector {scene} entity={selectedEntity} onUpdate={updateComponent} onRemove={(component) => selectedId && apply([{ op: "update", id: selectedId, components: { [component]: null } }])} onAdd={addComponent} />
  </div>
  <footer class="statusbar"><span><i></i> SCENE CORE</span><span>{scene.entities.length} {scene.entities.length === 1 ? "ENTITY" : "ENTITIES"}</span><span>Y-UP · METERS</span></footer>
</main>
