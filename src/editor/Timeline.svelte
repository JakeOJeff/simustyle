<script module lang="ts">
  /** A single animation key. Values follow the component field type. */
  export type TimelineInterpolation = "linear" | "ease-in-out" | "step";
  export type TimelineValue = number | [number, number, number] | string;
  export interface TimelineKey {
    time: number;
    value: TimelineValue;
    interpolation: TimelineInterpolation;
  }
  /** Animator.tracks stores component/field references and their ordered keys. */
  export interface TimelineTrack {
    component: string;
    field: string;
    keys: TimelineKey[];
  }
</script>

<script lang="ts">
  import { onDestroy } from "svelte";
  import { componentSchemas } from "../registry";
  import type { Entity, Scene } from "../scene/types";

  interface Props {
    scene: Scene;
    selectedId: string | null;
    playhead: number;
    onPlayheadChange: (time: number) => void;
    onTrackChange: (tracks: TimelineTrack[]) => void;
  }

  let { scene, selectedId, playhead, onPlayheadChange, onTrackChange }: Props = $props();
  let addTrack = $state("");
  let previewPlaying = $state(false);
  let draggingKey = $state<{ trackIndex: number; keyIndex: number; time: number; moved: boolean } | null>(null);
  let animationFrame = 0;
  let previousFrame = 0;

  const durationFallback = 5;
  const rulerMinWidth = 560;

  function selectedEntity(): Entity | undefined {
    return scene.entities.find((entity) => entity.id === selectedId);
  }

  function tracksFor(entity: Entity | undefined): TimelineTrack[] {
    const raw = entity?.components.Animator?.tracks;
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is TimelineTrack =>
      typeof item === "object" && item !== null &&
      typeof item.component === "string" && typeof item.field === "string" && Array.isArray(item.keys)
    ).map((track) => ({ ...track, keys: [...track.keys].sort((a, b) => a.time - b.time) }));
  }

  function durationFor(entity: Entity | undefined): number {
    const duration = entity?.components.Animator?.duration;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : durationFallback;
  }

  function animatableFields(entity: Entity | undefined): { id: string; component: string; field: string; label: string }[] {
    if (!entity) return [];
    const result: { id: string; component: string; field: string; label: string }[] = [];
    for (const [component, values] of Object.entries(entity.components)) {
      const schema = componentSchemas[component];
      if (!schema) continue;
      for (const [field, definition] of Object.entries(schema.fields)) {
        if (definition.type !== "float" && definition.type !== "vec3" && definition.type !== "color") continue;
        result.push({ id: `${component}.${field}`, component, field, label: `${component} · ${field}` });
      }
    }
    return result;
  }

  function emitTracks(next: TimelineTrack[]) {
    onTrackChange(next.map((track) => ({
      ...track,
      keys: [...track.keys].sort((a, b) => a.time - b.time)
    })));
  }

  function addOrUpdateKey(component: string, field: string) {
    const entity = selectedEntity();
    if (!entity) return;
    const currentTracks = tracksFor(entity).map((track) => ({ ...track, keys: [...track.keys] }));
    let track = currentTracks.find((item) => item.component === component && item.field === field);
    if (!track) {
      track = { component, field, keys: [] };
      currentTracks.push(track);
    }
    const time = clampTime(playhead, durationFor(entity));
    const existing = track.keys.findIndex((key) => Math.abs(key.time - time) < 0.001);
    const value = entity.components[component]?.[field];
    if (!isTimelineValue(value)) return;
    const key = { time, value: structuredClone(value), interpolation: "linear" as const };
    if (existing >= 0) track.keys[existing] = { ...track.keys[existing], value };
    else track.keys.push(key);
    emitTracks(currentTracks);
    addTrack = "";
  }

  function updateKey(trackIndex: number, keyIndex: number, patch: Partial<TimelineTrack["keys"][number]>) {
    const currentTracks = tracksFor(selectedEntity()).map((track) => ({ ...track, keys: [...track.keys] }));
    const track = currentTracks[trackIndex];
    if (!track?.keys[keyIndex]) return;
    track.keys[keyIndex] = { ...track.keys[keyIndex], ...patch };
    emitTracks(currentTracks);
  }

  function removeKey(trackIndex: number, keyIndex: number) {
    const currentTracks = tracksFor(selectedEntity()).map((track) => ({ ...track, keys: [...track.keys] }));
    const track = currentTracks[trackIndex];
    if (!track) return;
    track.keys.splice(keyIndex, 1);
    const next = track.keys.length ? currentTracks : currentTracks.filter((_, index) => index !== trackIndex);
    emitTracks(next);
  }

  function removeTrack(trackIndex: number) {
    emitTracks(tracksFor(selectedEntity()).filter((_, index) => index !== trackIndex));
  }

  function clampTime(value: number, duration: number): number {
    return Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0));
  }

  function isTimelineValue(value: unknown): value is TimelineValue {
    return typeof value === "number" && Number.isFinite(value) || typeof value === "string" ||
      Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === "number" && Number.isFinite(part));
  }

  function handleScrub(event: Event, duration: number) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onPlayheadChange(clampTime(value, duration));
  }

  function togglePreview() {
    if (previewPlaying) {
      previewPlaying = false;
      cancelAnimationFrame(animationFrame);
      return;
    }
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
        if (entity?.components.Animator?.loop !== false) onPlayheadChange(next % duration);
        else {
          onPlayheadChange(duration);
          previewPlaying = false;
          return;
        }
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

  function beginKeyDrag(event: PointerEvent, trackIndex: number, keyIndex: number) {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
    draggingKey = { trackIndex, keyIndex, time: tracks[trackIndex]?.keys[keyIndex]?.time ?? 0, moved: false };
  }

  function moveKeyDrag(event: PointerEvent) {
    if (!draggingKey) return;
    const lane = (event.currentTarget as HTMLElement).parentElement;
    if (!lane) return;
    const bounds = lane.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    const time = clampTime(ratio * duration, duration);
    if (Math.abs(time - (tracks[draggingKey.trackIndex]?.keys[draggingKey.keyIndex]?.time ?? time)) > 0.01) {
      draggingKey = { ...draggingKey, time, moved: true };
    }
  }

  function finishKeyDrag() {
    if (!draggingKey) return;
    const drag = draggingKey;
    draggingKey = null;
    if (!drag.moved) {
      onPlayheadChange(tracks[drag.trackIndex]?.keys[drag.keyIndex]?.time ?? drag.time);
      return;
    }
    const currentTracks = tracksFor(selectedEntity()).map((track) => ({ ...track, keys: [...track.keys] }));
    const key = currentTracks[drag.trackIndex]?.keys[drag.keyIndex];
    if (!key) return;
    key.time = drag.time;
    currentTracks[drag.trackIndex]!.keys.sort((first, second) => first.time - second.time);
    emitTracks(currentTracks);
    onPlayheadChange(drag.time);
  }

  function seekLane(event: MouseEvent) {
    if (draggingKey) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onPlayheadChange(clampTime(((event.clientX - bounds.left) / bounds.width) * duration, duration));
  }

  function seekLaneWithKeyboard(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.01 : 0.1;
    if (event.key === "ArrowLeft") onPlayheadChange(clampTime(currentTime - step, duration));
    else if (event.key === "ArrowRight") onPlayheadChange(clampTime(currentTime + step, duration));
    else if (event.key === "Home") onPlayheadChange(0);
    else if (event.key === "End") onPlayheadChange(duration);
    else return;
    event.preventDefault();
  }

  onDestroy(() => cancelAnimationFrame(animationFrame));

  function keyPosition(time: number, duration: number): string {
    return `${(clampTime(time, duration) / duration) * 100}%`;
  }

  function ticks(duration: number): number[] {
    const step = duration <= 10 ? 1 : duration <= 30 ? 5 : 10;
    const values: number[] = [];
    for (let time = 0; time <= duration; time += step) values.push(time);
    if (values.at(-1) !== duration) values.push(duration);
    return values;
  }

  let entity = $derived(selectedEntity());
  let tracks = $derived(tracksFor(entity));
  let duration = $derived(durationFor(entity));
  let choices = $derived(animatableFields(entity).filter((field) =>
    !tracks.some((track) => track.component === field.component && track.field === field.field)
  ));
  let currentTime = $derived(clampTime(playhead, duration));
</script>

<section class="timeline" aria-label="Animation timeline">
  <header class="timeline-heading">
    <div class="timeline-title"><span class="eyebrow">ANIMATION</span><strong>Timeline</strong>
      {#if entity}
        <div class="transport" aria-label="Timeline preview controls">
          <button aria-label="Stop preview" title="Stop" onclick={stopPreview}>■</button>
          <button class="play-toggle" aria-label={previewPlaying ? "Pause preview" : "Play preview"} title={previewPlaying ? "Pause" : "Play"} onclick={togglePreview}>{previewPlaying ? "Ⅱ" : "▶"}</button>
        </div>
      {/if}
    </div>
    <label class="time-readout">TIME <input aria-label="Playhead time in seconds" type="number" min="0" max={duration} step="0.01" value={currentTime.toFixed(2)} onchange={(event) => onPlayheadChange(clampTime(Number(event.currentTarget.value), duration))} /> <span>s</span></label>
  </header>

  {#if entity}
    <div class="timeline-content">
      <div class="ruler-wrap">
        <div class="ruler" style={`min-width:${rulerMinWidth}px`} aria-label={`Timeline ruler from 0 to ${duration} seconds`}>
          {#each ticks(duration) as tick (tick)}
            <span class="tick" style={`left:${keyPosition(tick, duration)}`}><i></i><small>{tick.toFixed(tick % 1 ? 1 : 0)}s</small></span>
          {/each}
          <div class="playhead-line" style={`left:${keyPosition(currentTime, duration)}`} aria-hidden="true"></div>
          <input class="scrubber" type="range" aria-label="Scrub timeline playhead" min="0" max={duration} step="0.01" value={currentTime} oninput={(event) => handleScrub(event, duration)} />
        </div>
      </div>

      {#if tracks.length}
        <div class="tracks" style={`min-width:${rulerMinWidth}px`}>
          {#each tracks as track, trackIndex (`${track.component}.${track.field}`)}
            <section class="track-row" aria-label={`${track.component} ${track.field} track`}>
              <div class="track-info">
                <span class="track-name" title={`${track.component}.${track.field}`}>{track.component}<small>{track.field}</small></span>
                <button class="remove-track" aria-label={`Remove ${track.component} ${track.field} track`} title="Remove track" onclick={() => removeTrack(trackIndex)}>×</button>
              </div>
              <div class="key-lane" role="slider" tabindex="0" aria-label={`Timeline for ${track.component} ${track.field}`} aria-valuemin="0" aria-valuemax={duration} aria-valuenow={currentTime} onkeydown={seekLaneWithKeyboard} onclick={seekLane}>
                <div class="current-line" style={`left:${keyPosition(currentTime, duration)}`} aria-hidden="true"></div>
                {#each [...track.keys].sort((a, b) => a.time - b.time) as key, keyIndex (`${key.time}-${keyIndex}`)}
                  {@const keyTime = draggingKey?.trackIndex === trackIndex && draggingKey.keyIndex === keyIndex ? draggingKey.time : key.time}
                  <button class="diamond" class:active={Math.abs(keyTime - currentTime) < 0.025} class:dragging={draggingKey?.trackIndex === trackIndex && draggingKey.keyIndex === keyIndex} style={`left:${keyPosition(keyTime, duration)}`} aria-label={`Keyframe at ${key.time.toFixed(2)} seconds; drag to move`} title={`${keyTime.toFixed(2)}s · drag to move`} onpointerdown={(event) => beginKeyDrag(event, trackIndex, keyIndex)} onpointermove={moveKeyDrag} onpointerup={finishKeyDrag} onpointercancel={finishKeyDrag}></button>
                {/each}
              </div>
              <div class="key-controls">
                {#each [...track.keys].sort((a, b) => a.time - b.time) as key, keyIndex (`${key.time}-${keyIndex}`)}
                  <div class="key-control">
                    <button class="key-time" aria-label={`Move playhead to keyframe at ${key.time.toFixed(2)} seconds`} onclick={() => onPlayheadChange(key.time)}>{key.time.toFixed(2)}s</button>
                    <label><span class="sr-only">Interpolation at {key.time.toFixed(2)} seconds</span>
                      <select aria-label={`Interpolation at ${key.time.toFixed(2)} seconds`} value={key.interpolation ?? "linear"} onchange={(event) => updateKey(trackIndex, keyIndex, { interpolation: event.currentTarget.value as TimelineInterpolation })}>
                        <option value="linear">Linear</option><option value="ease-in-out">Ease in-out</option><option value="step">Step</option>
                      </select>
                    </label>
                    <button class="remove-key" aria-label={`Remove keyframe at ${key.time.toFixed(2)} seconds`} title="Remove keyframe" onclick={() => removeKey(trackIndex, keyIndex)}>×</button>
                  </div>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {:else}
        <p class="empty-state">No animation tracks yet. Add a track, then key the current value at the playhead.</p>
      {/if}

      <div class="track-actions">
        <label class="sr-only" for="add-animation-track">Property to animate</label>
        <select id="add-animation-track" bind:value={addTrack}>
          <option value="">Add animatable property…</option>
          {#each choices as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}
        </select>
        <button class="add-track" disabled={!addTrack} onclick={() => { const [component, field] = addTrack.split("."); if (component && field) addOrUpdateKey(component, field); }}>Add key</button>
        <span class="hint">Keys use the value currently shown in the Inspector.</span>
      </div>
    </div>
  {:else}
    <p class="empty-state">Select an entity with animatable properties to edit its timeline.</p>
  {/if}
</section>

<style>
  .timeline{display:flex;flex-direction:column;min-height:190px;background:#17181f;color:#d7d5df;border-top:1px solid #ffffff12;font:11px 'DM Sans',sans-serif;overflow:hidden}
  .timeline-heading{height:43px;flex:0 0 43px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #ffffff0c}
  .timeline-heading>div{display:flex;align-items:center;gap:10px}.timeline-heading strong{font-size:12px;font-weight:600}.eyebrow{font:9px 'DM Mono',monospace;letter-spacing:.12em;color:#8b84b5}.timeline-title{display:flex;align-items:center;gap:10px}.transport{display:flex;align-items:center;gap:3px;padding-left:8px;border-left:1px solid #ffffff12}.transport button{width:25px;height:23px;border:1px solid #ffffff12;border-radius:4px;background:#20212a;color:#aaa7b4;font-size:10px;cursor:pointer}.transport button:hover{background:#302b42;color:#e3ddff}.transport .play-toggle{color:#c1b5ff}
  .time-readout{display:flex;align-items:center;gap:5px;font:9px 'DM Mono',monospace;color:#858391}.time-readout input{width:61px;height:24px;padding:0 5px;border:1px solid #ffffff17;border-radius:4px;background:#111217;color:#dedce7;text-align:right;font:10px 'DM Mono',monospace}.time-readout span{color:#777582}
  .timeline-content{min-height:0;overflow:auto}.ruler-wrap{padding-left:172px;padding-right:14px;border-bottom:1px solid #ffffff0c;overflow:hidden}.ruler{height:43px;position:relative;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#ffffff08 calc(10% - 1px),#ffffff08 10%)}
  .tick{position:absolute;top:0;height:100%;transform:translateX(-50%);pointer-events:none}.tick:first-child{transform:none}.tick i{display:block;width:1px;height:8px;background:#6f6d7b}.tick small{position:absolute;top:12px;left:50%;transform:translateX(-50%);color:#767482;font:9px 'DM Mono',monospace;white-space:nowrap}.tick:first-child small{left:0;transform:none}.playhead-line,.current-line{position:absolute;z-index:2;top:0;bottom:0;width:1px;background:#a99bff;pointer-events:none}.playhead-line:before{content:"";position:absolute;top:0;left:-4px;width:9px;height:7px;background:#a99bff;clip-path:polygon(0 0,100% 0,50% 100%)}
  .scrubber{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:ew-resize;z-index:3}.scrubber:focus-visible{opacity:.16;outline:2px solid #a99bff;outline-offset:-2px}
  .track-row{display:grid;grid-template-columns:158px minmax(400px,1fr);grid-template-rows:33px auto;border-bottom:1px solid #ffffff0b}.track-info{display:flex;align-items:center;gap:8px;padding:0 10px 0 14px;border-right:1px solid #ffffff0b}.track-name{display:flex;flex-direction:column;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#aaa7b4;font:9px 'DM Mono',monospace}.track-name small{margin-top:2px;color:#dedce6;font:10px 'DM Sans',sans-serif}.remove-track,.remove-key{border:0;background:none;color:#777583;cursor:pointer}.remove-track{margin-left:auto;font-size:16px}.remove-track:hover,.remove-key:hover{color:#ff8791}.key-lane{position:relative;height:33px;cursor:crosshair;background:repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),#ffffff06 calc(10% - 1px),#ffffff06 10%)}.current-line{top:0;bottom:0;z-index:1;background:#a99bff80;pointer-events:none}.diamond{position:absolute;z-index:2;top:11px;width:11px;height:11px;padding:0;transform:translateX(-50%) rotate(45deg);border:1px solid #c7bcff;background:#7868d4;cursor:grab;touch-action:none}.diamond:hover,.diamond.active{background:#c5b9ff;box-shadow:0 0 8px #a99bff80}.diamond.dragging{z-index:4;cursor:grabbing;box-shadow:0 0 10px #c5b9ff}.diamond:focus-visible{outline:2px solid white;outline-offset:3px}
  .key-controls{grid-column:2;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 8px 7px;border-top:1px solid #ffffff08}.key-control{display:flex;align-items:center;gap:4px;padding:3px 4px;border:1px solid #ffffff0e;border-radius:4px;background:#121319}.key-time{padding:0;border:0;background:none;color:#a99bff;font:9px 'DM Mono',monospace;cursor:pointer}.key-control select{height:20px;max-width:76px;border:1px solid #ffffff12;border-radius:3px;background:#1a1b22;color:#aaa8b5;font:9px 'DM Sans',sans-serif}.remove-key{font-size:14px;line-height:1}
  .track-actions{display:flex;align-items:center;gap:7px;padding:9px 12px}.track-actions select{height:27px;max-width:220px;min-width:180px;padding:0 7px;border:1px solid #ffffff15;border-radius:4px;background:#111217;color:#c5c2cf;font:10px 'DM Sans',sans-serif}.add-track{height:27px;padding:0 10px;border:0;border-radius:4px;background:#39324f;color:#c0b5ff;font:10px 'DM Sans',sans-serif;cursor:pointer}.add-track:disabled{opacity:.4;cursor:default}.hint{color:#73717e;font-size:9px}.empty-state{margin:0;padding:24px 16px;color:#777583;text-align:center;font-size:10px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
  button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #a99bff;outline-offset:2px}
  @media(max-width:700px){.ruler-wrap{padding-left:128px;padding-right:8px}.track-row{grid-template-columns:120px minmax(400px,1fr)}.track-info{padding-left:8px}.track-actions{flex-wrap:wrap}.hint{flex-basis:100%}}
</style>
