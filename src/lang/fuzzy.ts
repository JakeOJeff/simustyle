// Finds words the script language does not know, so the editor can box them and
// offer an AI "Parse" into real syntax. The parser is forgiving (unknown names are
// treated as objects or variables), so this works from vocabulary, not parse errors.
import { highlightLine } from "./highlight";
import { ANIMATION_MODIFIERS, ANIMATION_STYLES, ANY_NOUNS, COMMAND_WORDS, FILLER_WORDS, KEY_WORDS, PROPERTY_WORDS, SENTENCE_WORDS, SHAPE_NOUNS } from "./vocabulary";

export interface UnclearWord {
  /** 1-based line and column, matching checker diagnostics. */
  line: number;
  column: number;
  text: string;
}

const knownWords = new Set<string>([
  ...COMMAND_WORDS, ...SENTENCE_WORDS, ...PROPERTY_WORDS, ...KEY_WORDS, ...ANY_NOUNS, ...FILLER_WORDS, ...ANIMATION_MODIFIERS,
  ...Object.keys(SHAPE_NOUNS), ...Object.values(ANIMATION_STYLES).flat(),
  "very", "super", "really", "if", "else", "otherwise", "do", "be", "s", "es"
]);

function isKnownNoun(word: string): boolean {
  return knownWords.has(word) || (word.endsWith("s") && (knownWords.has(word.slice(0, -1)) || knownWords.has(word.slice(0, -2))));
}

/** Names the script itself declares: "set score to 0", "setting speed = 2", "change lives by 1". */
export function declaredNames(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /\b(?:set|setting|param|let|change|increase|decrease)\s+([A-Za-z_]\w*)/gi;
  for (const match of source.matchAll(pattern)) names.add(match[1]!.toLowerCase());
  names.delete("my");
  return names;
}

/**
 * Words the language does not recognise, plus the start of any line with a
 * diagnostic that has no unknown word (so every broken line gets a box).
 * `entityNames` holds lower-cased scene names, name words, and ids.
 */
export function findUnclearWords(source: string, entityNames: Set<string>, errorLines: Set<number> = new Set()): UnclearWord[] {
  const declared = declaredNames(source);
  const found: UnclearWord[] = [];
  source.split("\n").forEach((line, index) => {
    const lineNumber = index + 1;
    let column = 1;
    const before = found.length;
    for (const span of highlightLine(line, entityNames)) {
      const lower = span.text.toLowerCase();
      if (span.cls === "plain" && /^[A-Za-z_]/.test(span.text) && !isKnownNoun(lower) && !declared.has(lower) && !entityNames.has(lower)) {
        found.push({ line: lineNumber, column, text: span.text });
      }
      column += span.text.length;
    }
    if (found.length === before && errorLines.has(lineNumber) && line.trim()) {
      const start = line.search(/\S/);
      const text = line.slice(start).replace(/\s*--.*$/, "").trimEnd();
      if (text) found.push({ line: lineNumber, column: start + 1, text });
    }
  });
  return found;
}
