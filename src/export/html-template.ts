import { serializeScene } from "../scene/serialize";
import type { Scene } from "../scene/types";

function inlineScript(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

/** Turns bundled renderer/runtime code and scene JSON into one offline HTML document. */
export function renderStandaloneHtml(scene: Scene, standaloneRuntime: string): string {
  const sceneJson = inlineScript(serializeScene(scene));
  const runtimeCode = standaloneRuntime.replaceAll("</script", "<\\/script");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SimuStyle Scene</title>
<style>
*{box-sizing:border-box}html,body,#scene{width:100%;height:100%;margin:0;overflow:hidden;background:#202124;color:#eee;font:13px system-ui,sans-serif}#scene{position:fixed;inset:0}.scene-canvas{display:block;width:100%;height:100%}#toolbar{position:fixed;z-index:2;left:16px;top:16px;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #ffffff20;border-radius:9px;background:#17181fdd;backdrop-filter:blur(12px);box-shadow:0 8px 30px #0005}#brand{font-weight:700;letter-spacing:.04em;margin-right:6px}button{border:0;border-radius:5px;padding:7px 12px;background:#7968d7;color:white;font-weight:600;cursor:pointer}button:disabled{opacity:.45;cursor:default}#stop{background:#393944}#status{color:#c5c2cf;font-size:11px;max-width:min(45vw,500px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#controls{position:fixed;z-index:2;right:16px;top:16px;display:grid;gap:9px;max-height:80vh;overflow:auto;padding:13px;border:1px solid #ffffff20;border-radius:9px;background:#17181fdd;backdrop-filter:blur(12px)}#controls:empty{display:none}#controls label{display:grid;gap:5px;min-width:190px;color:#ddd;font-size:11px}#controls input{width:100%}
</style></head><body><div id="scene"></div><header id="toolbar"><span id="brand">SIMUSTYLE</span><button id="play">Play</button><button id="stop" disabled>Stop</button><span id="status">Loading scene…</span></header><div id="controls"></div>
<script type="module">
const scene=JSON.parse(${JSON.stringify(sceneJson)});
${runtimeCode}
startStandalone(scene).catch(error=>{document.querySelector('#status').textContent=error instanceof Error?error.message:String(error)});
</script></body></html>`;
}
