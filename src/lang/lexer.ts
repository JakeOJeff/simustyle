export type TokenKind =
  | "identifier" | "number" | "string" | "color"
  | "newline" | "indent" | "dedent" | "eof"
  | "operator" | "punctuation";

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
}

export class ScriptError extends Error {
  readonly line: number;
  readonly column: number;

  constructor(message: string, line: number, column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "ScriptError";
    this.line = line;
    this.column = column;
  }
}

const operators = ["..", "+=", "-=", "*=", "/=", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "=", "<", ">"]; 
const punctuation = new Set([":", ".", ",", "(", ")"]);

export function lexScript(source: string): Token[] {
  const tokens: Token[] = [];
  const indents = [0];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const text = lines[lineIndex]!;
    let pos = 0;
    let indent = 0;
    while (pos < text.length && (text[pos] === " " || text[pos] === "\t")) {
      indent += text[pos] === "\t" ? 4 : 1;
      pos += 1;
    }
    if (pos === text.length) continue;

    const line = lineIndex + 1;
    const current = indents[indents.length - 1]!;
    if (indent > current) {
      indents.push(indent);
      tokens.push({ kind: "indent", value: "", line, column: pos + 1 });
    } else if (indent < current) {
      while (indent < indents[indents.length - 1]!) {
        indents.pop();
        tokens.push({ kind: "dedent", value: "", line, column: pos + 1 });
      }
      if (indent !== indents[indents.length - 1]) {
        throw new ScriptError("Indentation does not match an earlier block", line, 1);
      }
    }

    while (pos < text.length) {
      const ch = text[pos]!;
      if (ch === " " || ch === "\t") { pos += 1; continue; }
      const column = pos + 1;

      if (ch === '"' || ch === "'") {
        const quote = ch;
        pos += 1;
        let value = "";
        let closed = false;
        while (pos < text.length) {
          const c = text[pos++]!;
          if (c === quote) { closed = true; break; }
          if (c === "\\") {
            if (pos >= text.length) break;
            const escaped = text[pos++]!;
            value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
          } else value += c;
        }
        if (!closed) throw new ScriptError("Unterminated string literal", line, column);
        tokens.push({ kind: "string", value, line, column });
        continue;
      }

      if (ch === "#") {
        const match = text.slice(pos).match(/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?/);
        if (!match) throw new ScriptError("Color must be #RRGGBB or #RRGGBBAA", line, column);
        tokens.push({ kind: "color", value: match[0].toLowerCase(), line, column });
        pos += match[0].length;
        continue;
      }

      const number = text.slice(pos).match(/^(?:\d+\.\d+|\.\d+|\d+)(?:[eE][+-]?\d+)?/);
      if (number) {
        tokens.push({ kind: "number", value: number[0], line, column });
        pos += number[0].length;
        continue;
      }
      const name = text.slice(pos).match(/^[A-Za-z_][A-Za-z_0-9]*/);
      if (name) {
        tokens.push({ kind: "identifier", value: name[0], line, column });
        pos += name[0].length;
        continue;
      }
      const operator = operators.find((candidate) => text.startsWith(candidate, pos));
      if (operator) {
        tokens.push({ kind: "operator", value: operator, line, column });
        pos += operator.length;
        continue;
      }
      if (punctuation.has(ch)) {
        tokens.push({ kind: "punctuation", value: ch, line, column });
        pos += 1;
        continue;
      }
      throw new ScriptError(`Unexpected character '${ch}'`, line, column);
    }
    tokens.push({ kind: "newline", value: "", line, column: text.length + 1 });
  }

  while (indents.length > 1) {
    indents.pop();
    tokens.push({ kind: "dedent", value: "", line: lines.length, column: 1 });
  }
  tokens.push({ kind: "eof", value: "", line: lines.length, column: 1 });
  return tokens;
}
