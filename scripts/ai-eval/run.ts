// `npm run ai:eval`: runs the real scene agent on an empty scene for each eval prompt, with the same
// prompts, proxy and model routing as the editor (keys from .env / .env.local), and saves a fixed 3/4
// screenshot plus op/part counts, models, tokens and cost per prompt to eval-output/<timestamp>/.
// Pass prompts as arguments to run those instead: npm run ai:eval -- "a blue bicycle"
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadEnv } from "vite";
import { runSceneAgent } from "../../src/ai/agent";
import { forwardChat, isAiConfigured, lunaModel, solReviewEnabled, type ChatCredits } from "../../src/ai/chatProxy";
import { parseChatPayload, sceneEditMessages } from "../../src/ai/client";
import type { CallCharge, CreditStatus } from "../../src/ai/credits";
import { AI_RESPONSE_JSON_SCHEMA, buildSystemPrompt } from "../../src/ai/prompt";
import { serializeScene } from "../../src/scene/serialize";
import { createEmptyScene, type Scene } from "../../src/scene/types";
import { summaryTable, usageTotals, type EvalRow } from "./report";

const PROMPTS = [
  "Build a cozy reading corner in warm wood and sage green",
  "Create the house from Up and decorate its insides with furniture",
  "A red sports car",
  "A snowman in a snowy garden"
];
const WIDTH = 1280;
const HEIGHT = 800;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

const env = loadEnv("development", process.cwd(), "");
if (!isAiConfigured(env)) {
  console.error("AI is not configured: set AI_API_KEY and AI_MODEL_LUNA (or AI_MODEL) in .env or .env.local.");
  process.exit(1);
}
// npm on Windows can hand arguments through cmd.exe with ^ escapes left in.
const args = process.argv.slice(2).map((arg) => arg.replaceAll("^", "")).filter(Boolean);
const prompts = args.length ? args : PROMPTS;
const outDir = path.resolve("eval-output", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(outDir, { recursive: true });
console.log(`Draft model ${lunaModel(env)}; Sol reviews ${solReviewEnabled(env) ? `on (${env.AI_MODEL_SOL})` : "off"}. Writing to ${outDir}`);

/** The browser bundle that draws a scene for screenshots. */
const renderBundle = (await build({
  entryPoints: [path.resolve("scripts/ai-eval/render.ts")], bundle: true, write: false, format: "iife",
  platform: "browser", target: "es2022", minify: true, logLevel: "warning", define: { "import.meta.env.BASE_URL": JSON.stringify("/") }
})).outputFiles[0]!.text;

/** One agent run with metered calls recorded instead of charged to a visitor. */
async function runPrompt(prompt: string): Promise<{ scene?: Scene; row: EvalRow; detail: unknown }> {
  const charges: CallCharge[] = [];
  /** What each call was asked to fix, so result.json shows why a build needed corrections. */
  const requests: { task: string; correctionErrors: string[] }[] = [];
  const status: CreditStatus = { remaining: 1_000_000, limit: 1_000_000, resetsAt: new Date().toISOString() };
  const credits: ChatCredits = {
    reserve: async (task) => ({ ok: true, status, reservation: { task, day: "eval", credits: 0, usd: 0 } }),
    settle: async (_reservation, charge) => { if (charge) charges.push(charge); return status; }
  };
  const started = Date.now();
  const log = console.log;
  // forwardChat logs one JSON line per call for the server logs; the summary reports the same numbers.
  console.log = (...values: unknown[]) => { if (!(typeof values[0] === "string" && values[0].startsWith('{"event":"ai_call"'))) log(...values); };
  try {
    const result = await runSceneAgent(createEmptyScene(), prompt, {
      buildSystemPrompt,
      responseSchema: AI_RESPONSE_JSON_SCHEMA.schema,
      solReviewEnabled: solReviewEnabled(env),
      onProgress: (message) => log(`  ${message}`),
      complete: async ({ systemPrompt, userPrompt, correctionErrors, responseSchema, previousReply, task }) => {
        requests.push({ task, correctionErrors });
        const body = JSON.stringify({ task, messages: sceneEditMessages(systemPrompt, userPrompt, correctionErrors, previousReply),
          responseFormat: { type: "json_schema", json_schema: { ...AI_RESPONSE_JSON_SCHEMA, schema: responseSchema } } });
        const reply = await forwardChat(new TextEncoder().encode(body), env, credits);
        if (reply.status !== 200) throw new Error(String((reply.body as { error?: unknown }).error ?? `AI proxy returned HTTP ${reply.status}`));
        return parseChatPayload(reply.body);
      }
    });
    const row: EvalRow = { prompt, ok: result.ok, ops: result.ops.length, parts: result.scene?.entities.filter((entity) => entity.components.Mesh).length ?? 0,
      ...usageTotals(charges), seconds: (Date.now() - started) / 1000, ...(result.ok ? {} : { error: result.errors.join(" | ") }) };
    const detail = { prompt, ok: result.ok, summary: result.summary, errors: result.errors, attempts: result.attempts, requests, skipped: result.skipped,
      geometry: result.preflight?.geometry, quality: result.preflight?.quality?.warnings, charges, ops: result.ops };
    return { scene: result.scene, row, detail };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { row: { prompt, ok: false, ops: 0, parts: 0, ...usageTotals(charges), seconds: (Date.now() - started) / 1000, error: message }, detail: { prompt, error: message, requests, charges } };
  } finally {
    console.log = log;
  }
}

/** Minimal Chrome DevTools Protocol client over the built-in WebSocket; no extra dependencies. */
async function openBrowser() {
  const port = 9300 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(outDir, ".chrome-profile")}`,
    "--no-first-run", "--no-default-browser-check", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"], { windowsHide: true, stdio: "ignore" });
  let url = "";
  for (let attempt = 0; attempt < 100 && !url; attempt++) {
    try { url = ((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  if (!url) { chrome.kill(); throw new Error(`Could not start Chrome at ${CHROME}; set CHROME_PATH.`); }
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
    const waiter = message.id === undefined ? undefined : pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id!);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  };
  const send = <T>(method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<T>((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return {
    /** Draws the scene in a fresh tab and returns a PNG of the fixed 3/4 view. */
    async screenshot(scene: Scene, file: string): Promise<Buffer> {
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}</style></head><body>` +
        `<script>window.__scene=${JSON.stringify(scene).replaceAll("<", "\\u003c")}</script><script>${renderBundle.replaceAll("</script", "<\\/script")}</script></body></html>`;
      await writeFile(file, html);
      const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      try {
        await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
        await send("Page.navigate", { url: pathToFileURL(file).href }, sessionId);
        for (let attempt = 0; ; attempt++) {
          const { result } = await send<{ result: { value?: { done?: boolean; error?: string } } }>("Runtime.evaluate",
            { expression: "({ done: window.__rendered === true, error: window.__renderError })", returnByValue: true }, sessionId);
          if (result.value?.error) throw new Error(`Render failed: ${result.value.error}`);
          if (result.value?.done) break;
          if (attempt > 300) throw new Error("Render timed out.");
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const { data } = await send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sessionId);
        return Buffer.from(data, "base64");
      } finally {
        await send("Target.closeTarget", { targetId }).catch(() => undefined);
      }
    },
    close() { socket.close(); chrome.kill(); }
  };
}

const browser = await openBrowser();
const rows: EvalRow[] = [];
try {
  for (const [index, prompt] of prompts.entries()) {
    console.log(`\n[${index + 1}/${prompts.length}] ${prompt}`);
    const dir = path.join(outDir, `${String(index + 1).padStart(2, "0")}-${prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`);
    await mkdir(dir, { recursive: true });
    const { scene, row, detail } = await runPrompt(prompt);
    rows.push(row);
    await writeFile(path.join(dir, "result.json"), JSON.stringify(detail, null, 2));
    if (scene) {
      await writeFile(path.join(dir, "scene.json"), serializeScene(scene));
      try { await writeFile(path.join(dir, "screenshot.png"), await browser.screenshot(scene, path.join(dir, "render.html"))); }
      catch (error) { row.error = [row.error, `screenshot: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join(" | "); }
    }
    console.log(`  ${row.ok ? "ok" : "FAILED"}: ${row.ops} ops, ${row.parts} parts, $${row.costUsd.toFixed(4)}${row.error ? ` (${row.error})` : ""}`);
  }
} finally {
  browser.close();
}

const table = summaryTable(rows);
await writeFile(path.join(outDir, "summary.txt"), `${table}\n`);
await writeFile(path.join(outDir, "summary.json"), JSON.stringify(rows, null, 2));
console.log(`\n${table}\n\nSaved to ${outDir}`);
