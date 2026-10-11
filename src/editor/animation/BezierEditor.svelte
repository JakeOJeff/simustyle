<script lang="ts">
  import { BEZIER_PRESETS, sampleEasing, type BezierPoints } from "../../runtime/easing";
  import EasingCurve from "./EasingCurve.svelte";

  interface Props {
    points: BezierPoints;
    /** Live updates while a handle is dragged. */
    onInput: (points: BezierPoints) => void;
    /** Final value: on release, a typed number, or a preset. */
    onCommit: (points: BezierPoints) => void;
  }

  let { points, onInput, onCommit }: Props = $props();
  let dragging = $state<0 | 1 | null>(null);
  let svg: SVGSVGElement;

  const handles = [0, 1] as const;
  const size = 100;
  const pad = 14;
  // Room above and below the 0..1 box so overshooting handles stay grabbable.
  const yMin = -0.5;
  const yMax = 1.5;
  const px = (x: number) => pad + x * (size - 2 * pad);
  const py = (y: number) => pad + (1 - (y - yMin) / (yMax - yMin)) * (size - 2 * pad);
  const round = (value: number) => Math.round(value * 100) / 100;

  function pointFromEvent(event: PointerEvent): [number, number] {
    const bounds = svg.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width * size - pad) / (size - 2 * pad);
    const y = yMax - ((event.clientY - bounds.top) / bounds.height * size - pad) / (size - 2 * pad) * (yMax - yMin);
    return [round(Math.max(0, Math.min(1, x))), round(Math.max(yMin, Math.min(yMax, y)))];
  }

  function withHandle(handle: 0 | 1, [x, y]: [number, number]): BezierPoints {
    const next = [...points] as BezierPoints;
    next[handle * 2] = x;
    next[handle * 2 + 1] = y;
    return next;
  }

  function begin(event: PointerEvent, handle: 0 | 1) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    dragging = handle;
  }

  function move(event: PointerEvent) {
    if (dragging === null) return;
    onInput(withHandle(dragging, pointFromEvent(event)));
  }

  function end() {
    if (dragging === null) return;
    dragging = null;
    onCommit(points);
  }

  function nudge(event: KeyboardEvent, handle: 0 | 1) {
    const step = event.shiftKey ? 0.1 : 0.01;
    const [x, y] = [points[handle * 2]!, points[handle * 2 + 1]!];
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    onCommit(withHandle(handle, [round(Math.max(0, Math.min(1, x + delta[0]))), round(Math.max(yMin, Math.min(yMax, y + delta[1])))]));
  }

  function typed(index: number, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const next = [...points] as BezierPoints;
    next[index] = index % 2 === 0 ? Math.max(0, Math.min(1, value)) : Math.max(-2, Math.min(3, value));
    onCommit(next);
  }

  let curve = $derived(sampleEasing("bezier", points, 60).map(([t, value], index) => `${index ? "L" : "M"}${px(t).toFixed(2)} ${py(value).toFixed(2)}`).join(" "));
  let activePreset = $derived(BEZIER_PRESETS.find((preset) => preset.points.every((value, index) => Math.abs(value - points[index]!) < 0.005))?.id);
</script>

<div class="bezier-editor">
  <svg bind:this={svg} viewBox="0 0 {size} {size}" class:dragging={dragging !== null} role="group" aria-label="Bezier curve handles">
    <rect class="unit" x={px(0)} y={py(1)} width={px(1) - px(0)} height={py(0) - py(1)} />
    {#each [0.25, 0.5, 0.75] as line (line)}
      <line class="grid" x1={px(line)} x2={px(line)} y1={py(1)} y2={py(0)} />
      <line class="grid" x1={px(0)} x2={px(1)} y1={py(line)} y2={py(line)} />
    {/each}
    <line class="diagonal" x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} />
    <line class="arm" x1={px(0)} y1={py(0)} x2={px(points[0])} y2={py(points[1])} />
    <line class="arm" x1={px(1)} y1={py(1)} x2={px(points[2])} y2={py(points[3])} />
    <path class="curve" d={curve} />
    <circle class="anchor" cx={px(0)} cy={py(0)} r="2.4" />
    <circle class="anchor" cx={px(1)} cy={py(1)} r="2.4" />
    {#each handles as handle (handle)}
      <circle class="handle handle-{handle}" class:active={dragging === handle} cx={px(points[handle * 2]!)} cy={py(points[handle * 2 + 1]!)} r="4.6"
        role="slider" tabindex="0" aria-label="Handle {handle + 1}: arrow keys move it, Shift for larger steps" aria-valuenow={points[handle * 2 + 1]} aria-valuetext="x {points[handle * 2]}, y {points[handle * 2 + 1]}"
        onpointerdown={(event) => begin(event, handle)} onpointermove={move} onpointerup={end} onpointercancel={end} onkeydown={(event) => nudge(event, handle)} />
    {/each}
  </svg>

  <div class="bezier-values">
    {#each ["x1", "y1", "x2", "y2"] as name, index (name)}
      <label class:handle-a={index < 2} class:handle-b={index >= 2}><span>{name}</span>
        <input type="number" step="0.01" min={index % 2 === 0 ? 0 : -2} max={index % 2 === 0 ? 1 : 3} value={points[index]} onchange={(event) => typed(index, event.currentTarget.value)} />
      </label>
    {/each}
  </div>
  <code class="css-readout" title="Equivalent CSS timing function">cubic-bezier({points.join(", ")})</code>

  <div class="bezier-presets" role="group" aria-label="Bezier presets">
    {#each BEZIER_PRESETS as preset (preset.id)}
      <button type="button" class:active={activePreset === preset.id} title="{preset.label}: cubic-bezier({preset.points.join(', ')})" onclick={() => onCommit([...preset.points])}>
        <EasingCurve interpolation="bezier" bezier={preset.points} width={22} height={18} />
        <span>{preset.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .bezier-editor{display:grid;gap:8px}
  svg{width:100%;max-width:220px;aspect-ratio:1;justify-self:center;overflow:visible;touch-action:none;user-select:none}
  .unit{fill:#ffffff05;stroke:#ffffff1c;stroke-width:.4}
  .grid{stroke:#ffffff0d;stroke-width:.3}
  .diagonal{stroke:#ffffff26;stroke-width:.4;stroke-dasharray:1.5 1.5}
  .arm{stroke:#8f84c8;stroke-width:.5}
  .curve{fill:none;stroke:#c3b8ff;stroke-width:1.4;stroke-linecap:round}
  .anchor{fill:#2a2838;stroke:#8f84c8;stroke-width:.6}
  .handle{stroke:#fff;stroke-width:.8;cursor:grab;outline:none;transition:r .12s}
  .handle-0{fill:#ff8fb8}.handle-1{fill:#7fd1ff}
  .handle:hover,.handle:focus-visible,.handle.active{r:5.8}
  .handle:focus-visible{stroke:#ffe27a;stroke-width:1.2}
  svg.dragging,.handle.active{cursor:grabbing}
  .bezier-values{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
  .bezier-values label{display:flex;align-items:center;gap:3px;padding-left:5px;border:1px solid #ffffff12;border-radius:4px;background:#111217;overflow:hidden}
  .bezier-values span{font:9px 'DM Mono',monospace;color:#86838f}
  .bezier-values .handle-a span{color:#ff8fb8}.bezier-values .handle-b span{color:#7fd1ff}
  .bezier-values input{width:100%;min-width:0;height:23px;padding:0 4px;border:0;outline:none;background:transparent;color:#dedce7;text-align:right;font:10px 'DM Mono',monospace}
  .css-readout{justify-self:center;color:#86838f;font:9px 'DM Mono',monospace;user-select:all}
  .bezier-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
  .bezier-presets button{display:grid;justify-items:center;gap:2px;padding:5px 2px 4px;border:1px solid #ffffff0e;border-radius:5px;background:#16171d;color:#9d93dc;cursor:pointer}
  .bezier-presets button span{color:#9b99a6;font-size:8.5px;white-space:nowrap}
  .bezier-presets button:hover{background:#25233a;border-color:#7d6ff044}
  .bezier-presets button.active{background:#2f2a4a;border-color:#a99bff88;color:#d2c9ff}
  .bezier-presets button.active span{color:#e6e1ff}
  button:focus-visible,input:focus-visible{outline:2px solid #a99bff;outline-offset:1px}
</style>
