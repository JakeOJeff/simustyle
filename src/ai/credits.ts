/**
 * Daily AI credits for the hosted proxy. The site owner pays for every model call, so each visitor gets a
 * small daily allowance and the whole site has a daily ceiling. Both reset at 00:00 UTC.
 * One credit is one model call; a single assistant request usually makes two or three.
 */

export const DEFAULT_DAILY_CREDITS = 30;
export const DEFAULT_GLOBAL_DAILY_CREDITS = 3000;

export interface CreditLimitEnv {
  /** Credits each visitor gets per UTC day. */
  AI_DAILY_CREDITS?: string;
  /** Credits the whole site may spend per UTC day: the owner's spending cap. */
  AI_GLOBAL_DAILY_CREDITS?: string;
}

export interface CreditLimits {
  perUser: number;
  global: number;
}

/** What the browser is told about its balance after every call. */
export interface CreditStatus {
  remaining: number;
  limit: number;
  /** ISO time of the next reset. */
  resetsAt: string;
  /** True when the site-wide cap ran out before this visitor's own credits did. */
  globalExhausted?: boolean;
}

export interface SpendResult {
  ok: boolean;
  status: CreditStatus;
}

/** Minimal key/value storage; a Map in the dev server and Durable Object storage in the Worker. */
export interface CreditStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
}

export function creditLimits(env: CreditLimitEnv): CreditLimits {
  return {
    perUser: positiveInt(env.AI_DAILY_CREDITS, DEFAULT_DAILY_CREDITS),
    global: positiveInt(env.AI_GLOBAL_DAILY_CREDITS, DEFAULT_GLOBAL_DAILY_CREDITS)
  };
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function nextReset(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Counts spending per visitor and site-wide; wipes everything when the UTC day changes. */
export class CreditLedger {
  constructor(private readonly storage: CreditStorage, private readonly limits: CreditLimits) {}

  /**
   * A visitor can have several ids (their network address and a browser cookie). Every id is charged and
   * the most-used one sets the balance, so a new address or a cleared cookie alone does not refill credits.
   */
  async status(clientIds: string | string[], now = new Date()): Promise<CreditStatus> {
    await this.rollOver(now);
    const used = Math.max(...await this.usedBy(idList(clientIds)));
    const total = await this.storage.get<number>("total") ?? 0;
    return this.describe(used, total, now);
  }

  /** Takes one credit if the visitor and the site both have one left. */
  async spend(clientIds: string | string[], now = new Date()): Promise<SpendResult> {
    await this.rollOver(now);
    const keys = idList(clientIds);
    const usedBy = await this.usedBy(keys);
    const used = Math.max(...usedBy);
    const total = await this.storage.get<number>("total") ?? 0;
    if (used >= this.limits.perUser || total >= this.limits.global) {
      return { ok: false, status: this.describe(used, total, now) };
    }
    for (const [index, key] of keys.entries()) await this.storage.put(userKey(key), (usedBy[index] ?? 0) + 1);
    await this.storage.put("total", total + 1);
    return { ok: true, status: this.describe(used + 1, total + 1, now) };
  }

  /** Gives back a credit taken for a call that failed before the provider charged for it. */
  async refund(clientIds: string | string[], now = new Date()): Promise<CreditStatus> {
    await this.rollOver(now);
    const keys = idList(clientIds);
    const usedBy = (await this.usedBy(keys)).map((used) => Math.max(0, used - 1));
    const total = Math.max(0, (await this.storage.get<number>("total") ?? 0) - 1);
    for (const [index, key] of keys.entries()) await this.storage.put(userKey(key), usedBy[index] ?? 0);
    await this.storage.put("total", total);
    return this.describe(Math.max(...usedBy), total, now);
  }

  private usedBy(keys: string[]): Promise<number[]> {
    return Promise.all(keys.map(async (key) => await this.storage.get<number>(userKey(key)) ?? 0));
  }

  private async rollOver(now: Date): Promise<void> {
    const today = utcDay(now);
    if (await this.storage.get<string>("day") === today) return;
    await this.storage.deleteAll();
    await this.storage.put("day", today);
  }

  private describe(used: number, total: number, now: Date): CreditStatus {
    const globalExhausted = total >= this.limits.global;
    return {
      remaining: globalExhausted ? 0 : Math.max(0, this.limits.perUser - used),
      limit: this.limits.perUser,
      resetsAt: nextReset(now).toISOString(),
      ...(globalExhausted ? { globalExhausted: true } : {})
    };
  }
}

/** In-memory storage for the dev server and tests. */
export function memoryCreditStorage(): CreditStorage {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return values.get(key) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, value); },
    async deleteAll() { values.clear(); }
  };
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

function userKey(clientId: string): string {
  return `u:${clientId}`;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
