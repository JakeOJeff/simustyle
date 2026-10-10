import { afterEach, describe, expect, it, vi } from "vitest";
import { requestSceneEdit } from "../src/ai/client";

afterEach(() => vi.unstubAllGlobals());

describe("scene AI transport client", () => {
  it("sends structured messages through the same-origin proxy and parses the model JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: JSON.stringify({ summary: "Added a cube.", ops: [] })
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestSceneEdit("system", "add a cube")).resolves.toEqual({ summary: "Added a cube.", ops: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/ai/chat");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const request = JSON.parse(String(init.body)) as {
      messages: { role: string; content: string }[];
      responseFormat: { type: string; json_schema: { strict: boolean } };
    };
    expect(request.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "add a cube" }
    ]);
    expect(request.responseFormat.type).toBe("json_schema");
    expect(request.responseFormat.json_schema.strict).toBe(false);
    expect(JSON.stringify(init)).not.toContain("AI_API_KEY");
  });

  it("includes validation corrections as a separate user message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: "{}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await requestSceneEdit("system", "add a cube", ["unknown component"]);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const request = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    expect(request.messages[2]?.role).toBe("user");
    expect(request.messages[2]?.content).toContain("unknown component");
  });

  it("surfaces proxy errors and rejects malformed model JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "AI is not configured." }), { status: 503 })
    ));
    await expect(requestSceneEdit("system", "request")).rejects.toThrow("AI is not configured.");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ content: "not json" }), { status: 200 })
    ));
    await expect(requestSceneEdit("system", "request")).rejects.toThrow("The model returned invalid JSON.");
  });
});
