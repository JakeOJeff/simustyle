import { createServer } from "node:http";
import { parseSceneRequest } from "./openai.js";
import { DEFAULT_COMPONENT_SCHEMAS, SCRIPT_LANGUAGE } from "./prompts.js";
import { validateCurrentScene } from "./validate.js";

const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 1024 * 1024;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Request body exceeds 1 MiB."), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    return sendJson(response, 200, { ok: true, service: "simustyle-scene-agent" });
  }
  if (request.method !== "POST" || url.pathname !== "/api/parse") {
    return sendJson(response, 404, { error: "Route not found. Use POST /api/parse or GET /health." });
  }

  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return sendJson(response, error.statusCode || 400, { error: error.message });
  }

  if (!body || typeof body.prompt !== "string" || !body.prompt.trim()) {
    return sendJson(response, 400, { error: "prompt must be a non-empty string." });
  }
  if (body.prompt.length > 12000) return sendJson(response, 413, { error: "prompt must be at most 12,000 characters." });
  const scene = body.scene ?? [];
  if (!Array.isArray(scene)) return sendJson(response, 400, { error: "scene must be an array of scene objects." });
  if (body.componentSchemas !== undefined && (body.componentSchemas === null || typeof body.componentSchemas !== "object" || Array.isArray(body.componentSchemas))) {
    return sendJson(response, 400, { error: "componentSchemas must be an object keyed by component and field." });
  }
  if (body.scriptLanguage !== undefined && typeof body.scriptLanguage !== "string") {
    return sendJson(response, 400, { error: "scriptLanguage must be a string." });
  }
  const registry = body.componentSchemas ?? DEFAULT_COMPONENT_SCHEMAS;
  const sceneCheck = validateCurrentScene(scene, registry);
  if (!sceneCheck.ok) return sendJson(response, 400, { error: "scene failed validation.", details: sceneCheck.errors });

  try {
    const result = await parseSceneRequest({
      prompt: body.prompt.trim(),
      scene,
      componentSchemas: registry,
      scriptLanguage: body.scriptLanguage ?? SCRIPT_LANGUAGE
    });
    return sendJson(response, 200, result);
  } catch (error) {
    if (error.validationErrors) {
      return sendJson(response, 422, { error: error.message, details: error.validationErrors });
    }
    const status = /OPENAI_API_KEY/.test(error.message) ? 503 : 502;
    return sendJson(response, status, { error: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`SimuStyle scene agent listening on http://localhost:${port}`);
});
