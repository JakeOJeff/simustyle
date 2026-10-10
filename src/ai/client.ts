/** Browser-side client for the Vite development server's secret-holding proxy. */
import { AI_RESPONSE_JSON_SCHEMA } from "./prompt";
import { desktopChat, isDesktopRuntime } from "../platform/desktop";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** Sends one scene-edit request and returns the model's JSON object for agent validation. */
export async function requestSceneEdit(
  systemPrompt: string,
  userPrompt: string,
  correctionErrors: string[] = [],
  responseSchema: Record<string, unknown> = AI_RESPONSE_JSON_SCHEMA.schema
): Promise<unknown> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
  if (correctionErrors.length > 0) {
    messages.push({
      role: "user",
      content: `Fix only these errors and return the full corrected JSON response: ${JSON.stringify(correctionErrors)}`
    });
  }

  const request = {
    messages,
    responseFormat: {
      type: "json_schema",
      json_schema: { ...AI_RESPONSE_JSON_SCHEMA, schema: responseSchema }
    }
  };
  let payload: unknown;
  if (isDesktopRuntime()) {
    payload = await desktopChat(request);
  } else {
    const response = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
    payload = await response.json().catch(() => null);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
