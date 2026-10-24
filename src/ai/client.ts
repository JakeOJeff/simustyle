/** Browser-side client for the Vite development server's secret-holding proxy. */
import { AI_RESPONSE_JSON_SCHEMA } from "./prompt";
import { desktopChat, isDesktopRuntime } from "../platform/desktop";
import type { CreditStatus } from "./credits";
import type { AiTask } from "./tasks";

export type { AiTask, CreditStatus };

let creditListener: ((credits: CreditStatus) => void) | null = null;

/** Called with the visitor's balance after every AI call the hosted proxy meters. */
export function onCreditsChange(listener: ((credits: CreditStatus) => void) | null): void {
  creditListener = listener;
}

/** Reads today's AI credits from the hosted proxy; null when AI is off, runs on the desktop, or is unreachable. */
export async function fetchCredits(): Promise<CreditStatus | null> {
  return (await fetchAiStatus()).credits;
}

export interface AiStatus {
  credits: CreditStatus | null;
  /** True when the server will run scene_review on the strong model, so asking for a review is worth it. */
  solReview: boolean;
}

/** Reads the visitor's credits and whether the strong review model is on. The desktop app meters nothing. */
export async function fetchAiStatus(): Promise<AiStatus> {
  if (isDesktopRuntime()) return { credits: null, solReview: false };
  try {
    const response = await fetch("/api/ai/credits", { cache: "no-store" });
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) return { credits: null, solReview: false };
    return { credits: isCreditStatus(payload.credits) ? payload.credits : null, solReview: payload.solReview === true };
  } catch {
    return { credits: null, solReview: false };
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
  previousReply = "",
  task: AiTask = "scene_draft"
): Promise<unknown> {
  return requestJson(sceneEditMessages(systemPrompt, userPrompt, correctionErrors, previousReply), { ...AI_RESPONSE_JSON_SCHEMA, schema: responseSchema }, task);
}

/** The chat messages for one scene-edit call; a correction replays the rejected reply, then the errors to fix. */
export function sceneEditMessages(systemPrompt: string, userPrompt: string, correctionErrors: string[] = [], previousReply = ""): ChatMessage[] {
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
  return messages;
}

/**
 * The model answered (and was billed) but the reply can't be used: cut off at the output limit or not JSON.
 * Unlike transport errors, callers can ask the model again with a correction.
 */
export class UnusableReplyError extends Error {
  override readonly name = "UnusableReplyError";
  constructor(readonly truncated: boolean) {
    super(truncated ? "The model's reply was cut off at the output limit." : "The model returned invalid JSON.");
  }
}

/**
 * Sends chat messages through the proxy (or desktop shell) and returns the model's parsed JSON object.
 * The hosted proxy picks the model from `task`; the desktop app always uses the user's own configured model.
 */
export async function requestJson(
  messages: ChatMessage[],
  jsonSchema: { name: string; strict: boolean; schema: Record<string, unknown> },
  task: AiTask
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
        body: JSON.stringify({ task, ...request })
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
  return parseChatPayload(payload);
}

/** The model's JSON object from a successful proxy reply; a cut-off or non-JSON reply is an UnusableReplyError. */
export function parseChatPayload(payload: unknown): unknown {
  if (!isRecord(payload) || typeof payload.content !== "string") {
    throw new Error("AI server returned an invalid response.");
  }
  if (payload.truncated === true) throw new UnusableReplyError(true);
  try {
    return JSON.parse(payload.content) as unknown;
  } catch {
    throw new UnusableReplyError(false);
  }
}

function isCreditStatus(value: unknown): value is CreditStatus {
  return isRecord(value) && typeof value.remaining === "number" && typeof value.limit === "number" && typeof value.resetsAt === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
