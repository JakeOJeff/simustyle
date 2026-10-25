/** Browser-side client for the Vite development server's secret-holding proxy. */
import { AI_RESPONSE_JSON_SCHEMA } from "./prompt";
import { CRITIQUE_JSON_SCHEMA } from "./critique";
import { CONCEPT_JSON_SCHEMA, REFERENCE_SPEC_JSON_SCHEMA } from "./concept";
import { REFERENCE_JSON_SCHEMA } from "./references";
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
  /** True when the server accepts scene_critique (visual inspection of finished builds). */
  critique: boolean;
  /** True when the server draws reference images for complex requests (scene_image and scene_reference). */
  referenceImage: boolean;
}

/** Reads the visitor's credits and whether the strong review model is on. The desktop app meters nothing. */
export async function fetchAiStatus(): Promise<AiStatus> {
  const off: AiStatus = { credits: null, solReview: false, critique: false, referenceImage: false };
  if (isDesktopRuntime()) return off;
  try {
    const response = await fetch("/api/ai/credits", { cache: "no-store" });
    const payload = await response.json() as unknown;
    if (!isRecord(payload)) return off;
    return { credits: isCreditStatus(payload.credits) ? payload.credits : null, solReview: payload.solReview === true, critique: payload.critique === true, referenceImage: payload.referenceImage === true };
  } catch {
    return off;
  }
}

/** Text, or an inline base64 image (scene_critique and scene_reference only). */
export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A message that may carry images (scene_critique and scene_reference only; the desktop app has no vision call). */
export interface VisionChatMessage {
  role: "system" | "user";
  content: string | ChatContentPart[];
}

/** Sends one scene-edit request and returns the model's JSON object for agent validation. */
export async function requestSceneEdit(
  systemPrompt: string,
  userPrompt: string,
  correctionErrors: string[] = [],
  responseSchema: Record<string, unknown> = AI_RESPONSE_JSON_SCHEMA.schema,
  previousReply = "",
  task: AiTask = "scene_draft",
  onText?: (text: string) => void
): Promise<unknown> {
  return requestJson(sceneEditMessages(systemPrompt, userPrompt, correctionErrors, previousReply), { ...AI_RESPONSE_JSON_SCHEMA, schema: responseSchema }, task, onText);
}

/** The JSON schema each vision task answers in. */
export const VISION_SCHEMAS = { scene_critique: CRITIQUE_JSON_SCHEMA, scene_reference: REFERENCE_SPEC_JSON_SCHEMA } as const;

/** A vision call (task scene_critique or scene_reference); returns the raw JSON reply. */
export async function requestVision(task: keyof typeof VISION_SCHEMAS, messages: VisionChatMessage[]): Promise<unknown> {
  return requestJson(messages, VISION_SCHEMAS[task], task);
}

/** The concept step before a build (task scene_concept, see concept.ts); returns the raw JSON reply. */
export async function requestConcept(systemPrompt: string, userPrompt: string): Promise<unknown> {
  return requestJson([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], CONCEPT_JSON_SCHEMA, "scene_concept");
}

/** Draws a reference image (task scene_image) and returns it as a data URL. The desktop app has no image call. */
export async function requestImage(prompt: string): Promise<string> {
  if (isDesktopRuntime()) throw new Error("Reference images are not available in the desktop app.");
  let response: Response;
  try {
    response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "scene_image", prompt }) });
  } catch {
    throw new Error("Could not reach the local AI endpoint. Check that the development server is running.");
  }
  const payload = await response.json().catch(() => null) as unknown;
  if (isRecord(payload) && isCreditStatus(payload.credits)) creditListener?.(payload.credits);
  if (!response.ok || !isRecord(payload) || typeof payload.content !== "string") {
    throw new Error(isRecord(payload) && typeof payload.error === "string" ? payload.error : `AI request failed with HTTP ${response.status}.`);
  }
  return payload.content;
}

/** Asks what a follow-up request refers to (task scene_context, see references.ts); returns the raw JSON reply. */
export async function requestReferences(systemPrompt: string, userPrompt: string): Promise<unknown> {
  return requestJson([{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], REFERENCE_JSON_SCHEMA, "scene_context");
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
 * With onText, the proxy streams the reply and onText receives the whole text written so far after each piece
 * (the desktop app does not stream, so there it is never called).
 */
export async function requestJson(
  messages: ChatMessage[] | VisionChatMessage[],
  jsonSchema: { name: string; strict: boolean; schema: Record<string, unknown> },
  task: AiTask,
  onText?: (text: string) => void
): Promise<unknown> {
  const request = { messages, responseFormat: { type: "json_schema", json_schema: jsonSchema } };
  let payload: unknown;
  if (isDesktopRuntime()) {
    if (!messages.every((message): message is ChatMessage => typeof message.content === "string")) throw new Error("Visual critique is not available in the desktop app.");
    payload = await desktopChat({ ...request, messages });
  } else {
    let response: Response;
    try {
      response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, ...request, ...(onText ? { stream: true } : {}) })
      });
    } catch {
      throw new Error("Could not reach the local AI endpoint. Check that the development server is running.");
    }
    payload = response.ok && (response.headers.get("Content-Type") ?? "").includes("ndjson") && response.body
      ? await readStream(response.body, onText ?? (() => undefined))
      : await response.json().catch(() => null);
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

/**
 * Collects a streamed reply (see ChatStreamEvent in chatProxy.ts) into the same payload an unstreamed call returns.
 * A stream that ends without a done or error line broke off.
 */
async function readStream(body: ReadableStream<Uint8Array>, onText: (text: string) => void): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let end: Record<string, unknown> | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let event: unknown;
    try { event = JSON.parse(line); } catch { return; }
    if (!isRecord(event)) return;
    if (typeof event.delta === "string") { content += event.delta; onText(content); }
    else end = event;
  };
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);
  const last = end as Record<string, unknown> | null;
  if (last && isCreditStatus(last.credits)) creditListener?.(last.credits);
  if (!last) throw new Error("The AI reply stream broke off. Try again.");
  if (typeof last.error === "string") throw new Error(last.error);
  return { content, ...(last.truncated === true ? { truncated: true } : {}) };
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
