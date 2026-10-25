import { applyOps } from "../scene/applyOps";
import { createEmptyScene, type Scene, type SceneOp } from "../scene/types";
import { ScriptRuntime, validateScripts } from "../runtime/scripts";
import { tidyCreates } from "./placement";
import { matchedExpansion, sceneText } from "./sceneContext";
import { REFERENCE_SYSTEM_PROMPT, parseResolution, referenceUserMessage, resolutionText, type ContextResolution } from "./references";
import { expandBuildOperations } from "./buildTools";
import { BuildCache } from "./cache";
import { inspectBuildQuality, type BuildQualityReport } from "./quality";
import { validateScene } from "../scene/validate";
import { buildSceneUserMessage, requestHistory } from "./prompt";
import { checkGeometry } from "./geometry";
import { missingRequested } from "./requested";
import { AI_TASK_LIMITS } from "./tasks";
import { parsePartialReply, type PartialReply } from "./partialJson";
import { detailPrompt, fitDetailObject, parseDetailItems, placeLiveDetail, type DetailItem } from "./detailPass";
import { CRITIQUE_PASS_SCORE, critiqueCorrections, type CritiqueIssue, type SceneCritique } from "./critique";

export interface SceneAgentReply {
  summary: string;
  ops: SceneOp[];
}

interface PreparedReply extends SceneAgentReply {
  /** Retain compact assembly/repeat instructions so the reviewer needn't regenerate every copy. */
  buildPlan: unknown[];
  /** The model's parts/sizes plan; context for the reviewer only, never applied. */
  plan: string;
  /** Objects the layout left to be built one by one in detail passes (see detailPass.ts). */
  detail: DetailItem[];
  /** Every object the player explicitly named, as the model listed them; each must be built. */
  requested: string[];
}

/** The scene tasks; the server routes "scene_review" to the strong model and gives "scene_detail" a large output budget. */
export type SceneAgentTask = "scene_draft" | "scene_detail" | "scene_review";

export interface SceneAgentRequest {
  systemPrompt: string;
  userPrompt: string;
  correctionErrors: string[];
  responseSchema: Record<string, unknown>;
  /** The rejected reply as JSON, sent back with the errors so the model can correct it (truncated to the input budget). */
  previousReply: string;
  task: SceneAgentTask;
  /** Set on draft calls when the editor shows builds live: called with the whole reply text written so far. */
  onText?: (text: string) => void;
}

/** A draft as it streams in (see parsePartialReply); attempt counts draft calls from 1. */
export interface LiveBuild extends PartialReply {
  attempt: number;
  /** What is being built right now, when there is more to say than a part count (the detail passes). */
  label?: string;
}

/** At most one partial parse per this many milliseconds while a reply streams. */
const LIVE_INTERVAL_MS = 100;
/** Detail passes run this many at a time; each object gets at most DETAIL_CALLS calls (one correction). */
const DETAIL_CONCURRENCY = 3;
const DETAIL_CALLS = 2;
const UNUSABLE_DETAIL = (truncated: boolean) => truncated
  ? `Your previous reply was cut off at the ${AI_TASK_LIMITS.scene_detail.maxCompletionTokens}-token output limit. Return the object again more compactly: at most 40 parts, repeat ops for repeated features, a plan under 300 characters, and no default-valued fields.`
  : "Your previous reply was not valid JSON. Return only the JSON object with one assemble op.";

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
  /** Shows each draft attempt while it is written, then once more with the finished draft. Reviews are not streamed. */
  onLiveBuild?(build: LiveBuild): void;
  /**
   * Scores a finished build from renders of it (task scene_critique). Absent when visual critique is off; resolves
   * to null when it can't run now (e.g. too few credits for the critique and its fix pass).
   */
  critique?(request: { userPrompt: string; scene: Scene }): Promise<SceneCritique | null>;
  /**
   * The reference step before a follow-up build (task scene_context, see references.ts): sent its system and user
   * messages, returns the raw JSON reply, or null when it cannot run now. Absent: the outline expands the selection
   * and the objects the request names instead.
   */
  resolveReferences?(request: { systemPrompt: string; userPrompt: string }): Promise<unknown>;
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
  /** The visual critique of the build and what came of it (see runSceneAgent). */
  critique?: CritiqueReport;
  /** How a follow-up's scene context was chosen; absent for a build on an empty scene and for cache hits. */
  context?: ContextReport;
}

export interface CritiqueReport {
  /** Score of the build before any fix pass; absent when the critique call failed. */
  score?: number;
  issues: CritiqueIssue[];
  /** passed: scored at least CRITIQUE_PASS_SCORE. fixed: one fix pass applied. kept: the fix pass failed, so the critiqued build stands. failed: the critique call failed. */
  outcome: "passed" | "fixed" | "kept" | "failed";
  /** Why the fix pass or the critique failed. */
  note?: string;
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

export interface ContextReport {
  /** model: the reference step resolved the request. names: it was off or failed, so name matches chose what to expand. */
  source: "model" | "names";
  /** Ids listed part by part in the outline the builder saw; every other group was collapsed to its box. */
  expanded: string[];
  /** The request restated with its references resolved, when that differs from what the player wrote. */
  resolvedRequest?: string;
  facts: string[];
  /** Why the reference step did not run or failed. */
  note?: string;
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
  ? `Your previous reply was cut off at the ${AI_TASK_LIMITS.scene_draft.maxCompletionTokens}-token output limit and could not be used. Return a much more compact complete response: a plan under 400 characters, fewer parts per object (at most 12) but every object, repeat for repeated parts, and no default-valued fields.`
  : "Your previous reply was not valid JSON. Return only the JSON object in the required format.";
/** The model answered but the reply couldn't be used (see UnusableReplyError in client.ts); worth one more try. */
const unusableReply = (error: unknown): boolean | null =>
  error instanceof Error && error.name === "UnusableReplyError" ? (error as Error & { truncated?: boolean }).truncated === true : null;
const TOO_LARGE = "The request or scene instructions are too large. Split the request into smaller edits or select a smaller assembly.";

/** Accepts plan as optional (dropped when applying) so a reply missing it never costs a retry. */
function replyFrom(value: unknown): { plan: string; summary: string; ops: unknown[]; detail?: unknown; requested: string[] } | null {
  let decoded = value;
  if (typeof value === "string") {
    try { decoded = JSON.parse(value) as unknown; }
    catch { return null; }
  }
  if (!decoded || typeof decoded !== "object") return null;
  const candidate = decoded as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || !candidate.summary.trim() || candidate.summary.length > 2000 || !Array.isArray(candidate.ops)) return null;
  const requested = Array.isArray(candidate.requested) ? candidate.requested.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim().slice(0, 60)).slice(0, 20) : [];
  return { plan: typeof candidate.plan === "string" ? candidate.plan.trim().slice(0, 1500) : "", summary: candidate.summary.trim(), ops: candidate.ops, requested,
    ...(candidate.detail !== undefined ? { detail: candidate.detail } : {}) };
}

function prepareReply(scene: Scene, value: unknown): { reply?: PreparedReply; errors: string[] } {
  const parsed = replyFrom(value);
  if (!parsed) return { errors: ["Response must be a JSON object with a plan string, a nonempty summary (at most 2000 characters) and an ops array."] };
  const expanded = expandBuildOperations(scene, parsed.ops);
  if (expanded.errors.length) return { errors: expanded.errors };
  const detail = parseDetailItems(parsed.detail);
  // Detail objects are created later, so their ids and parents must fit the scene the layout ops produce.
  const layoutIds = new Set([...scene.entities.map((entity) => entity.id), ...expanded.ops.flatMap((op) => op.op === "create" ? [op.id] : [])]);
  for (const item of detail.items) {
    if (layoutIds.has(item.id)) detail.errors.push(`detail object '${item.id}' reuses an id that already exists; choose a new id.`);
    if (item.parent !== null && !layoutIds.has(item.parent)) detail.errors.push(`detail object '${item.id}' has parent '${item.parent}', which does not exist.`);
  }
  if (detail.errors.length) return { errors: detail.errors };
  try {
    const tidy = tidyCreates(scene, expanded.ops, { preserveExplicitPositions: true });
    return { reply: { summary: `${parsed.summary}${tidy.notes.length ? ` (Adjusted: ${tidy.notes.join("; ")}.)` : ""}`, ops: tidy.ops, buildPlan: parsed.ops, plan: parsed.plan, detail: detail.items, requested: parsed.requested }, errors: [] };
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

const REVIEW_INSTRUCTIONS = "You are now doing a separate second-pass review. Inspect the requested result against the player's exact intent and the first build. Treat the isolated Console output as real script-runtime feedback and the geometry checks as exact measurements. Return one corrected full operation list, or keep the first build unchanged only if it matches the request and its checks are clean. Checklist before returning: (1) list in \"requested\" every object the player explicitly named and confirm each exists in your ops, named for what it is; a missing one is an error, and extras come only after every requested object is built. (2) Identity: every part must clearly be part of a named thing or its setting (floor, walls, ground, lights); fix or remove any part that isn't. The editor has not applied either build. Do not apply anything; return only the final scene operations in the required JSON format.";

/**
 * Review user message within maxChars: instructions and checks are fixed, then the first build's operations
 * (truncated only if they cannot fit), then as much of the resulting scene as remains. Null when even the
 * fixed parts do not fit.
 */
function reviewPrompt(userPrompt: string, draft: PreparedReply, candidate: Scene, preflight: SceneAgentPreflight, focusIds: readonly string[], geometry: readonly string[], maxChars: number, expand?: readonly string[]): string | null {
  const sampled = (lines: readonly string[], count: number, width: number, empty: string) => lines.length ? `${lines.slice(0, count).map((line) => `- ${line.slice(0, width)}`).join("\n")}${lines.length > count ? `\n- ${lines.length - count} further lines omitted from review context; all are checked locally.` : ""}` : empty;
  const baselineSet = new Set(preflight.baselineIssues);
  const reviewIssues = [...preflight.issues.filter((issue) => !baselineSet.has(issue)), ...preflight.issues.filter((issue) => baselineSet.has(issue))];
  const consoleOutput = sampled(preflight.console, 5, 180, "- No script print output during the preview.");
  const issueOutput = sampled(reviewIssues, 8, 180, "- No runtime script errors during the preview.");
  const baselineOutput = sampled(preflight.baselineIssues, 4, 180, "- No baseline runtime script errors.");
  const geometryOutput = sampled(geometry, 10, 240, "- No geometry problems found.");
  const compactQuality = preflight.quality ? { ...preflight.quality, checks: undefined, warnings: preflight.quality.warnings.slice(0, 10).map((warning) => warning.slice(0, 180)), totalWarnings: preflight.quality.warnings.length } : undefined;
  const head = `${REVIEW_INSTRUCTIONS}\n\nPLAYER REQUEST:\n${userPrompt}\n\nFIRST BUILD SUMMARY:\n${draft.summary}\n\nFIRST BUILD PLAN:\n${draft.plan || "(none given)"}\n\nREQUESTED OBJECTS LISTED BY THE FIRST BUILD (re-check against the request):\n${draft.requested.length ? draft.requested.join("; ") : "(none listed)"}\n\nFIRST BUILD OPERATIONS:\n`;
  const middle = "\n\nFIRST BUILD RESULTING SCENE:\n";
  const tail = `\n\nISOLATED PLAY-START CONSOLE OUTPUT (${preflight.frames} script ticks of 0.1 seconds; no Rapier physics):\n${consoleOutput}\n\nRUNTIME ISSUES IN THE FIRST BUILD:\n${issueOutput}\n\nRUNTIME ISSUES ALREADY PRESENT BEFORE THIS REQUEST:\n${baselineOutput}\n\nGEOMETRY CHECKS (exact; fix each unless the request intends it):\n${geometryOutput}\n\nDESIGN AND ORGANIZATION CHECKS:\n${JSON.stringify(compactQuality)}\n\nCompare the resulting scene with what the player explicitly asked for. Preserve requested details, correct mismatches, geometry problems or newly introduced errors found in the Console check. Keep decorative details that support the request (props, clutter, small objects). Remove only things that contradict the request or that the player clearly didn't want. If the first build is sparse, add detail instead of removing it. Do not treat baseline issues as caused by this edit. If the first build already matches, return its operations unchanged. Your summary must briefly say what you checked and whether you changed anything. Do not claim visual review or physics checks. Review silhouette and required parts, requested style/colors, proportions, material choices, lighting, camera, repeated counts, and meaningful folders. Design warnings use conservative bounds and may flag intentional contacts; do not remove requested detail merely to reduce warnings. The second-pass operations must apply to the ORIGINAL scene, not the first build result. Return the complete replacement operation list.`;
  const room = maxChars - head.length - middle.length - tail.length;
  if (room < 600) return null;
  const fullOps = JSON.stringify(draft.buildPlan);
  // Keep at least ~1,500 characters of scene when the operations would otherwise take everything.
  const opsRoom = Math.max(400, room - 1_500);
  const opsText = fullOps.length <= opsRoom ? fullOps : `${fullOps.slice(0, opsRoom - 120)}\n[First build operations truncated for context budget; rebuild the rest from the plan and the resulting scene.]`;
  const sceneBudget = Math.max(0, Math.min(23_000, room - opsText.length - 50));
  // A follow-up review sees the same outline as the draft, plus everything the draft created or changed.
  const context = sceneText(candidate, { maxChars: sceneBudget, query: userPrompt, focusIds, ...(expand ? { expand: [...expand, ...touchedIds(draft.ops)] } : {}) });
  return `${head}${opsText}${middle}${context}${tail}`;
}

/** Script compile errors a candidate has that the source scene did not. */
function compileIssueCheck(scene: Scene): (candidate: Scene) => string[] {
  const baseline = new Set(validateScripts(scene).map((issue) => scriptErrorText(scene, issue)));
  return (candidate) => validateScripts(candidate).map((issue) => scriptErrorText(candidate, issue)).filter((issue) => !baseline.has(issue));
}

/** Builds that create fewer entities than this skip the visual critique. */
const MIN_CRITIQUE_CREATES = 3;

/**
 * Draft (cheap model, ≤ 2 corrections), validate, measure design and geometry, inspect isolated scripts, then
 * review only when it can matter: the strong model when enabled and the build is large or needed fixing, the
 * cheap model when checks found problems, nothing when the draft is clean. When visual critique is on, a build
 * that created 3+ entities is then rendered and scored, and one below CRITIQUE_PASS_SCORE gets one fix pass
 * (see critiqueAndFix). Commits one validated batch.
 */
export async function runSceneAgent(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies): Promise<SceneAgentResult> {
  const context: BuildContext = {};
  const withContext = (result: SceneAgentResult): SceneAgentResult => context.report && result.preflight ? { ...result, preflight: { ...result.preflight, context: context.report } } : result;
  const built = await buildScene(scene, userPrompt, dependencies, context);
  const created = built.ops.filter((op) => op.op === "create").length;
  if (!dependencies.critique || !built.ok || !built.scene || built.cacheHit || created < MIN_CRITIQUE_CREATES) return withContext(built);
  return withContext(await critiqueAndFix(scene, userPrompt, built, dependencies, context));
}

/** What buildScene settled on for the scene context, kept for the critique's fix pass and the result. */
interface BuildContext {
  /** Outline mode's expanded ids; unset when the scene was empty and was sent in full. */
  expand?: string[];
  report?: ContextReport;
}

/** Ids a batch creates or updates; a follow-up's outline expands them so the builder sees what it just made. */
const touchedIds = (ops: readonly SceneOp[]) => ops.flatMap((op) => op.op === "create" || op.op === "update" ? [op.id] : []);

/** The per-request prompts and cache key; shared by the build and the critique step that may replace its cache entry. */
function requestContext(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies) {
  const history = requestHistory(dependencies.previousRequests);
  const focusIds = (dependencies.focusIds ?? []).filter((id) => scene.entities.some((entity) => entity.id === id));
  const systemPrompt = dependencies.buildSystemPrompt();
  const draftBudget = MAX_SCENE_INPUT_CHARS - systemPrompt.length - CORRECTION_RESERVE - DRAFT_ECHO_RESERVE;
  // The draft message depends on the reference step's answer, so the key holds what that step is asked instead.
  const cacheKey = JSON.stringify(["scene-build-v4", scene, systemPrompt, userPrompt, history, focusIds, dependencies.responseSchema,
    dependencies.solReviewEnabled === true, Boolean(dependencies.resolveReferences)]);
  return { history, focusIds, systemPrompt, draftBudget, cacheKey };
}

/**
 * The reference step for a follow-up: what the request refers to and which groups to expand in the outline the
 * builder sees. Without the step (or when it fails) the selection and groups the request names are expanded.
 * Selected parts inside a group are always expanded, so the builder can edit them by id.
 */
async function resolveContext(scene: Scene, userPrompt: string, history: readonly string[], focusIds: readonly string[], dependencies: SceneAgentDependencies): Promise<{ expand: string[]; resolution: string; report: ContextReport }> {
  const byNames = (note?: string) => {
    const expand = matchedExpansion(scene, userPrompt, focusIds);
    return { expand, resolution: "", report: { source: "names" as const, expanded: expand, facts: [], ...(note ? { note } : {}) } };
  };
  if (!dependencies.resolveReferences) return byNames();
  dependencies.onProgress?.("Working out what the request refers to in the scene…");
  let resolution: ContextResolution | null;
  try {
    const raw = await dependencies.resolveReferences({ systemPrompt: REFERENCE_SYSTEM_PROMPT, userPrompt: referenceUserMessage(scene, userPrompt, { previousRequests: history, focusIds }) });
    if (raw === null) return byNames("The reference step was skipped.");
    resolution = parseResolution(raw, scene, userPrompt);
  } catch (error) {
    return byNames(`The reference step failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
  }
  if (!resolution) return byNames("The reference step returned an unusable reply.");
  const nestedSelection = focusIds.filter((id) => scene.entities.find((entity) => entity.id === id)?.parent);
  const expand = [...new Set([...resolution.expand, ...nestedSelection])];
  const restated = resolution.resolvedRequest.trim() !== userPrompt.trim();
  return { expand, resolution: resolutionText(resolution, userPrompt),
    report: { source: "model", expanded: expand, facts: resolution.facts, ...(restated ? { resolvedRequest: resolution.resolvedRequest } : {}) } };
}

async function buildScene(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies, context: BuildContext): Promise<SceneAgentResult> {
  const sourceErrors = validateScene(scene);
  if (sourceErrors.length) return { ok: false, ops: [], errors: sourceErrors.map((error) => `current ${error}`), attempts: 0 };
  const tooLarge = (attempts = 0): SceneAgentResult => ({ ok: false, ops: [], errors: [TOO_LARGE], attempts });
  if (userPrompt.length > 12_000) return tooLarge();
  const { history, focusIds, systemPrompt, draftBudget, cacheKey } = requestContext(scene, userPrompt, dependencies);
  const draftMessage = (options: { expand?: string[]; resolution?: string } = {}) =>
    buildSceneUserMessage(scene, userPrompt, { focusIds, previousRequests: history, maxChars: draftBudget, ...options });
  // Checked before any call: the request and history alone must leave room for the scene.
  if (draftMessage({ expand: [] }).length > draftBudget) return tooLarge();
  const newCompileIssues = compileIssueCheck(scene);
  const solReviewEnabled = dependencies.solReviewEnabled === true;
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

  // A follow-up sees the scene as an outline: top-level objects, with groups collapsed to their world boxes except
  // those the request involves. A first build has nothing to outline.
  let draftPrompt = draftMessage();
  if (scene.entities.length) {
    const resolved = await resolveContext(scene, userPrompt, history, focusIds, dependencies);
    context.expand = resolved.expand;
    context.report = resolved.report;
    draftPrompt = draftMessage({ expand: resolved.expand, resolution: resolved.resolution });
    if (draftPrompt.length > draftBudget) draftPrompt = draftMessage({ expand: resolved.expand });
  }

  let attempts = 0;
  /** One model call; errors and the echoed reply are cut so system + user + correction stay within the input cap. */
  const ask = (prompt: string, task: SceneAgentTask, errors: readonly string[], rejected: string, onText?: (text: string) => void) => {
    attempts += 1;
    const correctionErrors = correctionPayload(errors);
    const room = MAX_SCENE_INPUT_CHARS - systemPrompt.length - prompt.length - CORRECTION_WRAPPER_CHARS - JSON.stringify(correctionErrors).length;
    return dependencies.complete({ systemPrompt, userPrompt: prompt, correctionErrors, responseSchema: dependencies.responseSchema,
      previousReply: correctionErrors.length ? echoReply(rejected, room) : rejected, task, ...(onText ? { onText } : {}) });
  };
  /** A streaming callback that hands the parsed partial reply to show, at most every LIVE_INTERVAL_MS; none without a live listener. */
  const throttledLive = (show: (partial: PartialReply) => void) => {
    if (!dependencies.onLiveBuild) return undefined;
    let parsedAt = 0;
    return (text: string) => {
      const now = Date.now();
      if (now - parsedAt < LIVE_INTERVAL_MS) return;
      parsedAt = now;
      show(parsePartialReply(text));
    };
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
      raw = await ask(draftPrompt, "scene_draft", correctionErrors, previousReply, throttledLive((partial) => dependencies.onLiveBuild?.({ ...partial, attempt })));
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
    // The last throttled update may have missed the end of the reply; show the finished draft.
    if (dependencies.onLiveBuild) dependencies.onLiveBuild({ ...parsePartialReply(previousReply), attempt });
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
    // A missing requested object is fed back like a geometry flag: corrected while retries remain, then reviewed.
    const geometry = result.errors.length ? [] : [...missingRequested(result.scene, reply.requested, reply.detail), ...geometryFlags(result.scene, reply.ops, userPrompt)];
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
    draft = { summary: `${best.summary || "Built part of the request."}${note}`, ops: best.ops, buildPlan: best.ops, plan: "", detail: [], requested: [] };
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

  // A laid-out scene: build each listed object in its own detail pass instead of reviewing the layout.
  if (draft.detail.length) {
    const layout = draft;
    const items = layout.detail;
    dependencies.onProgress?.(`Laid out the scene; detailing ${items.length} object${items.length === 1 ? "" : "s"}…`);
    /** Fitted ops of finished objects in finish order, so the live view's finished prefix only ever grows. */
    const finished: SceneOp[] = [];
    const growing = new Map<string, unknown[]>();
    const notes: string[] = [];
    const failed: string[] = [];
    let current = firstResult.scene;
    let done = 0;
    const showLive = () => {
      const inProgress = items.filter((item) => growing.has(item.id)).map((item) => item.name);
      dependencies.onLiveBuild?.({ plan: layout.plan, ops: [...layout.ops, ...finished, ...[...growing.values()].flat()], complete: layout.ops.length + finished.length,
        attempt: draftCalls, label: `Detailing ${Math.min(done + 1, items.length)} of ${items.length}${inProgress.length ? `: ${inProgress.join(", ")}` : ""}…` });
    };
    const buildItem = async (item: DetailItem) => {
      const prompt = detailPrompt(userPrompt, layout.plan, items, item);
      let errors: string[] = [];
      let rejectedReply = "";
      /** A first attempt whose only problems were detached parts; used if the correction fails outright. */
      let soft: { ops: SceneOp[]; notes: string[] } | null = null;
      let failure = "";
      for (let call = 1; call <= DETAIL_CALLS; call += 1) {
        let raw: unknown;
        try {
          raw = await ask(prompt, "scene_detail", errors, rejectedReply, throttledLive((partial) => { growing.set(item.id, placeLiveDetail(item, partial.ops)); showLive(); }));
        } catch (error) {
          const truncated = unusableReply(error);
          failure = error instanceof Error ? error.message : String(error);
          if (truncated !== null && call < DETAIL_CALLS) { errors = [UNUSABLE_DETAIL(truncated)]; rejectedReply = ""; continue; }
          break;
        }
        rejectedReply = replyText(raw);
        const parsed = replyFrom(raw);
        if (!parsed) { errors = ["Response must be a JSON object with plan, summary and an ops array holding one assemble op."]; failure = errors[0]!; continue; }
        const lastCall = call === DETAIL_CALLS;
        // Only building ops count; a stray settings or delete op is ignored rather than retried.
        const building = parsed.ops.filter((op) => ["assemble", "create", "repeat"].includes(String((op as { op?: unknown })?.op)));
        const expanded = expandBuildOperations(createEmptyScene(), building);
        const repairs: string[] = [];
        let objectOps = expanded.ops;
        const invalid = expanded.errors.length ? expanded.errors : applyOps(createEmptyScene(), expanded.ops).errors;
        if (invalid.length) {
          if (!lastCall) { errors = invalid; failure = errors[0]!; continue; }
          // Last call: keep every part that applies, dropping only a broken component (such as an unknown texture name).
          const salvaged = salvageOps(createEmptyScene(), building, () => []);
          if (!salvaged.ops.length || salvaged.ops.length < salvaged.total * 0.8) { failure = invalid[0]!; break; }
          objectOps = salvaged.ops;
          repairs.push(invalid[0]!);
        }
        const fitted = fitDetailObject(item, objectOps);
        if (!fitted.ops.length) { errors = fitted.notes; failure = errors[0]!; continue; }
        let applied = applyOps(current, fitted.ops);
        if (applied.errors.length && !lastCall) { errors = applied.errors; failure = errors[0]!; continue; }
        if (applied.errors.length) {
          const kept = salvageOps(current, fitted.ops, () => []).ops;
          if (kept.length < fitted.ops.length * 0.8) { failure = applied.errors[0]!; break; }
          repairs.push(applied.errors[0]!);
          fitted.ops = kept;
          applied = applyOps(current, kept);
          if (applied.errors.length) { failure = applied.errors[0]!; break; }
        }
        if (repairs.length) fitted.notes.push(`${item.name}: some parts repaired or left out (${repairs[0]!.slice(0, 120)})`);
        // Only detached parts are corrected here: ground contact and clearance depend on objects still being built.
        const detached = geometryFlags(applied.scene, fitted.ops, userPrompt).filter((line) => line.includes("touches nothing"));
        if (detached.length && !lastCall) { soft = fitted; errors = detached; continue; }
        current = applied.scene;
        finished.push(...fitted.ops);
        notes.push(...fitted.notes);
        growing.delete(item.id);
        done += 1;
        showLive();
        return;
      }
      growing.delete(item.id);
      const fallback = soft && applyOps(current, soft.ops);
      if (soft && fallback && !fallback.errors.length) {
        current = fallback.scene;
        finished.push(...soft.ops);
        notes.push(...soft.notes);
        done += 1;
      } else failed.push(`${item.name}${failure ? ` (${failure.slice(0, 160)})` : ""}`);
      showLive();
    };
    let next = 0;
    const worker = async () => { while (next < items.length) await buildItem(items[next++]!); };
    await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, items.length) }, worker));

    const ops = [...layout.ops, ...finished];
    const combined = applyOps(scene, ops);
    if (combined.errors.length) return useDraftAfterReviewFailure(`The detailed objects could not be combined: ${combined.errors.slice(0, 2).join("; ")}`);
    const checked = inspectCandidate(combined.scene, baselinePreflight.issues);
    checked.quality = inspectBuildQuality(combined.scene, ops);
    const geometry = geometryFlags(combined.scene, ops, userPrompt);
    if (geometry.length) checked.geometry = geometry;
    const parts = finished.filter((op) => op.op === "create" && op.components.Mesh).length;
    const summary = `${layout.summary} Built ${items.length - failed.length} of ${items.length} objects in detail (${parts} parts).` +
      `${notes.length ? ` (Adjusted: ${notes.join("; ")}.)` : ""}${failed.length ? ` Could not detail: ${failed.join("; ")}.` : ""}`;
    if (!failed.length && !skipped) dependencies.cache?.set(cacheKey, { summary, ops });
    return withSkipped({ ok: true, summary, ops, scene: combined.scene, inverseOps: combined.inverseOps, errors: [], attempts, preflight: checked });
  }

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
  const reviewUserPrompt = reviewPrompt(userPrompt, draft, candidate, preflight, focusIds, draftGeometry, reviewBudget, context.expand);
  if (reviewUserPrompt === null) return useDraftAfterReviewFailure("The review context is too large for one request.");
  correctionErrors = [];
  previousReply = "";
  let reviewed: PreparedReply | null = null;
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
      // The reviewer re-lists the requested objects; a reviewer that leaves the list out is held to the draft's.
      const requested = reviewed.requested.length ? reviewed.requested : draft.requested;
      const geometry = reviewedResult.errors.length ? [] : [...missingRequested(reviewedResult.scene, requested), ...geometryFlags(reviewedResult.scene, reviewed.ops, userPrompt)];
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


/**
 * Visual critique of a finished build: score it from renders, and below CRITIQUE_PASS_SCORE run one fix pass whose
 * ops apply on top of the build, with the critique's issues as its correction errors. The fix must apply, add no
 * script compile or runtime errors and no more geometry flags than the build had; otherwise the build stands as it
 * was. Never a second critique.
 */
async function critiqueAndFix(scene: Scene, userPrompt: string, built: SceneAgentResult, dependencies: SceneAgentDependencies, context: BuildContext): Promise<SceneAgentResult> {
  const before = built.preflight ?? inspectCandidate(built.scene!);
  const report = (critique: CritiqueReport, result: SceneAgentResult = built, preflight = before): SceneAgentResult =>
    ({ ...result, preflight: { ...preflight, critique } });
  dependencies.onProgress?.("Rendering the build for a visual critique…");
  let critique: SceneCritique | null;
  try {
    critique = await dependencies.critique!({ userPrompt, scene: built.scene! });
  } catch (error) {
    return report({ issues: [], outcome: "failed", note: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
  }
  if (!critique) return built;
  if (critique.score >= CRITIQUE_PASS_SCORE || !critique.issues.length) return report({ score: critique.score, issues: critique.issues, outcome: "passed" });
  const kept = (note: string) => report({ score: critique.score, issues: critique.issues, outcome: "kept", note });

  dependencies.onProgress?.(`The visual critique scored the build ${critique.score}/10; fixing ${critique.issues.length} issue${critique.issues.length === 1 ? "" : "s"}…`);
  const { history, systemPrompt, cacheKey } = requestContext(scene, userPrompt, dependencies);
  const focusIds = critique.issues.flatMap((issue) => issue.entityId && built.scene!.entities.some((entity) => entity.id === issue.entityId) ? [issue.entityId] : []);
  const fixRequest = `A reviewer looked at renders of the build you made for this request and found the problems listed after this message: "${userPrompt.slice(0, 2_000)}". Fix each one in the current scene. Return only the ops that change it (update, delete, or create for anything missing); do not rebuild what is already right.`;
  const budget = MAX_SCENE_INPUT_CHARS - systemPrompt.length - CORRECTION_RESERVE;
  // A follow-up fix sees the outline with the critiqued and newly built entities expanded.
  const expand = context.expand ? [...context.expand, ...focusIds, ...touchedIds(built.ops)] : undefined;
  const prompt = buildSceneUserMessage(built.scene!, fixRequest, { focusIds, previousRequests: history, maxChars: budget, ...(expand ? { expand } : {}) });
  if (prompt.length > budget) return kept("The scene is too large for a fix request.");
  let raw: unknown;
  try {
    raw = await dependencies.complete({ systemPrompt, userPrompt: prompt, correctionErrors: correctionPayload(critiqueCorrections(critique)),
      responseSchema: dependencies.responseSchema, previousReply: "", task: "scene_draft" });
  } catch (error) {
    return kept(`The fix pass failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
  }
  const prepared = prepareReply(built.scene!, raw);
  if (!prepared.reply) return kept(`The fix pass reply was invalid: ${prepared.errors[0]?.slice(0, 200) ?? "no ops"}`);
  const ops = [...built.ops, ...prepared.reply.ops];
  const combined = applyOps(scene, ops);
  const compile = combined.errors.length ? [] : compileIssueCheck(scene)(combined.scene);
  if (combined.errors.length || compile.length) return kept(`The fix pass did not validate: ${[...combined.errors, ...compile][0]!.slice(0, 200)}`);
  const baseline = inspectCandidate(scene);
  const checked = inspectCandidate(combined.scene, baseline.issues);
  const newRuntime = checked.issues.filter((line) => !before.issues.includes(line));
  if (newRuntime.length) return kept(`The fix pass added a script error: ${newRuntime[0]!.slice(0, 200)}`);
  const geometry = geometryFlags(combined.scene, ops, userPrompt);
  if (geometry.length > (before.geometry?.length ?? 0)) return kept(`The fix pass added geometry problems: ${geometry[0]!.slice(0, 200)}`);
  checked.quality = inspectBuildQuality(combined.scene, ops);
  if (geometry.length) checked.geometry = geometry;
  const summary = `${built.summary ?? ""} Visual critique: ${critique.score}/10; fixed: ${prepared.reply.summary}`.trim();
  if (!built.skipped) dependencies.cache?.set(cacheKey, { summary, ops });
  return report({ score: critique.score, issues: critique.issues, outcome: "fixed" },
    { ...built, summary, ops, scene: combined.scene, inverseOps: combined.inverseOps, attempts: built.attempts + 1 }, checked);
}
