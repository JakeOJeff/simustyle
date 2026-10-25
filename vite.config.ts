import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { build as esbuild } from "esbuild";
import { resolve } from "node:path";
import { critiqueEnabled, forwardChat, isAiConfigured, MAX_CHAT_REQUEST_BYTES, referenceImageEnabled, solReviewEnabled } from "./src/ai/chatProxy";
import { adminSpendResult, creditClientIds, creditCookie, creditLimits, CreditLedger, memoryCreditStorage } from "./src/ai/credits";

export default defineConfig(({ mode }) => {
  // Do not use Vite's VITE_ prefix: these values must stay on the server.
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [svelte(), standaloneRuntime(), aiProxy(env)],
    // Physics is imported lazily on first Play. Pre-bundling it stops the dev server from
    // discovering it mid-click and reloading the page, which made Play appear to do nothing.
    optimizeDeps: { include: ["@dimforge/rapier3d-compat"] },
    // Two pages: the landing page at / and the editor at /editor/.
    build: {
      rollupOptions: {
        input: {
          landing: resolve(process.cwd(), "index.html"),
          editor: resolve(process.cwd(), "editor/index.html")
        }
      }
    },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"]
    }
  };
});

function aiProxy(env: Record<string, string>) {
  // Same credits and monthly budget as the hosted Worker, kept in memory until the dev server restarts.
  const ledger = new CreditLedger(memoryCreditStorage(), creditLimits(env));
  // Charged under both the address and a cookie, like the Worker, so a refresh never refills credits.
  const clientIds = (request: unknown, response: { setHeader(name: string, value: string): unknown }) => {
    const incoming = request as { socket?: { remoteAddress?: string }; headers?: { cookie?: string } };
    const cookie = creditCookie(incoming.headers?.cookie, false);
    if (cookie.setCookie) response.setHeader("Set-Cookie", cookie.setCookie);
    return creditClientIds(incoming.socket?.remoteAddress ?? "local", cookie.id);
  };
  return {
    name: "simustyle-ai-server-proxy",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/ai/credits", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (!isAiConfigured(env)) {
          response.end(JSON.stringify({ enabled: false, solReview: false, critique: false, referenceImage: false }));
          return;
        }
        const credits = await ledger.status(await clientIds(request, response));
        response.end(JSON.stringify({ enabled: true, credits, solReview: solReviewEnabled(env), critique: critiqueEnabled(env), referenceImage: referenceImageEnabled(env) }));
      });
      server.middlewares.use("/api/ai/spend", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        const secret = request.headers["x-admin-secret"];
        const result = await adminSpendResult(Array.isArray(secret) ? secret[0] : secret, env, () => ledger.report());
        response.statusCode = result.status;
        response.end(JSON.stringify(result.body));
      });
      server.middlewares.use("/api/ai/chat", async (request, response) => {
        const incoming = request as unknown as {
          method?: string;
          on(event: "data" | "end" | "error", callback: (chunk?: Uint8Array | string) => void): unknown;
        };
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        const send = (status: number, body: unknown) => {
          response.statusCode = status;
          response.end(JSON.stringify(body));
        };

        if (incoming.method !== "POST") {
          response.setHeader("Allow", "POST");
          send(405, { error: "Use POST /api/ai/chat." });
          return;
        }

        // Stop buffering past the limit; forwardChat rejects the oversized length with 413.
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          await new Promise<void>((resolve, reject) => {
            incoming.on("data", (value) => {
              if (size > MAX_CHAT_REQUEST_BYTES || typeof value === "undefined") return;
              const chunk = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
              size += chunk.byteLength;
              if (size <= MAX_CHAT_REQUEST_BYTES) chunks.push(chunk);
            });
            incoming.on("end", () => resolve());
            incoming.on("error", (error) => reject(error));
          });
        } catch {
          send(400, { error: "Could not read AI request body." });
          return;
        }
        if (size > MAX_CHAT_REQUEST_BYTES) {
          send(413, { error: "AI request body exceeds 4 MiB." });
          return;
        }

        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const id = await clientIds(request, response);
        const result = await forwardChat(bytes, env, {
          reserve: (task) => ledger.reserve(id, task),
          settle: (reservation, charge) => ledger.settle(id, reservation, charge)
        });
        if (result.stream) {
          response.statusCode = 200;
          response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
          const reader = result.stream.getReader();
          // The request stream closes as soon as its body is read; the response closing early means the tab went away.
          response.on("close", () => { if (!response.writableEnded) void reader.cancel(); });
          for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) response.write(chunk.value);
          response.end();
          return;
        }
        send(result.status, result.body);
      });
    }
  };
}

function standaloneRuntime(): import("vite").Plugin {
  const publicId = "virtual:simustyle-standalone-runtime";
  const resolvedId = `\0${publicId}`;
  return {
    name: "simustyle-standalone-runtime",
    resolveId(id: string) { return id === publicId ? resolvedId : null; },
    async load(id: string) {
      if (id !== resolvedId) return null;
      const result = await esbuild({
        entryPoints: [resolve(process.cwd(), "src/export/standalone-runtime.ts")],
        bundle: true,
        write: false,
        format: "iife",
        globalName: "SimuStyleRuntime",
        footer: { js: "const startStandalone = SimuStyleRuntime.startStandalone;" },
        define: { "import.meta.env.BASE_URL": JSON.stringify("/") },
        metafile: true,
        platform: "browser",
        target: "es2022",
        minify: true,
        legalComments: "none"
      });
      const bundle = result.outputFiles[0]?.text;
      if (!bundle) throw new Error("Could not bundle the standalone scene runtime.");
      for (const input of Object.keys(result.metafile!.inputs)) this.addWatchFile(resolve(process.cwd(), input));
      return `export default ${JSON.stringify(bundle)};`;
    }
  };
}
