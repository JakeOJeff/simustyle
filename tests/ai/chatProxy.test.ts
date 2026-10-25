import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardChat, promptCacheKeyEnabled, resolveModel, solReviewEnabled, type ChatCredits, type ChatProxyEnv } from "../../src/ai/chatProxy";
import { CreditLedger, memoryCreditStorage } from "../../src/ai/credits";
import type { AiTask } from "../../src/ai/tasks";

beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => undefined); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const noon = new Date("2026-10-12T12:00:00Z");
const env: ChatProxyEnv = { AI_API_KEY: "key", AI_MODEL_LUNA: "gpt-6-luna", AI_MODEL_SOL: "gpt-6-sol" };
const messages = [{ role: "system", content: "s" }, { role: "user", content: "u" }];
const encode = (body: unknown) => new TextEncoder().encode(JSON.stringify(body));
const request = (task: unknown, extra: Record<string, unknown> = {}) => encode({ task, messages, responseFormat: { type: "json_object" }, ...extra });
const reply = (usage?: unknown) => Response.json({ choices: [{ message: { content: "{}" } }], ...(usage ? { usage } : {}) });

function stubProvider(response: () => Response = () => reply()) {
  const fetchMock = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    sent: (call = 0) => JSON.parse(String((fetchMock.mock.calls[call]?.[1] as RequestInit).body)) as Record<string, unknown>
  };
}

function meter(ledger: CreditLedger, id = "a"): ChatCredits {
  return { reserve: (task) => ledger.reserve(id, task, noon), settle: (reservation, charge) => ledger.settle(id, reservation, charge, noon) };
}

describe("chat proxy task routing", () => {
  it("rejects a missing or unknown task before calling the provider", async () => {
    const { fetchMock } = stubProvider();
    expect((await forwardChat(request(undefined), env)).status).toBe(400);
    expect((await forwardChat(request("scene_everything"), env)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the message count and role checks", async () => {
    stubProvider();
    expect((await forwardChat(encode({ task: "parse", messages: messages.slice(0, 1), responseFormat: {} }), env)).status).toBe(400);
    expect((await forwardChat(encode({ task: "parse", messages: [...messages, { role: "tool", content: "x" }], responseFormat: {} }), env)).status).toBe(400);
  });

  it("runs parse and drafts on Luna and ignores a model named by the browser", async () => {
    const { sent } = stubProvider();
    await forwardChat(request("parse", { model: "gpt-6-sol" }), env);
    await forwardChat(request("scene_draft", { model: "gpt-6-sol" }), env);
    expect(sent(0).model).toBe("gpt-6-luna");
    expect(sent(1).model).toBe("gpt-6-luna");
  });

  it("sends reviews to Sol only when the flag is on and Sol is set", async () => {
    expect(resolveModel("scene_review", env)).toBe("gpt-6-luna");
    expect(resolveModel("scene_review", { ...env, AI_SOL_ENABLED: "1" })).toBe("gpt-6-luna");
    expect(resolveModel("scene_review", { ...env, AI_SOL_ENABLED: "true", AI_MODEL_SOL: "" })).toBe("gpt-6-luna");
    expect(resolveModel("scene_review", { ...env, AI_SOL_ENABLED: "true" })).toBe("gpt-6-sol");
    expect(resolveModel("scene_draft", { ...env, AI_SOL_ENABLED: "true" })).toBe("gpt-6-luna");
    expect(solReviewEnabled({ ...env, AI_SOL_ENABLED: "true" })).toBe(true);
    expect(solReviewEnabled(env)).toBe(false);

    const { sent } = stubProvider();
    await forwardChat(request("scene_review"), { ...env, AI_SOL_ENABLED: "true" });
    expect(sent().model).toBe("gpt-6-sol");
  });

  it("falls back to AI_MODEL when AI_MODEL_LUNA is unset", async () => {
    expect(resolveModel("parse", { AI_API_KEY: "key", AI_MODEL: "legacy" })).toBe("legacy");
    stubProvider();
    expect((await forwardChat(request("parse"), { AI_API_KEY: "key" })).status).toBe(503);
  });

  it("rejects input past the task's character cap with 413", async () => {
    const { fetchMock } = stubProvider();
    const long = encode({ task: "parse", messages: [{ role: "system", content: "s".repeat(4_000) }, { role: "user", content: "u".repeat(4_001) }], responseFormat: {} });
    const result = await forwardChat(long, env);
    expect(result.status).toBe(413);
    expect("error" in result.body! && result.body!.error).toContain("8000");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caps completion tokens and sends a stable per-task prompt cache key to OpenAI", async () => {
    const { sent } = stubProvider();
    await forwardChat(request("scene_draft"), env);
    expect(sent()).toMatchObject({ max_completion_tokens: 4_000, prompt_cache_key: "simustyle-scene_draft-v1", messages });
    await forwardChat(request("parse"), { ...env, AI_PROMPT_CACHE_KEY: "false" });
    expect(sent(1).max_completion_tokens).toBe(800);
    expect(sent(1)).not.toHaveProperty("prompt_cache_key");
  });

  it("sends the cache key to other providers only when asked", () => {
    expect(promptCacheKeyEnabled("https://api.openai.com/v1", {})).toBe(true);
    expect(promptCacheKeyEnabled("https://example.test/v1", {})).toBe(false);
    expect(promptCacheKeyEnabled("https://example.test/v1", { AI_PROMPT_CACHE_KEY: "true" })).toBe(true);
    expect(promptCacheKeyEnabled("https://api.openai.com/v1", { AI_PROMPT_CACHE_KEY: "false" })).toBe(false);
  });
});

describe("chat proxy credits", () => {
  it("returns 429 without calling the provider when the visitor cannot cover the worst case", async () => {
    const { fetchMock } = stubProvider();
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    await ledger.reserve("a", "parse", noon);
    const result = await forwardChat(request("scene_review"), env, meter(ledger));
    expect(result.status).toBe(429);
    expect(result.body!.credits?.remaining).toBe(28);
    expect("error" in result.body! && result.body!.error).toContain("needs up to 30");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mentions the monthly budget when the site has run out", async () => {
    stubProvider();
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 0.001, dailyMaxUsd: 15 });
    const result = await forwardChat(request("parse"), env, meter(ledger));
    expect(result.status).toBe(429);
    expect(result.body!.credits?.globalExhausted).toBe(true);
    expect("error" in result.body! && result.body!.error).toMatch(/monthly AI budget/);
  });

  it("charges the call's real cost from usage, counting cached tokens", async () => {
    // 3000 fresh * $0.10 + 1000 cached * $0.01 + 2000 out * $0.50 = $0.00131 per 1M tokens -> 1 credit.
    stubProvider(() => reply({ prompt_tokens: 4_000, completion_tokens: 2_000, prompt_tokens_details: { cached_tokens: 1_000 } }));
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    const result = await forwardChat(request("scene_draft"), env, meter(ledger));
    expect(result.status).toBe(200);
    expect(result.body!.credits?.remaining).toBe(29);
    const report = await ledger.report(noon);
    expect(report.tasks.scene_draft).toEqual({ calls: 1, promptTokens: 4_000, cachedTokens: 1_000, completionTokens: 2_000, costUsd: 0.00131 });
    const logged = JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(logged).toMatchObject({ task: "scene_draft", model: "gpt-6-luna", promptTokens: 4_000, cachedTokens: 1_000, completionTokens: 2_000, credits: 1 });
  });

  it("charges the worst case when the provider reports no usage", async () => {
    stubProvider();
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    const result = await forwardChat(request("scene_draft"), env, meter(ledger));
    expect(result.body!.credits?.remaining).toBe(25);
    expect((await ledger.report(noon)).tasks.scene_draft.costUsd).toBeCloseTo(5 * 0.00167, 9);
  });

  it("refunds the whole reservation when the provider call fails", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    stubProvider(() => Response.json({ error: { message: "down" } }, { status: 500 }));
    const failed = await forwardChat(request("scene_review" as AiTask), env, meter(ledger));
    expect(failed.status).toBe(502);
    expect(failed.body!.credits?.remaining).toBe(30);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    expect((await forwardChat(request("parse"), env, meter(ledger))).body!.credits?.remaining).toBe(30);
    expect((await ledger.report(noon)).totals.calls).toBe(0);
  });
});

describe("chat proxy truncated replies", () => {
  it("flags a reply cut off at the token limit and still charges it", async () => {
    const usage = { prompt_tokens: 9000, completion_tokens: 4000 };
    stubProvider(() => Response.json({ choices: [{ finish_reason: "length", message: { content: "{\"plan\":\"cut" } }], usage }));
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    const result = await forwardChat(request("scene_draft"), env, meter(ledger));
    expect(result.status).toBe(200);
    expect(result.body!).toMatchObject({ content: "{\"plan\":\"cut", truncated: true });
    expect(result.body!.credits?.remaining).toBe(28);
  });

  it("treats an empty reply that spent its budget as truncated, not missing", async () => {
    stubProvider(() => Response.json({ choices: [{ finish_reason: "length", message: { content: null } }], usage: { prompt_tokens: 10, completion_tokens: 4000 } }));
    const result = await forwardChat(request("scene_draft"), env);
    expect(result).toMatchObject({ status: 200, body: { content: "", truncated: true } });
  });
});

describe("streamed replies", () => {
  /** A provider answering with server-sent events, split at awkward byte boundaries. */
  const events = (chunks: unknown[], cut = 7) => {
    const text = chunks.map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`).join("");
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += cut) controller.enqueue(bytes.slice(i, i + cut)); controller.close(); } });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  };
  const delta = (content: string, finish?: string) => ({ choices: [{ delta: { content }, ...(finish ? { finish_reason: finish } : {}) }] });
  const usage = { choices: [], usage: { prompt_tokens: 10_000, completion_tokens: 1_000, prompt_tokens_details: { cached_tokens: 8_000 } } };
  const read = async (result: Awaited<ReturnType<typeof forwardChat>>) => {
    expect(result.stream).toBeDefined();
    const text = await new Response(result.stream!).text();
    return text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  };

  it("relays deltas as they arrive, then settles from the final usage", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    const { sent } = stubProvider(() => events([delta('{"plan":'), delta('"x","summary":"y","ops":[]}', "stop"), usage, "[DONE]"]));
    const result = await forwardChat(request("scene_draft", { stream: true }), env, meter(ledger));
    expect(sent()).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    const lines = await read(result);
    await (result as { finished: Promise<void> }).finished;
    expect(lines.slice(0, 2)).toEqual([{ delta: '{"plan":' }, { delta: '"x","summary":"y","ops":[]}' }]);
    expect(lines[2]).toMatchObject({ done: true, credits: { remaining: 29 } });
    expect((await ledger.report(noon)).totals.calls).toBe(1);
  });

  it("marks a reply cut off at the output limit and reports a broken stream as an error", async () => {
    stubProvider(() => events([delta('{"plan":"lon', "length"), usage]));
    expect((await read(await forwardChat(request("scene_draft", { stream: true }), env))).at(-1)).toEqual({ done: true, truncated: true });
    stubProvider(() => events([usage]));
    expect((await read(await forwardChat(request("scene_draft", { stream: true }), env))).at(-1)).toEqual({ error: "AI provider returned no message content." });
  });

  it("keeps reading and charging after the browser stops listening", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
    stubProvider(() => events([delta("{"), delta("}", "stop"), usage]));
    const result = await forwardChat(request("scene_draft", { stream: true }), env, meter(ledger));
    await result.stream!.cancel();
    await (result as { finished: Promise<void> }).finished;
    expect((await ledger.report(noon)).totals.calls).toBe(1);
  });

  it("falls back to an unstreamed call when the provider rejects streaming, and to JSON when it ignores it", async () => {
    let calls = 0;
    const { sent } = stubProvider(() => ++calls === 1 ? Response.json({ error: { message: "stream_options unsupported" } }, { status: 400 }) : reply());
    const fallback = await forwardChat(request("scene_draft", { stream: true }), env);
    expect(sent(1).stream).toBeUndefined();
    expect(fallback.body).toEqual({ content: "{}" });
    stubProvider(() => reply());
    expect((await forwardChat(request("scene_draft", { stream: true }), env)).body).toEqual({ content: "{}" });
  });
});
