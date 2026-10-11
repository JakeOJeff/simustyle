<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { ArrowDownToLine, ArrowRightFromLine, Flame, Heart, Lightbulb, MoveVertical, Palette, RotateCw, Sparkles, Vibrate, WavesHorizontal, Wind, X, Zap } from "@lucide/svelte";
  import { ANIMATION_PRESETS, PRESET_CATEGORY_LABELS, presetAvailable, presetTracks, type AnimationPreset, type PresetCategory } from "../../runtime/animationPresets";
  import { evaluateTrack } from "../../runtime/animator";
  import { interpolationLabel } from "../../runtime/easing";
  import type { Entity } from "../../scene/types";
  import { PreviewClock } from "./previewClock.svelte";
  import { anchoredPosition, portal } from "./portal";

  interface Props {
    entity: Entity;
    anchor: DOMRect;
    onApply: (presetId: string) => void;
    onClose: () => void;
  }

  let { entity, anchor, onApply, onClose }: Props = $props();

  const width = 380;
  const icons: Record<string, typeof Sparkles> = {
    bounce: MoveVertical, float: Wind, spin: RotateCw, swing: WavesHorizontal, pulse: Heart, shake: Vibrate, wobble: Vibrate,
    "pop-in": Sparkles, "drop-in": ArrowDownToLine, "slide-in": ArrowRightFromLine, "color-cycle": Palette, "glow-pulse": Flame, flicker: Zap
  };
  const categories = Object.keys(PRESET_CATEGORY_LABELS) as PresetCategory[];
  const requirementNames: Record<string, string> = { Material: "a Look (Material)", Light: "a Light", Transform: "a Transform" };

  // Previews use a neutral stand-in object so every card shows the preset's real track data.
  const sample: Entity = {
    id: "preview", name: "Preview", parent: null,
    components: { Transform: {}, Material: { color: "#8b7cff" }, Light: { intensity: 1 } }
  };
  const previewTracks = new Map(ANIMATION_PRESETS.map((preset) => [preset.id, presetTracks(preset, sample)]));

  let root: HTMLDivElement;
  let height = $state(460);
  let position = $derived(anchoredPosition(anchor, width, height));
  const clock = new PreviewClock(1.6, 0.5);

  function previewStyle(preset: AnimationPreset, progress: number): string {
    const tracks = previewTracks.get(preset.id) ?? [];
    let x = 0, y = 0, rotate = 0, spin = 1, sx = 1, sy = 1, color = "#8b7cff", glow = 0, emissive = "#8b7cff", opacity = 1;
    for (const track of tracks) {
      const value = evaluateTrack(track, progress * preset.duration);
      const key = `${track.component}.${track.field}`;
      if (key === "Transform.position" && Array.isArray(value)) { x = value[0] * 7; y = -value[1] * 6; }
      else if (key === "Transform.rotation" && Array.isArray(value)) { rotate = value[2]; spin = Math.cos((value[1] * Math.PI) / 180); }
      else if (key === "Transform.scale" && Array.isArray(value)) { sx = value[0]; sy = value[1]; }
      else if (key === "Material.color" && typeof value === "string") color = value;
      else if (key === "Material.emissive" && typeof value === "string") emissive = value;
      else if (key === "Material.emissiveIntensity" && typeof value === "number") glow = value * 7;
      else if (key === "Light.intensity" && typeof value === "number") { opacity = Math.max(0.15, Math.min(1, value)); glow = value * 12; emissive = "#ffd97a"; color = "#ffe9a8"; }
    }
    return `transform:translate(${x.toFixed(2)}px,${y.toFixed(2)}px) rotate(${rotate.toFixed(2)}deg) scale(${(sx * spin).toFixed(3)},${sy.toFixed(3)});` +
      `background:${color};opacity:${opacity};box-shadow:0 0 ${glow.toFixed(1)}px ${emissive}`;
  }

  function easingSummary(preset: AnimationPreset): string {
    const eases = new Set(previewTracks.get(preset.id)?.flatMap((track) => track.keys.slice(0, -1).map((key) => interpolationLabel(key.interpolation))) ?? []);
    return [...eases].slice(0, 2).join(" · ");
  }

  function closeOnOutside(event: PointerEvent) {
    if (root && !root.contains(event.target as Node)) onClose();
  }

  function measure(node: HTMLElement) {
    const observer = new ResizeObserver(() => height = node.offsetHeight);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  onMount(() => {
    clock.start();
    root.querySelector<HTMLElement>("button.card:not(:disabled)")?.focus({ preventScroll: true });
    const timer = setTimeout(() => window.addEventListener("pointerdown", closeOnOutside, true));
    return () => { clearTimeout(timer); window.removeEventListener("pointerdown", closeOnOutside, true); };
  });
  onDestroy(() => clock.stop());
</script>

<div class="preset-gallery" bind:this={root} use:portal use:measure role="dialog" aria-label="Animation presets" tabindex="-1"
  style="left:{position.left}px;top:{position.top}px;width:{width}px"
  onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
  <header>
    <span class="badge"><Sparkles size={13} /></span>
    <div><strong>Animation presets</strong><small>Applies to <b>{entity.name}</b>, starting from where it is now. Each one stays editable on the timeline.</small></div>
    <button class="close" type="button" aria-label="Close presets" onclick={onClose}><X size={13} /></button>
  </header>
  {#each categories as category (category)}
    {@const presets = ANIMATION_PRESETS.filter((preset) => preset.category === category)}
    <section>
      <div class="category">{PRESET_CATEGORY_LABELS[category]}{#if category === "entrance"}<small>plays once</small>{/if}</div>
      <div class="cards">
        {#each presets as preset (preset.id)}
          {@const Icon = icons[preset.id] ?? Sparkles}
          {@const available = presetAvailable(preset, entity)}
          <button type="button" class="card" disabled={!available}
            title={available ? `${preset.description} (${preset.duration}s)` : `Needs ${preset.requires.map((name) => requirementNames[name] ?? name).join(" and ")}`}
            onclick={() => onApply(preset.id)}>
            <span class="stage" aria-hidden="true">
              <span class="floor"></span>
              <i class="actor" class:light={preset.requires.includes("Light")} style={previewStyle(preset, clock.progress)}></i>
            </span>
            <span class="card-label"><Icon size={11} /> {preset.label}</span>
            <small>{available ? easingSummary(preset) : `Needs ${preset.requires.join(", ")}`}</small>
          </button>
        {/each}
      </div>
    </section>
  {/each}
  {#if entity.components.Light}<p class="note"><Lightbulb size={11} /> Lights have no shape, so motion presets move the light itself.</p>{/if}
</div>

<style>
  .preset-gallery{position:fixed;z-index:60;display:grid;gap:10px;max-height:calc(100vh - 16px);overflow:auto;padding:12px;border:1px solid #ffffff1a;border-radius:10px;background:#18181b;box-shadow:0 18px 50px #000a;color:#e1e1e3;font:11px 'DM Sans',sans-serif;outline:none;animation:pop .14s cubic-bezier(.2,.9,.1,1)}
  @keyframes pop{from{opacity:0;transform:translateY(-4px) scale(.98)}}
  header{display:grid;grid-template-columns:auto 1fr auto;align-items:start;gap:9px}
  .badge{display:grid;width:26px;height:26px;place-items:center;border-radius:7px;background:#7c6cf0;color:#fff}
  header div{display:grid;gap:3px}
  header strong{font-size:12.5px;font-weight:600;color:#f6f6f6}
  header small{color:#9a9aa4;font-size:10px;line-height:1.4}
  header b{color:#e9e9eb;font-weight:600}
  .close{display:grid;width:22px;height:22px;place-items:center;padding:0;border:0;border-radius:4px;background:transparent;color:#8d8d97;cursor:pointer}
  .close:hover{background:#ffffff12;color:#fff}
  section{display:grid;gap:6px}
  .category{display:flex;align-items:baseline;gap:6px;color:#8b84b5;font:9px 'DM Mono',monospace;letter-spacing:.1em;text-transform:uppercase}
  .category small{color:#6e6e7a;letter-spacing:0;text-transform:none;font-family:'DM Sans',sans-serif}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
  .card{display:grid;gap:4px;padding:5px 5px 6px;border:1px solid #ffffff0d;border-radius:7px;background:#17171a;color:#cfcbe0;text-align:left;cursor:pointer;transition:background .12s,border-color .12s,transform .12s}
  .card:hover:not(:disabled){background:#ffffff0d;border-color:#a99bff66;transform:translateY(-1px)}
  .card:disabled{opacity:.42;cursor:not-allowed}
  .stage{position:relative;display:grid;height:52px;place-items:center;overflow:hidden;border-radius:5px;background:radial-gradient(circle at 50% 120%,#26262c 0,#111113 75%)}
  .floor{position:absolute;left:10%;right:10%;bottom:9px;height:1px;background:#ffffff18}
  .actor{width:15px;height:15px;margin-top:8px;border-radius:3px;will-change:transform}
  .actor.light{border-radius:50%}
  .card-label{display:flex;align-items:center;gap:4px;font-size:10px;font-weight:600;color:#e9e9eb}
  .card-label :global(svg){color:#a99bff}
  .card small{overflow:hidden;color:#7e7e8a;font-size:8.5px;text-overflow:ellipsis;white-space:nowrap}
  .note{display:flex;align-items:center;gap:5px;margin:0;color:#898994;font-size:9.5px}
  button:focus-visible{outline:2px solid #a99bff;outline-offset:1px}
  @media (prefers-reduced-motion: reduce){.preset-gallery{animation:none}.card{transition:none}}
</style>
