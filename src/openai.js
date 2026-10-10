import { buildSystemPrompt, DEFAULT_COMPONENT_SCHEMAS } from "./prompts.js";
import { validateCurrentScene, validateSceneResponse } from "./validate.js";

function extractOutputText(response) {
  if (typeof response.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }
  const pieces = [];
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) pieces.push(content.text);
      if (content.type === "refusal") throw new Error(`The model refused the request: ${content.refusal}`);
    }
  }
  if (pieces.length) return pieces.join("\n");
  throw new Error("The model response did not contain JSON output text.");
}

export async function parseSceneRequest({ prompt, scene = [], componentSchemas, scriptLanguage }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("prompt must be a non-empty string.");
  if (!Array.isArray(scene)) throw new Error("scene must be a JSON array.");
  const registry = componentSchemas ?? DEFAULT_COMPONENT_SCHEMAS;
  const sceneCheck = validateCurrentScene(scene, registry);
  if (!sceneCheck.ok) {
    const error = new Error("The supplied scene failed validation.");
    error.validationErrors = sceneCheck.errors;
    throw error;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required. Set it in your environment before parsing.");

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const apiBase = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const system = buildSystemPrompt({ componentSchemas: registry, scriptLanguage });
  const originalRequest = JSON.stringify({ request: prompt, currentScene: scene });

  async function generate(input) {
    const response = await fetch(`${apiBase}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, input, text: { format: { type: "json_object" } } })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.error?.message || `OpenAI API returned HTTP ${response.status}`;
      throw new Error(detail);
    }
    return extractOutputText(payload);
  }

  let text = await generate([
    { role: "system", content: system },
    { role: "user", content: originalRequest }
  ]);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      if (attempt === 1) throw new Error("The model returned invalid JSON after one correction attempt.");
      text = await generate([
        { role: "system", content: system },
        { role: "user", content: originalRequest },
        { role: "assistant", content: text },
        { role: "user", content: "Fix only the JSON syntax issue in your previous response. Return the full corrected JSON object with no prose." }
      ]);
      continue;
    }

    const checked = validateSceneResponse(result, scene, registry);
    if (checked.ok) return checked.value;
    if (attempt === 1) {
      const error = new Error("The model output failed scene validation after one correction attempt.");
      error.validationErrors = checked.errors;
      throw error;
    }
    text = await generate([
      { role: "system", content: system },
      { role: "user", content: originalRequest },
      { role: "assistant", content: text },
      { role: "user", content: `Fix only these validation errors and return the full corrected JSON object: ${JSON.stringify(checked.errors)}` }
    ]);
  }
  throw new Error("Generation failed unexpectedly.");
}
