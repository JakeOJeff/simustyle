// First, instant stage of Parse: finds problems with the real parser/checker and
// fixes plain typos ("pant" → paint, "bxo1" → Box1) and a few common synonyms
// locally, so small mistakes never need an AI call.
import { typecheckScript, type ScriptDiagnostic } from "./checker";
import { declaredNames, findUnclearWords, knownWords } from "./fuzzy";
import { SYNTAX_WORDS } from "./highlight";
import { parseScript } from "./parser";

export interface ScriptProblem {
  line: number;
  message: string;
}

export interface WordFix {
  line: number;
  from: string;
  to: string;
}

/** Casual words with a clear script meaning. Kept short: anything less certain goes to the AI. */
const SYNONYMS: Record<string, string> = {
  begins: "starts", begin: "starts", launches: "starts", loads: "starts",
  tint: "paint", recolor: "paint", recolour: "paint",
  sec: "seconds", secs: "seconds",
  pause: "wait", sleep: "wait", delay: "wait",
  vanish: "hide", disappear: "hide", appear: "show",
  kill: "destroy", erase: "destroy"
};

/** Parser and checker diagnostics, with the parser's "(line, column)" suffix removed. */
export function diagnose(source: string): ScriptDiagnostic[] {
  try {
    return typecheckScript(parseScript(source));
  } catch (error) {
    const issue = error as { line?: number; column?: number; message?: string };
    return [{ line: issue.line ?? 1, column: issue.column ?? 1, message: (issue.message ?? String(error)).replace(/ \(line \d+, column \d+\)$/, "") }];
  }
}

/** Every reason the script is not yet valid: diagnostics plus words the language does not know. */
export function scriptProblems(source: string, entityNames: Set<string>): ScriptProblem[] {
  const problems: ScriptProblem[] = diagnose(source).map(({ line, message }) => ({ line, message }));
  for (const word of findUnclearWords(source, entityNames)) {
    problems.push({ line: word.line, message: `'${word.text}' is not a script word or scene object` });
  }
  return problems.sort((a, b) => a.line - b.line);
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping early past `limit`. */
export function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, prevPrev[j - 2]! + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length]!;
}

/** The single closest dictionary word, or null when nothing is close or two words tie. */
function closestWord(word: string, dictionary: Map<string, string>): string | null {
  const lower = word.toLowerCase();
  if (SYNONYMS[lower]) return SYNONYMS[lower]!;
  if (lower.length < 3) return null;
  const limit = lower.length >= 7 ? 2 : 1;
  let best: string | null = null;
  let bestDistance = limit + 1;
  let tied = false;
  for (const [candidate, display] of dictionary) {
    const distance = editDistance(lower, candidate, limit);
    if (distance < bestDistance) { best = display; bestDistance = distance; tied = false; }
    else if (distance === bestDistance && display !== best) tied = true;
  }
  return tied ? null : best;
}

/**
 * Replace unknown words with their closest known word. A replacement is kept only
 * if it adds no diagnostic to its line, so a guess can never make the script worse.
 * Scene names keep their casing ("Box1", "Big Rock"); ids are accepted as written.
 */
export function autocorrect(source: string, entities: { id: string; name: string }[]): { source: string; fixes: WordFix[] } {
  const dictionary = new Map<string, string>();
  for (const word of [...SYNTAX_WORDS, ...knownWords, ...declaredNames(source)]) if (word.length >= 2) dictionary.set(word, word);
  for (const { name } of entities) for (const word of name.split(/\s+/)) if (word) dictionary.set(word.toLowerCase(), word);
  const nameSet = new Set([...dictionary.keys(), ...entities.map((entity) => entity.id.toLowerCase())]);

  const lines = source.split("\n");
  const fixes: WordFix[] = [];
  // Right to left within each line so earlier columns stay valid after a replacement.
  const words = findUnclearWords(source, nameSet).sort((a, b) => a.line - b.line || b.column - a.column);
  for (const word of words) {
    const replacement = closestWord(word.text, dictionary);
    if (!replacement) continue;
    const index = word.line - 1;
    const line = lines[index]!;
    const before = diagnose(lines.join("\n")).filter((issue) => issue.line === word.line).length;
    lines[index] = line.slice(0, word.column - 1) + replacement + line.slice(word.column - 1 + word.text.length);
    const after = diagnose(lines.join("\n")).filter((issue) => issue.line === word.line).length;
    if (after > before) lines[index] = line;
    else fixes.push({ line: word.line, from: word.text, to: replacement });
  }
  return { source: lines.join("\n"), fixes: fixes.sort((a, b) => a.line - b.line) };
}
