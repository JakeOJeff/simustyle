<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import { emitTutorial } from "./tutorial/tutorialState.svelte";
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
    emitTutorial("export", { kind: "glb" });
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
    emitTutorial("export", { kind: "html" });
    busy = true; error = "";
    try {
      const { createStandaloneHtml } = await import("../export/html");
      download(new Blob([await createStandaloneHtml(scene)], { type: "text/html;charset=utf-8" }), "simustyle-scene.html");
      open = false;
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { busy = false; }
  }

  async function video() {
    if (busy) return;
    emitTutorial("export", { kind: "video" });
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
  <summary data-tutorial-target="export-button"><Upload size={14} /> <span>Export</span></summary>
  <div class="export-popover">
    <button disabled={busy} data-tutorial-target="export-glb" onclick={glb}>Current frame · GLB</button>
    <button disabled={busy} data-tutorial-target="export-html" onclick={html}>Standalone web page · HTML</button>
    <div class="video-options">
      <label>Video duration <span><input type="number" min="1" max="600" step="1" bind:value={seconds} /> s</span></label>
      <label>Resolution<select bind:value={resolution}><option value="1280x720">720p</option><option value="1920x1080">1080p</option></select></label>
      {#if progress}<progress max="1" value={progress.fraction}></progress><small>{progress.elapsed.toFixed(1)} / {progress.duration}s</small>{/if}
      <button class="video-button" data-tutorial-target="export-video" disabled={busy} onclick={video}>{busy ? "Recording WebM…" : "Export WebM · 30 fps"}</button>
      {#if busy}<button class="cancel" onclick={() => controller?.abort()}>Cancel</button>{/if}
    </div>
    {#if error}<p role="alert">{error}</p>{/if}
  </div>
</details>

<style>
  .export-menu{position:relative;font:11px 'DM Sans',sans-serif}.export-menu summary{list-style:none;cursor:pointer;height:30px;display:flex;align-items:center;gap:7px;padding:0 12px;border:1px solid #ffffff14;border-radius:8px;color:#e4e4e6;background:#121214}.export-menu summary:hover{background:#1d1d21}@media(max-width:1100px){.export-menu summary span{display:none}}.export-menu summary::-webkit-details-marker{display:none}.export-menu[open] summary{border-color:#ffffff26;background:#232327}.export-popover{position:absolute;z-index:20;right:0;top:calc(100% + 7px);display:grid;gap:7px;width:255px;padding:10px;border:1px solid #ffffff1a;border-radius:9px;background:#18181b;box-shadow:0 10px 28px #0009}.export-popover button{min-height:30px;border:1px solid #ffffff12;border-radius:6px;background:#222226;color:#d4d4d8;text-align:left;padding:0 10px;font:11px 'DM Sans',sans-serif;cursor:pointer}.export-popover button:hover:not(:disabled){background:#2d2d33;color:#fff}.export-popover button:disabled{opacity:.55;cursor:wait}.video-options{display:grid;gap:7px;padding-top:8px;border-top:1px solid #ffffff12}.video-options label{display:flex;align-items:center;justify-content:space-between;color:#9898a2;font-size:10px}.video-options input,.video-options select{height:26px;border:1px solid #ffffff14;border-radius:6px;background:#121214;color:#dadadd;font:10px 'DM Sans',sans-serif}.video-options input{width:60px;text-align:right;padding:0 4px}.video-options label span{display:flex;align-items:center;gap:4px}.video-options progress{width:100%;height:5px;accent-color:#a99bff}.video-options small{color:#aaaab2;font:9px 'DM Mono',monospace}.export-popover .video-button{border-color:transparent;background:#7c6cf0;color:#fff;font-weight:600;text-align:center}.export-popover .video-button:hover:not(:disabled){background:#8b7cf6;color:#fff}.export-popover .cancel{border-color:#5a3439;background:#302024;color:#ffb2b6;text-align:center}.export-popover p{margin:0;color:#ff9a9f;font-size:10px;line-height:1.4}
</style>
