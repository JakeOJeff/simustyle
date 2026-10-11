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
  import DocsPanel from "./editor/DocsPanel.svelte";
  import PanelResizeHandles, { type ResizeEdge } from "./editor/PanelResizeHandles.svelte";
  import ExportMenu from "./editor/ExportMenu.svelte";
  import TopBar, { type LightKind, type PrimitiveShape, type TopBarActions, type ToolMode } from "./editor/TopBar.svelte";
  import SettingsPanel from "./editor/SettingsPanel.svelte";
  import ScriptEditor from "./editor/ScriptEditor.svelte";
  import type { ParseEntity } from "./ai/scriptParse";
  import { ScriptRuntime, scriptOps, validateScripts } from "./runtime/scripts";
  import { uniqueName } from "./runtime/commands";
  import { chooseSceneToOpen, chooseSceneToSave, getDesktopAiSettings, isDesktopRuntime, readSceneFile, saveDesktopAiSettings, writeSceneFile } from "./platform/desktop";
  import { cacheRecentScene, loadRecentScenes, readCachedRecentScene, saveRecentScenes, type RecentSceneEntry } from "./platform/recentScenes";
  import type { VideoExportConfig, VideoExportProgress } from "./export/video";
  import type { AnimationTrack, AnimationValue } from "./runtime/animator";
  import { AnimatorRuntime } from "./runtime/animator";
  import { componentSchemas } from "./registry";
  import { Box, FileCode2, X } from "@lucide/svelte";
  import { applyOps } from "./scene/applyOps";
  import { describeChanges } from "./scene/describeChanges";
  import { groupOps, localPosition, reparentOps, ungroupOps, uniqueId } from "./scene/hierarchy";
  import { keyName } from "./lang/vocabulary";
  import { deserializeScene, serializeScene } from "./scene/serialize";
  import { createEmptyScene, type Entity, type Scene, type SceneOp, type Vec3 } from "./scene/types";
  import type { PlayState, SimulationController } from "./runtime/physics";

  type EditorPanel = "hierarchy" | "inspector" | "console" | "ai" | "timeline" | "docs" | "sceneLoader";
  type PanelDock = "left" | "right" | "top" | "bottom" | "floating";
  type PanelLayout = { dock: PanelDock; x: number; y: number; width: number; height: number; dockSize?: number };

  let scene: Scene = $state.raw(createEmptyScene());
  let selectedId: string | null = $state(null);
  let selectedIds: string[] = $state([]);
  let mode: ToolMode = $state("translate");
  let gridVisible = $state(true);
  let focusToken = $state(0);
  let space: "world" | "local" = $state("world");
  let snap = $state(false);
  const emptyHistory: SceneOp[][] = [];
  let undoStack: SceneOp[][] = $state.raw(emptyHistory);
  let redoStack: SceneOp[][] = $state.raw([]);
  /** The undo history at the last new/open/save; any other history means unsaved changes. */
  let savedHistory: SceneOp[][] = $state.raw(emptyHistory);
  let message = $state("Ready");
  let playState: PlayState = $state("stopped");
  let playStarting = $state(false);
  let simulationWarnings = $state<string[]>([]);
  let panelOpen: Record<EditorPanel, boolean> = $state({ hierarchy: true, inspector: true, console: true, ai: false, timeline: false, docs: false, sceneLoader: false });
  let panelLayouts = $state<Record<EditorPanel, PanelLayout>>({
    hierarchy: { dock: "left", x: 12, y: 12, width: 260, height: 420 },
    inspector: { dock: "right", x: 16, y: 16, width: 300, height: 420 },
    console: { dock: "bottom", x: 12, y: 12, width: 500, height: 250 },
    ai: { dock: "right", x: 16, y: 16, width: 430, height: 340 },
    timeline: { dock: "bottom", x: 16, y: 16, width: 680, height: 250 },
    docs: { dock: "floating", x: 220, y: 20, width: 620, height: 680 },
    sceneLoader: { dock: "floating", x: 260, y: 70, width: 430, height: 420 }
  });
  let draggingPanel: { panel: EditorPanel; offsetX: number; offsetY: number; stageLeft: number; stageTop: number; stageWidth: number; stageHeight: number } | null = $state(null);
  let resizingPanel: { panel: EditorPanel; edge: ResizeEdge; dock: PanelDock; startX: number; startY: number; left: number; top: number; width: number; height: number; stageWidth: number; stageHeight: number } | null = $state(null);
  let snapTarget: PanelDock | null = $state(null);
  let stageHost: HTMLDivElement;
  let stageWidth = $state(0);
  let stageHeight = $state(0);
  let panelWorkspaceReady = $state(false);
  let focusedPanel: EditorPanel = $state("console");
  let frameToken = $state(0);
  let aiPrompt = $state("");
  let aiLoading = $state(false);
  let aiProgress = $state("Building the first pass…");
  let aiMessages: AIPanelMessage[] = $state([]);
  let aiUndoRecords: Record<string, SceneOp[]> = $state.raw({});
  let nextAIId = 1;
  let timelineTime = $state(0);
  let settingsOpen = $state(false);
  let aiSettings = $state({ apiKeyConfigured: false, model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" });
  let scenePath = $state<string | null>(null);
  let savedSceneName = $state<string | undefined>(undefined);
  let recentScenes = $state<RecentSceneEntry[]>([]);
  let sceneRenameTarget = $state<string | null>(null);
  const sceneName = $derived(scene.name?.trim() || "Untitled scene");
  // Script tabs open over the viewport, like script windows in Roblox Studio.
  let openScripts: string[] = $state([]);
  let activeTab: string = $state("scene");
  let scriptDrafts: Record<string, string> = $state({});
  let commandText = $state("");
  let commandInput: HTMLInputElement | undefined = $state();
  let commandHistory: string[] = [];
  let commandHistoryIndex = -1;
  let consoleLog: { kind: "info" | "error" | "print"; text: string }[] = $state([]);
  let contextMenu: { id: string | null; x: number; y: number; position: Vec3 | null; source: "object" | "viewport" | "hierarchy" } | null = $state(null);
  let contextAddOpen = $state(false);
  let renameTarget: { id: string; name: string } | null = $state(null);
  let entityClipboard: Entity[] | null = $state.raw(null);
  const animatorPreview = new AnimatorRuntime();
  let openInput: HTMLInputElement;
  let activeGesture: { id: string; initial: Scene; operation: SceneOp | null } | null = null;
  let simulation: SimulationController | null = null;
  let animationFrame = 0;
  let lastFrameTime = 0;

  function panelWindowStyle(panel: EditorPanel): string {
    const layout = panelLayouts[panel];
    const zIndex = focusedPanel === panel ? 9 : 8;
    if (layout.dock === "floating") return `left:${layout.x}px;top:${layout.y}px;width:${layout.width}px;height:${layout.height}px;z-index:${zIndex}`;
    const peers = (Object.keys(panelLayouts) as EditorPanel[]).filter((candidate) => panelOpen[candidate] && panelLayouts[candidate].dock === layout.dock);
    const index = peers.indexOf(panel);
    const left = panelDockInset("left");
    const right = panelDockInset("right");
    if (layout.dock === "left" || layout.dock === "right") {
      const height = stageHeight / peers.length;
      const width = panelDockInset(layout.dock);
      return `${layout.dock}:0;top:${index * height}px;width:${width}px;height:${height}px;z-index:${zIndex}`;
    }
    const width = Math.max(0, stageWidth - left - right) / peers.length;
    const height = panelDockInset(layout.dock);
    return `${layout.dock}:0;left:${left + index * width}px;width:${width}px;height:${height}px;z-index:${zIndex}`;
  }

  function panelDockInset(side: PanelDock): number {
    const peers = (Object.keys(panelLayouts) as EditorPanel[]).filter((panel) => panelOpen[panel] && panelLayouts[panel].dock === side);
    if (!peers.length) return 0;
    const vertical = side === "left" || side === "right";
    const fallback = vertical ? Math.min(stageWidth * 0.38, 440) : Math.min(stageHeight * 0.42, 340);
    const custom = peers.map((panel) => panelLayouts[panel].dockSize).find((size) => Number.isFinite(size));
    const oppositeSide: PanelDock = side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top";
    const oppositeDefault = vertical ? Math.min(stageWidth * 0.38, 440) : Math.min(stageHeight * 0.42, 340);
    const oppositeCustom = (Object.keys(panelLayouts) as EditorPanel[])
      .filter((panel) => panelOpen[panel] && panelLayouts[panel].dock === oppositeSide)
      .map((panel) => panelLayouts[panel].dockSize)
      .find((size) => Number.isFinite(size));
    const available = vertical ? stageWidth : stageHeight;
    const minimumCenter = vertical ? 240 : 160;
    const maxSize = Math.max(180, available - Math.min(oppositeCustom ?? oppositeDefault, available) - minimumCenter);
    return Math.max(180, Math.min(custom ?? fallback, maxSize));
  }

  function updateDockSize(side: PanelDock, dockSize: number) {
    const layouts = { ...panelLayouts };
    for (const panel of Object.keys(layouts) as EditorPanel[]) {
      if (layouts[panel].dock === side) layouts[panel] = { ...layouts[panel], dockSize };
    }
    panelLayouts = layouts;
  }

  function stageContentStyle(): string {
    return `padding:${panelDockInset("top")}px ${panelDockInset("right")}px ${panelDockInset("bottom")}px ${panelDockInset("left")}px`;
  }

  function sceneContentStyle(): string {
    return `inset:${panelDockInset("top")}px ${panelDockInset("right")}px ${panelDockInset("bottom")}px ${panelDockInset("left")}px`;
  }

  function observeStageSize(node: HTMLElement) {
    const update = () => {
      stageWidth = node.clientWidth;
      stageHeight = node.clientHeight;
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return { destroy: () => observer.disconnect() };
  }

  function restorePanelWorkspace() {
    try {
      const saved = JSON.parse(localStorage.getItem("simustyle.panelWorkspace") ?? "null") as { open?: Record<string, unknown>; layouts?: Record<string, Partial<PanelLayout>> } | null;
      if (saved) {
        for (const panel of ["hierarchy", "inspector", "console", "ai", "timeline", "docs", "sceneLoader"] as const) {
          if (typeof saved.open?.[panel] === "boolean") panelOpen[panel] = saved.open[panel] as boolean;
          const layout = saved.layouts?.[panel];
          if (!layout) continue;
          if (["left", "right", "top", "bottom", "floating"].includes(layout.dock ?? "")) {
            panelLayouts[panel] = {
              dock: layout.dock as PanelDock,
              x: Number.isFinite(layout.x) ? layout.x! : 16,
              y: Number.isFinite(layout.y) ? layout.y! : 16,
              width: Number.isFinite(layout.width) ? Math.max(220, layout.width!) : 480,
              height: Number.isFinite(layout.height) ? Math.max(140, layout.height!) : 280,
              dockSize: Number.isFinite(layout.dockSize) ? Math.max(180, layout.dockSize!) : undefined
            };
          }
        }
      }
    } catch {
      localStorage.removeItem("simustyle.panelWorkspace");
    }
    panelWorkspaceReady = true;
  }

  function rememberPanelSize(node: HTMLElement, panel: EditorPanel) {
    const observer = new ResizeObserver(() => {
      const layout = panelLayouts[panel];
      if (layout.dock !== "floating") return;
      const width = node.offsetWidth;
      const height = node.offsetHeight;
      if (Math.abs(width - layout.width) < 2 && Math.abs(height - layout.height) < 2) return;
      panelLayouts[panel] = { ...layout, width, height };
    });
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function startPanelDrag(event: PointerEvent, panel: EditorPanel) {
    if (event.button !== 0 || (event.target as HTMLElement).closest(".panel-close")) return;
    const windowRect = (event.currentTarget as HTMLElement).closest(".panel-window")?.getBoundingClientRect();
    const stageRect = stageHost?.getBoundingClientRect();
    if (!windowRect || !stageRect) return;
    event.preventDefault();
    draggingPanel = {
      panel,
      offsetX: event.clientX - windowRect.left,
      offsetY: event.clientY - windowRect.top,
      stageLeft: stageRect.left,
      stageTop: stageRect.top,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height
    };
    focusedPanel = panel;
    panelLayouts[panel] = { ...panelLayouts[panel], dock: "floating", x: windowRect.left - stageRect.left, y: windowRect.top - stageRect.top };
  }

  function startPanelResize(event: PointerEvent, panel: EditorPanel, edge: ResizeEdge) {
    if (event.button !== 0) return;
    const windowRect = (event.currentTarget as HTMLElement).closest(".panel-window")?.getBoundingClientRect();
    const stageRect = stageHost?.getBoundingClientRect();
    if (!windowRect || !stageRect) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    focusedPanel = panel;
    resizingPanel = {
      panel,
      edge,
      dock: panelLayouts[panel].dock,
      startX: event.clientX,
      startY: event.clientY,
      left: windowRect.left - stageRect.left,
      top: windowRect.top - stageRect.top,
      width: windowRect.width,
      height: windowRect.height,
      stageWidth: stageRect.width,
      stageHeight: stageRect.height
    };
  }

  function resizePanel(event: PointerEvent) {
    if (!resizingPanel) return;
    const resize = resizingPanel;
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    if (resize.dock !== "floating") {
      const delta = resize.dock === "left" ? dx : resize.dock === "right" ? -dx : resize.dock === "top" ? dy : -dy;
      const size = resize.dock === "left" || resize.dock === "right" ? resize.width : resize.height;
      updateDockSize(resize.dock, Math.max(180, size + delta));
      return;
    }

    const west = resize.edge.includes("w");
    const east = resize.edge.includes("e");
    const north = resize.edge.includes("n");
    const south = resize.edge.includes("s");
    let left = resize.left + (west ? dx : 0);
    let top = resize.top + (north ? dy : 0);
    let width = resize.width + (east ? dx : west ? -dx : 0);
    let height = resize.height + (south ? dy : north ? -dy : 0);
    width = Math.max(220, Math.min(width, resize.stageWidth));
    height = Math.max(140, Math.min(height, resize.stageHeight));
    if (west) left = resize.left + resize.width - width;
    if (north) top = resize.top + resize.height - height;
    left = Math.max(0, Math.min(left, resize.stageWidth - width));
    top = Math.max(0, Math.min(top, resize.stageHeight - height));
    panelLayouts[resize.panel] = { ...panelLayouts[resize.panel], x: left, y: top, width, height };
  }

  function movePanelDrag(event: PointerEvent) {
    if (resizingPanel) { resizePanel(event); return; }
    if (!draggingPanel) return;
    const drag = draggingPanel;
    const x = event.clientX - drag.stageLeft - drag.offsetX;
    const y = event.clientY - drag.stageTop - drag.offsetY;
    const edge = 24;
    snapTarget = event.clientX <= drag.stageLeft + edge ? "left"
      : event.clientX >= drag.stageLeft + drag.stageWidth - edge ? "right"
        : event.clientY <= drag.stageTop + edge ? "top"
          : event.clientY >= drag.stageTop + drag.stageHeight - edge ? "bottom" : null;
    panelLayouts[drag.panel] = {
      ...panelLayouts[drag.panel],
      dock: "floating",
      x: Math.max(0, Math.min(x, drag.stageWidth - 220)),
      y: Math.max(0, Math.min(y, drag.stageHeight - 100))
    };
  }

  function endPanelDrag() {
    resizingPanel = null;
    if (!draggingPanel) return;
    if (snapTarget) panelLayouts[draggingPanel.panel] = { ...panelLayouts[draggingPanel.panel], dock: snapTarget };
    draggingPanel = null;
    snapTarget = null;
  }

  function selectEntity(id: string | null) {
    selectedId = id;
    selectedIds = id ? [id] : [];
  }

  function selectEntities(ids: string[]) {
    selectedIds = ids;
    selectedId = ids[0] ?? null;
  }

  onMount(() => {
    restorePanelWorkspace();
    recentScenes = loadRecentScenes();
    if (isDesktopRuntime()) {
      void getDesktopAiSettings().then((settings) => aiSettings = settings).catch((error) => {
        message = error instanceof Error ? error.message : "Could not load AI settings";
      });
    }
  });

  $effect(() => {
    if (panelWorkspaceReady) localStorage.setItem("simustyle.panelWorkspace", JSON.stringify({ open: panelOpen, layouts: panelLayouts }));
  });

  let selectedEntity = $derived(scene.entities.find((entity) => entity.id === selectedId) ?? null);
  let viewportScene = $derived(panelOpen.timeline && playState === "stopped" ? animatorPreview.evaluate(scene, timelineTime).scene : scene);

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
    panelOpen.timeline = true;
  }

  function pushAIMessage(aiMessage: AIPanelMessage) { aiMessages = [...aiMessages, aiMessage]; }

  async function submitAI(prompt: string) {
    if (aiLoading || !prompt.trim()) return;
    if (playState !== "stopped") { message = "Stop the simulation before asking the scene agent to edit."; return; }
    pushAIMessage({ id: `ai_${nextAIId++}`, role: "user", content: prompt });
    aiPrompt = "";
    aiLoading = true;
    aiProgress = "Building the first pass…";
    panelOpen.ai = true;
    try {
      const result = await runSceneAgent(scene, prompt, {
        buildSystemPrompt,
        responseSchema: AI_RESPONSE_JSON_SCHEMA.schema,
        onProgress: (progress) => aiProgress = progress,
        complete: ({ systemPrompt, userPrompt, correctionErrors, responseSchema, previousReply }) =>
          requestSceneEdit(systemPrompt, userPrompt, correctionErrors, responseSchema, previousReply)
      });
      const id = `ai_${nextAIId++}`;
      if (!result.ok || !result.scene || !result.inverseOps) {
        pushAIMessage({ id, role: "assistant", content: result.errors.join(" · "), summary: `Could not complete after ${result.attempts} AI call${result.attempts === 1 ? "" : "s"}.`, ...(result.preflight ? { preflight: result.preflight } : {}), ...(result.fallbackDraft ? { fallbackDraft: { summary: result.fallbackDraft.summary, operations: result.fallbackDraft.ops } } : {}) });
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
      pushAIMessage({ id, role: "assistant", content: result.summary ?? "Scene updated.", summary: result.summary ?? "Scene updated.", operations: result.ops, ...(result.preflight ? { preflight: result.preflight } : {}) });
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

  function applyAIFallback(messageId: string) {
    const messageEntry = aiMessages.find((entry) => entry.id === messageId);
    const operations = messageEntry?.fallbackDraft?.operations;
    if (!operations) return;
    const result = applyOps(scene, operations);
    if (result.errors.length) { message = `Could not apply the first draft: ${result.errors.join(" · ")}`; return; }
    const scriptErrors = validateScripts(result.scene);
    if (scriptErrors.length) { message = `Could not apply the first draft: ${scriptErrors[0]!.message}`; return; }
    scene = result.scene;
    undoStack = [...undoStack, result.inverseOps];
    redoStack = [];
    aiUndoRecords = { ...aiUndoRecords, [messageId]: result.inverseOps };
    const changed = operations.find((operation) => operation.op === "create" || operation.op === "update");
    if (changed && (changed.op === "create" || changed.op === "update")) selectEntity(changed.id);
    frameToken += 1;
    aiMessages = aiMessages.map((entry) => entry.id === messageId
      ? { ...entry, content: "Applied the first validated draft. Review issues remain visible above.", summary: "Applied the first validated draft; review issues remain.", operations, fallbackDraft: undefined }
      : entry);
    message = "Applied the first validated draft; inspect the runtime issues in the AI response.";
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


  function freeId(prefix: string): string {
    let index = 1;
    while (scene.entities.some((entity) => entity.id === `${prefix}_${index}`)) index += 1;
    return `${prefix}_${index}`;
  }

  /** Place new objects in a deterministic spiral so they remain visible and pickable. */
  function spiralSpot(height: number): Vec3 {
    const placement = scene.entities.length;
    const angle = placement * 2.399963229728653;
    const radius = 1.5 * Math.sqrt(placement);
    return [radius * Math.cos(angle), height, radius * Math.sin(angle)];
  }

  /** Add an entity the same way the AI agent does: one validated, undoable create op. */
  function addEntity(prefix: string, label: string, components: Record<string, Record<string, unknown>>, parent: string | null = null) {
    const id = freeId(prefix);
    if (apply([{ op: "create", id, name: uniqueName(scene, label), parent, components }])) selectEntity(id);
  }

  function contextPlacement(height: number): { parent: string | null; position: Vec3 } {
    const parent = contextMenu?.id ?? null;
    if (contextMenu?.source === "viewport" && contextMenu.position) {
      const point: Vec3 = [contextMenu.position[0], contextMenu.position[1] + height, contextMenu.position[2]];
      return { parent, position: localPosition(scene, parent, point) };
    }
    return { parent, position: parent ? [0, height, 0] : spiralSpot(height) };
  }

  function addFromContext(prefix: string, label: string, height: number, components: Record<string, Record<string, unknown>>) {
    const { parent, position } = contextPlacement(height);
    addEntity(prefix, label, { ...components, Transform: { ...(components.Transform ?? {}), position } }, parent);
    contextMenu = null;
    contextAddOpen = false;
  }

  function addContextPrimitive(shape: PrimitiveShape) {
    const height = shape === "plane" ? 0.01 : 0.5;
    addFromContext(shape, shape[0].toUpperCase() + shape.slice(1), height, {
      Transform: { rotation: shape === "plane" ? [-90, 0, 0] : [0, 0, 0] },
      Mesh: { shape }, Material: { color: "#8b7cff" }
    });
  }

  function addContextLight(kind: LightKind) {
    const details = {
      point: { label: "Point Light", height: 2.5, intensity: 20 },
      directional: { label: "Sun Light", height: 8, intensity: 2 },
      spot: { label: "Spot Light", height: 4, intensity: 40 }
    }[kind];
    addFromContext(`${kind}_light`, details.label, details.height, {
      Transform: { rotation: kind === "directional" ? [-30, 0, 20] : [0, 0, 0] },
      Light: { type: kind, intensity: details.intensity }
    });
  }

  function addContextCamera() {
    const { parent, position } = contextPlacement(4);
    const id = freeId("camera");
    if (apply([{ op: "create", id, name: uniqueName(scene, "Camera"), parent, components: { Transform: { position, rotation: [-20, 0, 0] }, Camera: { isActive: !scene.entities.some((entity) => entity.components.Camera?.isActive === true) } } }])) selectEntity(id);
    contextMenu = null;
    contextAddOpen = false;
  }

  function addContextScript() {
    const { parent, position } = contextPlacement(0);
    const id = freeId("script");
    if (apply([{ op: "create", id, name: uniqueName(scene, "Script"), parent, components: { Transform: { position }, Script: { source: scriptTemplate("the scene", true) } } }])) {
      selectEntity(id);
      openScript(id);
    }
    contextMenu = null;
    contextAddOpen = false;
  }

  function addContextGroup() {
    addFromContext("group", "Empty group", 0, { Transform: {} });
  }

  function createPrimitive(shape: "box" | "sphere" | "cylinder" | "cone" | "plane" | "capsule") {
    addEntity(shape, shape[0].toUpperCase() + shape.slice(1), {
      Transform: { position: spiralSpot(shape === "plane" ? 0.01 : 0.5), rotation: shape === "plane" ? [-90, 0, 0] : [0, 0, 0] },
      Mesh: { shape },
      Material: { color: "#8b7cff" }
    });
  }

  /** Inspector Physics switch: adds or removes the RigidBody (and a Joint, which needs one) in one undoable step. */
  function setPhysics(id: string, enabled: boolean) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity || Boolean(entity.components.RigidBody) === enabled) return;
    const components: Record<string, Record<string, unknown> | null> = enabled ? { RigidBody: {} } : { RigidBody: null, ...(entity.components.Joint ? { Joint: null } : {}) };
    if (apply([{ op: "update", id, components }])) message = `Physics ${enabled ? "on" : "off"} for ${entity.name}`;
  }

  /** Inspector Collision switch: sets Collider.enabled, adding a Collider when needed. */
  function setCollision(id: string, enabled: boolean) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    if (apply([{ op: "update", id, components: { Collider: { enabled } } }])) message = `Collision ${enabled ? "on" : "off"} for ${entity.name}`;
  }

  // Default intensities are bright enough to see next to the editor's fill light.
  function addLight(kind: LightKind) {
    const light = {
      point: { label: "Point Light", position: spiralSpot(2.5), rotation: [0, 0, 0], intensity: 20 },
      directional: { label: "Sun Light", position: [0, 8, 0], rotation: [-30, 0, 20], intensity: 2 },
      spot: { label: "Spot Light", position: spiralSpot(4), rotation: [0, 0, 0], intensity: 40 }
    }[kind];
    addEntity(`${kind}_light`, light.label, { Transform: { position: light.position, rotation: light.rotation }, Light: { type: kind, intensity: light.intensity } });
  }

  function addCamera() {
    addEntity("camera", "Camera", { Transform: { position: [0, 4, 10], rotation: [-20, 0, 0] }, Camera: { isActive: !scene.entities.some((entity) => entity.components.Camera?.isActive === true) } });
  }

  function addScriptObject() {
    const id = freeId("script");
    if (!apply([{ op: "create", id, name: uniqueName(scene, "Script"), parent: null, components: { Transform: {}, Script: { source: scriptTemplate("the scene", true) } } }])) return;
    selectEntity(id);
    openScript(id);
  }

  function updateSettings(settings: Partial<Scene["settings"]>) {
    if (apply([{ op: "settings", settings }])) message = "Scene settings updated";
  }

  function descendantsInDeleteOrder(id: string): string[] {
    const children = scene.entities.filter((entity) => entity.parent === id);
    return [...children.flatMap((child) => descendantsInDeleteOrder(child.id)), id];
  }

  function deleteEntity(id: string): boolean {
    if (playState !== "stopped") { message = "Stop the simulation before deleting entities."; return false; }
    if (!scene.entities.some((entity) => entity.id === id)) { message = "That entity no longer exists."; return false; }
    const ids = descendantsInDeleteOrder(id);
    if (apply(ids.map((entityId) => ({ op: "delete" as const, id: entityId })))) {
      if (ids.includes(selectedId ?? "") || ids.some((entityId) => selectedIds.includes(entityId))) {
        selectEntities(selectedIds.filter((entityId) => !ids.includes(entityId)));
      }
      return true;
    }
    return false;
  }

  function openEntityMenu(id: string | null, x: number, y: number, position: Vec3 | null = null, source: "object" | "viewport" | "hierarchy" = "object") {
    if (playState !== "stopped") { message = "Stop the simulation before editing entities."; return; }
    // Right-clicking inside a multi-selection keeps it, so "Group" can wrap all of it.
    if (id && !selectedIds.includes(id)) selectEntity(id);
    contextAddOpen = false;
    contextMenu = { id, position, source, x: Math.max(8, Math.min(x, window.innerWidth - 210)), y: Math.max(8, Math.min(y, window.innerHeight - 360)) };
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

  function commitSceneRename() {
    if (sceneRenameTarget === null) return;
    const name = sceneRenameTarget.trim();
    if (!name) return;
    scene = { ...scene, name };
    sceneRenameTarget = null;
    message = `Renamed scene to ${name}`;
  }

  function sceneNameFromFile(fileName: string): string {
    return fileName.replace(/(\.scene)?\.(json|simu)$/i, "") || fileName;
  }

  function sceneDownloadName(): string {
    const safeName = sceneName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/g, "").trim();
    return `${safeName || "scene"}.scene.json`;
  }

  async function rememberOpenedScene(name: string, path: string | null, contents?: string, fileName = name): Promise<boolean> {
    const key = path ? `desktop:${path}` : `browser:${fileName.toLocaleLowerCase()}`;
    let cached = true;
    if (!path && contents !== undefined) {
      try {
        await cacheRecentScene(key, contents);
      } catch {
        cached = false;
      }
    }
    const entry: RecentSceneEntry = { key, name, path, ...(path ? {} : { sourceName: fileName }) };
    recentScenes = [entry, ...recentScenes.filter((candidate) => candidate.key !== key)].slice(0, 10);
    saveRecentScenes(recentScenes);
    return cached;
  }

  function installOpenedScene(loadedScene: Scene, path: string | null, fileName: string) {
    const nextScene = loadedScene.name?.trim() ? loadedScene : { ...loadedScene, name: sceneNameFromFile(fileName) };
    stopSimulation();
    scene = nextScene;
    scenePath = path ?? fileName;
    activeGesture = null;
    selectEntity(null);
    undoStack = [];
    redoStack = [];
    savedHistory = undoStack;
    savedSceneName = nextScene.name;
  }

  async function openRecentScene(key: string) {
    const entry = recentScenes.find((candidate) => candidate.key === key);
    if (!entry) return;
    try {
      const contents = entry.path && isDesktopRuntime()
        ? await readSceneFile(entry.path)
        : await readCachedRecentScene(entry.key);
      const loadedScene = deserializeScene(contents);
      const fileName = entry.sourceName ?? entry.path?.split(/[\\/]/).at(-1) ?? entry.name;
      installOpenedScene(loadedScene, entry.path, fileName);
      recentScenes = [entry, ...recentScenes.filter((candidate) => candidate.key !== key)];
      saveRecentScenes(recentScenes);
      message = `Opened ${sceneName}`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Unable to open recent scene";
    }
  }

  /** Move an object into another (or to the top level) without moving it in the world. */
  function reparentEntity(id: string, parent: string | null) {
    if (playState !== "stopped") { message = "Stop the simulation before changing parents."; return; }
    const { ops, error } = reparentOps(scene, id, parent);
    if (error) { message = error; return; }
    if (ops.length && apply(ops)) {
      const name = (entityId: string | null) => scene.entities.find((entity) => entity.id === entityId)?.name ?? entityId;
      message = parent ? `Put ${name(id)} inside ${name(parent)}` : `Moved ${name(id)} to the top level`;
    }
  }

  /** Wrap the selection in a new group (Ctrl+G), or add an empty group when nothing is selected. */
  function groupSelection() {
    if (playState !== "stopped") return;
    const id = uniqueId(scene, "group");
    const name = `Group ${scene.entities.filter((entity) => /^group(_\d+)?$/.test(entity.id)).length + 1}`;
    const ids = selectedIds.length ? selectedIds : selectedId ? [selectedId] : [];
    if (!ids.length) {
      if (apply([{ op: "create", id, name, parent: null, components: { Transform: {} } }])) { selectEntity(id); message = `Added ${name}. Drag objects onto it in the Hierarchy to put them inside.`; }
      return;
    }
    const { ops, error } = groupOps(scene, ids, id, name);
    if (error) { message = error; return; }
    if (apply(ops)) { selectEntity(id); message = `Grouped ${ids.length} object${ids.length === 1 ? "" : "s"} into ${name}`; }
    contextMenu = null;
  }

  /** Move a group's children out to its parent and remove the empty group (Ctrl+Shift+G). */
  function ungroupEntity(id: string) {
    if (playState !== "stopped") return;
    const children = scene.entities.filter((entity) => entity.parent === id).map((entity) => entity.id);
    const { ops, error } = ungroupOps(scene, id);
    if (error) { message = error; return; }
    if (apply(ops)) { selectEntities(children); message = "Ungrouped"; }
    contextMenu = null;
  }

  function typingInField(event: KeyboardEvent): boolean {
    const target = event.target;
    return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
  }

  /** Editor shortcuts, and keyboard input for scripts ("when space is pressed") during Play. */
  function windowKeyDown(event: KeyboardEvent) {
    if (typingInField(event)) return;
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      panelOpen.console = true;
      requestAnimationFrame(() => commandInput?.focus());
      return;
    }
    if (event.code === "Space" && !event.repeat && playState === "stopped") {
      event.preventDefault();
      void startSimulation();
      return;
    }
    if (event.code === "Space" && !event.repeat && playState === "paused") {
      event.preventDefault();
      resumeSimulation();
      return;
    }
    if (playState === "playing") {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) {
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) event.preventDefault();
        if (!event.repeat) simulation?.pressKey(keyName(event.key));
      }
      return;
    }
    if (playState !== "stopped") return;
    const ctrl = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (ctrl && key === "s") { event.preventDefault(); void saveScene(); }
    else if (ctrl && key === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
    else if (ctrl && (key === "y" || (key === "z" && event.shiftKey))) { event.preventDefault(); redo(); }
    else if (ctrl && key === "g" && event.shiftKey) { event.preventDefault(); if (selectedId) ungroupEntity(selectedId); }
    else if (ctrl && key === "g") { event.preventDefault(); groupSelection(); }
    else if (ctrl && key === "d" && selectedId) { event.preventDefault(); duplicateEntity(selectedId); }
    else if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length) {
      event.preventDefault();
      for (const id of [...selectedIds]) if (scene.entities.some((entity) => entity.id === id)) deleteEntity(id);
    } else if (event.key === "F2" && selectedEntity) { event.preventDefault(); renameTarget = { id: selectedEntity.id, name: selectedEntity.name }; }
  }

  function windowKeyUp(event: KeyboardEvent) {
    if (playState !== "stopped") simulation?.releaseKey(keyName(event.key));
  }

  /** Viewport clicks select objects, and during Play also fire "when clicked". */
  function viewportSelect(id: string | null) {
    if (playState === "playing" && id) simulation?.click(id);
    selectEntity(id);
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

  let entityNames = $derived(new Set(scene.entities.flatMap((entity) => [entity.id.toLowerCase(), ...entity.name.toLowerCase().split(/\s+/)])));
  // Compact object summaries for the script editor's AI Parse (names, shapes, colors, positions).
  let parseEntities = $derived(scene.entities.map((entity): ParseEntity => {
    const mesh = entity.components.Mesh;
    const material = entity.components.Material;
    const transform = entity.components.Transform;
    const parent = entity.parent ? scene.entities.find((candidate) => candidate.id === entity.parent)?.name : undefined;
    return {
      id: entity.id,
      name: entity.name,
      ...(typeof mesh?.shape === "string" ? { shape: mesh.shape } : entity.components.Light ? { shape: "light" } : {}),
      ...(typeof material?.color === "string" ? { color: material.color } : {}),
      ...(Array.isArray(transform?.position) ? { position: transform.position as Vec3 } : {}),
      ...(parent ? { parent } : {})
    };
  }));

  function storedSource(id: string): string {
    const source = scene.entities.find((entity) => entity.id === id)?.components.Script?.source;
    return typeof source === "string" ? source : "";
  }

  function scriptTemplate(name: string, sceneScript: boolean): string {
    return sceneScript
      ? `-- Scene script: rules for the whole scene. Name objects to control them,
-- for example "paint the cube red" or "move all balls up 1".
when game starts
  say "Scene started"
`
      : `-- This script belongs to ${name}. "me" means ${name}.
-- Each event line starts a list of sentences. Press Play to try it.
when game starts
  float gently

when clicked
  spin fast
`;
  }

  /** Open an entity's script in a tab, adding a Script component first if it has none. */
  function openScript(id: string) {
    const entity = scene.entities.find((candidate) => candidate.id === id);
    if (!entity) return;
    if (!entity.components.Script) {
      const components: Record<string, Record<string, unknown>> = { Script: { source: scriptTemplate(entity.name, !entity.components.Mesh && !scene.entities.some((child) => child.parent === id)) } };
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
    commandHistory = [text, ...commandHistory.filter((entry) => entry !== text)].slice(0, 30);
    commandHistoryIndex = -1;
    const quickCommand = text.toLowerCase();
    if (quickCommand === "clear") {
      consoleLog = [];
      commandText = "";
      message = "Console cleared";
      return;
    }
    if (["play", "run", "start"].includes(quickCommand)) {
      log("info", `> ${text}`);
      if (playState === "stopped") void startSimulation();
      else if (playState === "paused") resumeSimulation();
      commandText = "";
      return;
    }
    if (quickCommand === "pause") {
      log("info", `> ${text}`);
      if (playState === "playing") pauseSimulation();
      else if (playState === "stopped") message = "Start Play before pausing.";
      commandText = "";
      return;
    }
    if (quickCommand === "stop") {
      log("info", `> ${text}`);
      stopSimulation();
      commandText = "";
      return;
    }
    log("info", `> ${text}`);
    const result = playState === "stopped"
      ? ScriptRuntime.runOnce(scene, text)
      : simulation?.runConsoleCommand(scene, text);
    if (!result) { message = "The simulation is not ready to run Console commands."; return; }
    for (const entry of result.prints) log("print", entry.values.map(String).join(" "));
    for (const issue of result.issues) log("error", issue.message);
    const ops = scriptOps(scene, result.scene);
    for (const line of describeChanges(scene, result.scene)) log("info", line);
    if (ops.length) {
      const applied = playState === "stopped" ? apply(ops) : (scene = result.scene, true);
      if (applied) message = `Ran: ${text}`;
    }
    else if (!ops.length && !result.issues.length && !result.prints.length) log("info", "Nothing changed.");
    if (!result.issues.length) commandText = "";
  }

  function commandKey(event: KeyboardEvent) {
    if (event.key === "Tab") {
      event.preventDefault();
      const mostRecent = scene.entities.at(-1);
      if (mostRecent) selectEntity(mostRecent.id);
      else message = "There are no objects to select.";
    } else if (event.key === "ArrowUp" && commandHistory.length) {
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
    savedHistory = undoStack;
    scenePath = null;
    savedSceneName = scene.name;
    message = "New scene";
  }

  async function saveScene() {
    commitAllScripts();
    if (isDesktopRuntime()) {
      try {
        const path = scenePath ?? await chooseSceneToSave(`${sceneName.replace(/[<>:"/\\|?*]/g, "-")}.simu`);
        if (!path) return;
        const contents = serializeScene(scene);
        await writeSceneFile(path, contents);
        scenePath = path;
        savedHistory = undoStack;
        savedSceneName = scene.name;
        await rememberOpenedScene(sceneName, path, contents);
        message = `Saved ${path.split(/[\\/]/).at(-1) ?? "scene"}`;
      } catch (error) {
        message = error instanceof Error ? error.message : "Unable to save scene file";
      }
      return;
    }
    const contents = serializeScene(scene);
    const fileName = sceneDownloadName();
    const file = new Blob([contents], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    savedHistory = undoStack;
    savedSceneName = scene.name;
    scenePath = fileName;
    const recentCached = await rememberOpenedScene(sceneName, null, contents, fileName);
    message = recentCached ? "Scene saved as JSON" : "Scene saved as JSON, but browser storage could not cache it for Open Recent.";
  }

  async function saveSceneAsJson() {
    if (!isDesktopRuntime()) {
      await saveScene();
      return;
    }
    commitAllScripts();
    try {
      const path = await chooseSceneToSave(sceneDownloadName());
      if (!path) return;
      const contents = serializeScene(scene);
      await writeSceneFile(path, contents);
      scenePath = path;
      savedHistory = undoStack;
      savedSceneName = scene.name;
      await rememberOpenedScene(sceneName, path, contents);
      message = `Saved ${path.split(/[\\/]/).at(-1) ?? "scene"}`;
    } catch (error) {
      message = error instanceof Error ? error.message : "Unable to save scene file";
    }
  }

  async function loadScene(event?: Event) {
    if (isDesktopRuntime()) {
      try {
        const path = await chooseSceneToOpen();
        if (!path) return;
        const contents = await readSceneFile(path);
        const fileName = path.split(/[\\/]/).at(-1) ?? "scene";
        installOpenedScene(deserializeScene(contents), path, fileName);
        await rememberOpenedScene(sceneName, path, contents, fileName);
        message = `Opened ${sceneName}`;
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
      const contents = await file.text();
      installOpenedScene(deserializeScene(contents), null, file.name);
      const recentCached = await rememberOpenedScene(sceneName, null, contents, file.name);
      message = recentCached ? `Opened ${sceneName}` : `Opened ${sceneName}, but browser storage could not cache it for Open Recent.`;
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
    logScriptMessages();
    animationFrame = requestAnimationFrame(physicsFrame);
  }

  function logScriptMessages() {
    const scriptMessages = simulation?.takeScriptMessages() ?? [];
    if (!scriptMessages.length) return;
    simulationWarnings = [...simulationWarnings, ...scriptMessages].slice(-30);
    for (const entry of scriptMessages) log(/^[^:\s]*:\d+:\d+ /.test(entry) ? "error" : "print", entry);
  }

  async function startSimulation() {
    if (playStarting || playState !== "stopped") return;
    commandInput?.blur();
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

  /** Pause if needed, then advance the simulation by one 60 fps frame. */
  function stepSimulation() {
    if (!simulation || playState === "stopped") return;
    if (playState === "playing") pauseSimulation();
    const frame = 1 / 60;
    simulation.resume();
    scene = simulation.advance(scene, frame);
    simulation.pause();
    timelineTime += frame;
    logScriptMessages();
    message = "Stepped one frame";
  }

  const panelNames: EditorPanel[] = ["hierarchy", "inspector", "console", "ai", "timeline", "docs", "sceneLoader"];
  const panelLabels: Record<EditorPanel, string> = { hierarchy: "Hierarchy", inspector: "Inspector", console: "Console", ai: "AI", timeline: "Timeline", docs: "Docs", sceneLoader: "Scene Loader" };

  function togglePanel(name: string) {
    if (!(name in panelOpen)) return;
    const panel = name as EditorPanel;
    panelOpen[panel] = !panelOpen[panel];
    if (panelOpen[panel]) {
      focusedPanel = panel;
      const layout = panelLayouts[panel];
      const width = panel === "docs" || panel === "sceneLoader" ? Math.min(layout.width, Math.max(220, stageWidth)) : layout.width;
      const height = panel === "docs" || panel === "sceneLoader" ? Math.min(layout.height, Math.max(140, stageHeight)) : layout.height;
      panelLayouts[panel] = {
        ...layout,
        x: Math.min(Math.max(0, layout.x), Math.max(0, stageWidth - width)),
        y: Math.min(Math.max(0, layout.y), Math.max(0, stageHeight - height)),
        width,
        height
      };
    }
  }

  function showSceneLoader() {
    if (!panelOpen.sceneLoader) togglePanel("sceneLoader");
    else focusedPanel = "sceneLoader";
  }

  function openScenePicker() {
    if (isDesktopRuntime()) void loadScene();
    else openInput.click();
  }

  const topBarActions: TopBarActions = {
    newScene, saveScene: () => void saveScene(), undo, redo,
    openScene: () => isDesktopRuntime() ? void loadScene() : openInput.click(),
    openRecent: () => showSceneLoader(),
    openSceneLoader: () => showSceneLoader(),
    renameScene: () => { if (playState !== "stopped") message = "Stop the simulation before renaming the scene."; else sceneRenameTarget = sceneName; },
    cut: () => { if (selectedId) cutEntity(selectedId); },
    copy: () => { if (selectedId) copyEntity(selectedId); },
    paste: () => pasteEntity(null),
    duplicate: () => { if (selectedId) duplicateEntity(selectedId); },
    remove: () => { for (const id of [...selectedIds]) if (scene.entities.some((entity) => entity.id === id)) deleteEntity(id); },
    rename: () => { if (selectedEntity) renameTarget = { id: selectedEntity.id, name: selectedEntity.name }; },
    group: groupSelection,
    togglePanel,
    frameSelected: () => focusToken += 1,
    openSettings: () => settingsOpen = true,
    setTool: (tool) => mode = tool,
    toggleSpace: () => space = space === "world" ? "local" : "world",
    toggleSnap: () => snap = !snap,
    toggleGrid: () => gridVisible = !gridVisible,
    toggleCollisions: () => updateSettings({ collisions: !scene.settings.collisions }),
    showSceneSettings: () => { selectEntity(null); if (!panelOpen.inspector) togglePanel("inspector"); },
    addPrimitive: createPrimitive,
    addLight,
    addCamera,
    addSceneScript: addScriptObject,
    addGroup: () => { selectEntity(null); groupSelection(); },
    openScript: openScriptForSelection,
    play: () => void startSimulation(), pause: pauseSimulation, resume: resumeSimulation, stop: stopSimulation, step: stepSimulation
  };

  onDestroy(() => {
    cancelAnimationFrame(animationFrame);
    simulation?.stop();
  });
</script>

<svelte:head><title>SimuStyle — Scene Editor</title></svelte:head>
<svelte:window onpointermove={movePanelDrag} onpointerup={endPanelDrag} onkeydown={windowKeyDown} onkeyup={windowKeyUp} />

<main class="editor" class:simulation-playing={playState === "playing"} class:simulation-paused={playState === "paused"}>
  <TopBar
    {sceneName}
    saved={undoStack === savedHistory && scene.name === savedSceneName}
    editable={playState === "stopped"}
    canUndo={undoStack.length > 0}
    canRedo={redoStack.length > 0}
    hasSelection={selectedId !== null}
    canPaste={entityClipboard !== null}
    tool={mode}
    {space}
    {snap}
    {gridVisible}
    collisions={scene.settings.collisions}
    panels={panelNames.map((name) => ({ name, label: panelLabels[name], open: panelOpen[name] }))}
    showSettings={isDesktopRuntime()}
    {playState}
    {playStarting}
    time={timelineTime}
    actions={topBarActions}
  >
    {#snippet exportMenu()}<ExportMenu scene={viewportScene} onVideoExport={exportVideo} />{/snippet}
  </TopBar>
  <input bind:this={openInput} class="file-input" type="file" accept=".simu,.json,.scene.json,application/json" onchange={loadScene} />

  <div class="editor-body">
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
      <div class="stage" bind:this={stageHost} style={stageContentStyle()} use:observeStageSize>
        <Viewport scene={viewportScene} {selectedId} {selectedIds} {mode} {frameToken} {focusToken} {gridVisible} {space} {snap} onSelect={viewportSelect} onSelectMany={selectEntities} onTransform={updateTransform} onModeChange={(nextMode) => mode = nextMode} onContextMenu={(id, x, y, position) => openEntityMenu(id, x, y, position, id ? "object" : "viewport")} />
        {#if activeTab !== "scene" && openScripts.includes(activeTab)}
          {@const id = activeTab}
          <div class="scene-content-window" style={sceneContentStyle()}>
            {#key id}
              <ScriptEditor
                title={`${scene.entities.find((entity) => entity.id === id)?.name ?? id} — script`}
                owner={scene.entities.find((entity) => entity.id === id)?.name ?? id}
                ownerHasChildren={scene.entities.some((entity) => entity.parent === id)}
                source={scriptDrafts[id] ?? storedSource(id)}
                dirty={scriptDrafts[id] !== undefined}
                readOnly={playState !== "stopped"}
                {entityNames}
                entities={parseEntities}
                ownerId={id}
                onChange={(source) => scriptDrafts = { ...scriptDrafts, [id]: source }}
                onCommit={() => commitScript(id)}
              />
            {/key}
          </div>
        {/if}
        <div class="panel-workspace" aria-label="Editor panels">
          {#if panelOpen.hierarchy}
            <section class="panel-window" class:floating-panel={panelLayouts.hierarchy.dock === "floating"} style={panelWindowStyle("hierarchy")} use:rememberPanelSize={"hierarchy"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag Hierarchy panel to move or snap" onpointerdown={(event) => startPanelDrag(event, "hierarchy")}><strong>Hierarchy</strong><span>Drag to move or snap</span></button><button class="panel-close" type="button" aria-label="Close Hierarchy" onclick={() => panelOpen.hierarchy = false}><X size={13} /></button></header>
              <div class="panel-window-body sidebar-panel-body"><Hierarchy scene={scene} {selectedIds} onSelect={selectEntity} onSelectMany={selectEntities} onGroup={groupSelection} onRename={(id, name) => apply([{ op: "update", id, components: {}, name }])} onDelete={deleteEntity} onReparent={reparentEntity} onOpenScript={openScript} onContextMenu={openEntityMenu} onContextMenuEmpty={(x, y) => openEntityMenu(null, x, y, null, "hierarchy")} /></div>
              <PanelResizeHandles panelName="Hierarchy" dock={panelLayouts.hierarchy.dock} onResizeStart={(event, edge) => startPanelResize(event, "hierarchy", edge)} />
            </section>
          {/if}
          {#if panelOpen.inspector}
            <section class="panel-window" class:floating-panel={panelLayouts.inspector.dock === "floating"} style={panelWindowStyle("inspector")} use:rememberPanelSize={"inspector"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag Inspector panel to move or snap" onpointerdown={(event) => startPanelDrag(event, "inspector")}><strong>Inspector</strong><span>Drag to move or snap</span></button><button class="panel-close" type="button" aria-label="Close Inspector" onclick={() => panelOpen.inspector = false}><X size={13} /></button></header>
              <div class="panel-window-body sidebar-panel-body"><Inspector {scene} entity={selectedEntity} onUpdate={updateComponent} onRemove={(component) => selectedId && apply([{ op: "update", id: selectedId, components: { [component]: null } }])} onAdd={addComponent} onKeyframe={addKeyframe} onOpenScript={() => selectedId && openScript(selectedId)} onRename={(name) => selectedId && apply([{ op: "update", id: selectedId, components: {}, name }])} onReparent={(parent) => selectedId && reparentEntity(selectedId, parent)} onSettings={updateSettings} onPhysics={(enabled) => selectedId && setPhysics(selectedId, enabled)} onCollision={(enabled) => selectedId && setCollision(selectedId, enabled)} /></div>
              <PanelResizeHandles panelName="Inspector" dock={panelLayouts.inspector.dock} onResizeStart={(event, edge) => startPanelResize(event, "inspector", edge)} />
            </section>
          {/if}
          {#if panelOpen.console}
            <section class="panel-window" class:floating-panel={panelLayouts.console.dock === "floating"} style={panelWindowStyle("console")} use:rememberPanelSize={"console"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag Console panel to move or snap" onpointerdown={(event) => startPanelDrag(event, "console")}><strong>Console</strong><span>Drag to move or snap</span></button><button class="panel-close" type="button" aria-label="Close Console" onclick={() => panelOpen.console = false}><X size={13} /></button></header>
              <div class="panel-window-body console-body">
                <div class="console-line"><span class="console-dot">●</span>{message}{#if simulationWarnings.length}<span> · {simulationWarnings.join(" · ")}</span>{/if}</div>
                <div class="console-log" aria-live="polite" use:followLog={consoleLog.length}>
                  {#if !consoleLog.length}<div class="console-hint">Type a command to change the scene, for example <code>move the box up 2</code> or <code>paint the sphere red</code>. Quick commands: <code>play</code>/<code>run</code>, <code>pause</code>, <code>stop</code>, <code>clear</code>. {playState === "stopped" ? "Scene commands are undoable; use the Script button to make actions run on Play." : "Scene commands affect the live simulation and are discarded when you Stop."}</div>{/if}
                  {#each consoleLog as entry}<div class="log-{entry.kind}">{entry.text}</div>{/each}
                </div>
                <form class="command-bar" onsubmit={(event) => { event.preventDefault(); runCommandBar(); }}>
                  <span aria-hidden="true">›</span>
                  <input bind:this={commandInput} aria-label="Run a script command" placeholder="move the red ball above the box" bind:value={commandText} onkeydown={commandKey} spellcheck="false" autocomplete="off" />
                  <button type="submit" disabled={!commandText.trim()}>Run</button>
                </form>
              </div>
              <PanelResizeHandles panelName="Console" dock={panelLayouts.console.dock} onResizeStart={(event, edge) => startPanelResize(event, "console", edge)} />
            </section>
          {/if}
          {#if panelOpen.ai}
            <section class="panel-window" class:floating-panel={panelLayouts.ai.dock === "floating"} style={panelWindowStyle("ai")} use:rememberPanelSize={"ai"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag AI panel to move or snap" onpointerdown={(event) => startPanelDrag(event, "ai")}><strong>AI</strong><span>Drag to move or snap</span></button><button class="panel-close" type="button" aria-label="Close AI" onclick={() => panelOpen.ai = false}><X size={13} /></button></header>
              <div class="panel-window-body"><AIPanel messages={aiMessages} loading={aiLoading} {aiProgress} prompt={aiPrompt} onPromptChange={(value) => aiPrompt = value} onSubmit={submitAI} onUndo={undoAIChange} onApplyDraft={applyAIFallback} /></div>
              <PanelResizeHandles panelName="AI" dock={panelLayouts.ai.dock} onResizeStart={(event, edge) => startPanelResize(event, "ai", edge)} />
            </section>
          {/if}
          {#if panelOpen.timeline}
            <section class="panel-window" class:floating-panel={panelLayouts.timeline.dock === "floating"} style={panelWindowStyle("timeline")} use:rememberPanelSize={"timeline"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag Timeline panel to move or snap" onpointerdown={(event) => startPanelDrag(event, "timeline")}><strong>Timeline</strong><span>Drag to move or snap</span></button><button class="panel-close" type="button" aria-label="Close Timeline" onclick={() => panelOpen.timeline = false}><X size={13} /></button></header>
              <div class="panel-window-body"><Timeline {scene} {selectedId} playhead={timelineTime} onPlayheadChange={(value) => timelineTime = value} onTrackChange={(tracks) => selectedId && changeTracks(selectedId, tracks)} /></div>
              <PanelResizeHandles panelName="Timeline" dock={panelLayouts.timeline.dock} onResizeStart={(event, edge) => startPanelResize(event, "timeline", edge)} />
            </section>
          {/if}
          {#if panelOpen.docs}
            <section class="panel-window" class:floating-panel={panelLayouts.docs.dock === "floating"} style={panelWindowStyle("docs")} use:rememberPanelSize={"docs"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag Docs panel to move or snap" onpointerdown={(event) => startPanelDrag(event, "docs")}><strong>Docs</strong><span>Drag to move or snap</span></button><button class="panel-close" type="button" aria-label="Close Docs" onclick={() => panelOpen.docs = false}><X size={13} /></button></header>
              <div class="panel-window-body"><DocsPanel /></div>
              <PanelResizeHandles panelName="Docs" dock={panelLayouts.docs.dock} onResizeStart={(event, edge) => startPanelResize(event, "docs", edge)} />
            </section>
          {/if}
          {#if panelOpen.sceneLoader}
            <section class="panel-window floating-panel scene-loader-window" style={panelWindowStyle("sceneLoader")} use:rememberPanelSize={"sceneLoader"}>
              <header class="panel-window-title"><button class="panel-drag-handle" type="button" aria-label="Drag Scene Loader panel to move" onpointerdown={(event) => startPanelDrag(event, "sceneLoader")}><strong>Scene Loader</strong><span>Open and save scene files</span></button><button class="panel-close" type="button" aria-label="Close Scene Loader" onclick={() => panelOpen.sceneLoader = false}><X size={13} /></button></header>
              <div class="panel-window-body scene-loader-body">
                <div class="scene-loader-actions">
                  <button type="button" onclick={openScenePicker}>Open scene…</button>
                  <button type="button" onclick={() => void saveSceneAsJson()}>Save current scene as JSON</button>
                </div>
                <div class="scene-loader-heading">Recent scenes</div>
                {#if recentScenes.length}
                  <div class="scene-loader-list">
                    {#each recentScenes as entry (entry.key)}
                      <button type="button" class:current-scene={entry.key === (scenePath && isDesktopRuntime() ? `desktop:${scenePath}` : `browser:${scenePath?.toLocaleLowerCase() ?? ""}`)} onclick={() => void openRecentScene(entry.key)}>
                        <strong>{entry.name}</strong><small>{entry.path ?? "Saved in this browser"}</small>
                      </button>
                    {/each}
                  </div>
                {:else}
                  <p class="scene-loader-empty">No recent scenes yet. Open a .simu or .json file to add it here.</p>
                {/if}
              </div>
              <PanelResizeHandles panelName="Scene Loader" dock={panelLayouts.sceneLoader.dock} onResizeStart={(event, edge) => startPanelResize(event, "sceneLoader", edge)} />
            </section>
          {/if}
          {#if draggingPanel && snapTarget}
            <div class="panel-snap-preview snap-{snapTarget}" aria-hidden="true"></div>
          {/if}
        </div>
      </div>
      <div class="bottom-tabs" role="toolbar" aria-label="Show or hide editor panels">
        <button class:selected={panelOpen.hierarchy} aria-pressed={panelOpen.hierarchy} onclick={() => panelOpen.hierarchy = !panelOpen.hierarchy}>Hierarchy</button>
        <button class:selected={panelOpen.inspector} aria-pressed={panelOpen.inspector} onclick={() => panelOpen.inspector = !panelOpen.inspector}>Inspector</button>
        <button class:selected={panelOpen.console} aria-pressed={panelOpen.console} onclick={() => panelOpen.console = !panelOpen.console}>Console</button>
        <button class:selected={panelOpen.ai} aria-pressed={panelOpen.ai} onclick={() => panelOpen.ai = !panelOpen.ai}>AI</button>
        <button class:selected={panelOpen.timeline} aria-pressed={panelOpen.timeline} onclick={() => panelOpen.timeline = !panelOpen.timeline}>Timeline</button>
        <button class:selected={panelOpen.docs} aria-pressed={panelOpen.docs} onclick={() => togglePanel("docs")}>Docs</button>
      </div>
    </section>
  </div>
  <footer class="statusbar"><span><i></i> SCENE CORE</span><span>{scene.entities.length} {scene.entities.length === 1 ? "ENTITY" : "ENTITIES"}</span><span>Y-UP · METERS</span></footer>
  {#if settingsOpen}
    <div class="settings-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) settingsOpen = false; }}>
      <SettingsPanel model={aiSettings.model} baseUrl={aiSettings.baseUrl} hasApiKey={aiSettings.apiKeyConfigured} onSave={saveAiSettings} onRemoveKey={removeAiKey} onClose={() => settingsOpen = false} />
    </div>
  {/if}
  {#if sceneRenameTarget !== null}
    <div class="rename-overlay" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) sceneRenameTarget = null; }}>
      <div class="rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-scene-title">
        <h2 id="rename-scene-title">Rename scene</h2>
        <form onsubmit={(event) => { event.preventDefault(); commitSceneRename(); }}>
          <input aria-label="Scene name" bind:value={sceneRenameTarget} maxlength="100" />
          <div class="rename-actions"><button type="button" onclick={() => sceneRenameTarget = null}>Cancel</button><button type="submit" disabled={!sceneRenameTarget.trim()}>Rename</button></div>
        </form>
      </div>
    </div>
  {/if}
  {#if contextMenu}
    <button class="context-dismiss" type="button" aria-label="Close entity menu" onclick={() => contextMenu = null}></button>
    <div class="entity-context-menu" style={`left:${contextMenu.x}px;top:${contextMenu.y}px`} role="menu" aria-label="Entity actions" tabindex="-1" oncontextmenu={(event) => event.preventDefault()}>
      <button role="menuitem" aria-expanded={contextAddOpen} onclick={() => contextAddOpen = !contextAddOpen}>Add <span class="context-chevron">{contextAddOpen ? "−" : "›"}</span></button>
      {#if contextAddOpen}
        <div class="context-add-list" aria-label="Add object">
          <button role="menuitem" onclick={() => addContextPrimitive("box")}>Cube</button>
          <button role="menuitem" onclick={() => addContextPrimitive("sphere")}>Sphere</button>
          <button role="menuitem" onclick={() => addContextPrimitive("cylinder")}>Cylinder</button>
          <button role="menuitem" onclick={() => addContextPrimitive("capsule")}>Capsule</button>
          <button role="menuitem" onclick={() => addContextPrimitive("cone")}>Cone</button>
          <button role="menuitem" onclick={() => addContextPrimitive("plane")}>Plane</button>
          <div class="context-separator"></div>
          <button role="menuitem" onclick={() => addContextLight("point")}>Point light</button>
          <button role="menuitem" onclick={() => addContextLight("directional")}>Sun light</button>
          <button role="menuitem" onclick={() => addContextLight("spot")}>Spot light</button>
          <button role="menuitem" onclick={addContextCamera}>Camera</button>
          <div class="context-separator"></div>
          <button role="menuitem" onclick={addContextScript}>Script object</button>
          <button role="menuitem" onclick={addContextGroup}>Empty group</button>
        </div>
        <div class="context-separator"></div>
      {/if}
      {#if contextMenu.id}
        <button role="menuitem" onclick={() => cutEntity(contextMenu!.id!)} disabled={playState !== "stopped"}>Cut</button>
        <button role="menuitem" onclick={() => copyEntity(contextMenu!.id!)}>Copy</button>
      {/if}
      <button role="menuitem" onclick={() => pasteEntity(contextMenu?.position ?? null)} disabled={!entityClipboard || playState !== "stopped"}>Paste</button>
      {#if contextMenu.id}
        <div class="context-separator"></div>
        <button role="menuitem" onclick={() => duplicateEntity(contextMenu!.id!)} disabled={playState !== "stopped"}>Duplicate</button>
        <button role="menuitem" onclick={groupSelection} disabled={playState !== "stopped"}>Group{selectedIds.length > 1 ? ` ${selectedIds.length} objects` : ""} <kbd>Ctrl+G</kbd></button>
        {#if scene.entities.some((entity) => entity.parent === contextMenu!.id)}<button role="menuitem" onclick={() => ungroupEntity(contextMenu!.id!)} disabled={playState !== "stopped"}>Ungroup <kbd>Ctrl+Shift+G</kbd></button>{/if}
        {#if scene.entities.find((entity) => entity.id === contextMenu!.id)?.parent}<button role="menuitem" onclick={() => { reparentEntity(contextMenu!.id!, null); contextMenu = null; }} disabled={playState !== "stopped"}>Move out to top level</button>{/if}
        <button role="menuitem" onclick={() => { const entity = scene.entities.find((candidate) => candidate.id === contextMenu!.id); if (entity) renameTarget = { id: entity.id, name: entity.name }; contextMenu = null; }} disabled={playState !== "stopped"}>Rename</button>
        <div class="context-separator"></div>
        <button class="context-delete" role="menuitem" onclick={() => { if (deleteEntity(contextMenu!.id!)) contextMenu = null; }} disabled={playState !== "stopped"}>Delete</button>
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
  .stage{position:relative;z-index:0;isolation:isolate;box-sizing:border-box;flex:1;min-height:0;display:flex}
  .scene-content-window{position:absolute;z-index:3;min-width:0;min-height:0}
  .panel-workspace{position:absolute;inset:0;z-index:5;overflow:hidden;pointer-events:none}
  .panel-window{position:absolute;display:flex;min-width:220px;min-height:140px;flex-direction:column;overflow:hidden;pointer-events:auto;border:1px solid #454450;border-radius:0;background:#191a21;box-shadow:none}
  .panel-window.floating-panel{overflow:hidden;min-width:220px;min-height:140px}
  .panel-window-title{display:flex;flex:0 0 32px;align-items:center;gap:10px;padding:0 8px 0 12px;border-bottom:1px solid #ffffff12;background:#22232d;color:#dedce8;cursor:grab;user-select:none}
  .panel-window-title:active{cursor:grabbing}
  .panel-window-title strong{font-size:10px;font-weight:600}
  .panel-window-title span{flex:1;color:#777583;font-size:9px}
  .panel-drag-handle{display:flex;height:100%;min-width:0;flex:1;align-items:center;gap:10px;padding:0;border:0;background:transparent;text-align:left;cursor:grab;user-select:none}
  .panel-drag-handle:active{cursor:grabbing}
  .panel-close{display:grid;width:22px;height:22px;flex:none;place-items:center;border:0;border-radius:4px;background:transparent;color:#9795a3;cursor:pointer}
  .panel-close:hover{background:#ffffff12;color:#fff}
  .panel-window-body{display:flex;min-width:0;min-height:0;flex:1;flex-direction:column;overflow:hidden}
  .panel-window-body :global(.ai-panel){flex:1}
  .panel-window-body :global(.timeline){min-height:0;flex:1;border-top:0}
  .sidebar-panel-body :global(.hierarchy),.sidebar-panel-body :global(.inspector){width:100%;min-width:0;min-height:0;flex:1;flex-basis:auto;border-right:0;border-left:0}
  .console-body .console-line{flex:none;padding:6px 10px}
  .console-body .console-log{flex:1;min-height:30px}
  .console-body .command-bar{flex:none}
  .panel-snap-preview{position:absolute;z-index:10;border:1px solid #a99aff;background:#9b8cff22;pointer-events:none}
  .panel-snap-preview.snap-left{top:0;bottom:0;left:0;width:38%}
  .panel-snap-preview.snap-right{top:0;right:0;bottom:0;width:38%}
  .panel-snap-preview.snap-top{top:0;right:0;left:0;height:42%}
  .panel-snap-preview.snap-bottom{right:0;bottom:0;left:0;height:42%}
  .stage-tabs{height:32px;display:flex;align-items:stretch;gap:1px;padding:0 6px;background:#15161c;border-bottom:1px solid #ffffff0e;overflow-x:auto}
  .stage-tab{display:flex;align-items:center;gap:6px;padding:0 6px 0 10px;border:0;border-top:2px solid transparent;background:transparent;color:#8a8896;font-size:10.5px;white-space:nowrap;cursor:pointer}
  button.stage-tab{padding-right:12px}
  .stage-tab[aria-selected="true"]{background:#1d1e26;color:#e6e3f1;border-top-color:#9585fa}
  .stage-tab:hover{color:#d6d3e0}
  .dirty-dot{font-style:normal;color:#ffd479;font-size:8px}
  .close-tab{display:grid;place-items:center;width:18px;height:18px;border:0;border-radius:4px;background:none;color:#777583;cursor:pointer}
  .close-tab:hover{background:#ffffff12;color:#fff}
  .console-log{flex:1;min-height:0;overflow:auto;padding:0 15px 4px;font:10.5px/17px 'DM Mono',monospace;color:#a9a7b5}
  .console-hint{color:#77757f;font-family:'DM Sans',sans-serif;font-size:10.5px}.console-hint code{color:#7fd1ff;font-family:'DM Mono',monospace}
  .log-info{color:#8a8896}.log-print{color:#d9d7e2}.log-error{color:#ff8992}
  .command-bar{display:flex;align-items:center;gap:8px;margin:0 10px 8px;padding:0 4px 0 10px;height:30px;border:1px solid #ffffff14;border-radius:6px;background:#111217}
  .command-bar:focus-within{border-color:#7fd1ff66}
  .command-bar span{color:#7fd1ff;font:13px 'DM Mono',monospace}
  .command-bar input{flex:1;min-width:0;height:100%;border:0;outline:none;background:transparent;color:#e6e3f1;font:11px 'DM Mono',monospace}
  .command-bar button{height:22px;padding:0 10px;border:0;border-radius:4px;background:#1f2f3a;color:#a9def7;font-size:10px;cursor:pointer}.command-bar button:disabled{opacity:.4;cursor:default}
  .settings-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;padding:20px;background:#09090dc9;backdrop-filter:blur(5px)}
  .scene-loader-body{padding:10px;gap:10px}
  .scene-loader-actions{display:flex;flex-wrap:wrap;gap:6px}
  .scene-loader-actions button{height:27px;padding:0 9px;border:1px solid #ffffff16;border-radius:5px;background:#25252f;color:#d6d3e0;font-size:10px}
  .scene-loader-actions button:hover{background:#302d40;color:#fff}
  .scene-loader-heading{color:#aaa8b5;font-size:10px;font-weight:600}
  .scene-loader-list{display:grid;min-height:0;gap:3px;overflow:auto}
  .scene-loader-list button{display:flex;height:auto;min-height:42px;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;padding:6px 9px;border:0;border-radius:5px;background:transparent;text-align:left}
  .scene-loader-list button:hover,.scene-loader-list button.current-scene{background:#ffffff0c}
  .scene-loader-list strong{max-width:100%;overflow:hidden;color:#e6e3f1;font-size:10.5px;text-overflow:ellipsis}
  .scene-loader-list small{max-width:100%;overflow:hidden;color:#777583;font-size:9px;text-overflow:ellipsis}
  .scene-loader-empty{margin:0;color:#777583;font-size:10px;line-height:1.5}
  .context-dismiss{position:fixed;inset:0;z-index:30;border:0;background:transparent}
  .entity-context-menu{position:fixed;z-index:31;width:194px;max-height:75vh;overflow:auto;padding:5px;border:1px solid #383845;border-radius:8px;background:#1b1b23;box-shadow:0 12px 36px #0009}
  .entity-context-menu button{display:block;width:100%;height:30px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:#e6e3f1;text-align:left;font-size:11px;cursor:pointer}
  .entity-context-menu button:hover:not(:disabled){background:#302d40}
  .context-add-list{margin:2px 0 4px 10px;padding-left:5px;border-left:1px solid #ffffff20}
  .context-chevron{float:right;color:#9995a9}
  .entity-context-menu button:disabled{opacity:.4;cursor:default}
  .entity-context-menu kbd{float:right;color:#7d7a8a;font:9px 'DM Mono',monospace}
  .menu-separator{height:1px;margin:4px 3px;background:#ffffff18}
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
