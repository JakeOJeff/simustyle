/**
 * Cloudflare Worker for the hosted site. Static files (landing page at /, editor at /editor/) come from
 * the built `dist/` folder; only /api/* and /download/* reach this code (see `run_worker_first` in wrangler.jsonc).
 */
import { forwardChat, type ChatCredits, type ChatProxyEnv } from "../src/ai/chatProxy";
import { creditClientIds, creditCookie, creditLimits, CreditLedger, type CreditLimitEnv, type CreditStatus, type CreditStorage, type SpendResult } from "../src/ai/credits";

interface DurableObjectStub { fetch(request: Request): Promise<Response> }
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

interface Env extends ChatProxyEnv, CreditLimitEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** One ledger instance holds every visitor's daily AI credits (see AiCreditLedger below). */
  AI_CREDITS: DurableObjectNamespace;
  /** owner/name of the GitHub repository whose releases hold the Windows installer. */
  GITHUB_REPO: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/ai/chat") return aiChat(request, env);
    if (url.pathname === "/api/ai/credits") return aiCredits(request, env);
    if (url.pathname === "/download/windows") return windowsDownload(env);
    return env.ASSETS.fetch(request);
  }
};

async function aiChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST /api/ai/chat." }, { Allow: "POST" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const ledger = await ledgerFor(request, env);
  const result = await forwardChat(bytes, env, ledger);
  return json(result.status, result.body, ledger.headers);
}

/** Lets the editor show the visitor's balance before they send anything. */
async function aiCredits(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "Use GET /api/ai/credits." }, { Allow: "GET" });
  if (!env.AI_API_KEY || !env.AI_MODEL) return json(200, { enabled: false });
  const ledger = await ledgerFor(request, env);
  return json(200, { enabled: true, credits: await ledger.status() }, ledger.headers);
}

/** The visitor is charged under both their address and a cookie, so neither a refresh nor a new IP refills credits. */
async function ledgerFor(request: Request, env: Env): Promise<ChatCredits & { status(): Promise<CreditStatus>; headers: Record<string, string> }> {
  const cookie = creditCookie(request.headers.get("Cookie"), new URL(request.url).protocol === "https:");
  const clientIds = await creditClientIds(request.headers.get("CF-Connecting-IP") ?? "unknown", cookie.id);
  const stub = env.AI_CREDITS.get(env.AI_CREDITS.idFromName("ledger"));
  const call = async <T>(action: string): Promise<T> => {
    const response = await stub.fetch(new Request(`https://ledger/${action}`, { method: "POST", body: JSON.stringify({ clientIds }) }));
    return await response.json() as T;
  };
  return {
    spend: () => call<SpendResult>("spend"),
    refund: () => call<CreditStatus>("refund"),
    status: () => call<CreditStatus>("status"),
    headers: cookie.setCookie ? { "Set-Cookie": cookie.setCookie } : {}
  };
}

/**
 * Durable Object that counts AI credits. A single instance keeps the per-visitor and site-wide counts
 * consistent; its storage is wiped at the first request of each UTC day.
 */
export class AiCreditLedger {
  private readonly ledger: CreditLedger;

  constructor(state: { storage: CreditStorage }, env: CreditLimitEnv) {
    this.ledger = new CreditLedger(state.storage, creditLimits(env));
  }

  async fetch(request: Request): Promise<Response> {
    const { clientIds } = await request.json() as { clientIds: string[] };
    const action = new URL(request.url).pathname.slice(1);
    if (action === "spend") return Response.json(await this.ledger.spend(clientIds));
    if (action === "refund") return Response.json(await this.ledger.refund(clientIds));
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
