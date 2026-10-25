// `npm run ai:eval`: runs the real scene agent from an empty scene for each eval case, with the same
// prompts, proxy and model routing as the editor (keys from .env / .env.local), and saves a fixed 3/4
// screenshot plus op/part counts, models, tokens and cost per prompt to eval-output/<timestamp>/.
// A case may take several steps on the same scene and end with a pass check (see checks.ts).
// With AI_CRITIQUE_ENABLED=true, builds are also inspected from every side with the editor's own offscreen renders
// (saved under views/), and the summary shows each prompt's lowest final inspection score. With
// AI_REFERENCE_IMAGE_ENABLED=true, complex requests get a reference image first (saved as reference-<step>.jpg).
// Pass prompts as arguments to run those instead: npm run ai:eval -- "a blue bicycle" "a desk >> make it oak" 8
// ("a >> b" runs requests as steps on one scene; a number runs that built-in case with its check).
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadEnv } from "vite";
import { runSceneAgent } from "../../src/ai/agent";
import { critiqueEnabled, forwardChat, imageModel, isAiConfigured, lunaModel, referenceImageEnabled, solReviewEnabled, visionModel, type ChatCredits } from "../../src/ai/chatProxy";
import type { RenderedView } from "../../src/ai/critique";
import type { ViewName } from "../../src/ai/framing";
import { CONCEPT_JSON_SCHEMA } from "../../src/ai/concept";
import { REFERENCE_JSON_SCHEMA } from "../../src/ai/references";
import { VISION_SCHEMAS, parseChatPayload, sceneEditMessages } from "../../src/ai/client";
import type { CallCharge, CreditStatus } from "../../src/ai/credits";
import { AI_RESPONSE_JSON_SCHEMA, buildSystemPrompt } from "../../src/ai/prompt";
import { EXAMPLE_LIBRARY, FEW_SHOT_EXAMPLES, selectExamples } from "../../src/ai/examples";
import { serializeScene } from "../../src/scene/serialize";
import { createEmptyScene, type Scene } from "../../src/scene/types";
import { containedAndTethered, mugOnDeskThenRed } from "./checks";
import { summaryTable, usageTotals, type EvalRow } from "./report";

interface EvalCase {
  /** Requests run one after another on the same scene, each seeing the earlier ones as history. */
  steps: string[];
  /** Failures in the final scene, given the scene before the last step; empty means pass. */
  check?: (before: Scene, after: Scene) => string[];
}

/** Kept different from the few-shot and library examples, so a run measures how well the rules generalize. */
const CASES: EvalCase[] = [
  { steps: ["Build a cozy kitchen nook in warm wood and sage green"] },
  { steps: ["Create the house from Up and decorate its insides with furniture"] },
  { steps: ["A red sports car"] },
  { steps: ["A snowman in a snowy garden"] },
  // Shape variety: text sign, hollow mugs with torus handles, bevelled case; slide, swings, dome (arc) climber.
  { steps: ["A coffee shop counter with a sign, mugs and a pastry case"] },
  { steps: ["A playground with a slide, swings and a dome climber"] },
  // Containment: the corner must end up inside the house, and the balloons must be tethered to its roof.
  { steps: ["Build a cozy reading corner", "Create the house from Up and put this inside"], check: containedAndTethered },
  // Follow-up references: the mug goes on a grouped desk next to its monitor, then "it" must mean the mug.
  { steps: ["A home office with a desk, a computer monitor and an office chair", "Put a coffee mug on the desk next to the monitor", "Make it red"], check: mugOnDeskThenRed }
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
// A number picks a built-in case (1-based, with its check); "first >> second" runs the requests as steps of one case.
const cases: EvalCase[] = args.length ? args.map((arg) => /^\d+$/.test(arg) && CASES[Number(arg) - 1] ? CASES[Number(arg) - 1]! : { steps: arg.split(" >> ").map((step) => step.trim()).filter(Boolean) }) : CASES;
for (const prompt of cases.flatMap((item) => item.steps)) {
  const copied = [...FEW_SHOT_EXAMPLES, ...EXAMPLE_LIBRARY].find((example) => example.request.toLowerCase() === prompt.toLowerCase());
  if (copied) console.warn(`Note: "${prompt}" is one of the examples, so it measures copying rather than generalizing.`);
}
const outDir = path.resolve("eval-output", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(outDir, { recursive: true });
console.log(`Draft model ${lunaModel(env)}; Sol reviews and reference step ${solReviewEnabled(env) ? `on (${env.AI_MODEL_SOL})` : "off"}; visual inspection ${critiqueEnabled(env) ? `on (${visionModel(env)})` : "off"}; reference images ${referenceImageEnabled(env) ? `on (${imageModel(env)})` : "off"}. Writing to ${outDir}`);

/** Browser bundles: one draws a scene for screenshots, the other makes the inspection's offscreen renders. */
const bundle = async (entry: string) => (await build({
  entryPoints: [path.resolve(entry)], bundle: true, write: false, format: "iife",
  platform: "browser", target: "es2022", minify: true, logLevel: "warning", define: { "import.meta.env.BASE_URL": JSON.stringify("/") }
})).outputFiles[0]!.text;
const renderBundle = await bundle("scripts/ai-eval/render.ts");
const critiqueBundle = critiqueEnabled(env) ? await bundle("scripts/ai-eval/critiqueRender.ts") : "";

/** One case's agent runs with metered calls recorded instead of charged to a visitor. */
type Render = (scene: Scene, ids: readonly string[] | null, views: readonly ViewName[]) => Promise<RenderedView[]>;

/** Sends one request body through the proxy and returns the parsed JSON reply (or, for scene_image, the data URL). */
async function proxy(body: Record<string, unknown>, credits: ChatCredits): Promise<unknown> {
  const reply = await forwardChat(new TextEncoder().encode(JSON.stringify(body)), env, credits);
  if (reply.status !== 200 || !reply.body) throw new Error(String((reply.body as { error?: unknown } | undefined)?.error ?? `AI proxy returned HTTP ${reply.status}`));
  return body.task === "scene_image" ? (reply.body as { content: string }).content : parseChatPayload(reply.body);
}

async function runCase({ steps, check }: EvalCase, dir: string, render?: Render): Promise<{ scene?: Scene; row: EvalRow; detail: unknown }> {
  const prompt = steps.join(" → ");
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
  let saved = 0;
  /** Writes a data URL image into the case folder. */
  const save = async (name: string, url: string) => {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
  };
  try {
    let scene = createEmptyScene();
    let before = scene;
    const results: Awaited<ReturnType<typeof runSceneAgent>>[] = [];
    for (const [index, step] of steps.entries()) {
      if (steps.length > 1) log(`  step ${index + 1}/${steps.length}: ${step}`);
      const result = await runSceneAgent(scene, step, {
        buildSystemPrompt,
        previousRequests: steps.slice(0, index),
        responseSchema: AI_RESPONSE_JSON_SCHEMA.schema,
        solReviewEnabled: solReviewEnabled(env),
        onProgress: (message) => log(`  ${message}`),
        resolveReferences: async ({ systemPrompt, userPrompt }) => {
          requests.push({ task: "scene_context", correctionErrors: [] });
          return proxy({ task: "scene_context", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
            responseFormat: { type: "json_schema", json_schema: REFERENCE_JSON_SCHEMA } }, credits);
        },
        ...(render || referenceImageEnabled(env) ? { see: async ({ task, messages }) => {
          requests.push({ task, correctionErrors: [] });
          return proxy({ task, messages, responseFormat: { type: "json_schema", json_schema: VISION_SCHEMAS[task] } }, credits);
        } } : {}),
        ...(render ? { renderViews: async (built, ids, views) => {
          const rendered = await render(built, ids, views);
          const label = ids ? ids[0]!.replace(/[^a-z0-9_]+/gi, "-").slice(0, 30) : "scene";
          const batch = String(++saved).padStart(3, "0");
          for (const view of rendered) await save(`views/step${index + 1}-${batch}-${label}-${view.view}.jpg`, view.url);
          return rendered;
        } } : {}),
        ...(referenceImageEnabled(env) ? {
          planConcept: async ({ systemPrompt, userPrompt }) => {
            requests.push({ task: "scene_concept", correctionErrors: [] });
            return proxy({ task: "scene_concept", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
              responseFormat: { type: "json_schema", json_schema: CONCEPT_JSON_SCHEMA } }, credits);
          },
          generateImage: async (imagePrompt) => {
            requests.push({ task: "scene_image", correctionErrors: [imagePrompt] });
            const url = String(await proxy({ task: "scene_image", prompt: imagePrompt }, credits));
            await save(`reference-${index + 1}.${url.startsWith("data:image/png") ? "png" : "jpg"}`, url);
            return url;
          }
        } : {}),
        complete: async ({ systemPrompt, userPrompt, correctionErrors, responseSchema, previousReply, task }) => {
          requests.push({ task, correctionErrors });
          return proxy({ task, messages: sceneEditMessages(systemPrompt, userPrompt, correctionErrors, previousReply),
            responseFormat: { type: "json_schema", json_schema: { ...AI_RESPONSE_JSON_SCHEMA, schema: responseSchema } } }, credits);
        }
      });
      results.push(result);
      if (!result.ok || !result.scene) break;
      before = scene;
      scene = result.scene;
    }
    const ok = results.length === steps.length && results.every((result) => result.ok);
    const checks = ok && check ? check(before, scene) : undefined;
    const critique = results.at(-1)?.preflight?.critique;
    const row: EvalRow = { prompt, ok, ops: results.reduce((sum, result) => sum + result.ops.length, 0), parts: scene.entities.filter((entity) => entity.components.Mesh).length,
      ...usageTotals(charges), seconds: (Date.now() - started) / 1000, ...(ok ? {} : { error: results.flatMap((result) => result.errors).join(" | ") }), ...(checks ? { checks } : {}),
      ...(critique ? { critique: { ...(critique.score !== undefined ? { score: critique.score } : {}), outcome: critique.outcome } } : {}) };
    const detail = { prompt, ok, checks, requests, charges, steps: results.map((result, index) => ({ request: steps[index], ok: result.ok,
      examples: selectExamples(steps[index]!, index === 0).map((example) => example.request), summary: result.summary, errors: result.errors, attempts: result.attempts, skipped: result.skipped,
      geometry: result.preflight?.geometry, quality: result.preflight?.quality?.warnings, critique: result.preflight?.critique, context: result.preflight?.context,
      reference: result.preflight?.reference ? { ...result.preflight.reference, image: result.preflight.reference.image ? "(saved as reference-<step>.jpg)" : undefined } : undefined, ops: result.ops })) };
    return { scene: results.length ? scene : undefined, row, detail };
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
  /** Opens the scene with a bundle in a fresh tab, waits until the page expression `ready` is truthy, then hands its value and the tab to `use`. */
  const withPage = async <T>(scene: Scene, script: string, file: string, ready: string, use: (value: unknown, sessionId: string) => Promise<T>, request: unknown = null): Promise<T> => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:#000}</style></head><body>` +
      `<script>window.__scene=${JSON.stringify(scene).replaceAll("<", "\\u003c")};window.__request=${JSON.stringify(request).replaceAll("<", "\\u003c")}</script><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
    await writeFile(file, html);
    const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    try {
      await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send("Page.navigate", { url: pathToFileURL(file).href }, sessionId);
      for (let attempt = 0; ; attempt++) {
        const { result } = await send<{ result: { value?: { value?: unknown; error?: string } } }>("Runtime.evaluate",
          { expression: `({ value: ${ready}, error: window.__renderError })`, returnByValue: true }, sessionId);
        if (result.value?.error) throw new Error(`Render failed: ${result.value.error}`);
        if (result.value?.value) return await use(result.value.value, sessionId);
        if (attempt > 300) throw new Error("Render timed out.");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      await send("Target.closeTarget", { targetId }).catch(() => undefined);
    }
  };
  return {
    /** Draws the scene in a fresh tab and returns a PNG of the fixed 3/4 view. */
    screenshot: (scene: Scene, file: string): Promise<Buffer> => withPage(scene, renderBundle, file, "window.__rendered === true", async (_done, sessionId) =>
      Buffer.from((await send<{ data: string }>("Page.captureScreenshot", { format: "png" }, sessionId)).data, "base64")),
    /** The inspection's JPEG renders of a scene or chunk, made by the editor's own offscreen renderer (src/ai/snapshot.ts). */
    views: (scene: Scene, ids: readonly string[] | null, views: readonly ViewName[], file: string): Promise<RenderedView[]> =>
      withPage(scene, critiqueBundle, file, "window.__views", async (rendered) => rendered as RenderedView[], { ids, views }),
    close() { socket.close(); chrome.kill(); }
  };
}

const browser = await openBrowser();
const rows: EvalRow[] = [];
try {
  for (const [index, item] of cases.entries()) {
    console.log(`\n[${index + 1}/${cases.length}] ${item.steps.join(" → ")}`);
    // Named after the last step: the one a multi-step case measures.
    const dir = path.join(outDir, `${String(index + 1).padStart(2, "0")}-${item.steps.at(-1)!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`);
    await mkdir(dir, { recursive: true });
    let page = 0;
    const { scene, row, detail } = await runCase(item, dir, critiqueEnabled(env) ? (built, ids, views) => browser.views(built, ids, views, path.join(dir, `.views-${++page}.html`)) : undefined);
    rows.push(row);
    await writeFile(path.join(dir, "result.json"), JSON.stringify(detail, null, 2));
    if (scene) {
      await writeFile(path.join(dir, "scene.json"), serializeScene(scene));
      try { await writeFile(path.join(dir, "screenshot.png"), await browser.screenshot(scene, path.join(dir, "render.html"))); }
      catch (error) { row.error = [row.error, `screenshot: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join(" | "); }
    }
    console.log(`  ${row.ok ? "ok" : "FAILED"}: ${row.ops} ops, ${row.parts} parts, $${row.costUsd.toFixed(4)}${row.error ? ` (${row.error})` : ""}`);
    if (row.checks) console.log(`  check ${row.checks.length ? `FAILED: ${row.checks.join(" ")}` : "passed"}`);
  }
} finally {
  browser.close();
}

const table = summaryTable(rows);
await writeFile(path.join(outDir, "summary.txt"), `${table}\n`);
await writeFile(path.join(outDir, "summary.json"), JSON.stringify(rows, null, 2));
console.log(`\n${table}\n\nSaved to ${outDir}`);
