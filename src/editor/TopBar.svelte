<script lang="ts" module>
  export type ToolMode = "select" | "translate" | "rotate" | "scale";
  export type PrimitiveShape = "box" | "sphere" | "cylinder" | "cone" | "plane" | "capsule";

  /** Everything the top bar can ask the editor to do. */
  export interface TopBarActions {
    newScene(): void; openScene(): void; saveScene(): void;
    undo(): void; redo(): void;
    cut(): void; copy(): void; paste(): void; duplicate(): void; remove(): void; rename(): void; group(): void;
    togglePanel(name: string): void; frameSelected(): void; openSettings(): void;
    setTool(tool: ToolMode): void; toggleSpace(): void; toggleSnap(): void; toggleGrid(): void;
    addPrimitive(shape: PrimitiveShape): void; addGroup(): void; openScript(): void;
    play(): void; pause(): void; resume(): void; stop(): void; step(): void;
  }
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PlayState } from "../runtime/physics";
  import { BookOpen, Box, ChevronDown, Circle, Code, Cone, Cylinder, FolderPlus, Globe, Grid3X3, Magnet, MousePointer2, Move, Pause, Play, Plus, Redo2, RotateCw, Scaling, SkipForward, Square, Undo2 } from "@lucide/svelte";

  interface Props {
    sceneName: string;
    saved: boolean;
    /** False during Play: scene edits are locked. */
    editable: boolean;
    canUndo: boolean;
    canRedo: boolean;
    hasSelection: boolean;
    canPaste: boolean;
    tool: ToolMode;
    space: "world" | "local";
    snap: boolean;
    gridVisible: boolean;
    panels: { name: string; label: string; open: boolean }[];
    showSettings: boolean;
    playState: PlayState;
    playStarting: boolean;
    /** Seconds since Play started. */
    time: number;
    actions: TopBarActions;
    /** The Export button and its popover. */
    exportMenu: Snippet;
  }

  let { sceneName, saved, editable, canUndo, canRedo, hasSelection, canPaste, tool, space, snap, gridVisible, panels, showSettings, playState, playStarting, time, actions, exportMenu }: Props = $props();

  type MenuName = "scene" | "file" | "edit" | "view" | "add";
  let openMenu: MenuName | null = $state(null);

  const tools: { mode: ToolMode; label: string; key: string; icon: typeof Move }[] = [
    { mode: "select", label: "Select", key: "Q", icon: MousePointer2 },
    { mode: "translate", label: "Move", key: "W", icon: Move },
    { mode: "rotate", label: "Rotate", key: "E", icon: RotateCw },
    { mode: "scale", label: "Scale", key: "R", icon: Scaling }
  ];
  const primitives: { shape: PrimitiveShape; label: string; icon: typeof Box }[] = [
    { shape: "box", label: "Cube", icon: Box }, { shape: "sphere", label: "Sphere", icon: Circle },
    { shape: "cylinder", label: "Cylinder", icon: Cylinder }, { shape: "capsule", label: "Capsule", icon: Circle },
    { shape: "cone", label: "Cone", icon: Cone }, { shape: "plane", label: "Plane", icon: Square }
  ];

  /** 00:00.00 for the Play clock, and the frame number at 60 fps. */
  const clock = $derived(`${String(Math.floor(time / 60)).padStart(2, "0")}:${(time % 60).toFixed(2).padStart(5, "0")}`);
  const frame = $derived(Math.floor(time * 60));

  function toggle(menu: MenuName) { openMenu = openMenu === menu ? null : menu; }
  /** Run a menu item and close its menu. */
  function run(action: () => void) { openMenu = null; action(); }

  function closeOutside(event: PointerEvent) {
    if (openMenu && !(event.target instanceof Element && event.target.closest(".tb-menu-root"))) openMenu = null;
  }
</script>

<svelte:window onpointerdown={closeOutside} onkeydown={(event) => { if (event.key === "Escape") openMenu = null; }} />

{#snippet fileItems()}
  <div class="tb-menu" role="menu">
    <button role="menuitem" onclick={() => run(actions.newScene)}>New scene</button>
    <button role="menuitem" onclick={() => run(actions.openScene)}>Open…</button>
    <button role="menuitem" onclick={() => run(actions.saveScene)}>Save <kbd>Ctrl+S</kbd></button>
  </div>
{/snippet}

<header class="topbar">
  <div class="tb-left">
    <div class="tb-menu-root">
      <button class="tb-scene" aria-haspopup="menu" aria-expanded={openMenu === "scene"} title="Scene file" onclick={() => toggle("scene")}>
        <span class="tb-logo">S</span>
        <strong>{sceneName}</strong>
        <span class="tb-status" class:unsaved={!saved}><i></i>{saved ? "Saved" : "Unsaved"}</span>
        <ChevronDown size={13} />
      </button>
      {#if openMenu === "scene"}{@render fileItems()}{/if}
    </div>
    <span class="tb-divider"></span>
    <nav class="tb-menus" aria-label="Editor menus">
      <div class="tb-menu-root">
        <button class="tb-text" aria-haspopup="menu" aria-expanded={openMenu === "file"} onclick={() => toggle("file")}>File</button>
        {#if openMenu === "file"}{@render fileItems()}{/if}
      </div>
      <div class="tb-menu-root">
        <button class="tb-text" aria-haspopup="menu" aria-expanded={openMenu === "edit"} onclick={() => toggle("edit")}>Edit</button>
        {#if openMenu === "edit"}
          <div class="tb-menu" role="menu">
            <button role="menuitem" disabled={!canUndo || !editable} onclick={() => run(actions.undo)}>Undo <kbd>Ctrl+Z</kbd></button>
            <button role="menuitem" disabled={!canRedo || !editable} onclick={() => run(actions.redo)}>Redo <kbd>Ctrl+Y</kbd></button>
            <div class="tb-sep"></div>
            <button role="menuitem" disabled={!hasSelection || !editable} onclick={() => run(actions.cut)}>Cut</button>
            <button role="menuitem" disabled={!hasSelection} onclick={() => run(actions.copy)}>Copy</button>
            <button role="menuitem" disabled={!canPaste || !editable} onclick={() => run(actions.paste)}>Paste</button>
            <button role="menuitem" disabled={!hasSelection || !editable} onclick={() => run(actions.duplicate)}>Duplicate <kbd>Ctrl+D</kbd></button>
            <button role="menuitem" disabled={!hasSelection || !editable} onclick={() => run(actions.rename)}>Rename <kbd>F2</kbd></button>
            <button role="menuitem" disabled={!hasSelection || !editable} onclick={() => run(actions.remove)}>Delete <kbd>Del</kbd></button>
            <div class="tb-sep"></div>
            <button role="menuitem" disabled={!editable} onclick={() => run(actions.group)}>Group <kbd>Ctrl+G</kbd></button>
          </div>
        {/if}
      </div>
      <div class="tb-menu-root">
        <button class="tb-text" aria-haspopup="menu" aria-expanded={openMenu === "view"} onclick={() => toggle("view")}>View</button>
        {#if openMenu === "view"}
          <div class="tb-menu" role="menu">
            {#each panels as panel (panel.name)}
              <button role="menuitemcheckbox" aria-checked={panel.open} onclick={() => run(() => actions.togglePanel(panel.name))}><span class="tb-check">{panel.open ? "✓" : ""}</span>{panel.label}</button>
            {/each}
            <div class="tb-sep"></div>
            <button role="menuitemcheckbox" aria-checked={gridVisible} onclick={() => run(actions.toggleGrid)}><span class="tb-check">{gridVisible ? "✓" : ""}</span>Floor grid</button>
            <button role="menuitem" disabled={!hasSelection} onclick={() => run(actions.frameSelected)}><span class="tb-check"></span>Frame selected <kbd>F</kbd></button>
            {#if showSettings}<button role="menuitem" onclick={() => run(actions.openSettings)}><span class="tb-check"></span>AI settings…</button>{/if}
          </div>
        {/if}
      </div>
    </nav>
    <span class="tb-divider"></span>
    <button class="tb-icon" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo || !editable} onclick={actions.undo}><Undo2 size={15} /></button>
    <button class="tb-icon" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!canRedo || !editable} onclick={actions.redo}><Redo2 size={15} /></button>
  </div>

  <div class="tb-center">
    <div class="tb-segment" role="toolbar" aria-label="Transform tool">
      {#each tools as item (item.mode)}
        <button class="tb-icon" class:active={tool === item.mode} aria-pressed={tool === item.mode} aria-label="{item.label} tool" title="{item.label} ({item.key})" onclick={() => actions.setTool(item.mode)}><item.icon size={15} /></button>
      {/each}
    </div>
    <button class="tb-pill" title="Gizmo axes: {space === 'world' ? 'world' : 'object'} space. Click to switch." aria-label="Gizmo space: {space}" onclick={actions.toggleSpace}><Globe size={14} /> <span class="tb-label">{space === "world" ? "World" : "Local"}</span></button>
    <div class="tb-segment">
      <button class="tb-icon" class:active={snap} aria-pressed={snap} title="Snap: 0.5 m, 15°, 0.1 scale" aria-label="Snap" onclick={actions.toggleSnap}><Magnet size={15} /></button>
      <button class="tb-icon" class:active={gridVisible} aria-pressed={gridVisible} title="Floor grid" aria-label="Floor grid" onclick={actions.toggleGrid}><Grid3X3 size={15} /></button>
    </div>
  </div>

  <div class="tb-right">
    <div class="tb-menu-root">
      <button class="tb-text" aria-haspopup="menu" aria-expanded={openMenu === "add"} disabled={!editable} onclick={() => toggle("add")}><Plus size={14} /> <span class="tb-label">Add</span> <ChevronDown size={12} /></button>
      {#if openMenu === "add"}
        <div class="tb-menu align-right" role="menu" aria-label="Add mesh primitive">
          {#each primitives as item (item.shape)}
            <button role="menuitem" onclick={() => run(() => actions.addPrimitive(item.shape))}><item.icon size={14} /> {item.label}</button>
          {/each}
          <div class="tb-sep"></div>
          <button role="menuitem" onclick={() => run(actions.addGroup)}><FolderPlus size={14} /> Empty group</button>
        </div>
      {/if}
    </div>
    <button class="tb-text" title="Open the selected object's script (or a scene script)" onclick={actions.openScript}><Code size={14} /> <span class="tb-label">Script</span></button>
    <button class="tb-text" title="Open the SimuStyle user guide" aria-label="Open Docs" aria-pressed={panels.find((panel) => panel.name === "docs")?.open ?? false} onclick={() => actions.togglePanel("docs")}><BookOpen size={14} /> <span class="tb-label">Docs</span></button>
    <div class="tb-transport" role="group" aria-label="Simulation">
      <span class="tb-clock" aria-label="Play time">{clock}<small>f {frame}</small></span>
      <button class="tb-icon" title="Stop and restore the scene" aria-label="Stop" disabled={playState === "stopped"} onclick={actions.stop}><Square size={12} /></button>
      <button class="tb-icon" title="Step one frame" aria-label="Step one frame" disabled={playState === "stopped"} onclick={actions.step}><SkipForward size={13} /></button>
      {#if playState === "playing"}
        <button class="tb-play" onclick={actions.pause}><Pause size={13} fill="currentColor" /> Pause</button>
      {:else if playState === "paused"}
        <button class="tb-play" onclick={actions.resume}><Play size={13} fill="currentColor" /> Resume</button>
      {:else}
        <button class="tb-play" disabled={playStarting} onclick={actions.play}><Play size={13} fill="currentColor" /> {playStarting ? "Starting…" : "Play"}</button>
      {/if}
    </div>
    <span class="tb-divider"></span>
    {@render exportMenu()}
  </div>
</header>

<style>
  .topbar{position:relative;z-index:20;height:46px;min-height:46px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px;padding:0 10px;background:#18181d;border-bottom:1px solid #ffffff0f;font:11px 'DM Sans',sans-serif;color:#d9d7e2}
  .tb-left,.tb-center,.tb-right{display:flex;align-items:center;gap:6px;min-width:0}
  .tb-right{justify-content:flex-end}
  button{height:28px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid transparent;border-radius:6px;background:transparent;color:#c9c7d3;font:inherit;cursor:pointer;white-space:nowrap}
  button:hover:not(:disabled){background:#ffffff0d;color:#fff}
  button:disabled{opacity:.38;cursor:default}
  .tb-divider{width:1px;height:20px;background:#ffffff14;margin:0 4px;flex:none}
  .tb-menu-root{position:relative}
  .tb-scene{padding:0 6px 0 2px;gap:8px;color:#e8e6ef}
  .tb-scene strong{font-size:12px;font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis}
  .tb-logo{display:grid;place-items:center;width:24px;height:24px;border-radius:6px;background:#6d5ce7;color:#fff;font-size:12px;font-weight:700}
  .tb-status{display:inline-flex;align-items:center;gap:5px;color:#8f8d9a;font-size:10px}
  .tb-status i{width:6px;height:6px;border-radius:50%;background:#3fcf8e}
  .tb-status.unsaved i{background:#e5a345}
  .tb-scene :global(svg){color:#8f8d9a}
  .tb-menus{display:flex;gap:2px}
  .tb-text{padding:0 9px}
  .tb-icon{width:30px;padding:0}
  .tb-segment{display:flex;gap:2px;padding:3px;border:1px solid #ffffff10;border-radius:8px;background:#111115}
  .tb-segment .tb-icon{height:26px;width:28px}
  .tb-icon.active{background:#3b3566;border-color:#7d6ff066;color:#cfc8ff}
  .tb-pill{height:34px;padding:0 12px;border:1px solid #ffffff10;border-radius:8px;background:#111115}
  .tb-transport{display:flex;align-items:center;gap:4px;padding:3px 3px 3px 10px;border:1px solid #ffffff10;border-radius:8px;background:#111115}
  .tb-clock{display:inline-flex;align-items:baseline;gap:7px;margin-right:6px;font:11px 'DM Mono',monospace;color:#e2e0ea;font-variant-numeric:tabular-nums}
  .tb-clock small{font-size:9px;color:#7d7b88}
  .tb-transport .tb-icon{height:26px;width:28px}
  .tb-play{height:26px;padding:0 16px;background:#6d5ce7;color:#fff;font-weight:600}
  .tb-play:hover:not(:disabled){background:#7d6df0}
  .tb-menu{position:absolute;top:calc(100% + 6px);left:0;z-index:30;min-width:190px;display:grid;padding:5px;border:1px solid #ffffff16;border-radius:8px;background:#1f1f26;box-shadow:0 12px 32px #0009}
  .tb-menu.align-right{left:auto;right:0}
  .tb-menu button{width:100%;height:29px;justify-content:flex-start;gap:8px;padding:0 9px;border:0;border-radius:5px;font-size:11px;text-align:left}
  .tb-menu button :global(svg){color:#a99aff}
  .tb-menu kbd{margin-left:auto;color:#7d7b88;font:9px 'DM Mono',monospace}
  .tb-check{width:12px;color:#a99aff}
  .tb-sep{height:1px;margin:4px 3px;background:#ffffff14}
  @media(max-width:1280px){.tb-status{display:none}}
  @media(max-width:1100px){.tb-label,.tb-clock small{display:none}.tb-scene strong{max-width:110px}.topbar{gap:6px}}
  @media(max-width:900px){.tb-scene strong{display:none}}
</style>
