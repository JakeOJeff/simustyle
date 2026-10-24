<script lang="ts">
  import { Box, Camera, ChevronDown, ChevronRight, Circle, Cone, Cylinder, FileCode, FilePlus, Folder, FolderOpen, Lightbulb, Pill, Plus, ScrollText, Search, Square, X } from "@lucide/svelte";
  import type { Entity, Scene } from "../scene/types";

  interface Props {
    scene: Scene;
    selectedIds: string[];
    onSelect: (id: string) => void;
    onSelectMany: (ids: string[]) => void;
    /** Creates a new object; shown as the empty-state action. */
    onAdd: () => void;
    onDelete: (id: string) => boolean;
    onRename: (id: string, name: string) => void;
    onReparent: (id: string, parent: string | null) => void;
    onOpenScript: (id: string) => void;
    onContextMenu: (id: string, x: number, y: number) => void;
    onContextMenuEmpty: (x: number, y: number) => void;
  }

  interface TreeRow {
    entity: Entity;
    depth: number;
    childCount: number;
  }

  type DropZone = { id: string | null; mode: "inside" | "beside" };

  let { scene, selectedIds, onSelect, onSelectMany, onAdd, onDelete, onRename, onReparent, onOpenScript, onContextMenu, onContextMenuEmpty }: Props = $props();
  let collapsed = $state<Record<string, boolean>>({});
  let filter = $state("");
  let renaming = $state<{ id: string; name: string } | null>(null);
  let dragging = $state<string | null>(null);
  let dropZone = $state<DropZone | null>(null);
  let anchorId: string | null = null;
  const isCollapsed = (id: string) => Object.hasOwn(collapsed, id) && collapsed[id];

  let rows = $derived.by(() => {
    const byParent = new Map<string, Entity[]>();
    const knownIds = new Set(scene.entities.map((entity) => entity.id));
    const roots: Entity[] = [];
    for (const entity of scene.entities) {
      if (entity.parent === null || !knownIds.has(entity.parent)) roots.push(entity);
      else byParent.set(entity.parent, [...(byParent.get(entity.parent) ?? []), entity]);
    }
    const query = filter.trim().toLowerCase();
    if (query) {
      return scene.entities
        .filter((entity) => entity.name.toLowerCase().includes(query) || entity.id.toLowerCase().includes(query))
        .map((entity) => ({ entity, depth: 0, childCount: byParent.get(entity.id)?.length ?? 0 }));
    }
    const result: TreeRow[] = [];
    const visited = new Set<string>();
    const visit = (entity: Entity, depth: number, hidden: boolean) => {
      if (visited.has(entity.id)) return;
      visited.add(entity.id);
      const children = byParent.get(entity.id) ?? [];
      if (!hidden) result.push({ entity, depth, childCount: children.length });
      for (const child of children) visit(child, depth + 1, hidden || Boolean(isCollapsed(entity.id)));
    };
    for (const root of roots) visit(root, 0, false);
    // Keep malformed cyclic data visible instead of silently hiding entities.
    for (const entity of scene.entities) visit(entity, 0, false);
    return result;
  });

  /** What kind of thing a row is, for its icon and tooltip. */
  function kindOf(entity: Entity, childCount: number): { icon: typeof Box; label: string } {
    const shape = entity.components.Mesh ? String(entity.components.Mesh.shape ?? "box") : null;
    if (shape === "sphere") return { icon: Circle, label: "Sphere" };
    if (shape === "cylinder") return { icon: Cylinder, label: "Cylinder" };
    if (shape === "cone") return { icon: Cone, label: "Cone" };
    if (shape === "plane") return { icon: Square, label: "Plane" };
    if (shape === "capsule") return { icon: Pill, label: "Capsule" };
    if (shape) return { icon: Box, label: "Cube" };
    if (entity.components.Light) return { icon: Lightbulb, label: "Light" };
    if (entity.components.Camera) return { icon: Camera, label: "Camera" };
    if (entity.components.Script && !childCount) return { icon: ScrollText, label: "Scene script" };
    return { icon: childCount && !isCollapsed(entity.id) ? FolderOpen : Folder, label: "Group" };
  }

  function select(event: MouseEvent, id: string) {
    if (event.ctrlKey || event.metaKey) {
      onSelectMany(selectedIds.includes(id) ? selectedIds.filter((candidate) => candidate !== id) : [...selectedIds, id]);
    } else if (event.shiftKey && anchorId) {
      const order = rows.map((row) => row.entity.id);
      const [from, to] = [order.indexOf(anchorId), order.indexOf(id)].sort((a, b) => a - b);
      if (from >= 0) { onSelectMany(order.slice(from, to + 1)); return; }
      onSelect(id);
    } else onSelect(id);
    anchorId = id;
  }

  function isInside(id: string, ancestor: string): boolean {
    let current = scene.entities.find((entity) => entity.id === id);
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (current.id === ancestor) return true;
      seen.add(current.id);
      current = scene.entities.find((entity) => entity.id === current!.parent);
    }
    return false;
  }

  /** Middle of a row = put inside it; top or bottom edge = put next to it (same parent). */
  function zoneFor(event: DragEvent, entity: Entity): DropZone | null {
    if (!dragging || dragging === entity.id || isInside(entity.id, dragging)) return null;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = (event.clientY - rect.top) / rect.height;
    return offset > 0.25 && offset < 0.75 ? { id: entity.id, mode: "inside" } : { id: entity.parent, mode: "beside" };
  }

  function finishDrop(zone: DropZone | null) {
    const id = dragging;
    dragging = null;
    dropZone = null;
    if (!id || !zone) return;
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    for (const moving of ids) if (!zone.id || !isInside(zone.id, moving)) onReparent(moving, zone.id);
  }

  function startRename(entity: Entity) { renaming = { id: entity.id, name: entity.name }; }

  function finishRename(save: boolean) {
    const target = renaming;
    renaming = null;
    if (save && target && target.name.trim()) onRename(target.id, target.name.trim());
  }

  function focusAndSelect(node: HTMLInputElement) { node.focus(); node.select(); }
</script>

<section class="hierarchy" data-tutorial-target="hierarchy-list" aria-label="Scene hierarchy"
  ondragover={(event) => { if (dragging) { event.preventDefault(); if (!(event.target as HTMLElement).closest(".entity-row")) dropZone = { id: null, mode: "beside" }; } }}
  ondrop={(event) => { event.preventDefault(); finishDrop(dropZone ?? { id: null, mode: "beside" }); }}
  oncontextmenu={(event) => {
    if ((event.target as HTMLElement).closest(".entity-row")) return;
    event.preventDefault();
    onContextMenuEmpty(event.clientX, event.clientY);
  }}>
  <div class="filter-row">
    <label class="filter"><Search size={13} /><input aria-label="Filter objects" placeholder="Filter" bind:value={filter} spellcheck="false" />
      {#if filter}<button class="clear-filter" type="button" aria-label="Clear filter" onclick={() => filter = ""}><X size={12} /></button>{/if}
    </label>
  </div>

  {#if rows.length === 0}
    {#if filter}
      <p class="empty-state no-match">No objects match “{filter.trim()}”.</p>
    {:else}
      <div class="empty-state">
        <strong>No objects yet</strong>
        <button class="add-object" type="button" onclick={onAdd}><Plus size={14} />Add object</button>
        <span>Drag one object onto another to nest it</span>
      </div>
    {/if}
  {:else}
    <ul class="entity-list" class:drop-root={dropZone?.id === null && dragging} role="tree" aria-label="Scene objects" aria-multiselectable="true">
      {#each rows as row (row.entity.id)}
        {@const kind = kindOf(row.entity, row.childCount)}
        {@const Icon = kind.icon}
        {@const selected = selectedIds.includes(row.entity.id)}
        <li class="entity-row" data-tutorial-target="hierarchy-row" role="treeitem" aria-level={row.depth + 1} aria-selected={selected} aria-expanded={row.childCount ? !isCollapsed(row.entity.id) : undefined}
          class:selected
          class:primary={selectedIds[0] === row.entity.id}
          class:drop-inside={dropZone?.mode === "inside" && dropZone.id === row.entity.id}
          class:drop-sibling={dragging && dropZone?.mode === "beside" && dropZone.id !== null && dropZone.id === row.entity.parent}
          class:dragging={dragging === row.entity.id}
          style={`--depth:${row.depth}`}
          oncontextmenu={(event) => { event.preventDefault(); event.stopPropagation(); onContextMenu(row.entity.id, event.clientX, event.clientY); }}
          draggable={renaming?.id !== row.entity.id}
          ondragstart={(event) => {
            dragging = row.entity.id;
            event.dataTransfer?.setData("text/plain", row.entity.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          }}
          ondragend={() => { dragging = null; dropZone = null; }}
          ondragover={(event) => { event.preventDefault(); event.stopPropagation(); dropZone = zoneFor(event, row.entity); }}
          ondrop={(event) => { event.preventDefault(); event.stopPropagation(); finishDrop(zoneFor(event, row.entity)); }}
        >
          {#if row.childCount && !filter}
            <button class="twisty" type="button" aria-label={isCollapsed(row.entity.id) ? `Expand ${row.entity.name}` : `Collapse ${row.entity.name}`} onclick={() => collapsed = { ...collapsed, [row.entity.id]: !isCollapsed(row.entity.id) }}>
              {#if isCollapsed(row.entity.id)}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
            </button>
          {:else}
            <span class="twisty" aria-hidden="true"></span>
          {/if}
          {#if renaming?.id === row.entity.id}
            <input class="rename" aria-label="Object name" bind:value={renaming.name} use:focusAndSelect
              onkeydown={(event) => { if (event.key === "Enter") finishRename(true); else if (event.key === "Escape") finishRename(false); }}
              onblur={() => finishRename(true)} />
          {:else}
            <button class="select-button" type="button" title={`${kind.label}: ${row.entity.name} — double-click to rename, drag onto another object to put it inside`}
              onclick={(event) => select(event, row.entity.id)}
              ondblclick={() => startRename(row.entity)}
              onkeydown={(event) => { if (event.key === "F2") { event.preventDefault(); startRename(row.entity); } }}>
              <span class="entity-icon" aria-hidden="true"><Icon size={13} /></span>
              <span class="entity-name">{row.entity.name}</span>
              {#if row.childCount && isCollapsed(row.entity.id)}<span class="child-count" title="{row.childCount} inside">{row.childCount}</span>{/if}
            </button>
          {/if}
          <button class="script-button" class:has-script={Boolean(row.entity.components.Script)} type="button"
            aria-label={row.entity.components.Script ? `Edit ${row.entity.name} script` : `Add a script to ${row.entity.name}`}
            title={row.entity.components.Script ? "Edit this object's script" : "Add a script to this object"}
            onclick={(event) => { event.stopPropagation(); onOpenScript(row.entity.id); }}>
            {#if row.entity.components.Script}<FileCode size={12} />{:else}<FilePlus size={12} />{/if}
          </button>
          <button class="delete-button" type="button" aria-label={`Delete ${row.entity.name}`} title={`Delete ${row.entity.name}${row.childCount ? " and everything inside it" : ""}`}
            onclick={(event) => { event.stopPropagation(); onDelete(row.entity.id); }}>
            <X size={12} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if rows.length}
  <footer class="tips">
    {#if dragging}
      Drop <b>on</b> an object to put it inside · drop on an <b>edge</b> to place it next to one · drop on empty space for the top level
    {:else}
      Drag onto an object to make it a child · Ctrl+click to pick several · <kbd>Ctrl+G</kbd> group
    {/if}
  </footer>
  {/if}
</section>

<style>
  .hierarchy {
    display: flex;
    width: 236px;
    min-width: 200px;
    flex: 0 0 236px;
    flex-direction: column;
    overflow: hidden;
    color: var(--text-primary, #ececed);
    background: var(--panel-bg, #1a1a1d);
    border-right: 1px solid var(--border, #2c2c32);
  }

  .filter-row { flex: none; padding: 8px 8px; border-bottom: 1px solid var(--window-line, #ffffff0d); }
  .filter {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 6px 0 11px;
    border: 1px solid var(--field-border, #ffffff14);
    border-radius: 7px;
    background: var(--field-bg, #161618);
    color: #7a7a85;
    cursor: text;
  }
  .filter input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; color: #e9e9eb; font-size: 12px; }
  .filter input::placeholder { color: #6e6e79; }
  .filter:focus-within { border-color: #a99bff80; color: #a9a9b2; }
  .clear-filter { display: grid; width: 20px; height: 20px; place-items: center; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #8d8d97; cursor: pointer; }
  .clear-filter:hover { background: #ffffff10; color: #fff; }

  .entity-list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 6px;
    list-style: none;
    border: 1px dashed transparent;
  }
  .entity-list.drop-root { border-color: #a99bff55; background: #a99bff08; }

  .entity-row {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 28px;
    align-items: center;
    gap: 1px;
    padding-left: calc(var(--depth) * 14px);
    border-radius: 5px;
  }
  /* Faint guide lines show which group a row belongs to. */
  .entity-row::before {
    content: "";
    position: absolute;
    left: calc(var(--depth) * 14px - 7px);
    top: 0;
    bottom: 0;
    width: 1px;
    background: #ffffff10;
    display: var(--guide, block);
  }
  .entity-row[aria-level="1"]::before { display: none; }
  .entity-row:hover { background: #ffffff07; }
  .entity-row.selected { background: #3b3566; box-shadow: inset 2px 0 #a99bff; }
  .entity-row.selected:not(.primary) { background: #313137; box-shadow: inset 2px 0 #70d8ff; }
  .entity-row.drop-inside { background: #a99bff2a; box-shadow: inset 0 0 0 1px #b9adff; }
  .entity-row.drop-sibling { background: #a99bff12; }
  .entity-row.dragging { opacity: 0.45; }

  .twisty {
    display: grid;
    flex: none;
    width: 16px;
    height: 22px;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: #898995;
    cursor: pointer;
  }
  .twisty:hover { color: #fff; }

  .select-button {
    display: flex;
    min-width: 0;
    min-height: 28px;
    flex: 1;
    align-items: center;
    gap: 7px;
    padding: 0 4px;
    overflow: hidden;
    border: 0;
    color: var(--text-secondary, #c6c6cc);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }
  .entity-row.selected .select-button { color: #fff; }
  .entity-icon { display: grid; flex: none; place-items: center; color: #8e8e99; }
  .entity-row.selected .entity-icon { color: var(--accent, #b9adff); }
  .entity-name { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .child-count { margin-left: auto; padding: 1px 6px; border-radius: 8px; background: #ffffff10; color: #aaaab2; font: 9px 'DM Mono', monospace; }

  .rename {
    flex: 1;
    min-width: 0;
    height: 24px;
    margin: 2px 4px;
    padding: 0 6px;
    border: 1px solid #a99bff;
    border-radius: 4px;
    outline: none;
    background: #131315;
    color: #fff;
    font-size: 11px;
  }

  .script-button,
  .delete-button {
    display: grid;
    flex: none;
    width: 22px;
    height: 22px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: #898995;
    cursor: pointer;
    opacity: 0;
  }
  .script-button.has-script { opacity: 1; color: #7fd1ff; }
  .entity-row:hover .script-button,
  .entity-row:hover .delete-button,
  .entity-row.selected .delete-button,
  .script-button:focus-visible,
  .delete-button:focus-visible { opacity: 1; }
  .script-button:hover { background: #1f2f3a; color: #a9def7; }
  .delete-button:hover { color: #ff858d; background: #39252b; }

  .empty-state { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px; margin: 0; padding: 24px 16px; color: var(--text-muted, #878792); font-size: 11px; line-height: 1.5; text-align: center; }
  .empty-state strong { color: var(--text-primary, #ececed); font-size: 12.5px; font-weight: 500; }
  .empty-state.no-match { justify-content: flex-start; padding-top: 28px; }
  .add-object { display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px 0 11px; border: 1px solid #ffffff1c; border-radius: 7px; background: #ffffff08; color: #f0f0f2; font-size: 12px; font-weight: 500; cursor: pointer; transition: background .12s, border-color .12s; }
  .add-object:hover { border-color: #ffffff30; background: #ffffff10; }
  .add-object:focus-visible { outline: 2px solid var(--accent, #a99bff); outline-offset: 2px; }

  .tips {
    padding: 8px 12px;
    border-top: 1px solid var(--border, #2c2c32);
    color: #747480;
    font-size: 9.5px;
    line-height: 1.45;
  }
  .tips b { color: #b9adff; font-weight: 600; }
  .tips kbd { font: 9px 'DM Mono', monospace; color: #aaaab2; }
</style>
