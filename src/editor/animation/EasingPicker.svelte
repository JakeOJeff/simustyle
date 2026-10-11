<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { X } from "@lucide/svelte";
  import {
    DEFAULT_BEZIER, EASING_DIRECTIONS, EASING_FAMILIES, directionLabel, easeProgress, familyLabel, interpolationLabel, parseFamilyEasing,
    type AnimationInterpolation, type BezierPoints, type EasingDirection, type EasingFamily
  } from "../../runtime/easing";
  import BezierEditor from "./BezierEditor.svelte";
  import EasingCurve from "./EasingCurve.svelte";
  import { PreviewClock } from "./previewClock.svelte";
  import { anchoredPosition, portal } from "./portal";

  interface Props {
    interpolation: AnimationInterpolation;
    bezier?: BezierPoints;
    /** The control that opened the picker; the popover sits next to it. */
    anchor: DOMRect;
    /** A short description of what is being eased, such as "Position · 1.00s → 2.50s". */
    context?: string;
    onChange: (interpolation: AnimationInterpolation, bezier?: BezierPoints) => void;
    onClose: () => void;
  }

  let { interpolation, bezier, anchor, context = "", onChange, onClose }: Props = $props();

  const width = 344;
  const familyHints: Record<EasingFamily, string> = {
    sine: "gentle", quad: "soft", cubic: "natural", quart: "strong", quint: "very strong",
    expo: "sharp", circ: "swift", back: "overshoots", elastic: "springy", bounce: "bouncy"
  };
  const directionHints: Record<EasingDirection, string> = { in: "starts slow, ends fast", out: "starts fast, ends slow", "in-out": "slow at both ends" };
  const basics: { value: AnimationInterpolation; hint: string }[] = [
    { value: "linear", hint: "Constant speed" },
    { value: "ease-in-out", hint: "Smooth start and stop" },
    { value: "step", hint: "Holds, then jumps at the next key" },
    { value: "bezier", hint: "Shape your own curve" }
  ];

  let root: HTMLDivElement;
  let height = $state(520);
  let hovered = $state<AnimationInterpolation | null>(null);
  let draftBezier = $state<BezierPoints | null>(null);
  // Opens on the current curve's direction; afterwards the tabs are the person's choice.
  let direction = $state<EasingDirection>(untrack(() => parseFamilyEasing(interpolation)?.direction ?? "out"));
  const clock = new PreviewClock();

  let shownInterpolation = $derived(hovered ?? interpolation);
  let shownBezier = $derived(draftBezier ?? bezier ?? DEFAULT_BEZIER);
  let position = $derived(anchoredPosition(anchor, width, height));
  let progress = $derived(clock.progress);
  let eased = $derived(shownInterpolation === "step" ? (progress >= 1 ? 1 : 0) : easeProgress(shownInterpolation, progress, shownBezier));
  let shownFamily = $derived(parseFamilyEasing(shownInterpolation));

  function choose(value: AnimationInterpolation) {
    hovered = null;
    if (value === "bezier") onChange("bezier", bezier ?? DEFAULT_BEZIER);
    else onChange(value);
    clock.restart();
  }

  function commitBezier(points: BezierPoints) {
    draftBezier = null;
    onChange("bezier", points);
  }

  function closeOnOutside(event: PointerEvent) {
    if (root && !root.contains(event.target as Node)) onClose();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
  }

  function measure(node: HTMLElement) {
    const observer = new ResizeObserver(() => height = node.offsetHeight);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  onMount(() => {
    clock.start();
    (root.querySelector<HTMLElement>("[aria-pressed='true']") ?? root.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    // Defer so the click that opened the picker does not immediately close it.
    const timer = setTimeout(() => window.addEventListener("pointerdown", closeOnOutside, true));
    return () => { clearTimeout(timer); window.removeEventListener("pointerdown", closeOnOutside, true); };
  });
  onDestroy(() => clock.stop());
</script>

<div class="easing-picker" bind:this={root} use:portal use:measure role="dialog" aria-label="Choose easing" tabindex="-1"
  style="left:{position.left}px;top:{position.top}px;width:{width}px" onkeydown={keydown}>
  <header class="picker-preview">
    <div class="preview-curve">
      <EasingCurve interpolation={shownInterpolation} bezier={shownBezier} width={92} height={92} progress={progress} guides strokeWidth={2} />
    </div>
    <div class="preview-copy">
      <div class="preview-title">
        <strong>{interpolationLabel(shownInterpolation)}</strong>
        <button class="close" type="button" aria-label="Close easing picker" onclick={onClose}><X size={13} /></button>
      </div>
      <p>{#if shownFamily}{familyHints[shownFamily.family]}, {directionHints[shownFamily.direction]}{:else}{basics.find((item) => item.value === shownInterpolation)?.hint ?? ""}{/if}</p>
      {#if context}<small class="context">{context}</small>{/if}
      <div class="motion-lane" aria-hidden="true" title="Top: this easing. Bottom: linear, for comparison.">
        <span class="track"></span>
        <i class="ghost" style="left:calc({progress * 100}% - 4px)"></i>
        <i class="mover" style="left:calc({Math.max(-0.2, Math.min(1.2, eased)) * 100}% - 6px)"></i>
      </div>
      <div class="scale-bar" aria-hidden="true"><i style="transform:scaleX({Math.max(0, Math.min(1.3, eased))})"></i></div>
    </div>
  </header>

  <div class="section-label">Basic</div>
  <div class="basic-grid" role="group" aria-label="Basic easings">
    {#each basics as item (item.value)}
      <button type="button" class="tile" aria-pressed={interpolation === item.value} title={item.hint}
        onpointerenter={() => hovered = item.value} onpointerleave={() => hovered = null} onfocus={() => hovered = item.value} onblur={() => hovered = null}
        onclick={() => choose(item.value)}>
        <EasingCurve interpolation={item.value} bezier={item.value === "bezier" ? shownBezier : undefined} width={30} height={24} />
        <span>{interpolationLabel(item.value).replace(" (hold)", "")}</span>
      </button>
    {/each}
  </div>

  <div class="family-heading">
    <span class="section-label">Easing curves</span>
    <div class="direction-tabs" role="tablist" aria-label="Easing direction">
      {#each EASING_DIRECTIONS as option (option)}
        <button type="button" role="tab" aria-selected={direction === option} title={directionHints[option]} onclick={() => direction = option}>{directionLabel(option)}</button>
      {/each}
    </div>
  </div>
  <div class="family-grid" role="group" aria-label="{directionLabel(direction)} easing curves">
    {#each EASING_FAMILIES as family (family)}
      {@const value = `ease-${direction}-${family}` as AnimationInterpolation}
      <button type="button" class="tile" aria-pressed={interpolation === value} title="{familyLabel(family)} {directionLabel(direction)}: {familyHints[family]}"
        onpointerenter={() => hovered = value} onpointerleave={() => hovered = null} onfocus={() => hovered = value} onblur={() => hovered = null}
        onclick={() => choose(value)}>
        <EasingCurve interpolation={value} width={30} height={24} />
        <span>{familyLabel(family)}</span>
      </button>
    {/each}
  </div>

  {#if interpolation === "bezier"}
    <div class="section-label">Custom curve <small>drag the pink and blue handles</small></div>
    <BezierEditor points={shownBezier} onInput={(points) => draftBezier = points} onCommit={commitBezier} />
  {/if}
</div>

<style>
  .easing-picker{position:fixed;z-index:60;display:grid;gap:8px;max-height:calc(100vh - 16px);overflow:auto;padding:10px;border:1px solid #ffffff1a;border-radius:10px;background:#18181b;box-shadow:0 18px 50px #000a,0 0 0 1px #00000040;color:#e1e1e3;font:11px 'DM Sans',sans-serif;outline:none;animation:pop .14s cubic-bezier(.2,.9,.1,1)}
  @keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
  .picker-preview{display:grid;grid-template-columns:auto 1fr;gap:10px;padding:8px;border:1px solid #ffffff0d;border-radius:8px;background:#141416}
  .preview-curve{display:grid;place-items:center;padding:2px;border-radius:6px;background:#111113;color:#a99bff}
  .preview-copy{display:flex;min-width:0;flex-direction:column;gap:5px}
  .preview-title{display:flex;align-items:center;justify-content:space-between;gap:6px}
  .preview-title strong{font-size:12.5px;font-weight:600;color:#f6f6f6}
  .preview-copy p{margin:0;color:#a7a7af;font-size:10px;line-height:1.35}
  .context{color:#7c7c89;font:9px 'DM Mono',monospace}
  .close{display:grid;width:22px;height:22px;flex:none;place-items:center;padding:0;border:0;border-radius:4px;background:transparent;color:#8d8d97;cursor:pointer}
  .close:hover{background:#ffffff12;color:#fff}
  .motion-lane{position:relative;height:26px;margin:auto 6px 0}
  .motion-lane .track{position:absolute;left:0;right:0;top:12px;height:2px;border-radius:2px;background:#ffffff14}
  .motion-lane i{position:absolute;border-radius:50%}
  .motion-lane .mover{top:1px;width:12px;height:12px;background:#b9adff;box-shadow:0 0 10px #a99bff99}
  .motion-lane .ghost{top:16px;width:8px;height:8px;background:#ffffff30}
  .scale-bar{height:5px;margin:0 6px 2px;border-radius:3px;background:#ffffff0c;overflow:visible}
  .scale-bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#7c6cf0,#7fd1ff);transform-origin:left}
  .section-label{color:#8b84b5;font:9px 'DM Mono',monospace;letter-spacing:.1em;text-transform:uppercase}
  .section-label small{margin-left:6px;color:#6e6e7a;letter-spacing:0;text-transform:none;font-family:'DM Sans',sans-serif}
  .basic-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
  .family-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
  .direction-tabs{display:flex;gap:2px;padding:2px;border:1px solid #ffffff10;border-radius:6px;background:#131315}
  .direction-tabs button{height:20px;padding:0 8px;border:0;border-radius:4px;background:transparent;color:#8d8d98;font-size:9.5px;cursor:pointer}
  .direction-tabs button:hover{color:#e9e9eb}
  .direction-tabs button[aria-selected="true"]{background:#3b3566;color:#e1dbff}
  .family-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}
  .tile{display:grid;justify-items:center;gap:3px;padding:6px 2px 5px;border:1px solid #ffffff0d;border-radius:6px;background:#17171a;color:#8f84d6;cursor:pointer;transition:background .12s,border-color .12s,transform .12s}
  .tile span{max-width:100%;overflow:hidden;color:#a1a1aa;font-size:9px;text-overflow:ellipsis;white-space:nowrap}
  .tile:hover{background:#ffffff0d;border-color:#7c6cf044;color:#c7bcff;transform:translateY(-1px)}
  .tile[aria-pressed="true"]{background:#3b3566;border-color:#a99bffaa;color:#e0d9ff;box-shadow:inset 0 0 0 1px #a99bff33}
  .tile[aria-pressed="true"] span{color:#f6f6f6}
  button:focus-visible{outline:2px solid #a99bff;outline-offset:1px}
  @media (prefers-reduced-motion: reduce){.easing-picker{animation:none}.tile{transition:none}}
</style>
