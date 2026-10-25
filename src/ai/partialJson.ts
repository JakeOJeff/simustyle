/**
 * Reads a scene reply while it is still streaming: the plan written so far, and every operation in the
 * top-level "ops" array that is already usable. The text is cut just after the last finished object inside
 * that array (an op, or an assemble part) and the open brackets are closed, so a half-written assemble
 * yields an assemble holding only its finished parts. Number arrays (positions) are never cut.
 */
export interface PartialReply {
  plan: string;
  /** Usable ops, in order; the last may be an assemble that is still growing. */
  ops: unknown[];
  /** How many leading ops are finished and will not change. */
  complete: number;
}

const closer = (open: string) => (open === "{" ? "}" : "]");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The plan string written so far, unescaped; empty until its opening quote arrives. */
function partialPlan(text: string): string {
  const start = /^\s*\{\s*"plan"\s*:\s*"/.exec(text);
  if (!start) return "";
  let end = start[0].length;
  for (; end < text.length; end++) {
    if (text[end] === "\\") end++;
    else if (text[end] === '"') break;
  }
  let body = text.slice(start[0].length, Math.min(end, text.length));
  // Drop an escape sequence cut in half (a lone backslash or a partial \uXXXX).
  body = body.replace(/\\(u[0-9a-fA-F]{0,3})?$/, "");
  try { return JSON.parse(`"${body}"`) as string; }
  catch { return ""; }
}

export function parsePartialReply(text: string): PartialReply {
  const plan = partialPlan(text);
  const stack: string[] = [];
  let inString = false;
  let stringStart = -1;
  let lastKey = "";
  let opsStart = -1;
  let opsDepth = -1;
  /** Text end and the brackets still open (from the ops array inward) at the latest safe cut. */
  let cut: { end: number; open: string[]; complete: number } | null = null;
  let complete = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inString) {
      if (char === "\\") i++;
      else if (char === '"') {
        inString = false;
        // A string directly inside the root object followed by ':' is a key.
        if (stack.length === 1) lastKey = text.slice(stringStart + 1, i);
      }
      continue;
    }
    if (char === '"') { inString = true; stringStart = i; continue; }
    if (char === "{" || char === "[") {
      if (char === "[" && stack.length === 1 && lastKey === "ops" && opsStart < 0) { opsStart = i; opsDepth = 1; }
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") continue;
    const closed = stack.pop();
    if (opsStart < 0) continue;
    if (stack.length === opsDepth) {
      // The ops array itself closed: everything in it is final.
      cut = { end: i + 1, open: [], complete };
      break;
    }
    // A finished object whose parent is an array inside the ops array: an op or an assemble part.
    if (closed === "{" && stack.at(-1) === "[" && stack.length > opsDepth) {
      if (stack.length === opsDepth + 1) complete++;
      cut = { end: i + 1, open: stack.slice(opsDepth), complete };
    }
  }

  if (opsStart < 0 || !cut) return { plan, ops: [], complete: 0 };
  const json = text.slice(opsStart, cut.end) + cut.open.slice().reverse().map(closer).join("");
  let ops: unknown[];
  try { ops = JSON.parse(json) as unknown[]; }
  catch { return { plan, ops: [], complete: 0 }; }
  if (!Array.isArray(ops)) return { plan, ops: [], complete: 0 };
  const finished = Math.min(cut.complete, ops.length);
  if (ops.length > finished) {
    // A growing op is only shown when it is an assemble with its header and at least one finished part.
    const growing = ops[finished];
    const usable = isRecord(growing) && growing.op === "assemble" && typeof growing.id === "string" && typeof growing.name === "string" &&
      "parent" in growing && Array.isArray(growing.parts) && growing.parts.length > 0;
    ops = usable ? ops.slice(0, finished + 1) : ops.slice(0, finished);
  }
  return { plan, ops, complete: finished };
}
