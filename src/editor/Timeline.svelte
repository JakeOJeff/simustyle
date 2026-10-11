<script lang="ts">
  import { onDestroy } from "svelte";
  import { ChevronDown, ChevronFirst, ChevronLast, Clapperboard, Diamond, DiamondPlus, Pause, Play, Plus, Repeat, SkipBack, SkipForward, Sparkles, Square, Trash, X } from "@lucide/svelte";
  import { componentSchemas } from "../registry";
  import { evaluateTrack, type AnimationKey, type AnimationTrack, type AnimationValue } from "../runtime/animator";
  import { interpolationLabel, type AnimationInterpolation, type BezierPoints } from "../runtime/easing";
  import type { Entity, Scene, Vec3 } from "../scene/types";
  import EasingCurve from "./animation/EasingCurve.svelte";
  import EasingPicker from "./animation/EasingPicker.svelte";
  import PresetGallery from "./animation/PresetGallery.svelte";
  import { fieldIcon, fieldLabel } from "./animation/fieldIcons";
  import { anchoredPosition, portal } from "./animation/portal";
  import { emitTutorial } from "./tutorial/tutorialState.svelte";

  interface Props {
    scene: Scene;
    selectedId: string | null;
    playhead: number;
    onPlayheadChange: (time: number) => void;
    onTrackChange: (tracks: AnimationTrack[]) => void;
    /** Loop and duration live on the Animator component. */
    onAnimatorChange: (fields: { loop?: boolean; duration?: number }) => void;
    onApplyPreset: (presetId: string) => void;
  }

  let { scene, selectedId, playhead, onPlayheadChange, onTrackChange, onAnimatorChange, onApplyPreset }: Props = $props();

  type KeyRef = { track: string; index: number };
  type Choice = { id: string; component: string; field: string };

  let previewPlaying = $state(false);
  let draggingKey = $state<{ trackIndex: number; keyIndex: number; time: number; moved: boolean } | null>(null);
  let selectedKey = $state<KeyRef | null>(null);
  let easingPopover = $state<{ ref: KeyRef; anchor: DOMRect } | null>(null);
  let presetAnchor = $state<DOMRect | null>(null);
  let propertyAnchor = $state<DOMRect | null>(null);
  let animationFrame = 0;
  let previousFrame = 0;

  const durationFallback = 5;
  const laneMinWidth = 420;

  const trackId = (track: { component: string; field: string }) => `${track.component}.${track.field}`;

  function tracksFor(entity: Entity | undefined): AnimationTrack[] {
    const raw = entity?.components.Animator?.tracks;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is AnimationTrack =>
      typeof item === "object" && item !== null &&
      typeof item.component === "string" && typeof item.field === "string" && Array.isArray(item.keys)
    ).map((track) => ({ ...track, keys: [...track.keys].sort((a, b) => a.time - b.time) }));
  }

  function durationFor(entity: Entity | undefined): number {
    const value = entity?.components.Animator?.duration;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : durationFallback;
  }

  function animatableFields(entity: Entity | undefined): Choice[] {
    if (!entity) return [];
    const result: Choice[] = [];
    for (const component of Object.keys(entity.components)) {
      const schema = componentSchemas[component];
      if (!schema) continue;
      for (const [field, definition] of Object.entries(schema.fields)) {
        if (definition.type === "float" || definition.type === "vec3" || definition.type === "color") result.push({ id: `${component}.${field}`, component, field });
      }
    }
    return result;
  }

  function cloneTracks(): AnimationTrack[] {
    return tracks.map((track) => ({ ...track, keys: track.keys.map((key) => ({ ...key })) }));
  }

  function emitTracks(next: AnimationTrack[]) {
    onTrackChange(next.map((track) => ({ ...track, keys: [...track.keys].sort((a, b) => a.time - b.time) })));
  }

  function clampTime(value: number, limit = duration): number {
    return Math.max(0, Math.min(limit, Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0));
  }

  function isAnimationValue(value: unknown): value is AnimationValue {
    return typeof value === "number" && Number.isFinite(value) || typeof value === "string" ||
      Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));
  }

  /** Keeps a value inside its field's range, so a key inserted on an overshooting curve stays valid. */
  function clampToField(component: string, field: string, value: AnimationValue): AnimationValue {
    const schema = componentSchemas[component]?.fields[field];
    const tidy = (part: number) => Math.round(part * 10000) / 10000;
    if (schema?.type === "float" && typeof value === "number") return tidy(Math.max(schema.min, Math.min(schema.max, value)));
    if (schema?.type === "vec3" && Array.isArray(value)) return value.map((part) => tidy(Math.max(schema.min ?? -Infinity, Math.min(schema.max ?? Infinity, part)))) as Vec3;
    return value;
  }

  function keyIndexAt(track: AnimationTrack, time: number): number {
    return track.keys.findIndex((key) => Math.abs(key.time - time) < 0.001);
  }

  /** The easing a new key inherits: whatever the key before it uses, so inserted keys keep the motion's style. */
  function inheritedEasing(track: AnimationTrack | undefined, time: number): Pick<AnimationKey, "interpolation" | "bezier"> {
    const before = track?.keys.filter((key) => key.time < time).at(-1);
    return before ? { interpolation: before.interpolation ?? "linear", ...(before.bezier ? { bezier: [...before.bezier] as BezierPoints } : {}) } : { interpolation: "linear" };
  }

  /** Key the Inspector's current value at the playhead (adding the track if needed). */
  function keyCurrentValue(component: string, field: string, next = cloneTracks()): AnimationTrack[] | null {
    const value = entity?.components[component]?.[field] ?? componentSchemas[component]?.fields[field]?.default;
    if (!isAnimationValue(value)) return null;
    let track = next.find((item) => item.component === component && item.field === field);
    if (!track) { track = { component, field, keys: [] }; next.push(track); }
    const time = currentTime;
    const existing = keyIndexAt(track, time);
    if (existing >= 0) track.keys[existing] = { ...track.keys[existing]!, value: structuredClone(value) };
    else track.keys.push({ time, value: structuredClone(value), ...inheritedEasing(track, time) });
    track.keys.sort((a, b) => a.time - b.time);
    return next;
  }

  function addProperty(choice: Choice) {
    propertyAnchor = null;
    const next = keyCurrentValue(choice.component, choice.field);
    if (next) emitTracks(next);
  }

  function keyTrackHere(trackIndex: number) {
    const track = tracks[trackIndex];
    if (!track) return;
    const next = keyCurrentValue(track.component, track.field);
    if (next) {
      emitTracks(next);
      selectedKey = { track: trackId(track), index: keyIndexAt(next.find((item) => trackId(item) === trackId(track))!, currentTime) };
    }
  }

  function keyAllTracks() {
    let next: AnimationTrack[] | null = cloneTracks();
    for (const track of tracks) next = next && keyCurrentValue(track.component, track.field, next);
    if (next) emitTracks(next);
  }

  /** Double-click a lane: add a key that sits exactly on the current motion, so nothing jumps. */
  function insertKeyOnCurve(event: MouseEvent, trackIndex: number) {
    const time = timeFromLane(event);
    const next = cloneTracks();
    const track = next[trackIndex];
    if (!track || keyIndexAt(track, time) >= 0) return;
    const value = evaluateTrack(track, time);
    if (value === undefined) return;
    track.keys.push({ time, value: clampToField(track.component, track.field, value), ...inheritedEasing(track, time) });
    track.keys.sort((a, b) => a.time - b.time);
    emitTracks(next);
    onPlayheadChange(time);
    selectedKey = { track: trackId(track), index: keyIndexAt(track, time) };
  }

  function setEasing(ref: KeyRef, interpolation: AnimationInterpolation, bezier?: BezierPoints) {
    const next = cloneTracks();
    const key = next.find((track) => trackId(track) === ref.track)?.keys[ref.index];
    if (!key) return;
    key.interpolation = interpolation;
    if (interpolation === "bezier" && bezier) key.bezier = [...bezier] as BezierPoints;
    else delete key.bezier;
    emitTracks(next);
    emitTutorial("easing", { interpolation });
  }

  function applyEasingToTrack(ref: KeyRef) {
    const next = cloneTracks();
    const track = next.find((item) => trackId(item) === ref.track);
    const source = track?.keys[ref.index];
    if (!track || !source) return;
    for (const key of track.keys.slice(0, -1)) {
      key.interpolation = source.interpolation ?? "linear";
      if (source.bezier) key.bezier = [...source.bezier] as BezierPoints;
      else delete key.bezier;
    }
    emitTracks(next);
    emitTutorial("easing", { interpolation: source.interpolation ?? "linear" });
  }

  function removeKey(ref: KeyRef) {
    const next = cloneTracks();
    const index = next.findIndex((track) => trackId(track) === ref.track);
    const track = next[index];
    if (!track) return;
    track.keys.splice(ref.index, 1);
    emitTracks(track.keys.length ? next : next.filter((_, position) => position !== index));
    selectedKey = null;
    easingPopover = null;
  }

  function removeTrack(trackIndex: number) {
    const removed = tracks[trackIndex];
    emitTracks(tracks.filter((_, index) => index !== trackIndex));
    if (removed && selectedKey?.track === trackId(removed)) selectedKey = null;
  }

  function setKeyTime(ref: KeyRef, raw: number) {
    emitTutorial("key-retime");
    const next = cloneTracks();
    const track = next.find((item) => trackId(item) === ref.track);
    const key = track?.keys[ref.index];
    if (!track || !key) return;
    const time = clampTime(raw);
    if (track.keys.some((other, index) => index !== ref.index && Math.abs(other.time - time) < 0.001)) return;
    key.time = time;
    track.keys.sort((a, b) => a.time - b.time);
    emitTracks(next);
    selectedKey = { track: ref.track, index: track.keys.indexOf(key) };
    onPlayheadChange(time);
  }

  // --- Playback -----------------------------------------------------------------

  function togglePreview() {
    if (previewPlaying) { previewPlaying = false; cancelAnimationFrame(animationFrame); return; }
    if (currentTime >= duration) onPlayheadChange(0);
    previousFrame = 0;
    previewPlaying = true;
    animationFrame = requestAnimationFrame(advancePreview);
  }

  function advancePreview(timestamp: number) {
    if (!previewPlaying) return;
    if (previousFrame) {
      const next = currentTime + (timestamp - previousFrame) / 1000;
      if (next >= duration) {
        if (loop) onPlayheadChange(next % duration);
        else { onPlayheadChange(duration); previewPlaying = false; return; }
      } else onPlayheadChange(next);
    }
    previousFrame = timestamp;
    animationFrame = requestAnimationFrame(advancePreview);
  }

  function stopPreview() {
    previewPlaying = false;
    cancelAnimationFrame(animationFrame);
    onPlayheadChange(0);
  }

  function jumpToKey(direction: -1 | 1) {
    const times = [...new Set(tracks.flatMap((track) => track.keys.map((key) => key.time)))].sort((a, b) => a - b);
    const target = direction < 0 ? times.filter((time) => time < currentTime - 0.001).at(-1) : times.find((time) => time > currentTime + 0.001);
    if (target !== undefined) onPlayheadChange(target);
  }

  // --- Key dragging and lane input ----------------------------------------------

  function timeFromLane(event: MouseEvent): number {
    const lane = (event.currentTarget as HTMLElement).closest(".key-lane") as HTMLElement;
    const bounds = lane.getBoundingClientRect();
    return clampTime(((event.clientX - bounds.left) / bounds.width) * duration);
  }

  function beginKeyDrag(event: PointerEvent, trackIndex: number, keyIndex: number) {
    if (event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    draggingKey = { trackIndex, keyIndex, time: tracks[trackIndex]?.keys[keyIndex]?.time ?? 0, moved: false };
    const track = tracks[trackIndex];
    if (track) selectedKey = { track: trackId(track), index: keyIndex };
  }

  function moveKeyDrag(event: PointerEvent) {
    if (!draggingKey) return;
    let time = timeFromLane(event);
    // Snap to whole tenths unless Alt is held, and to the playhead when close to it.
    if (!event.altKey) time = Math.round(time * 10) / 10;
    if (Math.abs(time - currentTime) < duration * 0.012) time = currentTime;
    const original = tracks[draggingKey.trackIndex]?.keys[draggingKey.keyIndex]?.time ?? time;
    if (draggingKey.moved || Math.abs(time - original) > 0.01) draggingKey = { ...draggingKey, time: clampTime(time), moved: true };
  }

  function finishKeyDrag() {
    if (!draggingKey) return;
    const drag = draggingKey;
    draggingKey = null;
    const track = tracks[drag.trackIndex];
    if (!track) return;
    if (!drag.moved) { onPlayheadChange(track.keys[drag.keyIndex]?.time ?? drag.time); return; }
    setKeyTime({ track: trackId(track), index: drag.keyIndex }, drag.time);
  }

  function seekLane(event: MouseEvent) {
    if (draggingKey) return;
    onPlayheadChange(timeFromLane(event));
  }

  function laneKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.01 : 0.1;
    if (event.key === "ArrowLeft") onPlayheadChange(clampTime(currentTime - step));
    else if (event.key === "ArrowRight") onPlayheadChange(clampTime(currentTime + step));
    else if (event.key === "Home") onPlayheadChange(0);
    else if (event.key === "End") onPlayheadChange(duration);
    else return;
    event.preventDefault();
  }

  function keyKeydown(event: KeyboardEvent, ref: KeyRef) {
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); removeKey(ref); }
    else if (event.key === "Enter") { event.preventDefault(); openEasing(ref, (event.currentTarget as HTMLElement).getBoundingClientRect()); }
    else if (event.key === "Escape") selectedKey = null;
  }

  function openEasing(ref: KeyRef, anchor: DOMRect) {
    selectedKey = ref;
    easingPopover = { ref, anchor };
  }

  onDestroy(() => cancelAnimationFrame(animationFrame));

  // --- Drawing helpers ----------------------------------------------------------

  function percent(time: number): string {
    return `${(clampTime(time) / duration) * 100}%`;
  }

  function ticks(limit: number): { time: number; major: boolean }[] {
    const major = limit <= 2 ? 0.5 : limit <= 10 ? 1 : limit <= 30 ? 5 : limit <= 120 ? 10 : 60;
    const minor = major / (major >= 5 ? 5 : 4);
    const values: { time: number; major: boolean }[] = [];
    for (let index = 0; index * minor <= limit + 1e-9; index += 1) {
      const time = Math.round(index * minor * 1000) / 1000;
      values.push({ time, major: Math.abs(time / major - Math.round(time / major)) < 1e-6 });
    }
    return values;
  }

  /** Seconds and hundredths, such as 04:50 for 4.5 seconds. */
  function clock(time: number): string {
    const hundredths = Math.round(Math.max(0, time) * 100);
    return `${String(Math.floor(hundredths / 100)).padStart(2, "0")}:${String(hundredths % 100).padStart(2, "0")}`;
  }

  function formatTick(time: number): string {
    return time >= 60 ? `${Math.floor(time / 60)}:${String(Math.round(time % 60)).padStart(2, "0")}` : `${Number(time.toFixed(2))}s`;
  }

  /** Whether a segment rises, falls, or holds, so its drawn curve points the right way. */
  function segmentDirection(from: AnimationValue, to: AnimationValue): 1 | -1 | 0 {
    let delta = 0;
    if (typeof from === "number" && typeof to === "number") delta = to - from;
    else if (Array.isArray(from) && Array.isArray(to)) {
      const deltas = from.map((value, index) => (to[index] ?? value) - value);
      delta = deltas.reduce((largest, value) => Math.abs(value) > Math.abs(largest) ? value : largest, 0);
    } else if (typeof from === "string" && typeof to === "string") {
      const light = (hex: string) => [1, 3, 5].reduce((sum, offset, index) => sum + Number.parseInt(hex.slice(offset, offset + 2), 16) * [0.299, 0.587, 0.114][index]!, 0);
      delta = from === to ? 0 : light(to) - light(from) || 1;
    }
    return Math.abs(delta) < 1e-9 ? 0 : delta > 0 ? 1 : -1;
  }

  function keyShape(key: AnimationKey, last: boolean): "diamond" | "circle" | "square" {
    if (last || !key.interpolation || key.interpolation === "linear") return "diamond";
    return key.interpolation === "step" ? "square" : "circle";
  }

  function formatValue(value: AnimationValue | undefined): string {
    if (typeof value === "number") return value.toFixed(2);
    if (Array.isArray(value)) return value.map((part) => Number(part.toFixed(2))).join(", ");
    return value ?? "";
  }

  let entity = $derived(scene.entities.find((candidate) => candidate.id === selectedId));
  let tracks = $derived(tracksFor(entity));
  let duration = $derived(durationFor(entity));
  let loop = $derived(entity?.components.Animator?.loop !== false);
  let choices = $derived(animatableFields(entity));
  let currentTime = $derived(clampTime(playhead));
  let selection = $derived.by(() => {
    if (!selectedKey) return null;
    const trackIndex = tracks.findIndex((track) => trackId(track) === selectedKey!.track);
    const track = tracks[trackIndex];
    const key = track?.keys[selectedKey.index];
    return track && key ? { track, trackIndex, key, index: selectedKey.index, next: track.keys[selectedKey.index + 1], ref: selectedKey } : null;
  });
  let easingTarget = $derived.by(() => {
    if (!easingPopover) return null;
    const track = tracks.find((item) => trackId(item) === easingPopover!.ref.track);
    const key = track?.keys[easingPopover.ref.index];
    const next = track?.keys[easingPopover.ref.index + 1];
    return track && key && next ? { track, key, next } : null;
  });

  // Forget a selected key when the object changes or the key disappears (undo, deletion).
  $effect(() => {
    selectedId;
    selectedKey = null;
    easingPopover = null;
    presetAnchor = null;
    propertyAnchor = null;
  });
  $effect(() => {
    if (selectedKey && !selection) selectedKey = null;
    if (easingPopover && !easingTarget) easingPopover = null;
  });
</script>

<section class="timeline" aria-label="Animation timeline">
  {#if !entity}
  <header class="idle-bar">
    <button class="icon" disabled aria-label="Play preview" title="Select an object to preview its animation"><Play size={12} fill="currentColor" /></button>
    <button class="icon" disabled aria-label="Add keyframe" title="Select an object, then press K to add a keyframe"><Diamond size={12} /></button>
    <span class="idle-time">{clock(0)} / {clock(duration)}</span>
  </header>
  <div class="idle-ruler" aria-hidden="true">
    {#each Array.from({ length: Math.floor(duration) + 1 }, (_, second) => second) as second (second)}<span style={`left:${percent(second)}`}>{second}s</span>{/each}
  </div>
  {:else}
  <header class="timeline-heading">
    <div class="heading-title">
      <span class="title-icon"><Clapperboard size={14} /></span>
      <div><span class="eyebrow">ANIMATION</span><strong>{entity?.name ?? "Timeline"}</strong></div>
    </div>
    {#if entity}
      <div class="transport" role="toolbar" aria-label="Timeline playback">
        <button class="icon" aria-label="Go to start" title="Go to start (Home)" onclick={() => onPlayheadChange(0)}><ChevronFirst size={14} /></button>
        <button class="icon" aria-label="Previous keyframe" title="Previous keyframe" onclick={() => jumpToKey(-1)}><SkipBack size={13} /></button>
        <button class="icon play" aria-label={previewPlaying ? "Pause preview" : "Play preview"} title={previewPlaying ? "Pause" : "Play the animation"} onclick={togglePreview}>
          {#if previewPlaying}<Pause size={13} fill="currentColor" />{:else}<Play size={13} fill="currentColor" />{/if}
        </button>
        <button class="icon" aria-label="Stop preview" title="Stop and go to start" onclick={stopPreview}><Square size={11} fill="currentColor" /></button>
        <button class="icon" aria-label="Next keyframe" title="Next keyframe" onclick={() => jumpToKey(1)}><SkipForward size={13} /></button>
        <button class="icon" aria-label="Go to end" title="Go to end (End)" onclick={() => onPlayheadChange(duration)}><ChevronLast size={14} /></button>
      </div>
      <div class="clip-settings">
        <button class="icon toggle" class:active={loop} aria-pressed={loop} aria-label="Loop" title={loop ? "Looping: the animation repeats. Click to play once." : "Plays once. Click to loop."} onclick={() => onAnimatorChange({ loop: !loop })}><Repeat size={13} /></button>
        <label class="number-field" title="Animation length in seconds"><span>LEN</span>
          <input aria-label="Animation length in seconds" type="number" min="0.1" max="600" step="0.1" value={duration} onchange={(event) => { const value = Number(event.currentTarget.value); if (Number.isFinite(value) && value >= 0.1 && value <= 600) onAnimatorChange({ duration: value }); else event.currentTarget.value = String(duration); }} /><em>s</em>
        </label>
        <label class="number-field time" title="Playhead time"><span>TIME</span>
          <input aria-label="Playhead time in seconds" type="number" min="0" max={duration} step="0.01" value={currentTime.toFixed(2)} onchange={(event) => onPlayheadChange(clampTime(Number(event.currentTarget.value)))} /><em>s</em>
        </label>
      </div>
      <div class="actions">
        <button class="action" disabled={!tracks.length} title="Key every animated property at the playhead" onclick={keyAllTracks}><DiamondPlus size={13} /><span>Key all</span></button>
        <button class="action" aria-haspopup="dialog" aria-expanded={propertyAnchor !== null} title="Animate another property" onclick={(event) => propertyAnchor = propertyAnchor ? null : event.currentTarget.getBoundingClientRect()}><Plus size={13} /><span>Property</span><ChevronDown size={11} /></button>
        <button class="action accent" aria-haspopup="dialog" aria-expanded={presetAnchor !== null} title="One-click animation presets" onclick={(event) => presetAnchor = presetAnchor ? null : event.currentTarget.getBoundingClientRect()}><Sparkles size={13} /><span>Presets</span></button>
      </div>
    {/if}
  </header>
  {/if}

  {#if entity}
    <div class="timeline-content">
      <div class="ruler-row">
        <div class="ruler-gutter"><span class="legend" title="Key shapes show the easing that leaves each key"><i class="glyph diamond"></i>linear <i class="glyph circle"></i>eased <i class="glyph square"></i>hold</span></div>
        <div class="ruler" style={`min-width:${laneMinWidth}px`} aria-label={`Timeline ruler from 0 to ${duration} seconds`}>
          {#each ticks(duration) as tick (tick.time)}
            <span class="tick" class:major={tick.major} style={`left:${percent(tick.time)}`}><i></i>{#if tick.major}<small>{formatTick(tick.time)}</small>{/if}</span>
          {/each}
          <div class="playhead" style={`left:${percent(currentTime)}`} aria-hidden="true"><b>{currentTime.toFixed(2)}</b></div>
          <input class="scrubber" data-tutorial-target="timeline-scrubber" type="range" aria-label="Scrub timeline playhead" min="0" max={duration} step="0.01" value={currentTime} oninput={(event) => onPlayheadChange(clampTime(Number(event.currentTarget.value)))} />
        </div>
      </div>

      {#if tracks.length}
        <div class="tracks">
          {#each tracks as track, trackIndex (trackId(track))}
            {@const Icon = fieldIcon(track.component, track.field)}
            {@const hereIndex = keyIndexAt(track, currentTime)}
            <div class="track-row" class:has-selection={selection?.trackIndex === trackIndex}>
              <div class="track-info">
                <span class="track-icon"><Icon size={13} /></span>
                <span class="track-name" title={`${track.component}.${track.field}`}><b>{fieldLabel(track.component, track.field)}</b><small>{track.component}</small></span>
                <button class="icon mini key-here" class:keyed={hereIndex >= 0} aria-label={hereIndex >= 0 ? `Update ${track.field} key at playhead` : `Add ${track.field} key at playhead`} title={hereIndex >= 0 ? "Update this key with the Inspector value" : "Key the Inspector value at the playhead"} onclick={() => keyTrackHere(trackIndex)}><Diamond size={12} fill={hereIndex >= 0 ? "currentColor" : "none"} /></button>
                <button class="icon mini remove" aria-label={`Remove ${track.component} ${track.field} track`} title="Remove track" onclick={() => removeTrack(trackIndex)}><Trash size={12} /></button>
              </div>
              <div class="key-lane" role="slider" tabindex="0" style={`min-width:${laneMinWidth}px`} aria-label={`Timeline for ${track.component} ${track.field}. Double-click to add a key on the curve.`} aria-valuemin="0" aria-valuemax={duration} aria-valuenow={currentTime}
                onkeydown={laneKeydown} onclick={seekLane} ondblclick={(event) => insertKeyOnCurve(event, trackIndex)}>
                {#each track.keys as key, keyIndex (`${key.time}-${keyIndex}`)}
                  {@const next = track.keys[keyIndex + 1]}
                  {@const dragged = draggingKey?.trackIndex === trackIndex && draggingKey.keyIndex === keyIndex}
                  {@const keyTime = dragged ? draggingKey!.time : key.time}
                  {#if next && !draggingKey}
                    {@const direction = segmentDirection(key.value, next.value)}
                    <div class="segment" class:falling={direction < 0} class:flat={direction === 0} class:selected-segment={selection?.trackIndex === trackIndex && selection.index === keyIndex} style={`left:${percent(key.time)};width:calc(${percent(next.time)} - ${percent(key.time)})`}>
                      {#if direction !== 0}<span class="segment-curve"><EasingCurve interpolation={key.interpolation ?? "linear"} bezier={key.bezier} width="100%" height="100%" stretch strokeWidth={1.4} /></span>{:else}<span class="segment-hold"></span>{/if}
                      <button class="ease-chip" title="{interpolationLabel(key.interpolation)}: click to change the easing" aria-label="Easing from {key.time.toFixed(2)}s: {interpolationLabel(key.interpolation)}. Change easing"
                        onclick={(event) => { event.stopPropagation(); openEasing({ track: trackId(track), index: keyIndex }, event.currentTarget.getBoundingClientRect()); }} ondblclick={(event) => event.stopPropagation()}>
                        <EasingCurve interpolation={key.interpolation ?? "linear"} bezier={key.bezier} width={16} height={12} strokeWidth={1.8} />
                      </button>
                    </div>
                  {/if}
                  <button class="key glyph {keyShape(key, !next)}" data-tutorial-target="timeline-key" class:at-playhead={Math.abs(keyTime - currentTime) < 0.001} class:selected={selection?.trackIndex === trackIndex && selection.index === keyIndex} class:dragging={dragged}
                    style={`left:${percent(keyTime)}`} aria-label={`Keyframe at ${key.time.toFixed(2)} seconds, ${interpolationLabel(key.interpolation)}. Drag to move, Delete to remove, Enter to change easing`} title={`${keyTime.toFixed(2)}s · ${formatValue(key.value)}`}
                    onpointerdown={(event) => beginKeyDrag(event, trackIndex, keyIndex)} onpointermove={moveKeyDrag} onpointerup={finishKeyDrag} onpointercancel={finishKeyDrag}
                    onclick={(event) => event.stopPropagation()} ondblclick={(event) => { event.stopPropagation(); if (next) openEasing({ track: trackId(track), index: keyIndex }, event.currentTarget.getBoundingClientRect()); }}
                    onkeydown={(event) => keyKeydown(event, { track: trackId(track), index: keyIndex })}>
                    {#if dragged}<span class="drag-time">{keyTime.toFixed(2)}s</span>{/if}
                  </button>
                {/each}
                <div class="current-line" style={`left:${percent(currentTime)}`} aria-hidden="true"></div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="start-card">
          <div class="start-art" aria-hidden="true">
            {#each ["ease-out-bounce", "ease-in-out-sine", "ease-out-back", "ease-in-out-expo"] as sample (sample)}
              <EasingCurve interpolation={sample as AnimationInterpolation} width={34} height={26} strokeWidth={1.8} />
            {/each}
          </div>
          <div class="start-copy">
            <strong>Bring {entity.name} to life</strong>
            <p>Pick a ready-made <b>preset</b>, or add a <b>property</b> and key its value at different times. You can also click <Diamond size={10} /> beside any Inspector field.</p>
          </div>
          <div class="start-actions">
            <button class="action accent" onclick={(event) => presetAnchor = event.currentTarget.getBoundingClientRect()}><Sparkles size={13} /><span>Browse presets</span></button>
            <button class="action" onclick={(event) => propertyAnchor = event.currentTarget.getBoundingClientRect()}><Plus size={13} /><span>Add property</span></button>
          </div>
        </div>
      {/if}
    </div>

    {#if selection}
      {@const Icon = fieldIcon(selection.track.component, selection.track.field)}
      <footer class="key-detail" aria-label="Selected keyframe">
        <span class="detail-name"><Icon size={12} /> {fieldLabel(selection.track.component, selection.track.field)} <small>key {selection.index + 1}/{selection.track.keys.length}</small></span>
        <label class="number-field" title="Key time"><span>AT</span>
          <input aria-label="Selected key time in seconds" type="number" min="0" max={duration} step="0.01" value={selection.key.time.toFixed(2)} onchange={(event) => setKeyTime(selection!.ref, Number(event.currentTarget.value))} /><em>s</em>
        </label>
        <span class="detail-value" title="Key value">
          {#if typeof selection.key.value === "string"}<i class="swatch" style={`background:${selection.key.value}`}></i>{/if}{formatValue(selection.key.value)}
        </span>
        {#if selection.next}
          <button class="ease-button" data-tutorial-target="timeline-ease" aria-haspopup="dialog" title="Easing toward the next key" onclick={(event) => openEasing(selection!.ref, event.currentTarget.getBoundingClientRect())}>
            <EasingCurve interpolation={selection.key.interpolation ?? "linear"} bezier={selection.key.bezier} width={22} height={16} />
            <span>{interpolationLabel(selection.key.interpolation)}</span><ChevronDown size={11} />
          </button>
          <button class="icon" aria-label="Use this easing for the whole track" title="Use this easing for every key on this track" onclick={() => applyEasingToTrack(selection!.ref)}><Repeat size={12} /></button>
        {:else}
          <span class="detail-hint">Last key: easing applies between keys</span>
        {/if}
        <span class="spacer"></span>
        <button class="icon danger" aria-label="Delete selected key" title="Delete key (Delete)" onclick={() => removeKey(selection!.ref)}><Trash size={12} /></button>
        <button class="icon" aria-label="Deselect key" title="Deselect" onclick={() => selectedKey = null}><X size={12} /></button>
      </footer>
    {/if}
  {:else}
    <div class="empty-state">
      <Diamond size={22} strokeWidth={1.6} />
      <strong>Nothing to animate yet</strong>
      <p>Select an object, then press <kbd>K</kbd> to add a keyframe.</p>
    </div>
  {/if}
</section>

{#if easingPopover && easingTarget}
  <EasingPicker
    interpolation={easingTarget.key.interpolation ?? "linear"}
    bezier={easingTarget.key.bezier}
    anchor={easingPopover.anchor}
    context={`${fieldLabel(easingTarget.track.component, easingTarget.track.field)} · ${easingTarget.key.time.toFixed(2)}s → ${easingTarget.next.time.toFixed(2)}s`}
    onChange={(interpolation, bezier) => easingPopover && setEasing(easingPopover.ref, interpolation, bezier)}
    onClose={() => easingPopover = null}
  />
{/if}

{#if presetAnchor && entity}
  <PresetGallery {entity} anchor={presetAnchor} onApply={(id) => { presetAnchor = null; onApplyPreset(id); }} onClose={() => presetAnchor = null} />
{/if}

{#if propertyAnchor && entity}
  {@const position = anchoredPosition(propertyAnchor, 236, Math.min(420, 44 + choices.length * 30))}
  <button class="popover-dismiss" type="button" aria-label="Close property menu" use:portal onclick={() => propertyAnchor = null}></button>
  <div class="property-menu" role="menu" tabindex="-1" aria-label="Animate a property" use:portal style={`left:${position.left}px;top:${position.top}px`}
    onkeydown={(event) => { if (event.key === "Escape") propertyAnchor = null; }}>
    <div class="menu-heading">Animate a property <small>keys the current value at {currentTime.toFixed(2)}s</small></div>
    {#each [...new Set(choices.map((choice) => choice.component))] as component (component)}
      <div class="menu-group">{component}</div>
      {#each choices.filter((choice) => choice.component === component) as choice (choice.id)}
        {@const Icon = fieldIcon(choice.component, choice.field)}
        {@const tracked = tracks.some((track) => trackId(track) === choice.id)}
        <button role="menuitem" onclick={() => addProperty(choice)} title={tracked ? "Already animated: adds or updates a key at the playhead" : `Start animating ${fieldLabel(choice.component, choice.field)}`}>
          <Icon size={13} /><span>{fieldLabel(choice.component, choice.field)}</span>{#if tracked}<Diamond size={10} fill="currentColor" class="tracked" />{/if}
        </button>
      {/each}
    {/each}
  </div>
{/if}

<style>
  .timeline{display:flex;flex-direction:column;min-height:190px;background:var(--window-bg,#1c1c1f);color:#d8d8dc;font:11px 'DM Sans',sans-serif;overflow:hidden}
  .timeline-heading{display:flex;flex:none;flex-wrap:wrap;align-items:center;gap:8px 12px;min-height:44px;padding:6px 12px;border-bottom:1px solid #ffffff0c}
  .heading-title{display:flex;align-items:center;gap:8px;min-width:0;margin-right:auto}
  .heading-title>div{display:grid;gap:1px;min-width:0}
  .heading-title strong{overflow:hidden;font-size:12px;font-weight:600;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
  .title-icon{display:grid;width:26px;height:26px;flex:none;place-items:center;border-radius:7px;background:#3b3566;color:#e1dbff}
  .eyebrow{font:8.5px 'DM Mono',monospace;letter-spacing:.12em;color:#8b84b5}
  .transport,.clip-settings,.actions{display:flex;align-items:center;gap:3px}
  .transport{padding:2px;border:1px solid #ffffff10;border-radius:8px;background:#131315}
  button{font:inherit;cursor:pointer}
  .icon{display:grid;width:26px;height:24px;place-items:center;padding:0;border:1px solid transparent;border-radius:5px;background:transparent;color:#a9a9b2;transition:background .12s,color .12s}
  .icon:hover:not(:disabled){background:#ffffff10;color:#fff}
  .icon.play{width:30px;background:#7c6cf0;color:#fff}
  .icon.play:hover{background:#8b7cf6}
  .icon.toggle{border-color:#ffffff10;background:#131315}
  .icon.toggle.active{border-color:#7c6cf066;background:#3b3566;color:#d4cdff}
  .icon.mini{width:22px;height:22px}
  .icon.danger:hover{background:#ff7a8720;color:#ff9ba2}
  .number-field{display:flex;align-items:center;gap:4px;height:24px;padding:0 6px;border:1px solid #ffffff12;border-radius:5px;background:#131315}
  .number-field span{color:#7c7c89;font:8.5px 'DM Mono',monospace;letter-spacing:.06em}
  .number-field input{width:44px;height:100%;padding:0;border:0;outline:none;background:transparent;color:#e4e4e6;text-align:right;font:10px 'DM Mono',monospace}
  .number-field em{color:#6e6e79;font:normal 9px 'DM Mono',monospace}
  .number-field:focus-within{border-color:#a99bff88}
  .action{display:flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#cfcbe0;font-size:10px;transition:background .12s,border-color .12s}
  .action:hover:not(:disabled){background:#2d2d33;border-color:#a99bff44;color:#fff}
  .action:disabled{opacity:.4;cursor:default}
  .action.accent{border-color:#7c6cf066;background:#3b3566;color:#e1dbff}
  .action.accent:hover{background:#463f78;border-color:#a99bff88}
  .action :global(svg){flex:none}

  .timeline-content{flex:1;min-height:0;overflow:auto}
  .ruler-row,.track-row{display:grid;grid-template-columns:190px minmax(0,1fr)}
  .ruler-row{position:sticky;top:0;z-index:4;background:var(--window-bg,#1c1c1f);border-bottom:1px solid #ffffff0c}
  .ruler-gutter{display:flex;align-items:flex-end;padding:0 10px 6px 12px;border-right:1px solid #ffffff0b}
  .legend{display:flex;align-items:center;gap:4px;color:#6e6e7a;font-size:8.5px}
  .legend .glyph.glyph{position:static;flex:none;width:7px;height:7px;margin-left:3px;transform:none;cursor:default}
  .legend .glyph.glyph.diamond{transform:rotate(45deg)}
  .ruler{position:relative;height:30px;margin-right:12px}
  .tick{position:absolute;top:0;height:100%;pointer-events:none}
  .tick i{position:absolute;bottom:0;width:1px;height:5px;background:#55555d}
  .tick.major i{height:9px;background:#797986}
  .tick small{position:absolute;top:5px;left:3px;color:#797986;font:9px 'DM Mono',monospace;white-space:nowrap}
  .playhead{position:absolute;z-index:2;top:0;bottom:0;width:1px;background:#a99bff;pointer-events:none}
  .playhead b{position:absolute;top:3px;left:50%;padding:1px 4px;transform:translateX(-50%);border-radius:3px;background:#a99bff;color:#19191d;font:600 8.5px 'DM Mono',monospace}
  .scrubber{position:absolute;inset:0;z-index:3;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize}
  .scrubber:focus-visible{opacity:.16;outline:2px solid #a99bff;outline-offset:-2px}

  .track-row{border-bottom:1px solid #ffffff09}
  .track-row.has-selection .track-info{background:#202025}
  .track-info{position:sticky;left:0;z-index:3;display:flex;align-items:center;gap:6px;min-width:0;height:36px;padding:0 6px 0 12px;border-right:1px solid #ffffff0b;background:#19191d}
  .track-icon{display:grid;width:22px;height:22px;flex:none;place-items:center;border-radius:5px;background:#28282d00;color:#a99bff}
  .track-name{display:grid;min-width:0;flex:1}
  .track-name b{overflow:hidden;color:#e2e2e4;font-size:10.5px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
  .track-name small{color:#75758280;color:#757582;font:8.5px 'DM Mono',monospace}
  .key-here{color:#7c7c89}
  .key-here.keyed{color:#c5b9ff}
  .remove{opacity:0}
  .track-info:hover .remove,.remove:focus-visible{opacity:1}
  .remove:hover{color:#ff9ba2!important}
  .key-lane{position:relative;height:36px;margin-right:12px;cursor:crosshair;outline:none;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#ffffff05 calc(10% - 1px),#ffffff05 10%)}
  .key-lane:focus-visible{box-shadow:inset 0 0 0 1px #a99bff66}
  .current-line{position:absolute;z-index:1;top:0;bottom:0;width:1px;background:#a99bff70;pointer-events:none}

  .segment{position:absolute;top:5px;bottom:5px;container-type:inline-size;pointer-events:none}
  .segment-curve{position:absolute;inset:0;color:#8b7cf6;opacity:.55}
  .segment.falling .segment-curve{transform:scaleY(-1)}
  .segment.selected-segment .segment-curve{color:#c5b9ff;opacity:.9}
  .segment::before{content:"";position:absolute;inset:0;border-radius:3px;background:linear-gradient(90deg,#7c6cf014,#7c6cf008)}
  .segment.selected-segment::before{background:linear-gradient(90deg,#7c6cf038,#7c6cf018)}
  .segment-hold{position:absolute;left:0;right:0;top:50%;border-top:1px dashed #8b7cf670}
  .ease-chip{position:absolute;top:50%;left:50%;z-index:2;display:grid;width:24px;height:18px;place-items:center;padding:0;transform:translate(-50%,-50%);border:1px solid #ffffff1c;border-radius:5px;background:#212125;color:#b9adff;pointer-events:auto;opacity:0;transition:opacity .12s,background .12s}
  .key-lane:hover .ease-chip,.selected-segment .ease-chip,.ease-chip:focus-visible{opacity:1}
  .ease-chip:hover{background:#3b3566;border-color:#a99bff88}
  @container (max-width: 40px){.ease-chip{display:none}}

  .glyph{position:absolute;z-index:3;top:50%;width:11px;height:11px;padding:0;border:1px solid #d0c7ff;background:#7c6cf0;cursor:grab;touch-action:none;transition:box-shadow .12s,background .12s}
  .glyph.diamond{transform:translate(-50%,-50%) rotate(45deg)}
  .glyph.circle{border-radius:50%;transform:translate(-50%,-50%);width:12px;height:12px}
  .glyph.square{border-radius:1px;transform:translate(-50%,-50%);width:10px;height:10px;background:#5a6bd1}
  .glyph:hover,.glyph.at-playhead{background:#c5b9ff;box-shadow:0 0 8px #a99bff80}
  .glyph.selected{z-index:4;border-color:#fff;background:#fff;box-shadow:0 0 0 2px #a99bff,0 0 12px #a99bffaa}
  .glyph.dragging{z-index:5;cursor:grabbing}
  .glyph:focus-visible{outline:2px solid #ffe27a;outline-offset:3px}
  .drag-time{position:absolute;bottom:calc(100% + 8px);left:50%;padding:1px 5px;border-radius:3px;background:#000c;color:#fff;font:9px 'DM Mono',monospace;white-space:nowrap;transform:translateX(-50%)}
  .glyph.diamond .drag-time{transform:rotate(-45deg) translate(-30%,-60%)}

  .start-card{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;margin:14px 12px;padding:14px;border:1px dashed #8b7cf640;border-radius:10px;background:#1c1c20}
  .start-art{display:grid;grid-template-columns:repeat(2,auto);gap:4px;padding:6px;border-radius:8px;background:#111113;color:#a99bff}
  .start-copy strong{font-size:12px;color:#f6f6f6}
  .start-copy p{margin:4px 0 0;color:#a7a7af;font-size:10.5px;line-height:1.5}
  .start-copy p :global(svg){vertical-align:-1px;color:#b9adff}
  .start-copy b{color:#e0dbff;font-weight:600}
  .start-actions{display:grid;gap:5px}

  .key-detail{display:flex;flex:none;flex-wrap:wrap;align-items:center;gap:8px;min-height:38px;padding:5px 12px;border-top:1px solid #ffffff10;background:#1e1e22}
  .detail-name{display:flex;align-items:center;gap:6px;color:#e2e2e4;font-size:10.5px;font-weight:600}
  .detail-name :global(svg){color:#a99bff}
  .detail-name small{color:#77748a;font:9px 'DM Mono',monospace;font-weight:400}
  .detail-value{display:flex;align-items:center;gap:5px;max-width:200px;overflow:hidden;color:#b7b7bd;font:10px 'DM Mono',monospace;text-overflow:ellipsis;white-space:nowrap}
  .swatch{width:11px;height:11px;flex:none;border:1px solid #ffffff30;border-radius:3px}
  .ease-button{display:flex;align-items:center;gap:6px;height:26px;padding:0 8px 0 5px;border:1px solid #8b7cf655;border-radius:6px;background:#3b3566;color:#b9adff;font-size:10px}
  .ease-button span{color:#e6e1ff}
  .ease-button:hover{background:#463f78;border-color:#a99bff99}
  .detail-hint{color:#77748a;font-size:9.5px}
  .spacer{flex:1}
  .empty-state{display:grid;flex:1;place-items:center;align-content:center;gap:8px;padding:24px 16px;color:#8d8d97;text-align:center}
  .empty-state strong{margin-top:4px;color:#ececed;font-size:12.5px;font-weight:500}
  .empty-state p{max-width:260px;margin:0;font-size:12px;line-height:1.6;color:#9a9aa4}
  .empty-state kbd{display:inline-grid;min-width:20px;height:20px;place-items:center;margin:0 2px;padding:0 5px;border:1px solid #ffffff1f;border-radius:4px;background:#ffffff08;color:#ececed;font:11px 'DM Mono',monospace}

  .idle-bar{display:flex;flex:none;align-items:center;gap:4px;height:38px;padding:0 10px 0 8px;border-bottom:1px solid #ffffff0c}
  .idle-bar .icon:disabled{color:#6e6e79;cursor:default}
  .idle-time{margin-left:auto;color:#8d8d97;font:11px 'DM Mono',monospace;letter-spacing:.02em}
  .idle-ruler{position:relative;flex:none;height:26px;margin:0 14px;border-bottom:1px solid #ffffff0c}
  .idle-ruler span{position:absolute;top:7px;transform:translateX(-50%);color:#6e6e79;font:10px 'DM Mono',monospace}
  .idle-ruler span:first-child{transform:none}.idle-ruler span:last-child{transform:translateX(-100%)}

  .popover-dismiss{position:fixed;inset:0;z-index:58;border:0;background:transparent;cursor:default}
  .property-menu{position:fixed;z-index:59;display:grid;width:236px;max-height:420px;overflow:auto;padding:4px;border:1px solid #ffffff1a;border-radius:9px;background:#18181b;box-shadow:0 10px 28px #0009;font:11px 'DM Sans',sans-serif;animation:pop .12s cubic-bezier(.2,.9,.1,1)}
  @keyframes pop{from{opacity:0;transform:translateY(-4px)}}
  .menu-heading{display:grid;gap:2px;padding:6px 8px 7px;border-bottom:1px solid #ffffff10;color:#e9e9eb;font-weight:600}
  .menu-heading small{color:#7c7c89;font-size:9.5px;font-weight:400}
  .menu-group{padding:7px 8px 3px;color:#8b84b5;font:8.5px 'DM Mono',monospace;letter-spacing:.1em;text-transform:uppercase}
  .property-menu button{display:flex;align-items:center;gap:8px;height:28px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:#e1e1e3;text-align:left;font-size:10.5px}
  .property-menu button span{flex:1}
  .property-menu button :global(svg){color:#a99bff}
  .property-menu button:hover{background:#ffffff12;color:#fff}
  .property-menu :global(.tracked){color:#c5b9ff}
  button:focus-visible,input:focus-visible{outline:2px solid #a99bff;outline-offset:1px}
  /* Compact layout when the panel is narrow, such as docked beside the Console. */
  .timeline{container-type:inline-size}
  @container (max-width: 620px){
    .ruler-row,.track-row{grid-template-columns:128px minmax(0,1fr)}
    .key-lane,.ruler{min-width:160px!important}
    .track-info .remove{display:none}
    .track-info:hover .remove,.track-info .remove:focus-visible{display:grid}
    .legend,.track-name small,.heading-title .eyebrow{display:none}
    .action span{display:none}
    .action{padding:0 7px}
    .track-info{padding-left:8px;gap:4px}
    .start-card{grid-template-columns:1fr}
    .start-art{display:none}
    .start-actions{grid-auto-flow:column;justify-content:start}
  }
  @media (prefers-reduced-motion: reduce){.property-menu{animation:none}}
</style>
