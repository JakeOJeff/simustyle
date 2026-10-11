import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { build as esbuild } from "esbuild";
import { resolve } from "node:path";
import { forwardChat, MAX_CHAT_REQUEST_BYTES } from "./src/ai/chatProxy";

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
          send(413, { error: "AI request body exceeds 1 MiB." });
          return;
        }

        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const result = await forwardChat(bytes, env);
        send(result.status, result.body);
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
