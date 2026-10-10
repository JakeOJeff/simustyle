// Syntax highlighting for the script editor. Unlike the lexer this never throws:
// half-typed code still colors sensibly while the user is mid-edit.
import { ANIMATION_VERBS, COLOR_NAMES, COMMAND_WORDS, DIRECTION_ALIASES, SENTENCE_WORDS, SUPERLATIVES } from "./vocabulary";

export type TokenClass = "comment" | "string" | "number" | "color" | "keyword" | "command" | "phrase" | "builtin" | "entity" | "property" | "operator" | "plain";

export interface HighlightSpan {
  text: string;
  cls: TokenClass;
  /** Swatch color for color literals and color words. */
  swatch?: string;
}

// Event and decision words: the skeleton of a script.
const keywords = new Set(["param", "setting", "let", "on", "every", "when", "forever", "if", "then", "else", "otherwise", "while", "repeat", "times", "until", "and", "or", "not", "is", "isn't", "equals", "true", "false", "yes", "no", "start", "starts", "started", "frame", "collide", "clicked", "pressed", "press", "touch", "touches", "receive", "hear", "game", "seconds", "second"]);
const commands = new Set<string>([...COMMAND_WORDS, ...SENTENCE_WORDS, ...ANIMATION_VERBS]);
const phrases = new Set(["the", "to", "by", "over", "in", "for", "as", "like", "above", "below", "under", "underneath", "beneath", "beside", "next", "near", "behind", "front", "of", "top", "with", "times", "degrees", "s", "animating", "one", "at", "from", "called", "named", "than", "more", "less", "least", "most", "all", "every", "each", "children", "parent", "key", "distance", "random", "a", "an", ...Object.keys(DIRECTION_ALIASES), ...Object.keys(SUPERLATIVES)]);
const builtins = new Set(["self", "me", "myself", "my", "i", "it", "everyone", "time", "dt", "random", "sin", "cos", "abs", "min", "max", "clamp", "lerp", "sqrt", "print", "spawn", "destroy", "find"]);

/** Every word the highlighter colors as syntax; Parse autocorrect matches typos against these. */
export const SYNTAX_WORDS: ReadonlySet<string> = new Set([...keywords, ...commands, ...phrases, ...builtins, ...Object.keys(COLOR_NAMES)]);

/** Split one line into colored spans. `entityNames` holds lower-cased scene names and ids. */
export function highlightLine(line: string, entityNames: Set<string> = new Set()): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let pos = 0;
  const push = (text: string, cls: TokenClass, swatch?: string) => spans.push(swatch ? { text, cls, swatch } : { text, cls });
  while (pos < line.length) {
    const rest = line.slice(pos);
    if (rest.startsWith("--")) { push(rest, "comment"); break; }
    const space = rest.match(/^\s+/);
    if (space) { push(space[0], "plain"); pos += space[0].length; continue; }
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      let end = 1;
      while (end < rest.length && rest[end] !== quote) end += rest[end] === "\\" ? 2 : 1;
      const text = rest.slice(0, Math.min(rest.length, end + 1));
      push(text, "string");
      pos += text.length;
      continue;
    }
    const color = rest.match(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/);
    if (color) { push(color[0], "color", color[0].slice(0, 7)); pos += color[0].length; continue; }
    const number = rest.match(/^(?:\d+\.\d+|\.\d+|\d+)(?:[eE][+-]?\d+)?/);
    if (number) { push(number[0], "number"); pos += number[0].length; continue; }
    const word = rest.match(/^[A-Za-z_][A-Za-z_0-9]*(?:'[A-Za-z]+)?/);
    if (word) {
      const text = word[0];
      const lower = text.toLowerCase();
      const afterDot = spans.length > 0 && spans[spans.length - 1]!.text === ".";
      if (afterDot) push(text, "property");
      else if (keywords.has(lower)) push(text, "keyword");
      else if (commands.has(lower) && (pos === line.search(/\S/))) push(text, "command");
      else if (COLOR_NAMES[lower]) push(text, "color", COLOR_NAMES[lower]);
      else if (builtins.has(lower)) push(text, "builtin");
      else if (phrases.has(lower)) push(text, "phrase");
      else if (entityNames.has(lower)) push(text, "entity");
      else push(text, "plain");
      pos += text.length;
      continue;
    }
    const operator = rest.match(/^(?:\.\.|[+\-*/]=|==|!=|<=|>=|[+\-*/%=<>])/);
    if (operator) { push(operator[0], "operator"); pos += operator[0].length; continue; }
    push(rest[0]!, "plain");
    pos += 1;
  }
  return spans;
}
