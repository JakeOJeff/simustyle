import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardChat } from "../../src/ai/chatProxy";
import { clientIdFromAddress, CREDIT_COOKIE, creditCookie, creditLimits, CreditLedger, memoryCreditStorage } from "../../src/ai/credits";

afterEach(() => vi.unstubAllGlobals());

const noon = new Date("2026-10-12T12:00:00Z");

describe("daily AI credits", () => {
  it("spends one credit per call and stops at the visitor's daily limit", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 2, global: 100 });
    expect((await ledger.spend("a", noon)).status.remaining).toBe(1);
    expect((await ledger.spend("a", noon)).status.remaining).toBe(0);
    const blocked = await ledger.spend("a", noon);
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toEqual({ remaining: 0, limit: 2, resetsAt: "2026-10-13T00:00:00.000Z" });
    expect((await ledger.spend("b", noon)).ok).toBe(true);
  });

  it("stops everyone once the site-wide cap is reached", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 5, global: 2 });
    await ledger.spend("a", noon);
    await ledger.spend("b", noon);
    const blocked = await ledger.spend("c", noon);
    expect(blocked.ok).toBe(false);
    expect(blocked.status.globalExhausted).toBe(true);
    expect(blocked.status.remaining).toBe(0);
  });

  it("resets at 00:00 UTC", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 1, global: 100 });
    await ledger.spend("a", noon);
    expect((await ledger.spend("a", new Date("2026-10-12T23:59:59Z"))).ok).toBe(false);
    const nextDay = await ledger.spend("a", new Date("2026-10-13T00:00:01Z"));
    expect(nextDay.ok).toBe(true);
    expect(nextDay.status.resetsAt).toBe("2026-10-14T00:00:00.000Z");
  });

  it("refunds a credit without going below zero", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 3, global: 100 });
    await ledger.spend("a", noon);
    expect((await ledger.refund("a", noon)).remaining).toBe(3);
    expect((await ledger.refund("a", noon)).remaining).toBe(3);
  });

  it("reads limits from the environment with safe defaults", () => {
    expect(creditLimits({ AI_DAILY_CREDITS: "10", AI_GLOBAL_DAILY_CREDITS: "500" })).toEqual({ perUser: 10, global: 500 });
    expect(creditLimits({ AI_DAILY_CREDITS: "nope", AI_GLOBAL_DAILY_CREDITS: "-4" })).toEqual({ perUser: 30, global: 3000 });
  });

  it("charges every id so a new address or a cleared cookie does not refill credits", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 2, global: 100 });
    await ledger.spend(["ip1", "cookie1"], noon);
    await ledger.spend(["ip1", "cookie1"], noon);
    expect((await ledger.spend(["ip2", "cookie1"], noon)).ok).toBe(false);
    expect((await ledger.spend(["ip1", "cookie2"], noon)).ok).toBe(false);
    expect((await ledger.status(["ip2", "cookie1"], noon)).remaining).toBe(0);
    expect((await ledger.spend(["ip2", "cookie2"], noon)).ok).toBe(true);
  });

  it("treats addresses that change between page loads as one visitor", async () => {
    const same = async (a: string, b: string) => expect(await clientIdFromAddress(a)).toBe(await clientIdFromAddress(b));
    await same("::1", "127.0.0.1");
    await same("::ffff:203.0.113.7", "203.0.113.7");
    await same("2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:0db8:0001:0002::1");
    expect(await clientIdFromAddress("2001:db8:1:2::1")).not.toBe(await clientIdFromAddress("2001:db8:1:3::1"));
  });

  it("keeps a valid credit cookie and issues one otherwise", () => {
    const id = "0123456789abcdef0123456789abcdef";
    expect(creditCookie(`a=b; ${CREDIT_COOKIE}=${id}`, true)).toEqual({ id });
    const fresh = creditCookie(`${CREDIT_COOKIE}=forged`, true);
    expect(fresh.id).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh.setCookie).toContain(`${CREDIT_COOKIE}=${fresh.id}`);
    expect(fresh.setCookie).toContain("HttpOnly");
    expect(fresh.setCookie).toContain("Secure");
  });

  it("hashes addresses instead of storing them", async () => {
    const id = await clientIdFromAddress("203.0.113.7");
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(id).not.toContain("203");
    expect(await clientIdFromAddress("203.0.113.7")).toBe(id);
  });
});

describe("chat proxy credits", () => {
  const env = { AI_API_KEY: "key", AI_MODEL: "model" };
  const request = new TextEncoder().encode(JSON.stringify({
    messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    responseFormat: { type: "json_object" }
  }));

  it("returns 429 without calling the provider when credits are gone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 1, global: 100 });
    await ledger.spend("a");
    const result = await forwardChat(request, env, { spend: () => ledger.spend("a"), refund: () => ledger.refund("a") });
    expect(result.status).toBe(429);
    expect(result.body.credits?.remaining).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the balance on success and refunds on provider failure", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), { perUser: 5, global: 100 });
    const credits = { spend: () => ledger.spend("a"), refund: () => ledger.refund("a") };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] })));
    const ok = await forwardChat(request, env, credits);
    expect(ok.status).toBe(200);
    expect(ok.body.credits?.remaining).toBe(4);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "down" } }, { status: 500 })));
    const failed = await forwardChat(request, env, credits);
    expect(failed.status).toBe(502);
    expect(failed.body.credits?.remaining).toBe(4);
  });
});
