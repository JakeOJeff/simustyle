import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { ScriptRuntime, validateScripts } from "../runtime/scripts";
import { tidyCreates } from "./placement";
import { sceneText } from "./sceneContext";
import { expandBuildOperations } from "./buildTools";
import { BuildCache } from "./cache";
import { inspectBuildQuality, type BuildQualityReport } from "./quality";
import { validateScene } from "../scene/validate";
import { buildSceneUserMessage, requestHistory } from "./prompt";
import { checkGeometry } from "./geometry";
import { AI_TASK_LIMITS } from "./tasks";

export interface SceneAgentReply {
  summary: string;
  ops: SceneOp[];
}

interface PreparedReply extends SceneAgentReply {
  /** Retain compact assembly/repeat instructions so the reviewer needn't regenerate every copy. */
  buildPlan: unknown[];
  /** The model's parts/sizes plan; context for the reviewer only, never applied. */
  plan: string;
}

/** The two scene tasks; the server routes "scene_review" to the strong model. */
export type SceneAgentTask = "scene_draft" | "scene_review";

export interface SceneAgentRequest {
  systemPrompt: string;
  userPrompt: string;
  correctionErrors: string[];
  responseSchema: Record<string, unknown>;
  /** The rejected reply as JSON, sent back with the errors so the model can correct it (truncated to the input budget). */
  previousReply: string;
  task: SceneAgentTask;
}

export interface SceneAgentDependencies {
  /** The static, cacheable system prompt; per-call context is built into the user message. */
  buildSystemPrompt(): string;
  responseSchema: Record<string, unknown>;
  complete(request: SceneAgentRequest): Promise<unknown>;
  /** Draft correction retries, clamped to 0..2 (default 2). */
  maxRetries?: number;
  onProgress?(message: string): void;
  /** Cache only reviewed (or clean, review-free) builds; scoped to the editor session/provider settings. */
  cache?: BuildCache<SceneAgentReply>;
  /** Successful earlier requests in this document, used to retain user style across edits. */
  previousRequests?: readonly string[];
  focusIds?: readonly string[];
  /** Server allows escalating reviews to the strong model (task "scene_review"). */
  solReviewEnabled?: boolean;
}

export interface SceneAgentPreflight {
  /** Print and error lines collected from game start plus five isolated script ticks. */
  console: string[];
  issues: string[];
  baselineIssues: string[];
  frames: number;
  quality?: BuildQualityReport;
  /** Geometry checker lines still open on the returned build (soft; never block a build on their own). */
  geometry?: string[];
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
  /** Set when every draft attempt was rejected and only the ops that still applied were kept. */
  skipped?: { kept: number; total: number; errors: string[] };
  cacheHit?: boolean;
}

/** Server-side cap on all message contents of one scene request. */
export const MAX_SCENE_INPUT_CHARS = Math.min(AI_TASK_LIMITS.scene_draft.maxInputChars, AI_TASK_LIMITS.scene_review.maxInputChars);
/** JSON size of the error list sent with a correction, and the client's wrapper text around it. */
const CORRECTION_ERROR_CHARS = 3_000;
const CORRECTION_WRAPPER_CHARS = 300;
/** Room kept for echoing the rejected reply on a correction; longer replies are truncated to what remains. */
const DRAFT_ECHO_RESERVE = 4_000;
const REVIEW_ECHO_RESERVE = 2_000;
const CORRECTION_RESERVE = CORRECTION_ERROR_CHARS + CORRECTION_WRAPPER_CHARS;
/** Correction sent when the model's reply was cut off or wasn't JSON; the agent retries instead of giving up. */
const UNUSABLE_REPLY = (truncated: boolean) => truncated
  ? `Your previous reply was cut off at the ${AI_TASK_LIMITS.scene_draft.maxCompletionTokens}-token output limit and could not be used. Return a much more compact complete response: a plan under 400 characters, at most 20 parts per object, repeat for repeated parts, and no default-valued fields.`
  : "Your previous reply was not valid JSON. Return only the JSON object in the required format.";
/** The model answered but the reply couldn't be used (see UnusableReplyError in client.ts); worth one more try. */
const unusableReply = (error: unknown): boolean | null =>
  error instanceof Error && error.name === "UnusableReplyError" ? (error as Error & { truncated?: boolean }).truncated === true : null;
const TOO_LARGE = "The request or scene instructions are too large. Split the request into smaller edits or select a smaller assembly.";

/** Accepts plan as optional (dropped when applying) so a reply missing it never costs a retry. */
function replyFrom(value: unknown): { plan: string; summary: string; ops: unknown[] } | null {
  let decoded = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value) as unknown; }
    catch { return null; }
  }
  if (!decoded || typeof decoded !== "object") return null;
  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || !candidate.summary.trim() || candidate.summary.length > 2000 || !Array.isArray(candidate.ops)) return null;
  return { plan: typeof candidate.plan === "string" ? candidate.plan.trim().slice(0, 1500) : "", summary: candidate.summary.trim(), ops: candidate.ops };
}

function prepareReply(scene: Scene, value: unknown): { reply?: PreparedReply; errors: string[] } {
  const parsed = replyFrom(value);
  if (!parsed) return { errors: ["Response must be a JSON object with a plan string, a nonempty summary (at most 2000 characters) and an ops array."] };
  const expanded = expandBuildOperations(scene, parsed.ops);
  if (expanded.errors.length) return { errors: expanded.errors };
  try {
    const tidy = tidyCreates(scene, expanded.ops, { preserveExplicitPositions: true });
    return { reply: { summary: `${parsed.summary}${tidy.notes.length ? ` (Adjusted: ${tidy.notes.join("; ")}.)` : ""}`, ops: tidy.ops, buildPlan: parsed.ops, plan: parsed.plan }, errors: [] };
  } catch (error) {
    return { errors: [`Malformed build operation: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

/** The summary and raw ops of any reply that is a JSON object with an ops array, even one prepareReply rejects. */
function rejectedBuild(value: unknown): { summary: string; ops: unknown[] } | null {
  let decoded = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value) as unknown; }
    catch { return null; }
  }
  if (!decoded || typeof decoded !== "object" || !Array.isArray((decoded as Record<string, unknown>).ops)) return null;
  const { summary, ops } = decoded as { summary?: unknown; ops: unknown[] };
  return { summary: typeof summary === "string" ? summary.trim().slice(0, 2000) : "", ops };
}

/**
 * Smaller versions of a failing op to try in order: a missing parent detached to the root, then each
 * non-Transform component removed in turn (a broken Script or bad field costs only that component).
 */
function repairs(scene: Scene, op: SceneOp): SceneOp[] {
  if (op.op !== "create" && op.op !== "update") return [];
  const variants: SceneOp[] = [];
  const parent = typeof op.parent === "string" && !scene.entities.some((entity) => entity.id === op.parent) ? { ...op, parent: null } : op;
  if (parent !== op) variants.push(parent);
  for (const name of Object.keys(op.components)) {
    if (name === "Transform") continue;
    const { [name]: _dropped, ...components } = op.components;
    variants.push({ ...parent, components } as SceneOp);
  }
  return variants;
}

/**
 * The part of a rejected build that still applies: each op is kept, or repaired (see repairs), only if it
 * applies on top of those kept before it and adds no script compile errors.
 */
function salvageOps(scene: Scene, rawOps: readonly unknown[], newCompileIssues: (candidate: Scene) => string[]): { ops: SceneOp[]; total: number } {
  let current = scene;
  const kept: SceneOp[] = [];
  let total = 0;
  const tryOp = (op: SceneOp) => {
    const applied = applyOps(current, [op]);
    if (applied.errors.length || newCompileIssues(applied.scene).length) return false;
    current = applied.scene;
    kept.push(op);
    return true;
  };
  for (const raw of rawOps) {
    const expanded = expandBuildOperations(current, [raw]);
    total += Math.max(1, expanded.ops.length);
    if (expanded.errors.length) continue;
    for (const op of expanded.ops) {
      if (!tryOp(op)) repairs(current, op).some(tryOp);
    }
  }
  if (!kept.length) return { ops: kept, total };
  // Place unpositioned objects as a normal build would, unless that breaks the kept ops.
  try {
    const tidy = tidyCreates(scene, kept, { preserveExplicitPositions: true }).ops;
    if (!applyOps(scene, tidy).errors.length) return { ops: tidy, total };
  } catch { /* keep the untidied ops */ }
  return { ops: kept, total };
}

/** Errors sent to the model: at most 24, each ≤ 400 characters, ≤ CORRECTION_ERROR_CHARS as JSON. */
function correctionPayload(errors: readonly string[]): string[] {
  const sent: string[] = [];
  for (const error of errors.slice(0, 24)) {
    const line = error.slice(0, 400);
    if (sent.length && JSON.stringify([...sent, line]).length > CORRECTION_ERROR_CHARS) break;
    sent.push(line);
  }
  return sent;
}

/** The rejected reply cut to the room left in the request; dropped when too little room remains to help. */
function echoReply(reply: string, room: number): string {
  if (reply.length <= room) return reply;
  const marker = "\n[Rejected response truncated for context budget.]";
  return room >= 500 ? `${reply.slice(0, room - marker.length)}${marker}` : "";
}

/** Runs the geometry checker; a checker crash must not fail the build. */
function geometryFlags(scene: Scene, ops: SceneOp[], request: string): string[] {
  try { return checkGeometry(scene, ops, request); }
  catch { return []; }
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

const REVIEW_INSTRUCTIONS = "You are now doing a separate second-pass review. Inspect the requested result against the player's exact intent and the first build. Treat the isolated Console output as real script-runtime feedback and the geometry checks as exact measurements. Return one corrected full operation list, or keep the first build unchanged only if it matches the request and its checks are clean. The editor has not applied either build. Do not apply anything; return only the final scene operations in the required JSON format.";

/**
 * Review user message within maxChars: instructions and checks are fixed, then the first build's operations
 * (truncated only if they cannot fit), then as much of the resulting scene as remains. Null when even the
 * fixed parts do not fit.
 */
function reviewPrompt(userPrompt: string, draft: PreparedReply, candidate: Scene, preflight: SceneAgentPreflight, focusIds: readonly string[], geometry: readonly string[], maxChars: number): string | null {
  const sampled = (lines: readonly string[], count: number, width: number, empty: string) => lines.length ? `${lines.slice(0, count).map((line) => `- ${line.slice(0, width)}`).join("\n")}${lines.length > count ? `\n- ${lines.length - count} further lines omitted from review context; all are checked locally.` : ""}` : empty;
  const baselineSet = new Set(preflight.baselineIssues);
  const reviewIssues = [...preflight.issues.filter((issue) => !baselineSet.has(issue)), ...preflight.issues.filter((issue) => baselineSet.has(issue))];
  const consoleOutput = sampled(preflight.console, 5, 180, "- No script print output during the preview.");
  const issueOutput = sampled(reviewIssues, 8, 180, "- No runtime script errors during the preview.");
  const baselineOutput = sampled(preflight.baselineIssues, 4, 180, "- No baseline runtime script errors.");
  const geometryOutput = sampled(geometry, 10, 240, "- No geometry problems found.");
  const compactQuality = preflight.quality ? { ...preflight.quality, checks: undefined, warnings: preflight.quality.warnings.slice(0, 10).map((warning) => warning.slice(0, 180)), totalWarnings: preflight.quality.warnings.length } : undefined;
  const head = `${REVIEW_INSTRUCTIONS}\n\nPLAYER REQUEST:\n${userPrompt}\n\nFIRST BUILD SUMMARY:\n${draft.summary}\n\nFIRST BUILD PLAN:\n${draft.plan || "(none given)"}\n\nFIRST BUILD OPERATIONS:\n`;
  const middle = "\n\nFIRST BUILD RESULTING SCENE:\n";
  const tail = `\n\nISOLATED PLAY-START CONSOLE OUTPUT (${preflight.frames} script ticks of 0.1 seconds; no Rapier physics):\n${consoleOutput}\n\nRUNTIME ISSUES IN THE FIRST BUILD:\n${issueOutput}\n\nRUNTIME ISSUES ALREADY PRESENT BEFORE THIS REQUEST:\n${baselineOutput}\n\nGEOMETRY CHECKS (exact; fix each unless the request intends it):\n${geometryOutput}\n\nDESIGN AND ORGANIZATION CHECKS:\n${JSON.stringify(compactQuality)}\n\nCompare the resulting scene with what the player explicitly asked for. Preserve requested details, correct mismatches, geometry problems or newly introduced errors found in the Console check, and remove unrelated additions. Do not treat baseline issues as caused by this edit. If the first build already matches, return its operations unchanged. Your summary must briefly say what you checked and whether you changed anything. Do not claim visual review or physics checks. Review silhouette and required parts, requested style/colors, proportions, material choices, lighting, camera, repeated counts, and meaningful folders. Design warnings use conservative bounds and may flag intentional contacts; do not remove requested detail merely to reduce warnings. The second-pass operations must apply to the ORIGINAL scene, not the first build result. Return the complete replacement operation list.`;
  const room = maxChars - head.length - middle.length - tail.length;
  if (room < 600) return null;
  const fullOps = JSON.stringify(draft.buildPlan);
  // Keep at least ~1,500 characters of scene when the operations would otherwise take everything.
  const opsRoom = Math.max(400, room - 1_500);
  const opsText = fullOps.length <= opsRoom ? fullOps : `${fullOps.slice(0, opsRoom - 120)}\n[First build operations truncated for context budget; rebuild the rest from the plan and the resulting scene.]`;
  const sceneBudget = Math.max(0, Math.min(23_000, room - opsText.length - 50));
  const context = sceneText(candidate, { maxChars: sceneBudget, query: userPrompt, focusIds });
  return `${head}${opsText}${middle}${context}${tail}`;
}

/**
 * Draft (cheap model, ≤ 2 corrections), validate, measure design and geometry, inspect isolated scripts, then
 * review only when it can matter: the strong model when enabled and the build is large or needed fixing, the
 * cheap model when checks found problems, nothing when the draft is clean. Commits one validated batch.
 */
export async function runSceneAgent(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies): Promise<SceneAgentResult> {
  const sourceErrors = validateScene(scene);
  if (sourceErrors.length) return { ok: false, ops: [], errors: sourceErrors.map((error) => `current ${error}`), attempts: 0 };
  const tooLarge = (attempts = 0): SceneAgentResult => ({ ok: false, ops: [], errors: [TOO_LARGE], attempts });
  if (userPrompt.length > 12_000) return tooLarge();
  const history = requestHistory(dependencies.previousRequests);
  const focusIds = (dependencies.focusIds ?? []).filter((id) => scene.entities.some((entity) => entity.id === id));
  const systemPrompt = dependencies.buildSystemPrompt();
  const draftBudget = MAX_SCENE_INPUT_CHARS - systemPrompt.length - CORRECTION_RESERVE - DRAFT_ECHO_RESERVE;
  const draftPrompt = buildSceneUserMessage(scene, userPrompt, { focusIds, previousRequests: history, maxChars: draftBudget });
  if (draftPrompt.length > draftBudget) return tooLarge();
  const baselineCompileIssues = new Set(validateScripts(scene).map((issue) => scriptErrorText(scene, issue)));
  const newCompileIssues = (candidate: Scene) => validateScripts(candidate).map((issue) => scriptErrorText(candidate, issue)).filter((issue) => !baselineCompileIssues.has(issue));
  const solReviewEnabled = dependencies.solReviewEnabled === true;
  const cacheKey = JSON.stringify(["scene-build-v3", scene, systemPrompt, draftPrompt, userPrompt, history, focusIds, dependencies.responseSchema, solReviewEnabled]);
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

  let attempts = 0;
  /** One model call; errors and the echoed reply are cut so system + user + correction stay within the input cap. */
  const ask = (prompt: string, task: SceneAgentTask, errors: readonly string[], rejected: string) => {
    attempts += 1;
    const correctionErrors = correctionPayload(errors);
    const room = MAX_SCENE_INPUT_CHARS - systemPrompt.length - prompt.length - CORRECTION_WRAPPER_CHARS - JSON.stringify(correctionErrors).length;
    return dependencies.complete({ systemPrompt, userPrompt: prompt, correctionErrors, responseSchema: dependencies.responseSchema,
      previousReply: correctionErrors.length ? echoReply(rejected, room) : rejected, task });
  };
  const replyText = (raw: unknown) => typeof raw === "string" ? raw : JSON.stringify(raw) ?? "";

  const maxRetries = Math.max(0, Math.min(2, dependencies.maxRetries ?? 2));
  let correctionErrors: string[] = [];
  let previousReply = "";
  let draft: PreparedReply | null = null;
  let draftGeometry: string[] = [];
  let draftCalls = 0;
  const rejected: { summary: string; ops: unknown[] }[] = [];
  let requestFailure: string | null = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    if (attempt > 1) dependencies.onProgress?.(`Correcting the first pass (${attempt - 1}/${maxRetries})…`);
    draftCalls = attempt;
    let raw: unknown;
    try {
      raw = await ask(draftPrompt, "scene_draft", correctionErrors, previousReply);
    } catch (error) {
      const truncated = unusableReply(error);
      if (truncated !== null && attempt <= maxRetries) { correctionErrors = [UNUSABLE_REPLY(truncated)]; previousReply = ""; continue; }
      const reason = error instanceof Error ? error.message : String(error);
      requestFailure = `AI request failed: ${reason}`;
      break;
    }
    const prepared = prepareReply(scene, raw);
    const reply = prepared.reply;
    previousReply = replyText(raw);
    if (!reply) {
      correctionErrors = prepared.errors;
      const build = rejectedBuild(raw);
      if (build) rejected.push(build);
      continue;
    }
    const result = applyOps(scene, reply.ops);
    const hardErrors = result.errors.length ? result.errors : newCompileIssues(result.scene);
    // Kept even when only geometry flagged it: a later attempt may fail outright, and this one still applies.
    rejected.push({ summary: reply.summary, ops: reply.ops });
    const geometry = result.errors.length ? [] : geometryFlags(result.scene, reply.ops, userPrompt);
    correctionErrors = [...hardErrors, ...geometry];
    // Geometry flags are soft: the last allowed attempt is accepted with them and they go on to the review.
    if (!hardErrors.length && (!geometry.length || attempt === maxRetries + 1)) {
      draft = reply;
      draftGeometry = geometry;
      break;
    }
  }
  // Every attempt was rejected: keep the largest part of any attempt that still applies instead of wasting
  // the paid calls. Ties go to the later attempt, which had the earlier corrections.
  let skipped: SceneAgentResult["skipped"];
  if (!draft) {
    const errors = requestFailure ? [requestFailure] : correctionErrors;
    let best: { summary: string; ops: SceneOp[]; total: number } | null = null;
    for (const build of rejected) {
      const salvaged = salvageOps(scene, build.ops, newCompileIssues);
      if (salvaged.ops.length && (!best || salvaged.ops.length >= best.ops.length)) best = { summary: build.summary, ...salvaged };
    }
    if (!best) return { ok: false, ops: [], errors, attempts };
    skipped = { kept: best.ops.length, total: best.total, errors: errors.slice(0, 8) };
    const note = best.ops.length < best.total ? ` (Partial: kept ${best.ops.length} of ${best.total} operations; the rest failed validation.)` : " (Some parts were repaired to pass validation.)";
    draft = { summary: `${best.summary || "Built part of the request."}${note}`, ops: best.ops, buildPlan: best.ops, plan: "" };
  }
  /** A result built from the salvaged draft carries what was skipped; a reviewed replacement does not. */
  const withSkipped = (result: SceneAgentResult): SceneAgentResult => skipped && result.ops === draft?.ops ? { ...result, skipped } : result;

  const firstResult = applyOps(scene, draft.ops);
  if (firstResult.errors.length) return { ok: false, ops: [], errors: firstResult.errors, attempts };
  let candidate = firstResult.scene;
  const baselinePreflight = inspectCandidate(scene);
  let preflight = inspectCandidate(candidate, baselinePreflight.issues);
  preflight.quality = inspectBuildQuality(candidate, draft.ops);
  if (draftGeometry.length) preflight.geometry = draftGeometry;
  const draftPreflight = preflight;
  const baselineIssues = new Set(baselinePreflight.issues);
  const draftRuntimeErrors = preflight.issues.filter((line) => !baselineIssues.has(line));
  const useDraftAfterReviewFailure = (reason: string): SceneAgentResult => {
    if (!draft || !firstResult.inverseOps) return { ok: false, ops: [], errors: [reason], attempts, preflight: draftPreflight };
    // The draft passed scene and compile checks, so apply it (undoable) rather than discard paid work; any
    // runtime issues it still has stay listed in the preflight details.
    const issues = draftRuntimeErrors.length ? ` Its Play preview still reports ${draftRuntimeErrors.length} script issue${draftRuntimeErrors.length === 1 ? "" : "s"}; see the check details.` : "";
    return withSkipped({
      ok: true,
      summary: `${draft.summary} Applied the validated first draft because the independent review could not complete: ${reason}${issues}`,
      ops: draft.ops,
      scene: firstResult.scene,
      inverseOps: firstResult.inverseOps,
      errors: [],
      attempts,
      preflight: draftPreflight
    });
  };

  const creates = draft.ops.filter((op) => op.op === "create").length;
  const escalate = solReviewEnabled && (creates >= 3 || draftCalls > 1);
  const clean = !draftRuntimeErrors.length && !draftGeometry.length && !preflight.quality.warnings.length;
  if (!escalate && clean) {
    dependencies.onProgress?.("The first build passed every check; applying it without a second pass…");
    // A salvaged partial is never cached, so retrying the same request makes a fresh build.
    if (!skipped) dependencies.cache?.set(cacheKey, { summary: draft.summary, ops: draft.ops });
    return withSkipped({ ok: true, summary: draft.summary, ops: draft.ops, scene: candidate, inverseOps: firstResult.inverseOps, errors: [], attempts, preflight });
  }
  const reviewTask: SceneAgentTask = escalate ? "scene_review" : "scene_draft";
  dependencies.onProgress?.(escalate ? "Reviewing the first build with the stronger model…" : "Reviewing the first build and its check results…");

  const reviewBudget = MAX_SCENE_INPUT_CHARS - systemPrompt.length - CORRECTION_RESERVE - REVIEW_ECHO_RESERVE;
  const reviewUserPrompt = reviewPrompt(userPrompt, draft, candidate, preflight, focusIds, draftGeometry, reviewBudget);
  if (reviewUserPrompt === null) return useDraftAfterReviewFailure("The review context is too large for one request.");
  correctionErrors = [];
  previousReply = "";
  let reviewed: SceneAgentReply | null = null;
  let reviewedResult: ReturnType<typeof applyOps> | null = null;
  const reviewRetries = 1;
  for (let reviewAttempt = 1; reviewAttempt <= reviewRetries + 1; reviewAttempt += 1) {
    if (reviewAttempt > 1) dependencies.onProgress?.(`Correcting the second pass (${reviewAttempt - 1}/${reviewRetries})…`);
    let raw: unknown;
    try {
      raw = await ask(reviewUserPrompt, reviewTask, correctionErrors, previousReply);
    } catch (error) {
      const truncated = unusableReply(error);
      if (truncated !== null && reviewAttempt <= reviewRetries) { correctionErrors = [UNUSABLE_REPLY(truncated)]; previousReply = ""; continue; }
      const reason = error instanceof Error ? error.message : String(error);
      return useDraftAfterReviewFailure(`Second-pass review failed: ${reason}`);
    }
    previousReply = replyText(raw);
    const prepared = prepareReply(scene, raw);
    reviewed = prepared.reply ?? null;
    if (!reviewed) correctionErrors = prepared.errors;
    else {
      reviewedResult = applyOps(scene, reviewed.ops);
      let hardErrors = reviewedResult.errors.length ? reviewedResult.errors : newCompileIssues(reviewedResult.scene);
      let checked: SceneAgentPreflight | null = null;
      if (!hardErrors.length) {
        checked = inspectCandidate(reviewedResult.scene, baselinePreflight.issues);
        checked.quality = inspectBuildQuality(reviewedResult.scene, reviewed.ops);
        hardErrors = checked.issues.filter((line) => !baselineIssues.has(line));
      }
      const geometry = reviewedResult.errors.length ? [] : geometryFlags(reviewedResult.scene, reviewed.ops, userPrompt);
      correctionErrors = [...hardErrors, ...geometry];
      if (checked && !hardErrors.length && (!geometry.length || reviewAttempt === reviewRetries + 1)) {
        if (geometry.length) checked.geometry = geometry;
        candidate = reviewedResult.scene;
        preflight = checked;
        correctionErrors = [];
        break;
      }
    }
    if (reviewAttempt === reviewRetries + 1) return useDraftAfterReviewFailure(`Second-pass review did not pass validation after ${reviewAttempt} attempts.`);
  }
  if (!reviewed || !reviewedResult || correctionErrors.length) return { ok: false, ops: [], errors: correctionErrors, attempts, preflight };
  dependencies.cache?.set(cacheKey, { summary: reviewed.summary, ops: reviewed.ops });
  return { ok: true, summary: reviewed.summary, ops: reviewed.ops, scene: candidate, inverseOps: reviewedResult.inverseOps, errors: [], attempts, preflight };
}
