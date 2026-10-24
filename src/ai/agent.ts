import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { ScriptRuntime, validateScripts } from "../runtime/scripts";
import { tidyCreates } from "./placement";
import { sceneText, type SceneContextOptions } from "./sceneContext";
import { expandBuildOperations } from "./buildTools";
import { BuildCache } from "./cache";
import { inspectBuildQuality, type BuildQualityReport } from "./quality";
import { validateScene } from "../scene/validate";

export interface SceneAgentReply {
  summary: string;
  ops: SceneOp[];
}

interface PreparedReply extends SceneAgentReply {
  /** Retain compact assembly/repeat instructions so the reviewer needn't regenerate every copy. */
  buildPlan: unknown[];
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
  buildSystemPrompt(scene: Scene, options?: SceneContextOptions): string;
  responseSchema: Record<string, unknown>;
  complete(request: SceneAgentRequest): Promise<unknown>;
  maxRetries?: number;
  onProgress?(message: string): void;
  /** Cache only fully reviewed builds; scoped to the editor session/provider settings. */
  cache?: BuildCache<SceneAgentReply>;
  /** Successful earlier requests in this document, used to retain user style across edits. */
  previousRequests?: readonly string[];
  focusIds?: readonly string[];
}

export interface SceneAgentPreflight {
  /** Print and error lines collected from game start plus five isolated script ticks. */
  console: string[];
  issues: string[];
  baselineIssues: string[];
  frames: number;
  quality?: BuildQualityReport;
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
  cacheHit?: boolean;
}

function replyFrom(value: unknown): { summary: string; ops: unknown[] } | null {
  let decoded = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value) as unknown; }
    catch { return null; }
  }
  if (!decoded || typeof decoded !== "object") return null;
  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || !candidate.summary.trim() || candidate.summary.length > 2000 || !Array.isArray(candidate.ops)) return null;
  return { summary: candidate.summary.trim(), ops: candidate.ops };
}

function prepareReply(scene: Scene, value: unknown, requestLength: number): { reply?: PreparedReply; errors: string[] } {
  const parsed = replyFrom(value);
  if (!parsed) return { errors: ["Response must be a JSON object with a nonempty summary (at most 2000 characters) and an ops array."] };
  const replyBudget = Math.min(36_000, 40_000 - requestLength);
  if (JSON.stringify(parsed).length > replyBudget) return { errors: [`Build response exceeds ${replyBudget} characters for this request. Use assemble/repeat to express repeated detail compactly, and return the full corrected build.`] };
  const expanded = expandBuildOperations(scene, parsed.ops);
  if (expanded.errors.length) return { errors: expanded.errors };
  try {
    const tidy = tidyCreates(scene, expanded.ops, { preserveExplicitPositions: true });
    return { reply: { summary: `${parsed.summary}${tidy.notes.length ? ` (Adjusted: ${tidy.notes.join("; ")}.)` : ""}`, ops: tidy.ops, buildPlan: parsed.ops }, errors: [] };
  } catch (error) {
    return { errors: [`Malformed build operation: ${error instanceof Error ? error.message : String(error)}`] };
  }
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
  // Keep all issue identities for baseline subtraction; truncating first can hide a new failure.
  return { console: printed.slice(0, 20), issues: [...new Set(issues)], baselineIssues, frames };
}

function reviewPrompt(userPrompt: string, draft: PreparedReply, candidate: Scene, preflight: SceneAgentPreflight, focusIds: readonly string[]): string {
  const sampled = (lines: string[], count: number, empty: string) => lines.length ? `${lines.slice(0, count).map((line) => `- ${line.slice(0, 180)}`).join("\n")}${lines.length > count ? `\n- ${lines.length - count} further lines omitted from review context; all are checked locally.` : ""}` : empty;
  const baselineSet = new Set(preflight.baselineIssues);
  const reviewIssues = [...preflight.issues.filter((issue) => !baselineSet.has(issue)), ...preflight.issues.filter((issue) => baselineSet.has(issue))];
  const consoleOutput = sampled(preflight.console, 5, "- No script print output during the preview.");
  const issueOutput = sampled(reviewIssues, 10, "- No runtime script errors during the preview.");
  const baselineOutput = sampled(preflight.baselineIssues, 5, "- No baseline runtime script errors.");
  const compactQuality = preflight.quality ? { ...preflight.quality, warnings: preflight.quality.warnings.slice(0, 12).map((warning) => warning.slice(0, 180)), totalWarnings: preflight.quality.warnings.length } : undefined;
  const qualityOutput = `\n\nDESIGN AND ORGANIZATION CHECKS:\n${JSON.stringify(compactQuality)}\n\nReview silhouette and required parts, requested style/colors, proportions, material choices, lighting, camera, repeated counts, and meaningful folders. Resolve geometry warnings when they represent real mistakes; conservative bounds may flag intentional contacts. Do not remove requested detail merely to reduce warnings. The second-pass operations must apply to the ORIGINAL scene, not the first build result. Return the complete replacement operation list.`;
  const plan = JSON.stringify(draft.buildPlan);
  const sceneBudget = Math.max(0, Math.min(23_000, 43_000 - userPrompt.length - plan.length - draft.summary.length - consoleOutput.length - issueOutput.length - baselineOutput.length - qualityOutput.length));
  const context = sceneText(candidate, { maxChars: sceneBudget, query: userPrompt, focusIds });
  return `Independently review and build a second version of the scene edit. Do not apply anything; return only the final scene operations in the required JSON format.\n\nPLAYER REQUEST:\n${userPrompt}\n\nFIRST BUILD SUMMARY:\n${draft.summary}\n\nFIRST BUILD OPERATIONS:\n${plan}\n\nFIRST BUILD RESULTING SCENE:\n${context}\n\nISOLATED PLAY-START CONSOLE OUTPUT (${preflight.frames} script ticks of 0.1 seconds; no Rapier physics):\n${consoleOutput}\n\nRUNTIME ISSUES IN THE FIRST BUILD:\n${issueOutput}\n\nRUNTIME ISSUES ALREADY PRESENT BEFORE THIS REQUEST:\n${baselineOutput}\n\nCompare the resulting scene with what the player explicitly asked for. Preserve requested details, correct mismatches or newly introduced errors found in the Console check, and remove unrelated additions. Do not treat baseline issues as caused by this edit. If the first build already matches, return its operations unchanged. Your summary must briefly say what you checked and whether you changed anything. Do not claim visual review or physics checks.${qualityOutput}`;
}

/** Build, measure design/organization, inspect isolated scripts, review and commit one validated operation batch. */
export async function runSceneAgent(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies): Promise<SceneAgentResult> {
  const sourceErrors = validateScene(scene);
  if (sourceErrors.length) return { ok: false, ops: [], errors: sourceErrors.map((error) => `current ${error}`), attempts: 0 };
  const history = (dependencies.previousRequests ?? []).slice(-6).map((request) => request.slice(0, 2000));
  while (JSON.stringify(history).length > 6000) history.shift();
  const focusIds = (dependencies.focusIds ?? []).filter((id) => scene.entities.some((entity) => entity.id === id));
  const systemPrompt = `${dependencies.buildSystemPrompt(scene, { query: userPrompt, focusIds })}${history.length ? `\n\nEarlier successful requests (context only; current request overrides these):\n${JSON.stringify(history)}` : ""}${focusIds.length ? `\n\nSelected object ids (resolve this/these using this selection): ${JSON.stringify(focusIds)}` : ""}`;
  if (userPrompt.length > 12_000 || systemPrompt.length > 49_000) return { ok: false, ops: [], errors: ["The request or scene instructions are too large. Split the request into smaller edits or select a smaller assembly."], attempts: 0 };
  const baselineCompileIssues = new Set(validateScripts(scene).map((issue) => scriptErrorText(scene, issue)));
  const newCompileIssues = (candidate: Scene) => validateScripts(candidate).map((issue) => scriptErrorText(candidate, issue)).filter((issue) => !baselineCompileIssues.has(issue));
  const cacheKey = JSON.stringify(["scene-build-v2", scene, systemPrompt, userPrompt, dependencies.responseSchema]);
  const cached = dependencies.cache?.get(cacheKey);
  if (cached) {
    const applied = applyOps(scene, cached.ops);
    if (!applied.errors.length && !newCompileIssues(applied.scene).length) {
      const baseline = inspectCandidate(scene);
      const checked = inspectCandidate(applied.scene, baseline.issues);
      if (checked.issues.every((issue) => baseline.issues.includes(issue))) {
        checked.quality = inspectBuildQuality(applied.scene, cached.ops);
        dependencies.onProgress?.("Reusing a reviewed build and checking it against the current scene…");
        return { ok: true, summary: cached.summary, ops: cached.ops, scene: applied.scene, inverseOps: applied.inverseOps,
          errors: [], attempts: 0, preflight: checked, cacheHit: true };
      }
    }
  }
  const maxRetries = Math.max(0, Math.min(3, dependencies.maxRetries ?? 3));
  let correctionErrors: string[] = [];
  let previousReply = "";
  let draft: PreparedReply | null = null;
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
    const prepared = prepareReply(scene, raw, userPrompt.length);
    const reply = prepared.reply;
    previousReply = typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";
    if (!reply) correctionErrors = prepared.errors;
    else {
      const result = applyOps(scene, reply.ops);
      const scriptErrors = result.errors.length ? [] : newCompileIssues(result.scene);
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
  preflight.quality = inspectBuildQuality(candidate, draft.ops);
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
  const reviewUserPrompt = reviewPrompt(userPrompt, draft, candidate, preflight, focusIds);
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
    const prepared = prepareReply(scene, raw, userPrompt.length);
    reviewed = prepared.reply ?? null;
    if (!reviewed) correctionErrors = prepared.errors;
    else {
      reviewedResult = applyOps(scene, reviewed.ops);
      correctionErrors = reviewedResult.errors.length
        ? reviewedResult.errors
        : newCompileIssues(reviewedResult.scene);
      if (!correctionErrors.length) {
        const checked = inspectCandidate(reviewedResult.scene, baselinePreflight.issues);
        checked.quality = inspectBuildQuality(reviewedResult.scene, reviewed.ops);
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
  dependencies.cache?.set(cacheKey, { summary: reviewed.summary, ops: reviewed.ops });
  return { ok: true, summary: reviewed.summary, ops: reviewed.ops, scene: candidate, inverseOps: reviewedResult.inverseOps, errors: [], attempts, preflight };
}
