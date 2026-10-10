// AI "Parse" for the script editor, as an adaptive, escalating pipeline:
//   1. local: fix typos and common synonyms with no AI call;
//   2. lines: send the AI only the broken lines (with their event line) and splice
//      its replacements back in; repeats once if fixing revealed a masked error;
//   3. full:  only if the targeted fix fails or the AI asks for more context,
//      rewrite the whole script.
// Every stage's output is checked with the real parser, checker, and word recognizer.
import { autocorrect, scriptProblems, type ScriptProblem } from "../lang/autocorrect";
import { declaredNames } from "../lang/fuzzy";
import { requestJson, type ChatMessage } from "./client";
import { SCRIPT_AGENT_SPEC } from "./prompt";
import type { ParseEntity } from "./scriptParse";

export interface ScriptRewriteRequest {
  source: string;
  owner: ParseEntity | null;
  entities: ParseEntity[];
}

/** Which stage produced the result: "none" means the script was already valid. */
export type RewriteStage = "none" | "local" | "lines" | "full";

export interface ScriptRewriteResult {
  source: string;
  meaning: string;
  stage: RewriteStage;
  aiCalls: number;
}

type JsonSchema = { name: string; strict: boolean; schema: Record<string, unknown> };
export type RewriteCompletion = (messages: ChatMessage[], schema: JsonSchema) => Promise<unknown>;

const LINE_FIX_SCHEMA: JsonSchema = {
  name: "script_line_fix",
  strict: true,
  schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: { line: { type: "integer" }, text: { type: "string" } },
          required: ["line", "text"],
          additionalProperties: false
        }
      },
      needsContext: { type: "boolean" },
      meaning: { type: "string" }
    },
    required: ["lines", "needsContext", "meaning"],
    additionalProperties: false
  }
};

const FULL_REWRITE_SCHEMA: JsonSchema = {
  name: "script_rewrite",
  strict: true,
  schema: {
    type: "object",
    properties: { source: { type: "string" }, meaning: { type: "string" } },
    required: ["source", "meaning"],
    additionalProperties: false
  }
};

/** At most this many targeted line passes before escalating to a full rewrite. */
const LINE_PASSES = 2;

// Identical for every stage, so providers with prompt caching reuse it between calls.
const SYSTEM_PROMPT = `You fix scripts for a 3D scene editor. Users write casual, approximate English; you turn it into the script language below while keeping exactly what they meant.

## Script language
${SCRIPT_AGENT_SPEC}

## Rules
- Change only what is broken or unclear. Keep valid wording, settings, comments, indentation, and order.
- "this", "me", "myself" mean the script owner. Resolve object descriptions ("the ball near me") with the scene list by position; write exact object names and quote names containing spaces.
- Map casual words to supported ones when the intent is clear (begins → starts, tint → paint, hop → bounce).
- Preserve every requested action, target, value, event, and order. Never swap a trigger or condition for a different one to make it compile; an object-added trigger stays "when [object] is added".
- Never invent objects, variables, values, or behavior. If an essential detail is missing, say so in meaning.
- Answer with JSON only, no markdown fences.`;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** One short line per object: "Box1: box, #ff0000, at 0 1 0, in Group1". */
function describeEntity(entity: ParseEntity): string {
  const details = [
    entity.shape,
    entity.color,
    entity.position ? `at ${entity.position.map(round).join(" ")}` : undefined,
    entity.parent ? `in ${entity.parent}` : undefined
  ].filter(Boolean);
  return details.length ? `${entity.name}: ${details.join(", ")}` : entity.name;
}

function contextBlock(request: ScriptRewriteRequest, source: string): string {
  const variables = [...declaredNames(source)];
  return [
    `Script owner (me): ${request.owner ? describeEntity(request.owner) : "none (scene script)"}`,
    `Scene objects:\n${request.entities.length ? request.entities.map((entity) => `- ${describeEntity(entity)}`).join("\n") : "(none)"}`,
    variables.length ? `Script variables: ${variables.join(", ")}` : ""
  ].filter(Boolean).join("\n");
}

/** The event line a statement belongs to: the nearest unindented line above it. */
function eventLineFor(lines: string[], index: number): string | null {
  if (!/^\s/.test(lines[index]!)) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (line.trim() && !/^\s/.test(line) && !line.trim().startsWith("--")) return line.trim();
  }
  return null;
}

function groupByLine(problems: ScriptProblem[]): Map<number, string[]> {
  const byLine = new Map<number, string[]>();
  for (const { line, message } of problems) byLine.set(line, [...(byLine.get(line) ?? []), message]);
  return byLine;
}

export function buildLineFixMessages(request: ScriptRewriteRequest, source: string, problems: ScriptProblem[]): ChatMessage[] {
  const lines = source.split("\n");
  const targets = [...groupByLine(problems)].map(([line, messages]) => {
    const event = eventLineFor(lines, line - 1);
    return `Line ${line}${event ? ` (under "${event}")` : ""}: ${JSON.stringify(lines[line - 1] ?? "")}\n  problems: ${messages.join("; ")}`;
  });
  const user = `${contextBlock(request, source)}

Fix only these lines of the user's script:
${targets.join("\n")}

Return {"lines":[{"line":<number>,"text":"<replacement line, keeping its indentation>"}],"needsContext":false,"meaning":"<one short sentence>"}.
- One entry per listed line. Use "\\n" in text only if one sentence must become several lines.
- If a line cannot be understood without seeing the rest of the script, return "lines":[] and "needsContext":true.`;
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }];
}

export function buildScriptRewriteMessages(request: ScriptRewriteRequest, source: string = request.source, problems: ScriptProblem[] = []): ChatMessage[] {
  const remaining = problems.length ? `\nProblems found:\n${problems.map((problem) => `- line ${problem.line}: ${problem.message}`).join("\n")}\n` : "";
  const user = `${contextBlock(request, source)}
${remaining}
Rewrite the complete script below into valid script syntax, interpreting it as a whole. Change only what is needed.
Return {"source":"<complete script>","meaning":"<one short sentence>"}.
<script>
${source}
</script>`;
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface LineReply {
  lines: { line: number; text: string }[];
  needsContext: boolean;
  meaning: string;
}

function parseLineReply(value: unknown): LineReply {
  if (!isRecord(value) || !Array.isArray(value.lines)) return { lines: [], needsContext: true, meaning: "" };
  return {
    lines: value.lines.filter(isRecord).filter((item) => Number.isInteger(item.line) && typeof item.text === "string")
      .map((item) => ({ line: item.line as number, text: item.text as string })),
    needsContext: value.needsContext === true,
    meaning: typeof value.meaning === "string" ? value.meaning : ""
  };
}

function parseFullReply(value: unknown): { source: string; meaning: string } {
  if (!isRecord(value)) throw new Error("The AI response must be a JSON object.");
  if (typeof value.source !== "string" || typeof value.meaning !== "string") throw new Error("The AI response must include rewritten source and an explanation.");
  if (!value.source.trim()) throw new Error("The AI returned an empty script.");
  return { source: value.source, meaning: value.meaning };
}

/**
 * Splice replacement lines into the source. Only lines in `allowed` may change.
 * Returns the new source and the 1-based line ranges the replacements now occupy.
 */
export function applyLineFixes(source: string, fixes: { line: number; text: string }[], allowed: Set<number>): { source: string; edited: [number, number][] } {
  const byLine = new Map(fixes.filter((fix) => allowed.has(fix.line)).map((fix) => [fix.line, fix.text]));
  const output: string[] = [];
  const edited: [number, number][] = [];
  source.split("\n").forEach((line, index) => {
    const text = byLine.get(index + 1);
    if (text === undefined) { output.push(line); return; }
    // Keep the original indentation when the model drops it.
    const indent = line.match(/^\s*/)![0];
    const replacement = text.split("\n").map((part) => (!part.trim() || /^\s/.test(part) ? part : indent + part));
    edited.push([output.length + 1, output.length + replacement.length]);
    output.push(...replacement);
  });
  return { source: output.join("\n"), edited };
}

function entityNameSet(entities: ParseEntity[]): Set<string> {
  return new Set(entities.flatMap((entity) => [entity.id.toLowerCase(), ...entity.name.toLowerCase().split(/\s+/)]));
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return !trimmed || /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

const defaultCompletion: RewriteCompletion = (messages, schema) => requestJson(messages, schema);

/** Fix the script with the cheapest stage that works; see the file header. */
export async function runScriptRewrite(request: ScriptRewriteRequest, complete: RewriteCompletion = defaultCompletion): Promise<ScriptRewriteResult> {
  const names = entityNameSet(request.entities);
  const notes: string[] = [];
  let aiCalls = 0;

  // Stage 1: local typo and synonym fixes.
  const local = autocorrect(request.source, request.entities);
  let current = local.source;
  if (local.fixes.length) notes.push(`Fixed typos: ${local.fixes.map((fix) => `${fix.from} → ${fix.to}`).join(", ")}.`);
  let problems = scriptProblems(current, names);
  if (!problems.length) {
    return { source: current, meaning: notes.join(" ") || "The script is already valid.", stage: local.fixes.length ? "local" : "none", aiCalls };
  }

  // Stage 2: targeted line fixes.
  for (let pass = 0; pass < LINE_PASSES; pass += 1) {
    const reply = parseLineReply(await complete(buildLineFixMessages(request, current, problems), LINE_FIX_SCHEMA));
    aiCalls += 1;
    if (reply.needsContext || !reply.lines.length) break;
    const next = applyLineFixes(current, reply.lines, new Set(problems.map((problem) => problem.line)));
    const nextProblems = scriptProblems(next.source, names);
    const editedStillBroken = nextProblems.some((problem) => next.edited.some(([start, end]) => problem.line >= start && problem.line <= end));
    if (!next.edited.length || editedStillBroken) break;
    current = next.source;
    problems = nextProblems;
    if (reply.meaning) notes.push(sentence(reply.meaning));
    if (!problems.length) return { source: current, meaning: notes.join(" "), stage: "lines", aiCalls };
    // Otherwise the parser has moved on to an error the first one was hiding: target it next.
  }

  // Stage 3: full rewrite with the whole script as context.
  const full = parseFullReply(await complete(buildScriptRewriteMessages(request, current, problems), FULL_REWRITE_SCHEMA));
  aiCalls += 1;
  const remaining = scriptProblems(full.source, names);
  if (remaining.length) throw new Error(`The AI rewrite still has script errors: Line ${remaining[0]!.line}: ${remaining[0]!.message}`);
  return { source: full.source, meaning: [...notes, sentence(full.meaning)].filter(Boolean).join(" "), stage: "full", aiCalls };
}
