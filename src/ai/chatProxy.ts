/**
 * Server-side half of POST /api/ai/chat, shared by the Vite dev server and the Cloudflare Worker.
 * It validates the browser's request and forwards it to an OpenAI-compatible provider, so the key never reaches the page.
 */

import type { CreditStatus, SpendResult } from "./credits";

export const MAX_CHAT_REQUEST_BYTES = 1024 * 1024;

export interface ChatProxyEnv {
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
}

export interface ChatProxyResult {
  status: number;
  body: ({ content: string } | { error: string }) & { credits?: CreditStatus };
}

/** The calling visitor's daily credits; omitted when the server does not meter AI. */
export interface ChatCredits {
  spend(): Promise<SpendResult>;
  refund(): Promise<CreditStatus>;
}

/** Parses raw request bytes and forwards a valid chat request to the configured provider. */
export async function forwardChat(raw: Uint8Array, env: ChatProxyEnv, credits?: ChatCredits): Promise<ChatProxyResult> {
  if (raw.byteLength > MAX_CHAT_REQUEST_BYTES) return fail(413, "AI request body exceeds 1 MiB.");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw)) as unknown;
  } catch {
    return fail(400, "AI request body must be valid JSON.");
  }
  if (!isChatRequest(body)) return fail(400, "AI request requires system/user messages and a JSON response format.");
  if (!env.AI_API_KEY || !env.AI_MODEL) {
    return fail(503, "AI is not configured. Set AI_API_KEY and AI_MODEL in the server environment.");
  }

  const baseUrl = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(baseUrl)) return fail(503, "AI_BASE_URL must be an HTTP or HTTPS URL.");

  let balance: CreditStatus | undefined;
  if (credits) {
    const spent = await credits.spend();
    if (!spent.ok) return { status: 429, body: { error: outOfCreditsMessage(spent.status), credits: spent.status } };
    balance = spent.status;
  }
  // Give the credit back when the call fails, since the provider most likely did not bill it.
  const failAndRefund = async (status: number, error: string): Promise<ChatProxyResult> => {
    const refunded = credits ? await credits.refund() : undefined;
    return { status, body: { error, ...(refunded ? { credits: refunded } : {}) } };
  };
  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.AI_MODEL,
        messages: body.messages,
        response_format: body.responseFormat
      }),
      signal: AbortSignal.timeout(120_000)
    });
    const result = await upstream.json().catch(() => null) as unknown;
    if (!upstream.ok) {
      const message = extractProviderMessage(result) || `AI provider returned HTTP ${upstream.status}.`;
      return failAndRefund(502, message.slice(0, 500));
    }
    const content = extractCompletionContent(result);
    if (content === null) return failAndRefund(502, "AI provider returned no message content.");
    return { status: 200, body: { content, ...(balance ? { credits: balance } : {}) } };
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "AI provider request timed out."
      : "Could not reach the configured AI provider.";
    return failAndRefund(502, message);
  }
}

function outOfCreditsMessage(status: CreditStatus): string {
  return status.globalExhausted
    ? "Today's shared AI budget is used up. AI comes back at 00:00 UTC."
    : `You've used all ${status.limit} free AI credits for today. They reset at 00:00 UTC.`;
}

function fail(status: number, error: string): ChatProxyResult {
  return { status, body: { error } };
}

function isChatRequest(value: unknown): value is {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  responseFormat: Record<string, unknown>;
} {
  if (!isRecord(value) || !Array.isArray(value.messages) || !isRecord(value.responseFormat)) return false;
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
