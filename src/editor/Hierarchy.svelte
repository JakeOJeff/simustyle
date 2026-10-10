<script lang="ts">
  import type { Entity, Scene } from "../scene/types";

  interface Props {
    scene: Scene;
    selectedId: string | null;
    onSelect: (id: string) => void;
    onCreate: () => void;
    onDelete: (id: string) => void;
    onReparent: (id: string, parent: string | null) => void;
    onOpenScript: (id: string) => void;
    onContextMenu: (id: string, x: number, y: number) => void;
  }

  interface TreeRow {
    entity: Entity;
    depth: number;
  }

  let { scene, selectedId, onSelect, onCreate, onDelete, onReparent, onOpenScript, onContextMenu }: Props = $props();

  let rows = $derived.by(() => {
    const byParent = new Map<string, Entity[]>();
    const knownIds = new Set(scene.entities.map((entity) => entity.id));
    const roots: Entity[] = [];

    for (const entity of scene.entities) {
      if (entity.parent === null || !knownIds.has(entity.parent)) {
        roots.push(entity);
      } else {
        const siblings = byParent.get(entity.parent) ?? [];
        siblings.push(entity);
        byParent.set(entity.parent, siblings);
      }
    }

    const result: TreeRow[] = [];
    const visited = new Set<string>();
    const visit = (entity: Entity, depth: number) => {
      if (visited.has(entity.id)) return;
      visited.add(entity.id);
      result.push({ entity, depth });
      for (const child of byParent.get(entity.id) ?? []) visit(child, depth + 1);
    };

    for (const root of roots) visit(root, 0);
    // Keep malformed cyclic data visible instead of silently hiding entities.
    for (const entity of scene.entities) visit(entity, 0);
    return result;
  });
</script>

<section class="hierarchy" aria-label="Scene hierarchy" ondragover={(event) => event.preventDefault()} ondrop={(event) => {
  event.preventDefault();
  const draggedId = event.dataTransfer?.getData("text/plain");
  if (draggedId) onReparent(draggedId, null);
}}>
  <header class="panel-header">
    <div>
      <h2>Hierarchy</h2>
      <span class="entity-count">{scene.entities.length} {scene.entities.length === 1 ? "entity" : "entities"}</span>
    </div>
    <button class="add-button" type="button" onclick={onCreate} aria-label="Add entity" title="Add entity">
      <span aria-hidden="true">+</span>
    </button>
  </header>

  {#if rows.length === 0}
    <p class="empty-state">Your scene is empty.</p>
  {:else}
    <ul class="entity-list" role="tree" aria-label="Scene entities">
      {#each rows as row (row.entity.id)}
        <li class="entity-row" role="treeitem" aria-level={row.depth + 1} aria-selected={selectedId === row.entity.id} oncontextmenu={(event) => { event.preventDefault(); onContextMenu(row.entity.id, event.clientX, event.clientY); }}>
          <button
            class="select-button"
            class:selected={selectedId === row.entity.id}
            type="button"
            draggable="true"
            style={`padding-left: ${8 + row.depth * 15}px`}
            onclick={() => onSelect(row.entity.id)}
            ondragstart={(event) => {
              event.dataTransfer?.setData("text/plain", row.entity.id);
              if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            }}
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const draggedId = event.dataTransfer?.getData("text/plain");
              if (draggedId && draggedId !== row.entity.id) onReparent(draggedId, row.entity.id);
            }}
            title={row.entity.name}
          >
            <span class="entity-icon" aria-hidden="true">&#9671;</span>
            <span class="entity-name">{row.entity.name}</span>
          </button>
          {#if row.entity.components.Script}
            <button class="script-badge" type="button" aria-label={`Edit ${row.entity.name} script`} title="Edit script" onclick={(event) => { event.stopPropagation(); onOpenScript(row.entity.id); }}>{"</>"}</button>
          {/if}
          <button
            class="delete-button"
            type="button"
            aria-label={`Delete ${row.entity.name}`}
            title={`Delete ${row.entity.name}`}
            onclick={(event) => {
              event.stopPropagation();
              onDelete(row.entity.id);
            }}
          >
            <span aria-hidden="true">&#215;</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .script-badge {
    flex: 0 0 auto;
    height: 20px;
    margin-right: 2px;
    padding: 0 5px;
    border: 1px solid #7fd1ff33;
    border-radius: 4px;
    background: #1f2f3a;
    color: #a9def7;
    font: 9px 'DM Mono', monospace;
    cursor: pointer;
  }

  .script-badge:hover {
    background: #26394a;
  }

  .hierarchy {
    display: flex;
    width: 220px;
    min-width: 190px;
    flex: 0 0 220px;
    flex-direction: column;
    overflow: auto;
    color: var(--text-primary, #e9e9f0);
    background: var(--panel-bg, #171820);
    border-right: 1px solid var(--border, #292a35);
  }

  .panel-header {
    display: flex;
    min-height: 58px;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    border-bottom: 1px solid var(--border, #292a35);
  }

  .panel-header h2 {
    margin: 0;
    font-size: 12px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }

  .entity-count {
    display: block;
    margin-top: 3px;
    color: var(--text-muted, #858694);
    font-size: 10px;
  }

  .add-button,
  .delete-button {
    display: grid;
    place-items: center;
    border: 0;
    color: var(--text-muted, #858694);
    background: transparent;
    cursor: pointer;
  }

  .add-button {
    width: 28px;
    height: 28px;
    border: 1px solid var(--border, #323340);
    border-radius: 6px;
    font-size: 18px;
    line-height: 1;
  }

  .add-button:hover {
    color: var(--accent, #a995ff);
    border-color: var(--accent, #a995ff);
  }

  .entity-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 8px;
    list-style: none;
  }

  .entity-row {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 2px;
  }

  .select-button {
    display: flex;
    min-width: 0;
    min-height: 30px;
    flex: 1;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    overflow: hidden;
    border: 0;
    border-radius: 5px;
    color: var(--text-secondary, #b4b4c0);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .select-button:hover,
  .select-button.selected {
    color: var(--text-primary, #e9e9f0);
    background: var(--row-selected, #292638);
  }

  .select-button.selected .entity-icon {
    color: var(--accent, #a995ff);
  }

  .entity-icon {
    flex: none;
    color: var(--text-muted, #858694);
    font-size: 14px;
  }

  .entity-name {
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .delete-button {
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 5px;
    font-size: 16px;
    opacity: 0;
  }

  .entity-row:hover .delete-button,
  .delete-button:focus-visible {
    opacity: 1;
  }

  .delete-button:hover {
    color: #ff858d;
    background: #39252b;
  }

  .empty-state {
    margin: 0;
    padding: 18px 14px;
    color: var(--text-muted, #858694);
    font-size: 11px;
  }
</style>
