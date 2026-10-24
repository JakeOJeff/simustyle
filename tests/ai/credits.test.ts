import { describe, expect, it, vi } from "vitest";
import {
  adminSpendResult, clientIdFromAddress, CREDIT_COOKIE, creditCookie, creditLimits, CreditLedger, dailyCapUsd,
  memoryCreditStorage, secretsMatch, type CallCharge, type CreditLimits
} from "../../src/ai/credits";
import type { AiTask } from "../../src/ai/tasks";

const noon = new Date("2026-10-12T12:00:00Z");
const limits = (overrides: Partial<CreditLimits> = {}): CreditLimits => ({ perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15, ...overrides });
const charge = (task: AiTask, credits: number, costUsd = credits * 0.00167): CallCharge => ({
  task, model: "gpt-6-luna", usage: { promptTokens: 1000, cachedTokens: 200, completionTokens: 100 }, costUsd, credits
});

/** Runs one call through the ledger: reserve, then settle to `credits`. */
async function call(ledger: CreditLedger, ids: string | string[], task: AiTask, credits: number, now = noon, costUsd?: number) {
  const reserved = await ledger.reserve(ids, task, now);
  if (!reserved.reservation) throw new Error(`reserve refused: ${reserved.reason}`);
  return ledger.settle(ids, reserved.reservation, charge(task, credits, costUsd), now);
}

describe("AI credits ledger", () => {
  it("reserves the task's worst case and refuses a visitor who cannot cover it", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    const parse = await ledger.reserve("a", "parse", noon);
    expect(parse.ok).toBe(true);
    expect(parse.status.remaining).toBe(28);
    const review = await ledger.reserve("a", "scene_review", noon);
    expect(review).toMatchObject({ ok: false, reason: "visitor" });
    expect(review.status).toEqual({ remaining: 28, limit: 30, resetsAt: "2026-10-13T00:00:00.000Z" });
    expect((await ledger.reserve("b", "scene_review", noon)).ok).toBe(true);
  });

  it("does not let concurrent reservations overdraw a visitor", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits({ perUser: 8 }));
    expect((await ledger.reserve("a", "scene_draft", noon)).ok).toBe(true);
    expect((await ledger.reserve("a", "scene_draft", noon)).ok).toBe(false);
  });

  it("settles to the real charge, refunds failures in full, and floors at zero", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    expect((await call(ledger, "a", "scene_draft", 2)).remaining).toBe(28);

    const failed = await ledger.reserve("a", "scene_draft", noon);
    expect(failed.status.remaining).toBe(23);
    expect((await ledger.settle("a", failed.reservation!, null, noon)).remaining).toBe(28);

    expect((await call(ledger, "a", "scene_draft", 40)).remaining).toBe(0);
    expect((await ledger.status("a", noon)).remaining).toBe(0);
  });

  it("releases the site-wide reservation when a call settles", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    const held = await ledger.reserve("a", "scene_review", noon);
    expect((await ledger.report(noon)).reservedUsd).toBeCloseTo(30 * 0.00167, 9);
    await ledger.settle("a", held.reservation!, null, noon);
    const report = await ledger.report(noon);
    expect(report.reservedUsd).toBe(0);
    expect(report.totals.calls).toBe(0);
  });

  it("resets visitor credits at 00:00 UTC but keeps the month's spend", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits({ perUser: 5 }));
    await call(ledger, "a", "scene_draft", 5, noon, 1.25);
    expect((await ledger.reserve("a", "parse", new Date("2026-10-12T23:59:59Z"))).ok).toBe(false);
    const nextDay = new Date("2026-10-13T00:00:01Z");
    const status = await ledger.status("a", nextDay);
    expect(status).toEqual({ remaining: 5, limit: 5, resetsAt: "2026-10-14T00:00:00.000Z" });
    const report = await ledger.report(nextDay);
    expect(report.spentUsd).toBe(1.25);
    expect(report.days).toEqual({ "2026-10-12": 1.25 });
    expect(report.tasks.scene_draft).toEqual({ calls: 1, promptTokens: 1000, cachedTokens: 200, completionTokens: 100, costUsd: 1.25 });
    expect(report.todayUsd).toBe(0);
  });

  it("starts the month's spend over when the UTC month changes", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    await call(ledger, "a", "parse", 2, new Date("2026-10-31T20:00:00Z"), 3);
    const report = await ledger.report(new Date("2026-11-01T00:00:01Z"));
    expect(report).toMatchObject({ month: "2026-11", spentUsd: 0, days: {}, totals: { calls: 0, costUsd: 0 } });
    expect(report.todayCapUsd).toBe(5);
  });

  it("refuses everyone once a call would push today past its share of the budget", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    const first = new Date("2026-10-01T09:00:00Z");
    await call(ledger, "a", "parse", 2, first, 4.83);
    expect((await ledger.reserve("b", "parse", first)).ok).toBe(true);
    const blocked = await ledger.reserve("c", "scene_review", first);
    expect(blocked).toMatchObject({ ok: false, reason: "daily" });
    expect(blocked.status).toMatchObject({ remaining: 0, globalExhausted: true, resetsAt: "2026-10-02T00:00:00.000Z" });
  });

  it("keeps today's cap fixed while today's spend grows", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    await call(ledger, "a", "parse", 2, new Date("2026-10-01T09:00:00Z"), 4);
    const second = new Date("2026-10-02T09:00:00Z");
    const before = (await ledger.report(second)).todayCapUsd;
    expect(before).toBeCloseTo(146 / 30, 6);
    await call(ledger, "b", "parse", 2, second, 1);
    expect((await ledger.report(second)).todayCapUsd).toBe(before);
  });

  it("stops at the monthly budget until the next month", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits({ monthlyBudgetUsd: 1 }));
    await call(ledger, "a", "parse", 2, new Date("2026-10-30T09:00:00Z"), 1);
    const blocked = await ledger.reserve("b", "parse", new Date("2026-10-31T09:00:00Z"));
    expect(blocked).toMatchObject({ ok: false, reason: "monthly" });
    expect(blocked.status).toMatchObject({ remaining: 0, globalExhausted: true, resetsAt: "2026-11-01T00:00:00.000Z" });
    expect((await ledger.reserve("b", "parse", new Date("2026-11-01T09:00:00Z"))).ok).toBe(true);
  });

  it("spreads the monthly budget over the days left, capped by the daily maximum", () => {
    const base = limits();
    expect(dailyCapUsd(base, 0, new Date("2026-10-01T00:00:00Z"))).toBeCloseTo(4.84, 2);
    expect(dailyCapUsd(base, 100, new Date("2026-10-31T12:00:00Z"))).toBe(15);
    expect(dailyCapUsd(base, 149, new Date("2026-10-31T12:00:00Z"))).toBeCloseTo(1, 9);
    expect(dailyCapUsd(base, 160, new Date("2026-10-20T12:00:00Z"))).toBe(0);
    expect(dailyCapUsd(limits({ monthlyBudgetUsd: 10_000 }), 0, new Date("2026-02-01T00:00:00Z"))).toBe(15);
    expect(dailyCapUsd(base, 0, new Date("2026-02-01T00:00:00Z"))).toBeCloseTo(150 / 28, 9);
  });

  it("reads limits from the environment with safe defaults", () => {
    expect(creditLimits({ AI_DAILY_CREDITS: "10", AI_MONTHLY_BUDGET_USD: "75.5", AI_DAILY_MAX_USD: "4" }))
      .toEqual({ perUser: 10, monthlyBudgetUsd: 75.5, dailyMaxUsd: 4 });
    expect(creditLimits({ AI_DAILY_CREDITS: "nope", AI_MONTHLY_BUDGET_USD: "-4", AI_DAILY_MAX_USD: "" }))
      .toEqual({ perUser: 30, monthlyBudgetUsd: 150, dailyMaxUsd: 15 });
  });

  it("charges every id so a new address or a cleared cookie does not refill credits", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits({ perUser: 10 }));
    await call(ledger, ["ip1", "cookie1"], "scene_draft", 5);
    await call(ledger, ["ip1", "cookie1"], "scene_draft", 5);
    expect((await ledger.reserve(["ip2", "cookie1"], "parse", noon)).ok).toBe(false);
    expect((await ledger.reserve(["ip1", "cookie2"], "parse", noon)).ok).toBe(false);
    expect((await ledger.status(["ip2", "cookie1"], noon)).remaining).toBe(0);
    expect((await ledger.reserve(["ip2", "cookie2"], "parse", noon)).ok).toBe(true);
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

describe("admin spend endpoint", () => {
  it("hides the report when no secret is configured or the header is wrong", async () => {
    const report = vi.fn();
    expect((await adminSpendResult("anything", {}, report)).status).toBe(404);
    expect((await adminSpendResult(null, { AI_ADMIN_SECRET: "s3cret" }, report)).status).toBe(401);
    expect((await adminSpendResult("s3cre", { AI_ADMIN_SECRET: "s3cret" }, report)).status).toBe(401);
    expect(report).not.toHaveBeenCalled();
  });

  it("returns month-to-date spend with the right secret", async () => {
    const ledger = new CreditLedger(memoryCreditStorage(), limits());
    await call(ledger, "a", "scene_review", 12, noon, 0.02);
    const result = await adminSpendResult("s3cret", { AI_ADMIN_SECRET: "s3cret" }, () => ledger.report(noon));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ month: "2026-10", spentUsd: 0.02, todayUsd: 0.02, budgetUsd: 150, tasks: { scene_review: { calls: 1 } } });
  });

  it("compares secrets exactly", async () => {
    expect(await secretsMatch("abc", "abc")).toBe(true);
    expect(await secretsMatch("abc", "abd")).toBe(false);
    expect(await secretsMatch("", "abc")).toBe(false);
  });
});
