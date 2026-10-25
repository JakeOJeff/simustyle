/**
 * Cloudflare Worker for the hosted site. Static files (landing page at /, editor at /editor/) come from
 * the built `dist/` folder; only /api/* and /download/* reach this code (see `run_worker_first` in wrangler.jsonc).
 */
import { critiqueEnabled, forwardChat, isAiConfigured, referenceImageEnabled, solReviewEnabled, type ChatCredits, type ChatProxyEnv } from "../src/ai/chatProxy";
import {
  adminSpendResult, creditClientIds, creditCookie, creditLimits, CreditLedger,
  type AdminEnv, type CallCharge, type CreditLimitEnv, type CreditStatus, type CreditStorage, type Reservation, type SpendReport
} from "../src/ai/credits";
import { isAiTask } from "../src/ai/tasks";

/** The part of the Workers ExecutionContext used here. */
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }

interface DurableObjectStub { fetch(request: Request): Promise<Response> }
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

interface Env extends ChatProxyEnv, CreditLimitEnv, AdminEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** One ledger instance holds every visitor's daily credits and the month's spend (see AiCreditLedger below). */
  AI_CREDITS: DurableObjectNamespace;
  /** owner/name of the GitHub repository whose releases hold the Windows installer. */
  GITHUB_REPO: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/ai/chat") return aiChat(request, env, ctx);
    if (url.pathname === "/api/ai/credits") return aiCredits(request, env);
    if (url.pathname === "/api/ai/spend") return aiSpend(request, env);
    if (url.pathname === "/download/windows") return windowsDownload(env);
    return env.ASSETS.fetch(request);
  }
};

async function aiChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST /api/ai/chat." }, { Allow: "POST" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const ledger = await ledgerFor(request, env);
  const result = await forwardChat(bytes, env, ledger);
  if (result.stream) {
    // Keep the Worker alive until the provider call is settled, even if the visitor closes the tab.
    ctx.waitUntil(result.finished);
    return new Response(result.stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", ...ledger.headers } });
  }
  return json(result.status, result.body, ledger.headers);
}

/** Lets the editor show the visitor's balance, and whether reviews can use the strong model, before they send anything. */
async function aiCredits(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "Use GET /api/ai/credits." }, { Allow: "GET" });
  if (!isAiConfigured(env)) return json(200, { enabled: false, solReview: false, critique: false, referenceImage: false });
  const ledger = await ledgerFor(request, env);
  return json(200, { enabled: true, credits: await ledger.status(), solReview: solReviewEnabled(env), critique: critiqueEnabled(env), referenceImage: referenceImageEnabled(env) }, ledger.headers);
}

/** Month-to-date spend for the site owner; needs the X-Admin-Secret header to equal AI_ADMIN_SECRET. */
async function aiSpend(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "Use GET /api/ai/spend." }, { Allow: "GET" });
  const result = await adminSpendResult(request.headers.get("X-Admin-Secret"), env, () => ledgerCall<SpendReport>(env, "report", {}));
  return json(result.status, result.body);
}

function ledgerCall<T>(env: Env, action: string, body: unknown): Promise<T> {
  const stub = env.AI_CREDITS.get(env.AI_CREDITS.idFromName("ledger"));
  return stub.fetch(new Request(`https://ledger/${action}`, { method: "POST", body: JSON.stringify(body) }))
    .then((response) => response.json() as Promise<T>);
}

/** The visitor is charged under both their address and a cookie, so neither a refresh nor a new IP refills credits. */
async function ledgerFor(request: Request, env: Env): Promise<ChatCredits & { status(): Promise<CreditStatus>; headers: Record<string, string> }> {
  const cookie = creditCookie(request.headers.get("Cookie"), new URL(request.url).protocol === "https:");
  const clientIds = await creditClientIds(request.headers.get("CF-Connecting-IP") ?? "unknown", cookie.id);
  return {
    reserve: (task) => ledgerCall(env, "reserve", { clientIds, task }),
    settle: (reservation, charge) => ledgerCall(env, "settle", { clientIds, reservation, charge }),
    status: () => ledgerCall(env, "status", { clientIds }),
    headers: cookie.setCookie ? { "Set-Cookie": cookie.setCookie } : {}
  };
}

/**
 * Durable Object that counts AI credits and spend. A single instance keeps the per-visitor and site-wide
 * numbers consistent; visitor counters reset each UTC day, the month's spend each UTC month.
 */
export class AiCreditLedger {
  private readonly ledger: CreditLedger;

  constructor(state: { storage: CreditStorage }, env: CreditLimitEnv) {
    this.ledger = new CreditLedger(state.storage, creditLimits(env));
  }

  async fetch(request: Request): Promise<Response> {
    const body = await request.json() as { clientIds?: string[]; task?: unknown; reservation?: Reservation; charge?: CallCharge | null };
    const clientIds = body.clientIds ?? [];
    const action = new URL(request.url).pathname.slice(1);
    if (action === "reserve") {
      if (!isAiTask(body.task)) return Response.json({ error: "Unknown task." }, { status: 400 });
      return Response.json(await this.ledger.reserve(clientIds, body.task));
    }
    if (action === "settle" && body.reservation) return Response.json(await this.ledger.settle(clientIds, body.reservation, body.charge ?? null));
    if (action === "report") return Response.json(await this.ledger.report());
    return Response.json(await this.ledger.status(clientIds));
  }
}

/** Redirects to the newest release's NSIS installer, or to the releases page when none is published yet. */
async function windowsDownload(env: Env): Promise<Response> {
  const releasesPage = `https://github.com/${env.GITHUB_REPO}/releases/latest`;
  try {
    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "simustyle-site" },
      // Cloudflare-only option: cache the GitHub API answer at the edge to stay under its rate limit.
      cf: { cacheTtl: 300, cacheEverything: true }
    } as RequestInit);
    if (response.ok) {
      const release = await response.json() as { assets?: { name: string; browser_download_url: string }[] };
      const installer = release.assets?.find((asset) => /-setup\.exe$/i.test(asset.name));
      if (installer) return redirect(installer.browser_download_url);
    }
  } catch {
    // Fall through to the releases page.
  }
  return redirect(releasesPage);
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "public, max-age=300" } });
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
