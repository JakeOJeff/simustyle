/**
 * The kinds of AI call the editor makes. The browser names a task; only the server maps a task to a model
 * (see chatProxy.ts), so a page can never pick a more expensive model than the task allows.
 */

/** scene_detail builds one object of a laid-out scene in high detail (see detailPass.ts); it always runs on Luna. */
export type AiTask = "parse" | "scene_draft" | "scene_detail" | "scene_review";

export const AI_TASKS: readonly AiTask[] = ["parse", "scene_draft", "scene_detail", "scene_review"];

export interface AiTaskLimits {
  /** Total characters across every message's content; larger requests are rejected before any provider call. */
  maxInputChars: number;
  /** Sent to the provider as max_completion_tokens. */
  maxCompletionTokens: number;
  /** Credits a visitor must hold before the call; the real charge is computed from usage afterwards. */
  worstCaseCredits: number;
}

export const AI_TASK_LIMITS: Record<AiTask, AiTaskLimits> = {
  parse: { maxInputChars: 8_000, maxCompletionTokens: 800, worstCaseCredits: 2 },
  // Luna worst cases: 48,000 characters in (~12k tokens) plus the full output budget.
  scene_draft: { maxInputChars: 48_000, maxCompletionTokens: 8_000, worstCaseCredits: 5 },
  scene_detail: { maxInputChars: 48_000, maxCompletionTokens: 16_000, worstCaseCredits: 6 },
  scene_review: { maxInputChars: 48_000, maxCompletionTokens: 4_000, worstCaseCredits: 30 }
};

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === "string" && (AI_TASKS as readonly string[]).includes(value);
}
