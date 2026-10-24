/**
 * AI credits for the hosted proxy. The site owner pays for every model call, so credits stand for money
 * (see CREDIT_USD in pricing.ts): each visitor gets a small daily allowance that resets at 00:00 UTC, and
 * the whole site spends at most a monthly budget, spread over the days left in the month.
 * A call first reserves its task's worst case, then settles to what the provider actually billed.
 */

import { AI_TASK_LIMITS, AI_TASKS, type AiTask } from "./tasks";
import { worstCaseUsd, type TokenUsage } from "./pricing";

export const DEFAULT_DAILY_CREDITS = 30;
export const DEFAULT_MONTHLY_BUDGET_USD = 150;
export const DEFAULT_DAILY_MAX_USD = 15;

export interface CreditLimitEnv {
  /** Credits each visitor gets per UTC day. */
  AI_DAILY_CREDITS?: string;
  /** What the whole site may spend per UTC month, in US dollars: the owner's spending cap. */
  AI_MONTHLY_BUDGET_USD?: string;
  /** Upper bound on any single UTC day's site-wide spend, in US dollars. */
  AI_DAILY_MAX_USD?: string;
}

export interface CreditLimits {
  perUser: number;
  monthlyBudgetUsd: number;
  dailyMaxUsd: number;
}

/** What the browser is told about its balance after every call. */
export interface CreditStatus {
  remaining: number;
  limit: number;
  /** ISO time of the next reset. */
  resetsAt: string;
  /** True when the site-wide budget ran out before this visitor's own credits did. */
  globalExhausted?: boolean;
}

/** Why a call was refused: the visitor's own credits, today's share of the budget, or the whole month's. */
export type RefusalReason = "visitor" | "daily" | "monthly";

/** Credits and dollars held for one in-flight call until it settles. */
export interface Reservation {
  task: AiTask;
  day: string;
  credits: number;
  usd: number;
}

export interface ReserveResult {
  ok: boolean;
  status: CreditStatus;
  reservation?: Reservation;
  reason?: RefusalReason;
}

/** What one finished call cost; `usage` is null when the provider did not report it. */
export interface CallCharge {
  task: AiTask;
  model: string;
  usage: TokenUsage | null;
  costUsd: number;
  credits: number;
}

export interface TaskTotals {
  calls: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
}

/** Month-to-date spend for the owner's admin endpoint. */
export interface SpendReport {
  month: string;
  budgetUsd: number;
  spentUsd: number;
  todayUsd: number;
  todayCapUsd: number;
  /** Worst-case dollars held by calls still in flight today. */
  reservedUsd: number;
  days: Record<string, number>;
  tasks: Record<AiTask, TaskTotals>;
  totals: TaskTotals;
}

/** Minimal key/value storage; a Map in the dev server and Durable Object storage in the Worker. */
export interface CreditStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

interface MonthState {
  month: string;
  /** Dollars spent per UTC day of this month. */
  days: Record<string, number>;
  tasks: Partial<Record<AiTask, TaskTotals>>;
}

export function creditLimits(env: CreditLimitEnv): CreditLimits {
  return {
    perUser: positiveInt(env.AI_DAILY_CREDITS, DEFAULT_DAILY_CREDITS),
    monthlyBudgetUsd: positiveNumber(env.AI_MONTHLY_BUDGET_USD, DEFAULT_MONTHLY_BUDGET_USD),
    dailyMaxUsd: positiveNumber(env.AI_DAILY_MAX_USD, DEFAULT_DAILY_MAX_USD)
  };
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function nextReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function nextMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Today's site-wide cap: what is left of the month's budget spread evenly over the days left (today included),
 * never above the daily maximum. It uses spend from before today, so it does not shrink during the day.
 */
export function dailyCapUsd(limits: CreditLimits, spentBeforeTodayUsd: number, now: Date): number {
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - now.getUTCDate() + 1;
  return Math.max(0, Math.min(limits.dailyMaxUsd, (limits.monthlyBudgetUsd - spentBeforeTodayUsd) / daysLeft));
}

/** The cheapest call there is; the site counts as out of budget once not even this fits. */
const SMALLEST_TASK = AI_TASKS.reduce((a, b) => AI_TASK_LIMITS[a].worstCaseCredits <= AI_TASK_LIMITS[b].worstCaseCredits ? a : b);

/**
 * Counts each visitor's credits per UTC day and the site's dollars per UTC month. Visitor counters reset
 * daily; the month's spend survives the daily reset and starts over when the UTC month changes.
 */
export class CreditLedger {
  constructor(private readonly storage: CreditStorage, private readonly limits: CreditLimits) {}

  /**
   * A visitor can have several ids (their network address and a browser cookie). Every id is charged and
   * the most-used one sets the balance, so a new address or a cleared cookie alone does not refill credits.
   */
  async status(clientIds: string | string[], now = new Date()): Promise<CreditStatus> {
    const day = await this.rollOver(now);
    const used = Math.max(...await this.usedBy(day, idList(clientIds)));
    const global = this.globalRefusal(await this.month(now), await this.reserved(day), worstCaseUsd(SMALLEST_TASK), now);
    return this.describe(used, global, now);
  }

  /** Holds the task's worst-case credits and dollars when the visitor and the site can both afford them. */
  async reserve(clientIds: string | string[], task: AiTask, now = new Date()): Promise<ReserveResult> {
    const day = await this.rollOver(now);
    const keys = idList(clientIds);
    const usedBy = await this.usedBy(day, keys);
    const used = Math.max(...usedBy);
    const reserved = await this.reserved(day);
    const credits = AI_TASK_LIMITS[task].worstCaseCredits;
    const usd = worstCaseUsd(task);
    const global = this.globalRefusal(await this.month(now), reserved, usd, now);
    if (global) return { ok: false, reason: global, status: this.describe(used, global, now) };
    if (used + credits > this.limits.perUser) return { ok: false, reason: "visitor", status: this.describe(used, null, now) };
    for (const [index, key] of keys.entries()) await this.storage.put(userKey(day, key), (usedBy[index] ?? 0) + credits);
    await this.storage.put(reservedKey(day), reserved + usd);
    return { ok: true, reservation: { task, day, credits, usd }, status: this.describe(used + credits, null, now) };
  }

  /**
   * Replaces a reservation with the call's real charge, or gives it all back when `charge` is null (the call
   * failed). The real charge may exceed the reservation; balances never go below zero.
   */
  async settle(clientIds: string | string[], reservation: Reservation, charge: CallCharge | null, now = new Date()): Promise<CreditStatus> {
    const day = await this.rollOver(now);
    const keys = idList(clientIds);
    // A reservation from before the daily reset has nothing left to release: its counters are gone.
    if (reservation.day === day) {
      const delta = (charge?.credits ?? 0) - reservation.credits;
      const usedBy = await this.usedBy(day, keys);
      for (const [index, key] of keys.entries()) await this.storage.put(userKey(day, key), Math.max(0, (usedBy[index] ?? 0) + delta));
      await this.storage.put(reservedKey(day), Math.max(0, await this.reserved(day) - reservation.usd));
    }
    if (charge) await this.record(charge, now);
    return this.status(clientIds, now);
  }

  /** Month-to-date spend per task and per day, with today's cap. */
  async report(now = new Date()): Promise<SpendReport> {
    const day = await this.rollOver(now);
    const month = await this.month(now);
    const tasks = Object.fromEntries(AI_TASKS.map((task) => [task, { ...emptyTotals(), ...month.tasks[task] }])) as Record<AiTask, TaskTotals>;
    const totals = Object.values(tasks).reduce((sum, item) => ({
      calls: sum.calls + item.calls,
      promptTokens: sum.promptTokens + item.promptTokens,
      cachedTokens: sum.cachedTokens + item.cachedTokens,
      completionTokens: sum.completionTokens + item.completionTokens,
      costUsd: sum.costUsd + item.costUsd
    }), emptyTotals());
    const spent = sumDays(month.days);
    return {
      month: month.month,
      budgetUsd: this.limits.monthlyBudgetUsd,
      spentUsd: roundUsd(spent),
      todayUsd: roundUsd(month.days[day] ?? 0),
      todayCapUsd: roundUsd(dailyCapUsd(this.limits, spent - (month.days[day] ?? 0), now)),
      reservedUsd: roundUsd(await this.reserved(day)),
      days: Object.fromEntries(Object.entries(month.days).map(([key, value]) => [key, roundUsd(value)])),
      tasks: Object.fromEntries(Object.entries(tasks).map(([task, item]) => [task, { ...item, costUsd: roundUsd(item.costUsd) }])) as Record<AiTask, TaskTotals>,
      totals: { ...totals, costUsd: roundUsd(totals.costUsd) }
    };
  }

  private async record(charge: CallCharge, now: Date): Promise<void> {
    const month = await this.month(now);
    const day = utcDay(now);
    const totals = { ...emptyTotals(), ...month.tasks[charge.task] };
    month.days[day] = (month.days[day] ?? 0) + charge.costUsd;
    month.tasks[charge.task] = {
      calls: totals.calls + 1,
      promptTokens: totals.promptTokens + (charge.usage?.promptTokens ?? 0),
      cachedTokens: totals.cachedTokens + (charge.usage?.cachedTokens ?? 0),
      completionTokens: totals.completionTokens + (charge.usage?.completionTokens ?? 0),
      costUsd: totals.costUsd + charge.costUsd
    };
    await this.storage.put("month", month);
  }

  /** Refuses a call of `usd` worst case when it would push today past its cap or the month is spent. */
  private globalRefusal(month: MonthState, reserved: number, usd: number, now: Date): "daily" | "monthly" | null {
    const spent = sumDays(month.days);
    if (spent >= this.limits.monthlyBudgetUsd) return "monthly";
    const today = month.days[utcDay(now)] ?? 0;
    return today + reserved + usd > dailyCapUsd(this.limits, spent - today, now) + 1e-9 ? "daily" : null;
  }

  private async month(now: Date): Promise<MonthState> {
    const stored = await this.storage.get<MonthState>("month");
    return stored?.month === utcMonth(now) ? stored : { month: utcMonth(now), days: {}, tasks: {} };
  }

  private async reserved(day: string): Promise<number> {
    return await this.storage.get<number>(reservedKey(day)) ?? 0;
  }

  private usedBy(day: string, keys: string[]): Promise<number[]> {
    return Promise.all(keys.map(async (key) => await this.storage.get<number>(userKey(day, key)) ?? 0));
  }

  /** At the first request of a UTC day, drops the previous days' visitor counters; month spend is kept. */
  private async rollOver(now: Date): Promise<string> {
    const today = utcDay(now);
    if (await this.storage.get<string>("day") === today) return today;
    for (const prefix of ["u:", "r:"]) {
      for (const key of (await this.storage.list({ prefix })).keys()) {
        if (!key.startsWith(`${prefix}${today}:`) && key !== reservedKey(today)) await this.storage.delete(key);
      }
    }
    await this.storage.delete("total"); // Call counter from the old call-based ledger.
    await this.storage.put("day", today);
    return today;
  }

  private describe(used: number, global: "daily" | "monthly" | null, now: Date): CreditStatus {
    return {
      remaining: global ? 0 : Math.max(0, this.limits.perUser - used),
      limit: this.limits.perUser,
      resetsAt: (global === "monthly" ? nextMonth(now) : nextReset(now)).toISOString(),
      ...(global ? { globalExhausted: true } : {})
    };
  }
}

/** In-memory storage for the dev server and tests. */
export function memoryCreditStorage(): CreditStorage {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
    async delete(key: string) { return values.delete(key); },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))) as Map<string, T>;
    }
  };
}

export interface AdminEnv {
  /** Shared secret for GET /api/ai/spend, sent as the X-Admin-Secret header. */
  AI_ADMIN_SECRET?: string;
}

/**
 * The owner's month-to-date spend, for GET /api/ai/spend. Answers 404 when no admin secret is configured
 * and 401 when the X-Admin-Secret header does not match, so nothing is revealed without it.
 */
export async function adminSpendResult(
  providedSecret: string | null | undefined,
  env: AdminEnv,
  report: () => Promise<SpendReport>
): Promise<{ status: number; body: SpendReport | { error: string } }> {
  if (!env.AI_ADMIN_SECRET) return { status: 404, body: { error: "Not found." } };
  if (!await secretsMatch(providedSecret ?? "", env.AI_ADMIN_SECRET)) return { status: 401, body: { error: "Unauthorized." } };
  return { status: 200, body: await report() };
}

/** Compares digests in constant time, so neither the length nor a matching prefix leaks through timing. */
export async function secretsMatch(provided: string, expected: string): Promise<boolean> {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

function emptyTotals(): TaskTotals {
  return { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, costUsd: 0 };
}

function sumDays(days: Record<string, number>): number {
  return Object.values(days).reduce((sum, value) => sum + value, 0);
}

function roundUsd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function reservedKey(day: string): string {
  return `r:${day}`;
}

/** Hashes the visitor's IP so raw addresses are never stored. */
export async function clientIdFromAddress(address: string): Promise<string> {
  return hash(`simustyle-credits:${normalizeAddress(address)}`);
}

/**
 * Collapses the addresses one visitor can show up under between page loads: IPv6 becomes its /64 network
 * (privacy extensions rotate the rest), IPv4-mapped IPv6 becomes plain IPv4, and ::1 and 127.x are one id.
 */
export function normalizeAddress(address: string): string {
  const value = address.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const ip = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)?.[1] ?? value;
  if (ip === "::1" || ip.startsWith("127.")) return "loopback";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group || "0", 16).toString(16)).join(":")}::/64`;
}

/** Long-lived cookie that ties a browser to its credits even when its address changes. */
export const CREDIT_COOKIE = "simustyle_cid";

/** Reads the visitor's credit cookie or makes one; `setCookie` is set when the browser needs it sent back. */
export function creditCookie(cookieHeader: string | null | undefined, secure: boolean): { id: string; setCookie?: string } {
  const existing = new RegExp(`(?:^|;\\s*)${CREDIT_COOKIE}=([0-9a-f]{32})(?:;|$)`).exec(cookieHeader ?? "")?.[1];
  if (existing) return { id: existing };
  const id = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const attributes = ["Path=/", "Max-Age=31536000", "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])];
  return { id, setCookie: `${CREDIT_COOKIE}=${id}; ${attributes.join("; ")}` };
}

/** Every id a request is charged under: its network address and its browser cookie. */
export async function creditClientIds(address: string, cookieId: string): Promise<string[]> {
  return [await clientIdFromAddress(address), `c${await hash(`simustyle-cookie:${cookieId}`)}`];
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function idList(clientIds: string | string[]): string[] {
  const list = [...new Set(typeof clientIds === "string" ? [clientIds] : clientIds)];
  return list.length > 0 ? list : ["unknown"];
}

function userKey(day: string, clientId: string): string {
  return `u:${day}:${clientId}`;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
