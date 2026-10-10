<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import type { Scene } from "../scene/types";
  import type { VideoExportConfig, VideoExportProgress } from "../export/video";

  interface Props {
    scene: Scene;
    onVideoExport: (config: VideoExportConfig, signal: AbortSignal, onProgress: (value: VideoExportProgress) => void) => Promise<Blob>;
  }

  let { scene, onVideoExport }: Props = $props();
  let open = $state(false);
  let busy = $state(false);
  let error = $state("");
  let progress = $state<VideoExportProgress | null>(null);
  let seconds = $state(5);
  let resolution = $state("1280x720");
  let controller: AbortController | null = null;

  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function glb() {
    if (busy) return;
    busy = true; error = "";
    try {
      const { exportSceneGlb } = await import("../export/gltf");
      download(await exportSceneGlb(scene), "simustyle-scene.glb");
      open = false;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  async function html() {
    if (busy) return;
    busy = true; error = "";
    try {
      const { createStandaloneHtml } = await import("../export/html");
      download(new Blob([createStandaloneHtml(scene)], { type: "text/html;charset=utf-8" }), "simustyle-scene.html");
      open = false;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  async function video() {
    if (busy) return;
    const [widthText, heightText] = resolution.split("x");
    const config: VideoExportConfig = { duration: seconds, fps: 30, resolution: { width: Number(widthText), height: Number(heightText) } };
    controller = new AbortController();
    busy = true; error = ""; progress = null;
    try {
      const blob = await onVideoExport(config, controller.signal, (value) => progress = value);
      download(blob, "simustyle-scene.webm");
      open = false;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") error = "Video export cancelled.";
      else error = cause instanceof Error ? cause.message : String(cause);
    } finally { busy = false; controller = null; progress = null; }
  }
</script>

<details class="export-menu" bind:open>
  <summary><Upload size={14} /> <span>Export</span></summary>
  <div class="export-popover">
    <button disabled={busy} onclick={glb}>Current frame · GLB</button>
    <button disabled={busy} onclick={html}>Standalone web page · HTML</button>
    <div class="video-options">
      <label>Video duration <span><input type="number" min="1" max="600" step="1" bind:value={seconds} /> s</span></label>
      <label>Resolution<select bind:value={resolution}><option value="1280x720">720p</option><option value="1920x1080">1080p</option></select></label>
      {#if progress}<progress max="1" value={progress.fraction}></progress><small>{progress.elapsed.toFixed(1)} / {progress.duration}s</small>{/if}
      <button class="video-button" disabled={busy} onclick={video}>{busy ? "Recording WebM…" : "Export WebM · 30 fps"}</button>
      {#if busy}<button class="cancel" onclick={() => controller?.abort()}>Cancel</button>{/if}
    </div>
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
</details>

<style>
  .export-menu{position:relative;font:11px 'DM Sans',sans-serif}.export-menu summary{list-style:none;cursor:pointer;height:30px;display:flex;align-items:center;gap:7px;padding:0 12px;border:1px solid #ffffff14;border-radius:7px;color:#e2e0ea;background:#111115}.export-menu summary:hover{background:#1c1c22}@media(max-width:1100px){.export-menu summary span{display:none}}.export-menu summary::-webkit-details-marker{display:none}.export-menu[open] summary{border-color:#a99bff80;color:#d5ceff}.export-popover{position:absolute;z-index:20;right:0;top:calc(100% + 7px);display:grid;gap:7px;width:255px;padding:10px;border:1px solid #ffffff19;border-radius:8px;background:#191a21;box-shadow:0 12px 32px #0008}.export-popover button{min-height:29px;border:0;border-radius:4px;background:#292832;color:#d8d5e2;text-align:left;padding:0 9px;font:10px 'DM Sans',sans-serif;cursor:pointer}.export-popover button:hover:not(:disabled){background:#39344b;color:#d5ceff}.export-popover button:disabled{opacity:.55;cursor:wait}.video-options{display:grid;gap:7px;padding-top:8px;border-top:1px solid #ffffff12}.video-options label{display:flex;align-items:center;justify-content:space-between;color:#9997a3;font-size:10px}.video-options input,.video-options select{height:24px;border:1px solid #ffffff17;border-radius:4px;background:#101116;color:#d8d5e2;font:10px 'DM Sans',sans-serif}.video-options input{width:60px;text-align:right;padding:0 4px}.video-options label span{display:flex;align-items:center;gap:4px}.video-options progress{width:100%;height:5px;accent-color:#a99bff}.video-options small{color:#aaa7b5;font:9px 'DM Mono',monospace}.export-popover .video-button{background:#494071;color:#ded6ff;text-align:center}.export-popover .cancel{background:#4b292e;color:#ffb2b6;text-align:center}.export-popover p{margin:0;color:#ff9a9f;font-size:10px;line-height:1.4}
</style>
