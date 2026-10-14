// AI "Parse" for the script editor: turns loose wording ("the object near this",
// "colour me crimson", "when game begins") into real script syntax. The model
// proposes ranked options per phrase; every option is checked with the real
// parser and checker before the editor shows it, and the user confirms each one.
import { typecheckScript, type ScriptDiagnostic } from "../lang/checker";
import { declaredNames, findUnclearWords, type UnclearWord } from "../lang/fuzzy";
import { parseScript } from "../lang/parser";
import { requestJson, type ChatMessage } from "./client";
import { SCRIPT_AGENT_SPEC } from "./prompt";
import { TEXTURE_AGENT_SPEC } from "../materials/catalog";

/** What the model (and the confirm popover) knows about each scene object. */
export interface ParseEntity {
  id: string;
  name: string;
  shape?: string;
  color?: string;
  texture?: string;
  normalTexture?: string;
  position?: [number, number, number];
  parent?: string;
}

export interface ParseOption {
  /** Replacement for `original`, in valid script syntax. */
  text: string;
  /** The scene object this option refers to, if any. */
  entityId: string | null;
  /** Short human explanation shown in the picker. */
  label: string;
}

export interface ParseFix {
  line: number;
  /** Exact text in that line to replace. */
  original: string;
  /** What the model thinks the user meant. */
  meaning: string;
  /** Valid options, best first. Never empty. */
  options: ParseOption[];
}

export interface ScriptParseRequest {
  source: string;
  owner: ParseEntity | null;
  entities: ParseEntity[];
  unclear: UnclearWord[];
}

export interface ScriptParseResult {
  fixes: ParseFix[];
  errors: string[];
}

export const PARSE_RESPONSE_SCHEMA = {
  name: "script_parse",
  strict: false,
  schema: {
    type: "object",
    properties: {
      fixes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            line: { type: "integer", minimum: 1 },
            original: { type: "string", minLength: 1 },
            meaning: { type: "string" },
            options: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  entityId: { type: ["string", "null"] },
                  label: { type: "string" }
                },
                required: ["text", "entityId", "label"],
                additionalProperties: false
              }
            }
          },
          required: ["line", "original", "meaning", "options"],
          additionalProperties: false
        }
      }
    },
    required: ["fixes"],
    additionalProperties: false
  }
} as const;

export function buildParseMessages(request: ScriptParseRequest): ChatMessage[] {
  const system = `You fix loosely written scripts for a 3D scene editor. The user writes casual English; you rewrite only the unclear parts into the script language below, without changing what they meant.

## Script language
${SCRIPT_AGENT_SPEC}

${TEXTURE_AGENT_SPEC}

## How to answer
Return only JSON: { "fixes": [ { "line", "original", "meaning", "options": [ { "text", "entityId", "label" } ] } ] }
- One fix per unclear phrase. "original" must be copied exactly from that line and should cover the whole phrase that needs rewriting (for "move the object near this up 2", original is "the object near this", not just "this"). For a broken sentence, original may be the whole line without its indentation.
- "options" are replacements for "original", best guess first, at most 4. Each must make the line valid script. When the phrase refers to a scene object, put the best match first and also list up to 3 other plausible objects (for example the next-closest ones), so the user can pick a different one. For other words, add alternatives only when the meaning is genuinely ambiguous.
- When an option points at a scene object, write that object's exact name (quote it if it contains spaces, e.g. "Big Rock") and set entityId to its id; otherwise entityId is null.
- Resolve references with the scene data: "this", "this one", "myself" usually mean the script owner (me). "near", "next to", "closest" mean smallest distance using positions. Synonyms map to the real words: begins → starts, colour/tint → paint, jump → move up, etc.
- "label" is a few words for the user, like "Box2 — 1.2 m away" or "means: paint".
- "meaning" is one short sentence saying what you understood.
- Do not touch anything that is already valid. Do not invent object names that are not in the scene.`;

  const numbered = request.source.split("\n").map((line, index) => `${index + 1}| ${line}`).join("\n");
  const user = `Script owner (me): ${request.owner ? JSON.stringify(request.owner) : "none (scene script)"}
Scene objects: ${JSON.stringify(request.entities)}

Script:
${numbered}

Unclear words (line:column text): ${request.unclear.map((word) => `${word.line}:${word.column} ${JSON.stringify(word.text)}`).join(", ")}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function diagnosticsFor(source: string): ScriptDiagnostic[] {
  try {
    return typecheckScript(parseScript(source));
  } catch (error) {
    const issue = error as { line?: number; column?: number; message?: string };
    return [{ line: issue.line ?? 1, column: issue.column ?? 1, message: issue.message ?? String(error) }];
  }
}

/** 0-based start of `fix.original` in its line, or -1 if the user has since edited it away. */
export function locateFix(source: string, fix: Pick<ParseFix, "line" | "original">): number {
  const line = source.split("\n")[fix.line - 1];
  return line === undefined ? -1 : line.indexOf(fix.original);
}

/** Replace each chosen fix in the source. Fixes that can no longer be found are skipped. */
export function applyChoices(source: string, choices: { fix: ParseFix; option: ParseOption }[]): string {
  const lines = source.split("\n");
  const located = choices
    .map((choice) => ({ ...choice, start: locateFix(source, choice.fix) }))
    .filter((choice) => choice.start >= 0)
    // Right to left so earlier replacements on the same line keep their columns.
    .sort((a, b) => a.fix.line - b.fix.line || b.start - a.start);
  for (const { fix, option, start } of located) {
    const line = lines[fix.line - 1]!;
    lines[fix.line - 1] = line.slice(0, start) + option.text + line.slice(start + fix.original.length);
  }
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Lower-cased ids and name words, as the highlighter and unclear-word finder expect. */
export function nameWords(entities: ParseEntity[]): Set<string> {
  return new Set(entities.flatMap((entity) => [entity.id.toLowerCase(), ...entity.name.toLowerCase().split(/s+/)]));
}

/** Keep only fixes that point at real text and options that use known words and pass the parser and checker. */
export function validateParseReply(source: string, raw: unknown, entities: ParseEntity[]): ScriptParseResult {
  const entityIds = new Set(entities.map((entity) => entity.id));
  // The parser treats unknown words as names, so also require every word of an option to be known.
  const known = new Set([...nameWords(entities), ...declaredNames(source)]);
  if (!isRecord(raw) || !Array.isArray(raw.fixes)) return { fixes: [], errors: ["Response must be a JSON object with a fixes array."] };
  const errors: string[] = [];
  const candidates: ParseFix[] = [];
  for (const item of raw.fixes) {
    if (!isRecord(item) || typeof item.line !== "number" || typeof item.original !== "string" || !Array.isArray(item.options)) {
      errors.push("Each fix needs line, original, meaning, and options.");
      continue;
    }
    const fix: ParseFix = {
      line: item.line,
      original: item.original,
      meaning: typeof item.meaning === "string" ? item.meaning : "",
      options: item.options.filter(isRecord).filter((option) => typeof option.text === "string" && option.text !== item.original).map((option) => ({
        text: option.text as string,
        entityId: typeof option.entityId === "string" && entityIds.has(option.entityId) ? option.entityId : null,
        label: typeof option.label === "string" ? option.label : ""
      }))
    };
    if (!item.original.trim() || locateFix(source, fix) < 0) errors.push(`Line ${fix.line} does not contain ${JSON.stringify(fix.original)}; copy original exactly.`);
    else if (fix.options.length) candidates.push(fix);
  }
  const fixes: ParseFix[] = [];
  for (const fix of candidates) {
    // Check each option together with the best guess for every other fix, so two
    // fixes on one broken line can only be judged together.
    const others = candidates.filter((other) => other !== fix).map((other) => ({ fix: other, option: other.options[0]! }));
    const valid = fix.options.filter((option) => {
      const unknown = findUnclearWords(option.text, known);
      if (unknown.length) {
        errors.push(`Line ${fix.line} option ${JSON.stringify(option.text)}: '${unknown[0]!.text}' is not a script word or scene object.`);
        return false;
      }
      const problems = diagnosticsFor(applyChoices(source, [...others, { fix, option }])).filter((issue) => issue.line === fix.line);
      if (problems.length) errors.push(`Line ${fix.line} option ${JSON.stringify(option.text)}: ${problems[0]!.message}`);
      return problems.length === 0;
    });
    if (valid.length) fixes.push({ ...fix, options: valid });
  }
  return { fixes, errors };
}

export type ParseCompletion = (messages: ChatMessage[]) => Promise<unknown>;

const defaultCompletion: ParseCompletion = (messages) => requestJson(messages, PARSE_RESPONSE_SCHEMA);

/** Ask the model for fixes, retrying once with the rejected options if none survive validation. */
export async function runScriptParse(request: ScriptParseRequest, complete: ParseCompletion = defaultCompletion): Promise<ScriptParseResult> {
  const messages = buildParseMessages(request);
  let result = validateParseReply(request.source, await complete(messages), request.entities);
  if (result.fixes.length === 0 && result.errors.length) {
    const retry: ChatMessage[] = [...messages, { role: "user", content: `These fixes were rejected; correct them and return the full JSON again: ${JSON.stringify(result.errors.slice(0, 12))}` }];
    result = validateParseReply(request.source, await complete(retry), request.entities);
  }
  return result;
}
