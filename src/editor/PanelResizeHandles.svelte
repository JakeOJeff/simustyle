<script lang="ts">
  export type ResizeEdge = "n" | "e" | "s" | "w" | "ne" | "nw" | "se" | "sw";
  type Dock = "left" | "right" | "top" | "bottom" | "floating";
  type Props = {
    panelName: string;
    dock: Dock;
    onResizeStart: (event: PointerEvent, edge: ResizeEdge) => void;
  };

  let { panelName, dock, onResizeStart }: Props = $props();
  let edges: ResizeEdge[] = $derived(dock === "floating"
    ? ["n", "e", "s", "w", "ne", "nw", "se", "sw"]
    : [dock === "left" ? "e" : dock === "right" ? "w" : dock === "top" ? "s" : "n"]);
  const edgeNames: Record<ResizeEdge, string> = {
    n: "top", e: "right", s: "bottom", w: "left", ne: "top-right", nw: "top-left", se: "bottom-right", sw: "bottom-left"
  };
</script>

<div class="resize-handles">
  {#each edges as edge}
    <button
      type="button"
      class="resize-handle edge-{edge}"
      aria-label="Resize {panelName} window from {edgeNames[edge]} edge"
      title="Resize window"
      onpointerdown={(event) => onResizeStart(event, edge)}
    ></button>
  {/each}
</div>

<style>
  .resize-handles{position:absolute;z-index:4;inset:0;pointer-events:none}
  .resize-handle{position:absolute;display:block;margin:0;padding:0;border:0;background:transparent;pointer-events:auto;touch-action:none}
  .resize-handle:hover{background:#a99aff35}
  .edge-n,.edge-s{right:10px;left:10px;height:7px;cursor:ns-resize}
  .edge-n{top:0}.edge-s{bottom:0}
  .edge-e,.edge-w{top:10px;bottom:10px;width:7px;cursor:ew-resize}
  .edge-e{right:0}.edge-w{left:0}
  .edge-ne,.edge-nw,.edge-se,.edge-sw{width:13px;height:13px}
  .edge-ne{top:0;right:0;cursor:nesw-resize}
  .edge-nw{top:0;left:0;cursor:nwse-resize}
  .edge-se{right:0;bottom:0;cursor:nwse-resize}
  .edge-sw{bottom:0;left:0;cursor:nesw-resize}
</style>
