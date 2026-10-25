/**
 * The kinds of AI call the editor makes. The browser names a task; only the server maps a task to a model
 * (see chatProxy.ts), so a page can never pick a more expensive model than the task allows.
 */

/**
 * scene_detail builds one object of a laid-out scene in high detail (see detailPass.ts); it always runs on Luna.
 * scene_critique scores rendered views of a finished build or one chunk of it (see critique.ts) on the vision model.
 * scene_context resolves what a follow-up request refers to before it is built (see references.ts); it runs on
 * the strong model when that is on.
 * scene_concept rates how complex a request is and writes a prompt for a reference image (see concept.ts);
 * scene_image draws that image on the image model, and scene_reference has the vision model turn it into a build spec.
 * scene_fix applies the visual inspection's issues to a build (see inspectAndFix); it runs on the strong model when
 * that is on, with room to rework a whole detailed object.
 */
export type AiTask = "parse" | "scene_draft" | "scene_detail" | "scene_review" | "scene_critique" | "scene_context" | "scene_concept" | "scene_image" | "scene_reference" | "scene_fix";

export const AI_TASKS: readonly AiTask[] = ["parse", "scene_draft", "scene_detail", "scene_review", "scene_critique", "scene_context", "scene_concept", "scene_image", "scene_reference", "scene_fix"];

export interface AiTaskLimits {
  /** Total characters across every message's content (scene_image: of its prompt); larger requests are rejected before any provider call. */
  maxInputChars: number;
  /** Sent to the provider as max_completion_tokens; unused by scene_image. */
  maxCompletionTokens: number;
  /** Credits a visitor must hold before the call; the real charge is computed from usage afterwards. */
  worstCaseCredits: number;
}

export const AI_TASK_LIMITS: Record<AiTask, AiTaskLimits> = {
  parse: { maxInputChars: 8_000, maxCompletionTokens: 800, worstCaseCredits: 2 },
  // Luna worst cases: 48,000 characters in (~12k tokens) plus the full output budget.
  scene_draft: { maxInputChars: 48_000, maxCompletionTokens: 8_000, worstCaseCredits: 5 },
  scene_detail: { maxInputChars: 48_000, maxCompletionTokens: 16_000, worstCaseCredits: 6 },
  scene_review: { maxInputChars: 48_000, maxCompletionTokens: 4_000, worstCaseCredits: 30 },
  // At Sol prices: 24,000 text characters (~6k tokens) + eight 640 px images (~6k tokens) in, 3,000 out ≈ $0.054.
  scene_critique: { maxInputChars: 24_000, maxCompletionTokens: 3_000, worstCaseCredits: 33 },
  // At Sol prices: 32,000 characters (~8k tokens) in, 2,000 out ≈ $0.036.
  scene_context: { maxInputChars: 32_000, maxCompletionTokens: 2_000, worstCaseCredits: 22 },
  // At Sol prices: 16,000 characters (~4k tokens) in, 1,500 out ≈ $0.023.
  scene_concept: { maxInputChars: 16_000, maxCompletionTokens: 1_500, worstCaseCredits: 14 },
  // One high-quality 1024 px image: ~1,800 output image tokens at $30/M (gpt-image-2.5) ≈ $0.06; held at twice that.
  scene_image: { maxInputChars: 4_000, maxCompletionTokens: 0, worstCaseCredits: 72 },
  // At Sol prices: 8,000 characters (~2k tokens) + one image in, 3,000 out ≈ $0.037.
  scene_reference: { maxInputChars: 8_000, maxCompletionTokens: 3_000, worstCaseCredits: 23 },
  // At Sol prices: 48,000 characters (~12k tokens) in, 16,000 out ≈ $0.184.
  scene_fix: { maxInputChars: 48_000, maxCompletionTokens: 16_000, worstCaseCredits: 111 }
};

/** Tasks whose user message may carry inline images. */
export const IMAGE_TASKS: readonly AiTask[] = ["scene_critique", "scene_reference"];
/** An image-carrying request takes at most this many images, each at most this many bytes once decoded. */
export const MAX_CRITIQUE_IMAGES = 8;
export const MAX_CRITIQUE_IMAGE_BYTES = 400 * 1024;

export function isAiTask(value: unknown): value is AiTask {
  return typeof value === "string" && (AI_TASKS as readonly string[]).includes(value);
}
