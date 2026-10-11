import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { build as esbuild } from "esbuild";
import { resolve } from "node:path";

const maxRequestBytes = 1024 * 1024;

export default defineConfig(({ mode }) => {
  // Do not use Vite's VITE_ prefix: these values must stay on the server.
  const env = loadEnv(mode, ".", "");
  return {
    plugins: [svelte(), standaloneRuntime(), aiProxy(env)],
    // Physics is imported lazily on first Play. Pre-bundling it stops the dev server from
    // discovering it mid-click and reloading the page, which made Play appear to do nothing.
    optimizeDeps: { include: ["@dimforge/rapier3d-compat"] },
    test: {
      environment: "node",
      include: ["tests/**/*.test.ts"]
    }
  };
});

function aiProxy(env: Record<string, string>) {
  return {
    name: "simustyle-ai-server-proxy",
    configureServer(server: import("vite").ViteDevServer) {
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

        const chunks: Uint8Array[] = [];
        let size = 0;
        let tooLarge = false;
        try {
          await new Promise<void>((resolve, reject) => {
            incoming.on("data", (value) => {
              if (tooLarge || typeof value === "undefined") return;
              const chunk = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
              size += chunk.byteLength;
              if (size > maxRequestBytes) {
                tooLarge = true;
                return;
              }
              chunks.push(chunk);
            });
            incoming.on("end", () => resolve());
            incoming.on("error", (error) => reject(error));
          });
          if (tooLarge) {
            send(413, { error: "AI request body exceeds 1 MiB." });
            return;
          }
        } catch {
          send(400, { error: "Could not read AI request body." });
          return;
        }

        let body: unknown;
        try {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        } catch {
          send(400, { error: "AI request body must be valid JSON." });
          return;
        }

        if (!isChatRequest(body)) {
          send(400, { error: "AI request requires system/user messages and a JSON response format." });
          return;
        }
        if (!env.AI_API_KEY || !env.AI_MODEL) {
          send(503, { error: "AI is not configured. Set AI_API_KEY and AI_MODEL in the local environment." });
          return;
        }

        const baseUrl = (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(baseUrl)) {
          send(503, { error: "AI_BASE_URL must be an HTTP or HTTPS URL." });
          return;
        }
        try {
          const upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.AI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: env.AI_MODEL,
              messages: body.messages,
              response_format: body.responseFormat
            }),
            signal: AbortSignal.timeout(120_000)
          });
          const result = await upstream.json().catch(() => null) as unknown;
          if (!upstream.ok) {
            const message = extractProviderMessage(result) || `AI provider returned HTTP ${upstream.status}.`;
            send(502, { error: message.slice(0, 500) });
            return;
          }
          const content = extractCompletionContent(result);
          if (content === null) {
            send(502, { error: "AI provider returned no message content." });
            return;
          }
          send(200, { content });
        } catch (error) {
          const message = error instanceof Error && error.name === "TimeoutError"
            ? "AI provider request timed out."
            : "Could not reach the configured AI provider.";
          send(502, { error: message });
        }
      });
    }
  };
}

function standaloneRuntime() {
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
        format: "esm",
        platform: "browser",
        target: "es2022",
        minify: true,
        legalComments: "none"
      });
      const bundle = result.outputFiles[0]?.text;
      if (!bundle) throw new Error("Could not bundle the standalone scene runtime.");
      return `export default ${JSON.stringify(bundle)};`;
    }
  };
}

function isChatRequest(value: unknown): value is {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  responseFormat: Record<string, unknown>;
} {
  if (!isRecord(value) || !Array.isArray(value.messages) || !isRecord(value.responseFormat)) return false;
  return value.messages.length >= 2 && value.messages.length <= 8 && value.messages.every((message) =>
    isRecord(message) && (message.role === "system" || message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" && message.content.length <= 50_000
  );
}

function extractCompletionContent(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string") return null;
  return first.message.content;
}

function extractProviderMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== "string") return null;
  return value.error.message;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
