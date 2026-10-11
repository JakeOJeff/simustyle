/**
 * Cloudflare Worker for the hosted site. Static files (landing page at /, editor at /editor/) come from
 * the built `dist/` folder; only /api/* and /download/* reach this code (see `run_worker_first` in wrangler.jsonc).
 */
import { forwardChat, type ChatProxyEnv } from "../src/ai/chatProxy";

interface Env extends ChatProxyEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** owner/name of the GitHub repository whose releases hold the Windows installer. */
  GITHUB_REPO: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/ai/chat") return aiChat(request, env);
    if (url.pathname === "/download/windows") return windowsDownload(env);
    return env.ASSETS.fetch(request);
  }
};

async function aiChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Use POST /api/ai/chat." }, { Allow: "POST" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const result = await forwardChat(bytes, env);
  return json(result.status, result.body);
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
