<script lang="ts">
  import Inspector from "./editor/Inspector.svelte";
  import Hierarchy from "./editor/Hierarchy.svelte";
  import Viewport from "./editor/Viewport.svelte";
  import { applyOps } from "./scene/applyOps";
  import { deserializeScene, serializeScene } from "./scene/serialize";
  import { createEmptyScene, type Scene, type SceneOp } from "./scene/types";

  type ToolMode = "translate" | "rotate" | "scale";

  let scene: Scene = $state(createEmptyScene());
  let selectedId: string | null = $state(null);
  let mode: ToolMode = $state("translate");
  let undoStack: SceneOp[][] = $state([]);
  let redoStack: SceneOp[][] = $state([]);
  let message = $state("Ready");
  let openInput: HTMLInputElement;
  let activeGesture: { id: string; initial: Scene; operation: SceneOp | null } | null = null;

  let selectedEntity = $derived(scene.entities.find((entity) => entity.id === selectedId) ?? null);

  function apply(ops: SceneOp[]) {
    const result = applyOps(scene, ops);
    if (result.errors.length) {
      message = result.errors.join(" · ");
      return false;
    }
    scene = result.scene;
    if (result.inverseOps.length) {
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
    if (result.inverseOps.length) {
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
      scene = deserializeScene(await file.text());
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
</script>

<svelte:head><title>SimuStyle — Scene Editor</title></svelte:head>

<main class="editor">
  <header class="toolbar">
    <div class="brand"><span class="brand-mark">S</span><span>SimuStyle</span></div>
    <div class="toolbar-group file-actions">
      <button onclick={newScene}>New</button>
      <button onclick={() => openInput.click()}>Open</button>
      <button onclick={saveScene}>Save</button>
      <input bind:this={openInput} class="file-input" type="file" accept=".json,.scene.json,application/json" onchange={loadScene} />
    </div>
    <div class="toolbar-group history-actions">
      <button title="Undo" disabled={undoStack.length === 0} onclick={undo}>↶ <span>Undo</span></button>
      <button title="Redo" disabled={redoStack.length === 0} onclick={redo}>↷ <span>Redo</span></button>
    </div>
    <div class="toolbar-spacer"></div>
    <div class="toolbar-group tools" aria-label="Transform tool">
      <button class:active={mode === "translate"} title="Move (W)" onclick={() => mode = "translate"}>↔</button>
      <button class:active={mode === "rotate"} title="Rotate (E)" onclick={() => mode = "rotate"}>⟳</button>
      <button class:active={mode === "scale"} title="Scale (R)" onclick={() => mode = "scale"}>⤢</button>
    </div>
    <button class="play-button" disabled title="Simulation is coming in M3">▶ <span>Play</span></button>
  </header>

  <div class="editor-body">
    <Hierarchy scene={scene} {selectedId} onSelect={(id) => selectedId = id} onCreate={createBox} onDelete={deleteEntity} onReparent={reparentEntity} />
    <section class="viewport-column">
      <Viewport {scene} {selectedId} {mode} onSelect={(id) => selectedId = id} onTransform={updateTransform} onModeChange={(nextMode) => mode = nextMode} />
      <div class="bottom-panel">
        <div class="bottom-tabs"><button class="selected">Console</button><button disabled>AI <small>M5</small></button><button disabled>Timeline <small>M6</small></button></div>
        <div class="console-line"><span class="console-dot">●</span>{message}</div>
      </div>
    </section>
    <Inspector {scene} entity={selectedEntity} onUpdate={updateComponent} onRemove={(component) => selectedId && apply([{ op: "update", id: selectedId, components: { [component]: null } }])} onAdd={addComponent} />
  </div>
  <footer class="statusbar"><span><i></i> SCENE CORE</span><span>{scene.entities.length} {scene.entities.length === 1 ? "ENTITY" : "ENTITIES"}</span><span>Y-UP · METERS</span></footer>
</main>
