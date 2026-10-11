<script lang="ts">
  import { easeProgress, sampleEasing, type AnimationInterpolation, type BezierPoints } from "../../runtime/easing";

  interface Props {
    interpolation?: AnimationInterpolation;
    bezier?: BezierPoints;
    width?: number | string;
    height?: number | string;
    /** Draws a dot at this linear progress (0..1). */
    progress?: number | null;
    /** Dashed guides at the start and end values. */
    guides?: boolean;
    /** Fill the box instead of keeping the curve square (for timeline segments). */
    stretch?: boolean;
    strokeWidth?: number;
  }

  let { interpolation = "linear", bezier, width = 28, height = 20, progress = null, guides = false, stretch = false, strokeWidth = 1.6 }: Props = $props();

  // A shared vertical range so back, elastic, and bezier overshoot fit and every icon lines up.
  const yMin = -0.45;
  const yMax = 1.45;
  const pad = 8;
  const px = (t: number) => pad + t * (100 - 2 * pad);
  const py = (value: number) => pad + (1 - (value - yMin) / (yMax - yMin)) * (100 - 2 * pad);

  let path = $derived(sampleEasing(interpolation, bezier, 48)
    .map(([t, value], index) => `${index ? "L" : "M"}${px(t).toFixed(2)} ${py(Math.max(yMin, Math.min(yMax, value))).toFixed(2)}`)
    .join(" "));
  let dot = $derived(progress === null ? null : { x: px(progress), y: py(Math.max(yMin, Math.min(yMax, interpolation === "step" ? (progress >= 1 ? 1 : 0) : easeProgress(interpolation, progress, bezier)))) });
</script>

<svg class="easing-curve" viewBox="0 0 100 100" preserveAspectRatio={stretch ? "none" : "xMidYMid meet"} {width} {height} aria-hidden="true">
  {#if guides}
    <line class="guide" x1={pad} x2={100 - pad} y1={py(0)} y2={py(0)} />
    <line class="guide" x1={pad} x2={100 - pad} y1={py(1)} y2={py(1)} />
  {/if}
  <path d={path} stroke-width={strokeWidth} />
  {#if dot}<circle cx={dot.x} cy={dot.y} r="5" />{/if}
</svg>

<style>
  .easing-curve{display:block;overflow:visible;flex:none}
  path{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
  .guide{stroke:currentColor;stroke-width:1;stroke-dasharray:3 3;opacity:.22;vector-effect:non-scaling-stroke}
  circle{fill:#fff;stroke:currentColor;stroke-width:2;vector-effect:non-scaling-stroke}
</style>
