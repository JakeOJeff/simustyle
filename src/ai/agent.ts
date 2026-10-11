import { applyOps } from "../scene/applyOps";
import type { Scene, SceneOp } from "../scene/types";
import { validateScripts } from "../runtime/scripts";
import { tidyCreates } from "./placement";

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
}

export interface SceneAgentResult {
  ok: boolean;
  summary?: string;
  ops: SceneOp[];
  scene?: Scene;
  inverseOps?: SceneOp[];
  errors: string[];
  attempts: number;
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

/** Generates, dry-runs, and validates a scene edit with at most three correction retries. */
export async function runSceneAgent(scene: Scene, userPrompt: string, dependencies: SceneAgentDependencies): Promise<SceneAgentResult> {
  const systemPrompt = dependencies.buildSystemPrompt(scene);
  const maxRetries = Math.max(0, Math.min(3, dependencies.maxRetries ?? 3));
  let correctionErrors: string[] = [];
  let previousReply = "";
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let raw: unknown;
    try {
      raw = await dependencies.complete({ systemPrompt, userPrompt, correctionErrors, responseSchema: dependencies.responseSchema, previousReply });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, ops: [], errors: [`AI request failed: ${reason}`], attempts: attempt };
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
        return { ok: true, summary: reply.summary, ops: reply.ops, scene: result.scene, inverseOps: result.inverseOps, errors: [], attempts: attempt };
      }
    }
  }
  return { ok: false, ops: [], errors: correctionErrors, attempts: maxRetries + 1 };
}
