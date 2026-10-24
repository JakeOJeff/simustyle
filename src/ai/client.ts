/** Browser-side client for the Vite development server's secret-holding proxy. */
import { AI_RESPONSE_JSON_SCHEMA } from "./prompt";
import { desktopChat, isDesktopRuntime } from "../platform/desktop";
import type { CreditStatus } from "./credits";

export type { CreditStatus };

let creditListener: ((credits: CreditStatus) => void) | null = null;

/** Called with the visitor's balance after every AI call the hosted proxy meters. */
export function onCreditsChange(listener: ((credits: CreditStatus) => void) | null): void {
  creditListener = listener;
}

/** Reads today's AI credits from the hosted proxy; null when AI is off, runs on the desktop, or is unreachable. */
export async function fetchCredits(): Promise<CreditStatus | null> {
  if (isDesktopRuntime()) return null;
  try {
    const response = await fetch("/api/ai/credits", { cache: "no-store" });
    const payload = await response.json() as unknown;
    return isRecord(payload) && isCreditStatus(payload.credits) ? payload.credits : null;
  } catch {
    return null;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Sends one scene-edit request and returns the model's JSON object for agent validation. */
export async function requestSceneEdit(
  systemPrompt: string,
  userPrompt: string,
  correctionErrors: string[] = [],
  responseSchema: Record<string, unknown> = AI_RESPONSE_JSON_SCHEMA.schema,
  previousReply = ""
): Promise<unknown> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
  if (correctionErrors.length > 0) {
    // Show the rejected reply so the model corrects it instead of starting over.
    if (previousReply) messages.push({ role: "assistant", content: previousReply.length > 40_000 ? `${previousReply.slice(0, 39_900)}\n[Rejected response truncated for context budget.]` : previousReply });
    messages.push({
      role: "user",
      content: `Fix only these errors and return the full corrected JSON response: ${JSON.stringify(correctionErrors.slice(0, 24).map((error) => error.slice(0, 1000)))}`
    });
  }

  return requestJson(messages, { ...AI_RESPONSE_JSON_SCHEMA, schema: responseSchema });
}

/** Sends chat messages through the proxy (or desktop shell) and returns the model's parsed JSON object. */
export async function requestJson(
  messages: ChatMessage[],
  jsonSchema: { name: string; strict: boolean; schema: Record<string, unknown> }
): Promise<unknown> {
  const request = { messages, responseFormat: { type: "json_schema", json_schema: jsonSchema } };
  let payload: unknown;
  if (isDesktopRuntime()) {
    payload = await desktopChat(request);
  } else {
    let response: Response;
    try {
      response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request)
      });
    } catch {
      throw new Error("Could not reach the local AI endpoint. Check that the development server is running.");
    }
    payload = await response.json().catch(() => null);
    if (isRecord(payload) && isCreditStatus(payload.credits)) creditListener?.(payload.credits);
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === "string"
        ? payload.error
        : `AI request failed with HTTP ${response.status}.`;
      throw new Error(message);
    }
  }
  if (!isRecord(payload) || typeof payload.content !== "string") {
    throw new Error("AI server returned an invalid response.");
  }
  try {
    return JSON.parse(payload.content) as unknown;
  } catch {
    throw new Error("The model returned invalid JSON.");
  }
}

function isCreditStatus(value: unknown): value is CreditStatus {
  return isRecord(value) && typeof value.remaining === "number" && typeof value.limit === "number" && typeof value.resetsAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
