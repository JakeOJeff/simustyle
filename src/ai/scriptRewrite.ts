import { typecheckScript } from "../lang/checker";
import { declaredNames, findUnclearWords } from "../lang/fuzzy";
import { parseScript } from "../lang/parser";
import { requestJson, type ChatMessage } from "./client";
import { SCRIPT_AGENT_SPEC } from "./prompt";
import type { ParseEntity } from "./scriptParse";

export interface ScriptRewriteRequest {
  source: string;
  owner: ParseEntity | null;
  entities: ParseEntity[];
}

export interface ScriptRewriteResult {
  source: string;
  meaning: string;
}

const SCRIPT_REWRITE_SCHEMA = {
  name: "script_rewrite",
  strict: true,
  schema: {
    type: "object",
    properties: {
      source: { type: "string" },
      meaning: { type: "string" }
    },
    required: ["source", "meaning"],
    additionalProperties: false
  }
} as const;

export function buildScriptRewriteMessages(request: ScriptRewriteRequest): ChatMessage[] {
  const system = `You translate a user's complete script from casual, approximate English into the script language below. Interpret the whole script in context, including event lines, commands, object references, and indentation. Rewrite it into valid script syntax while preserving the user's intended behavior and all distinct instructions.

## Script language
${SCRIPT_AGENT_SPEC}

## Rules
- Return JSON with exactly two string fields: source (the complete rewritten script) and meaning (one short sentence explaining the interpretation).
- Do not return a patch or partial script. Keep valid lines and settings, and change only what is needed to express the user's intent in this language.
- Resolve words such as "this" and "me" using the script owner. Resolve object descriptions using the supplied scene. Use exact scene object names; quote names containing spaces.
- Convert casual wording to supported syntax when the intent is clear. Preserve each requested action, target, value, event, and order.
- Never replace a trigger or condition with a different one to make the script compile. In particular, an object-added trigger must remain an object-added trigger; use the supported "when [object] is added" event.
- Never invent objects, variables, values, or behaviors. If an essential detail is unclear or unsupported, say so in meaning instead of substituting unrelated behavior.
- The complete result must parse and type-check. Do not add markdown fences.`;
  const sceneObjects = request.entities.map(({ id, name, shape, color, position }) => ({ id, name, shape, color, position }));
  const user = `Script owner (me): ${request.owner ? JSON.stringify(request.owner) : "none (scene script)"}
Scene objects: ${JSON.stringify(sceneObjects)}

Rewrite this complete script:
<script>
${request.source}
</script>`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function validateScript(source: string, entities: ParseEntity[]): string[] {
  const problems: string[] = [];
  try {
    problems.push(...typecheckScript(parseScript(source)).map((issue) => `Line ${issue.line}: ${issue.message}`));
  } catch (error) {
    const issue = error as { line?: number; message?: string };
    problems.push(`Line ${issue.line ?? 1}: ${(issue.message ?? String(error)).replace(/ \(line \d+, column \d+\)$/, "")}`);
  }

  const knownNames = new Set([
    ...entities.flatMap((entity) => [entity.id.toLowerCase(), ...entity.name.toLowerCase().split(/\s+/)]),
    ...declaredNames(source)
  ]);
  for (const word of findUnclearWords(source, knownNames)) {
    problems.push(`Line ${word.line}: '${word.text}' is not recognized script syntax or a scene object.`);
  }
  return problems;
}

function parseReply(value: unknown): ScriptRewriteResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("The AI response must be a JSON object.");
  const record = value as Record<string, unknown>;
  if (typeof record.source !== "string" || typeof record.meaning !== "string") throw new Error("The AI response must include rewritten source and an explanation.");
  if (!record.source.trim()) throw new Error("The AI returned an empty script.");
  return { source: record.source, meaning: record.meaning };
}

/** Rewrite the whole script once; compiler validation prevents invalid output from being applied. */
export async function runScriptRewrite(
  request: ScriptRewriteRequest,
  complete: (messages: ChatMessage[]) => Promise<unknown> = (messages) => requestJson(messages, SCRIPT_REWRITE_SCHEMA)
): Promise<ScriptRewriteResult> {
  const messages = buildScriptRewriteMessages(request);
  const result = parseReply(await complete(messages));
  const problems = validateScript(result.source, request.entities);
  if (problems.length) throw new Error(`The AI rewrite still has script errors: ${problems[0]}`);
  return result;
}
