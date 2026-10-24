// AI "Parse" for the script editor. It only ever changes broken lines:
//   1. local: fix typos and common synonyms with no AI call;
//   2. lines: send the AI the broken lines (with the whole script as read-only
//      context) and splice its replacements back in. A replacement that still
//      fails is sent back with its errors; a fix that reveals a masked error on
//      another line targets that line next;
//   3. fallback: lines still broken after the last call are commented out, keeping
//      the user's text, so the result always runs.
// Valid lines are never touched. Every fix is checked with the real parser,
// checker, and word recognizer.
import { autocorrect, scriptProblems, type ScriptProblem } from "../lang/autocorrect";
import { declaredNames } from "../lang/fuzzy";
import { requestJson, type ChatMessage } from "./client";
import { SCRIPT_AGENT_SPEC } from "./prompt";
import { TEXTURE_AGENT_SPEC } from "../materials/catalog";
import type { ParseEntity } from "./scriptParse";

export interface ScriptRewriteRequest {
  source: string;
  owner: ParseEntity | null;
  entities: ParseEntity[];
}

/** Which stage produced the result: "none" means the script was already valid. */
export type RewriteStage = "none" | "local" | "lines";

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
      meaning: { type: "string" }
    },
    required: ["lines", "meaning"],
    additionalProperties: false
  }
};

/** AI calls allowed before giving up on the lines that still fail. */
const LINE_PASSES = 4;

// Identical for every call, so providers with prompt caching reuse it.
const SYSTEM_PROMPT = `You fix broken lines in scripts for a 3D scene editor. Users write casual, approximate, sometimes illogical English. For each broken line, work out what the user was trying to make happen and write the line they should have written in the language below.

## Script language
${SCRIPT_AGENT_SPEC}

${TEXTURE_AGENT_SPEC}

## Rules
- Only rewrite the listed broken lines. Never add actions, events, or objects the user did not write.
- Something the user counts or tracks ("give me a point", "lose a life", "add a coin") becomes a variable: "increase score by 1", "decrease lives by 1". That is their intent, not an addition.
- Always return a valid replacement for every listed line, even when the wording is odd or illogical: make sense of it as the closest supported script that keeps the user's words and intent.
- Keep the user's own action, target, values, and order. Map casual or unsupported words to the nearest supported ones (begins → starts, tint → paint, hop → bounce).
- Supported triggers stay as written (an object-added trigger stays "when [object] is added").
- "this", "me", "myself" mean the script owner. Resolve object descriptions ("the ball near me") with the scene list by position; write exact object names and quote names containing spaces. Only use objects from the scene list.
- Only fill in a value when the command cannot work without one, and then use a plain default (1 second, 1 unit).
- Say in meaning, in one short sentence, what you understood and any word you swapped.
- Answer with JSON only, no markdown fences.`;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** One short line per object: "Box1: box, #ff0000, at 0 1 0, in Group1". */
function describeEntity(entity: ParseEntity): string {
  const details = [
    entity.shape,
    entity.color,
    entity.texture ? `${entity.texture} surface` : undefined,
    entity.normalTexture ? `${entity.normalTexture} normal map` : undefined,
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

/** A replacement the model already tried for a line, and why it failed. */
export interface RejectedFix {
  line: number;
  text: string;
  problems: string[];
}

export function buildLineFixMessages(request: ScriptRewriteRequest, source: string, problems: ScriptProblem[], rejected: RejectedFix[] = []): ChatMessage[] {
  const lines = source.split("\n");
  const targets = [...groupByLine(problems)].map(([line, messages]) => {
    const event = eventLineFor(lines, line - 1);
    const tried = rejected.filter((fix) => fix.line === line)
      .map((fix) => `\n  your previous fix ${JSON.stringify(fix.text)} failed: ${fix.problems.join("; ")}`).join("");
    return `Line ${line}${event ? ` (under "${event}")` : ""}: ${JSON.stringify(lines[line - 1] ?? "")}\n  problems: ${messages.join("; ")}${tried}`;
  });
  const numbered = lines.map((line, index) => `${index + 1}| ${line}`).join("\n");
  const user = `${contextBlock(request, source)}

Whole script, for context only (do not change other lines):
${numbered}

Fix only these lines:
${targets.join("\n")}

Return {"lines":[{"line":<number>,"text":"<replacement line, keeping its indentation>"}],"meaning":"<one short sentence>"}.
- One entry per listed line. Use "\\n" in text only if one sentence must become several lines.`;
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: user }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface LineReply {
  lines: { line: number; text: string }[];
  meaning: string;
}

function parseLineReply(value: unknown): LineReply {
  if (!isRecord(value) || !Array.isArray(value.lines)) return { lines: [], meaning: "" };
  return {
    lines: value.lines.filter(isRecord).filter((item) => Number.isInteger(item.line) && typeof item.text === "string")
      .map((item) => ({ line: item.line as number, text: item.text as string })),
    meaning: typeof value.meaning === "string" ? value.meaning : ""
  };
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

const defaultCompletion: RewriteCompletion = (messages, schema) => requestJson(messages, schema, "parse");

/**
 * Apply a reply one line at a time from the top, keeping each replacement that
 * leaves no problem on its own lines. Going top-down means a broken line above
 * cannot hide a bad replacement below it (the parser stops at its first error).
 */
function keepWorkingFixes(source: string, reply: LineReply, targets: Set<number>, names: Set<string>): { source: string; kept: number; rejected: RejectedFix[] } {
  let current = source;
  let kept = 0;
  // A kept replacement that spans several lines pushes the later lines down.
  let shift = 0;
  const rejected: RejectedFix[] = [];
  const fixes = [...new Map(reply.lines.filter((fix) => targets.has(fix.line)).map((fix) => [fix.line, fix])).values()]
    .sort((a, b) => a.line - b.line);
  for (const fix of fixes) {
    const line = fix.line + shift;
    const next = applyLineFixes(current, [{ line, text: fix.text }], new Set([line]));
    const [start, end] = next.edited[0]!;
    const broken = scriptProblems(next.source, names).filter((problem) => problem.line >= start && problem.line <= end);
    if (broken.length) {
      rejected.push({ line, text: fix.text, problems: broken.map((problem) => problem.message) });
      continue;
    }
    current = next.source;
    shift += end - start;
    kept += 1;
  }
  return { source: current, kept, rejected };
}

const UNCONVERTED = "-- Parse could not convert: ";
/** Rounds of commenting out before giving up; each round also clears emptied blocks. */
const FALLBACK_ROUNDS = 5;

function indentOf(line: string): number {
  return line.match(/^\s*/)![0].length;
}

function isComment(line: string): boolean {
  return line.trim().startsWith("--");
}

function commentOut(line: string): string {
  return `${line.match(/^\s*/)![0]}${UNCONVERTED}${line.trim()}`;
}

/** Comment out event or block lines whose indented body is now only comments, innermost first. */
function commentEmptyBlocks(source: string): string {
  const lines = source.split("\n");
  for (let changed = true; changed;) {
    changed = false;
    lines.forEach((line, index) => {
      if (!line.trim() || isComment(line)) return;
      const body: string[] = [];
      for (let i = index + 1; i < lines.length; i += 1) {
        if (!lines[i]!.trim()) continue;
        if (indentOf(lines[i]!) <= indentOf(line)) break;
        body.push(lines[i]!);
      }
      if (body.length && body.every(isComment)) {
        lines[index] = commentOut(line);
        changed = true;
      }
    });
  }
  return lines.join("\n");
}

/**
 * Last resort so Parse always returns a script that runs: comment out lines the
 * AI could not fix (and any block they leave empty), keeping the user's text.
 */
function commentOutBroken(source: string, names: Set<string>): { source: string; lines: number[] } {
  let current = source;
  const commented = new Set<number>();
  for (let round = 0; round < FALLBACK_ROUNDS; round += 1) {
    const broken = new Set(scriptProblems(current, names).map((problem) => problem.line));
    if (!broken.size) break;
    current = current.split("\n").map((line, index) => {
      if (!broken.has(index + 1) || isComment(line) || !line.trim()) return line;
      commented.add(index + 1);
      return commentOut(line);
    }).join("\n");
    current = commentEmptyBlocks(current);
  }
  return { source: current, lines: [...commented].sort((a, b) => a - b) };
}

/** Fix only the broken lines; see the file header. */
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

  // Stage 2: AI fixes for the broken lines only.
  let rejected: RejectedFix[] = [];
  for (let pass = 0; pass < LINE_PASSES; pass += 1) {
    const reply = parseLineReply(await complete(buildLineFixMessages(request, current, problems, rejected), LINE_FIX_SCHEMA));
    aiCalls += 1;
    const result = keepWorkingFixes(current, reply, new Set(problems.map((problem) => problem.line)), names);
    current = result.source;
    rejected = result.rejected;
    if (result.kept && reply.meaning) notes.push(sentence(reply.meaning));
    problems = scriptProblems(current, names);
    if (!problems.length) return { source: current, meaning: notes.join(" "), stage: "lines", aiCalls };
  }

  // Stage 3: comment out what is still broken, saying what the AI last tried for each.
  const fallback = commentOutBroken(current, names);
  const remaining = scriptProblems(fallback.source, names);
  if (remaining.length) throw new Error(`Parse could not fix the script after ${aiCalls} AI calls. Line ${remaining[0]!.line}: ${remaining[0]!.message}`);
  const lines = current.split("\n");
  const unresolved = fallback.lines.map((line) => {
    const tried = rejected.find((fix) => fix.line === line);
    return `line ${line} ${JSON.stringify(lines[line - 1]!.trim())}${tried ? ` (AI's last try ${JSON.stringify(tried.text.trim())} failed: ${tried.problems[0]})` : ""}`;
  });
  notes.push(`Could not convert, so commented out for you to edit: ${unresolved.join("; ")}.`);
  return { source: fallback.source, meaning: notes.join(" "), stage: "lines", aiCalls };
}
