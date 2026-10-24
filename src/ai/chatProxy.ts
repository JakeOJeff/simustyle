/**
 * Server-side half of POST /api/ai/chat, shared by the Vite dev server and the Cloudflare Worker.
 * It validates the browser's request, picks the model for the named task, and forwards it to an
 * OpenAI-compatible provider, so neither the key nor the model choice is ever in the page's hands.
 */

import { AI_TASK_LIMITS, isAiTask, type AiTask } from "./tasks";
import { callCostUsd, creditsForCost, readUsage, worstCaseUsd } from "./pricing";
import type { CallCharge, CreditStatus, Reservation, ReserveResult } from "./credits";

export const MAX_CHAT_REQUEST_BYTES = 1024 * 1024;

export interface ChatProxyEnv {
  AI_API_KEY?: string;
  /** Cheap model for every task; falls back to the older AI_MODEL. */
  AI_MODEL_LUNA?: string;
  /** Strong model, used only for scene_review and only when AI_SOL_ENABLED is "true". */
  AI_MODEL_SOL?: string;
  AI_SOL_ENABLED?: string;
  /** Former single-model setting, still honoured when AI_MODEL_LUNA is unset. */
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  /** "true" or "false" forces prompt_cache_key on or off; otherwise it is sent only to api.openai.com. */
  AI_PROMPT_CACHE_KEY?: string;
}

export interface ChatProxyResult {
  status: number;
  body: ({ content: string } | { error: string }) & { credits?: CreditStatus };
}

/** The calling visitor's credits; omitted when the server does not meter AI. */
export interface ChatCredits {
  reserve(task: AiTask): Promise<ReserveResult>;
  settle(reservation: Reservation, charge: CallCharge | null): Promise<CreditStatus>;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export function lunaModel(env: ChatProxyEnv): string | undefined {
  return env.AI_MODEL_LUNA?.trim() || env.AI_MODEL?.trim() || undefined;
}

/** True when the strong model may review scenes; the browser uses this only to decide whether to ask. */
export function solReviewEnabled(env: ChatProxyEnv): boolean {
  return env.AI_SOL_ENABLED === "true" && Boolean(env.AI_MODEL_SOL?.trim()) && isAiConfigured(env);
}

export function isAiConfigured(env: ChatProxyEnv): boolean {
  return Boolean(env.AI_API_KEY && lunaModel(env));
}

/** The model a task runs on. Only scene_review can reach Sol; everything else, and Sol when off, is Luna. */
export function resolveModel(task: AiTask, env: ChatProxyEnv): string | undefined {
  if (task === "scene_review" && solReviewEnabled(env)) return env.AI_MODEL_SOL!.trim();
  return lunaModel(env);
}

export function promptCacheKeyEnabled(baseUrl: string, env: ChatProxyEnv): boolean {
  if (env.AI_PROMPT_CACHE_KEY === "false") return false;
  if (env.AI_PROMPT_CACHE_KEY === "true") return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

/** Parses raw request bytes and forwards a valid chat request to the model its task maps to. */
export async function forwardChat(raw: Uint8Array, env: ChatProxyEnv, credits?: ChatCredits): Promise<ChatProxyResult> {
  if (raw.byteLength > MAX_CHAT_REQUEST_BYTES) return fail(413, "AI request body exceeds 1 MiB.");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return fail(400, "AI request body must be valid JSON.");
  }
  if (!isRecord(body) || !isAiTask(body.task)) return fail(400, "AI request requires a task: parse, scene_draft, or scene_review.");
  if (!isChatRequest(body)) return fail(400, "AI request requires system/user messages and a JSON response format.");
  const task = body.task;
  const limits = AI_TASK_LIMITS[task];
  const inputChars = body.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (inputChars > limits.maxInputChars) {
    return fail(413, `This ${task} request is too long (${inputChars} characters; the limit is ${limits.maxInputChars}). Try a shorter prompt or a smaller scene.`);
  }
  const model = resolveModel(task, env);
  if (!env.AI_API_KEY || !model) {
    return fail(503, "AI is not configured. Set AI_API_KEY and AI_MODEL_LUNA in the server environment.");
  }

  const baseUrl = (env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return fail(503, "AI_BASE_URL must be an HTTP or HTTPS URL.");

  let reservation: Reservation | undefined;
  if (credits) {
    const reserved = await credits.reserve(task);
    if (!reserved.ok || !reserved.reservation) {
      return { status: 429, body: { error: outOfCreditsMessage(reserved, task), credits: reserved.status } };
    }
    reservation = reserved.reservation;
  }
  // Settles the held credits to the real charge, or gives them all back when the call was not billed.
  const settle = async (charge: CallCharge | null): Promise<CreditStatus | undefined> =>
    credits && reservation ? credits.settle(reservation, charge) : undefined;
  const failAndRefund = async (status: number, error: string, charge: CallCharge | null = null): Promise<ChatProxyResult> => {
    const balance = await settle(charge);
    return { status, body: { error, ...(balance ? { credits: balance } : {}) } };
  };

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: body.messages.map(({ role, content }) => ({ role, content })),
        response_format: body.responseFormat,
        max_completion_tokens: limits.maxCompletionTokens,
        ...(promptCacheKeyEnabled(baseUrl, env) ? { prompt_cache_key: `simustyle-${task}-v1` } : {})
      }),
      signal: AbortSignal.timeout(120_000)
    });
    const result = await upstream.json().catch(() => null) as unknown;
    if (!upstream.ok) {
      const message = extractProviderMessage(result) || `AI provider returned HTTP ${upstream.status}.`;
      return failAndRefund(502, message.slice(0, 500));
    }
    const content = extractCompletionContent(result);
    const usage = readUsage(result);
    // With no content and no usage there is no sign the call was billed; otherwise it was, so charge it.
    const charge = content === null && !usage ? null : chargeFor(task, model, usage);
    if (content === null) return failAndRefund(502, "AI provider returned no message content.", charge);
    const balance = await settle(charge);
    return { status: 200, body: { content, ...(balance ? { credits: balance } : {}) } };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "AI provider request timed out."
      : "Could not reach the configured AI provider.";
    return failAndRefund(502, message);
  }
}

/** Prices a finished call from its usage and logs it; missing usage is charged at the task's worst case. */
export function chargeFor(task: AiTask, model: string, usage: ReturnType<typeof readUsage>): CallCharge {
  const costUsd = usage ? callCostUsd(model, usage) : worstCaseUsd(task);
  const credits = usage ? creditsForCost(costUsd) : AI_TASK_LIMITS[task].worstCaseCredits;
  console.log(JSON.stringify({
    event: "ai_call",
    task,
    model,
    promptTokens: usage?.promptTokens ?? null,
    cachedTokens: usage?.cachedTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    costUsd,
    credits,
    ...(usage ? {} : { usageMissing: true })
  }));
  return { task, model, usage, costUsd, credits };
}

function outOfCreditsMessage(result: ReserveResult, task: AiTask): string {
  if (result.reason === "monthly") {
    const back = new Date(result.status.resetsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
    return `This month's shared AI budget is used up. AI comes back on ${back} (UTC).`;
  }
  if (result.status.globalExhausted) {
    return "Today's share of the monthly AI budget is used up. AI comes back at 00:00 UTC.";
  }
  const needed = AI_TASK_LIMITS[task].worstCaseCredits;
  return result.status.remaining > 0
    ? `This request needs up to ${needed} AI credits and you have ${result.status.remaining} left today. They reset at 00:00 UTC.`
    : `You've used all ${result.status.limit} free AI credits for today. They reset at 00:00 UTC.`;
}

function fail(status: number, error: string): ChatProxyResult {
  return { status, body: { error } };
}

function isChatRequest(value: Record<string, unknown>): value is {
  task: AiTask;
  messages: ChatMessage[];
  responseFormat: Record<string, unknown>;
} {
  if (!Array.isArray(value.messages) || !isRecord(value.responseFormat)) return false;
  return value.messages.length >= 2 && value.messages.length <= 8 && value.messages.every((message) =>
    isRecord(message) && (message.role === "system" || message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" && message.content.length <= 50_000
  );
}

function extractCompletionContent(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") return null;
  return first.message.content;
}

function extractProviderMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== "string") return null;
  return value.error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
