import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAiStatus, fetchCredits, requestJson, requestSceneEdit, UnusableReplyError } from "../src/ai/client";

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
    expect((request as { task?: string }).task).toBe("scene_draft");
    expect(request).not.toHaveProperty("model");
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

  it("bounds oversized rejected replies and correction feedback for transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: "{}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await requestSceneEdit("system", "build", Array.from({ length: 100 }, () => "error".repeat(1000)), {}, "rejected".repeat(10000));
    const request = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as { messages: { role: string; content: string }[] };
    expect(request.messages[2]?.role).toBe("assistant");
    expect(request.messages[2]?.content).toContain("truncated");
    request.messages.forEach((message) => expect(message.content.length).toBeLessThan(50_000));
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

  it("names the task so the server can pick the model", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ content: "{}" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await requestSceneEdit("system", "review", [], {}, "", "scene_review");
    await requestJson([{ role: "system", content: "s" }, { role: "user", content: "u" }], { name: "x", strict: true, schema: {} }, "parse");
    const tasks = fetchMock.mock.calls.map((call) => (JSON.parse(String((call[1] as RequestInit).body)) as { task: string }).task);
    expect(tasks).toEqual(["scene_review", "parse"]);
  });

  it("reads credits and whether the strong review model is on", async () => {
    const credits = { remaining: 12, limit: 30, resetsAt: "2026-10-13T00:00:00.000Z" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ enabled: true, credits, solReview: true })));
    await expect(fetchAiStatus()).resolves.toEqual({ credits, solReview: true });
    await expect(fetchCredits()).resolves.toEqual(credits);

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ enabled: false })));
    await expect(fetchAiStatus()).resolves.toEqual({ credits: null, solReview: false });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(fetchCredits()).resolves.toBeNull();
  });
});

describe("unusable model replies", () => {
  it("raises a correctable error for truncated or non-JSON replies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ content: "{\"plan\":", truncated: true }), { status: 200 })));
    await expect(requestSceneEdit("system", "request")).rejects.toMatchObject({ name: "UnusableReplyError", truncated: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ content: "nope" }), { status: 200 })));
    await expect(requestSceneEdit("system", "request")).rejects.toBeInstanceOf(UnusableReplyError);
  });
});
