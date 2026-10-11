import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { ScriptRuntime, validateScripts } from "../runtime/scripts";
import { tidyCreates } from "./placement";
import { sceneText } from "./sceneContext";

export interface SceneAgentReply {
  summary: string;
  ops: SceneOp[];
}

export interface SceneAgentRequest {
  systemPrompt: string;
  userPrompt: string;
  correctionErrors: string[];
  responseSchema: Record<string, unknown>;
  /** The rejected reply as JSON, sent back with the errors so the model can correct it. */
  previousReply: string;
}

export interface SceneAgentDependencies {
  buildSystemPrompt(scene: Scene): string;
  responseSchema: Record<string, unknown>;
  complete(request: SceneAgentRequest): Promise<unknown>;
  maxRetries?: number;
  onProgress?(message: string): void;
}

export interface SceneAgentPreflight {
  /** Print and error lines collected from game start plus five isolated script ticks. */
  console: string[];
  issues: string[];
  baselineIssues: string[];
  frames: number;
}

export interface SceneAgentResult {
  ok: boolean;
  summary?: string;
  ops: SceneOp[];
  scene?: Scene;
  inverseOps?: SceneOp[];
  errors: string[];
  attempts: number;
  preflight?: SceneAgentPreflight;
  fallbackDraft?: { summary: string; ops: SceneOp[]; preflight: SceneAgentPreflight };
}

function replyFrom(value: unknown): SceneAgentReply | null {
  let decoded = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value) as unknown; }
    catch { return null; }
  }
  if (!decoded || typeof decoded !== "object") return null;
  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || !Array.isArray(candidate.ops)) return null;
  return { summary: candidate.summary, ops: candidate.ops as SceneOp[] };
}

/** Quotes the failing source line so the model (and the user) can see exactly what was rejected. */
function scriptErrorText(scene: Scene, issue: { entityId: string; line: number; column: number; message: string }): string {
  const source = scene.entities.find((entity) => entity.id === issue.entityId)?.components.Script?.source;
  const lineText = typeof source === "string" ? source.split("\n")[issue.line - 1]?.trim() : undefined;
  const quoted = lineText ? ` in "${lineText}"` : "";
  return `Entity '${issue.entityId}', line ${issue.line}, column ${issue.column}${quoted}: ${issue.message}`;
}

/** Runs scripts on a disposable scene copy; this never changes the editor's live scene. */
function inspectCandidate(scene: Scene, baselineIssues: string[] = []): SceneAgentPreflight {
  const runtime = new ScriptRuntime(scene, 1, () => true);
  runtime.start();
  const frames = 5;
  for (let frame = 0; frame < frames; frame += 1) runtime.advance(0.1);
  const printed = runtime.takePrints().map((entry) => {
    const name = scene.entities.find((entity) => entity.id === entry.entityId)?.name ?? "Scene";
    return `${name}: ${entry.values.map(String).join(" ")}`;
  });
  const issues = runtime.takeIssues().map((issue) => scriptErrorText(scene, issue));
  return { console: printed.slice(0, 20), issues: issues.slice(0, 20), baselineIssues, frames };
}

function reviewPrompt(userPrompt: string, draft: SceneAgentReply, candidate: Scene, preflight: SceneAgentPreflight): string {
  const consoleOutput = preflight.console.length ? preflight.console.map((line) => `- ${line}`).join("\n") : "- No script print output during the preview.";
  const issueOutput = preflight.issues.length ? preflight.issues.map((line) => `- ${line}`).join("\n") : "- No runtime script errors during the preview.";
  const baselineOutput = preflight.baselineIssues.length ? preflight.baselineIssues.map((line) => `- ${line}`).join("\n") : "- No baseline runtime script errors.";
  return `Independently review and build a second version of the scene edit. Do not apply anything; return only the final scene operations in the required JSON format.\n\nPLAYER REQUEST:\n${userPrompt}\n\nFIRST BUILD SUMMARY:\n${draft.summary}\n\nFIRST BUILD OPERATIONS:\n${JSON.stringify(draft.ops)}\n\nFIRST BUILD RESULTING SCENE:\n${sceneText(candidate)}\n\nISOLATED PLAY-START CONSOLE OUTPUT (${preflight.frames} script ticks of 0.1 seconds; no Rapier physics):\n${consoleOutput}\n\nRUNTIME ISSUES IN THE FIRST BUILD:\n${issueOutput}\n\nRUNTIME ISSUES ALREADY PRESENT BEFORE THIS REQUEST:\n${baselineOutput}\n\nCompare the resulting scene with what the player explicitly asked for. Preserve requested details, correct mismatches or newly introduced errors found in the Console check, and remove unrelated additions. Do not treat baseline issues as caused by this edit. If the first build already matches, return its operations unchanged. Your summary must briefly say what you checked and whether you changed anything. Do not claim visual review or physics checks.`;
}

/** Builds once, inspects its isolated script output, then obtains and validates an independent second pass. */
export async function runSceneAgent(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies): Promise<SceneAgentResult> {
  const systemPrompt = dependencies.buildSystemPrompt(scene);
  const maxRetries = Math.max(0, Math.min(3, dependencies.maxRetries ?? 3));
  let correctionErrors: string[] = [];
  let previousReply = "";
  let draft: SceneAgentReply | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    attempts += 1;
    let raw: unknown;
    try {
      raw = await dependencies.complete({ systemPrompt, userPrompt, correctionErrors, responseSchema: dependencies.responseSchema, previousReply });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, ops: [], errors: [`AI request failed: ${reason}`], attempts };
    }
    const reply = replyFrom(raw);
    previousReply = typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";
    if (!reply) correctionErrors = ["Response must be a JSON object with a string summary and an ops array."];
    else {
      const tidy = tidyCreates(scene, reply.ops);
      reply.ops = tidy.ops;
      if (tidy.notes.length) reply.summary = `${reply.summary.trim()} (Adjusted: ${tidy.notes.join("; ")}.)`;
      const result = applyOps(scene, reply.ops);
      const scriptErrors = result.errors.length ? [] : validateScripts(result.scene).map((issue) => scriptErrorText(result.scene, issue));
      correctionErrors = [...result.errors, ...scriptErrors];
      if (!correctionErrors.length) {
        draft = reply;
        break;
      }
    }
  }
  if (!draft) return { ok: false, ops: [], errors: correctionErrors, attempts };

  const firstResult = applyOps(scene, draft.ops);
  if (firstResult.errors.length) return { ok: false, ops: [], errors: firstResult.errors, attempts };
  let candidate = firstResult.scene;
  const baselinePreflight = inspectCandidate(scene);
  let preflight = inspectCandidate(candidate, baselinePreflight.issues);
  const baselineIssues = new Set(baselinePreflight.issues);
  const draftRuntimeErrors = preflight.issues.filter((line) => !baselineIssues.has(line));
  const useDraftAfterReviewFailure = (reason: string): SceneAgentResult => {
    if (!draft || !firstResult.inverseOps) return { ok: false, ops: [], errors: [reason], attempts, preflight };
    if (!draftRuntimeErrors.length) {
      return {
        ok: true,
        summary: `${draft.summary} Applied the validated first draft because the independent review could not complete: ${reason}`,
        ops: draft.ops,
        scene: firstResult.scene,
        inverseOps: firstResult.inverseOps,
        errors: [],
        attempts,
        preflight
      };
    }
    return {
      ok: false,
      ops: [],
      errors: [reason, ...draftRuntimeErrors],
      attempts,
      preflight,
      fallbackDraft: { summary: draft.summary, ops: draft.ops, preflight }
    };
  };
  dependencies.onProgress?.("Reviewing the first build and its Console output…");

  const reviewerSystemPrompt = `${systemPrompt}\n\nYou are now doing a separate second-pass review. Inspect the requested result against the player's exact intent and the first build. Treat the isolated Console output as real script-runtime feedback. Return one corrected full operation list, or keep the first build unchanged only if it matches the request and its runtime check is clean. The editor has not applied either build.`;
  const reviewUserPrompt = reviewPrompt(userPrompt, draft, candidate, preflight);
  correctionErrors = [];
  previousReply = "";
  let reviewed: SceneAgentReply | null = null;
  let reviewedResult: ReturnType<typeof applyOps> | null = null;
  const reviewRetries = 4;
  for (let reviewAttempt = 1; reviewAttempt <= reviewRetries + 1; reviewAttempt += 1) {
    attempts += 1;
    dependencies.onProgress?.(reviewAttempt === 1 ? "Building and checking the second pass…" : `Correcting the second pass (${reviewAttempt - 1}/${reviewRetries})…`);
    let raw: unknown;
    try {
      raw = await dependencies.complete({
        systemPrompt: reviewerSystemPrompt,
        userPrompt: reviewUserPrompt,
        correctionErrors,
        responseSchema: dependencies.responseSchema,
        previousReply
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return useDraftAfterReviewFailure(`Second-pass review failed: ${reason}`);
    }
    previousReply = typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";
    reviewed = replyFrom(raw);
    if (!reviewed) correctionErrors = ["Second pass must return a JSON object with a string summary and an ops array."];
    else {
      const tidy = tidyCreates(scene, reviewed.ops);
      reviewed.ops = tidy.ops;
      if (tidy.notes.length) reviewed.summary = `${reviewed.summary.trim()} (Adjusted: ${tidy.notes.join("; ")}.)`;
      reviewedResult = applyOps(scene, reviewed.ops);
      correctionErrors = reviewedResult.errors.length
        ? reviewedResult.errors
        : validateScripts(reviewedResult.scene).map((issue) => scriptErrorText(reviewedResult!.scene, issue));
      if (!correctionErrors.length) {
        const checked = inspectCandidate(reviewedResult.scene, baselinePreflight.issues);
        const baseline = new Set(baselinePreflight.issues);
        const runtimeErrors = checked.issues.filter((line) => !baseline.has(line));
        correctionErrors = runtimeErrors;
        if (!correctionErrors.length) {
          candidate = reviewedResult.scene;
          preflight = checked;
          break;
        }
      }
    }
    if (reviewAttempt === reviewRetries + 1) return useDraftAfterReviewFailure(`Second-pass review did not pass validation after ${reviewAttempt} attempts.`);
  }
  if (!reviewed || !reviewedResult || correctionErrors.length) return { ok: false, ops: [], errors: correctionErrors, attempts, preflight };
  return { ok: true, summary: reviewed.summary, ops: reviewed.ops, scene: candidate, inverseOps: reviewedResult.inverseOps, errors: [], attempts, preflight };
}
