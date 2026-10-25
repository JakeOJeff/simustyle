// Pure helpers for `npm run ai:eval`: the fixed 3/4 screenshot camera and the per-prompt summary.
import type { CallCharge } from "../../src/ai/credits";

export { frameThreeQuarter } from "../../src/ai/framing";

export interface EvalRow {
  prompt: string;
  ok: boolean;
  ops: number;
  parts: number;
  /** One entry per model call, in order, e.g. ["scene_draft gpt-6-luna", "scene_review gpt-6-sol"]. */
  calls: string[];
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number;
  seconds: number;
  error?: string;
  /** A multi-step case's pass-check failures; empty when it passed, absent when it has no check. */
  checks?: string[];
  /** The last step's visual critique (score before any fix, and what came of it); absent when critique is off or skipped. */
  critique?: { score?: number; outcome: "passed" | "fixed" | "kept" | "failed" };
}

/** "9", "6 fixed", "5 kept", "error", or "-" when no critique ran. */
function critiqueCell(critique: EvalRow["critique"]): string {
  if (!critique) return "-";
  if (critique.score === undefined) return "error";
  return critique.outcome === "passed" ? String(critique.score) : `${critique.score} ${critique.outcome}`;
}

/** Token and cost totals over a prompt's calls; calls without reported usage count as zero tokens. */
export function usageTotals(charges: readonly CallCharge[]): Pick<EvalRow, "calls" | "promptTokens" | "cachedTokens" | "completionTokens" | "costUsd"> {
  return {
    calls: charges.map((charge) => `${charge.task} ${charge.model}${charge.usage ? "" : " (no usage)"}`),
    promptTokens: charges.reduce((sum, charge) => sum + (charge.usage?.promptTokens ?? 0), 0),
    cachedTokens: charges.reduce((sum, charge) => sum + (charge.usage?.cachedTokens ?? 0), 0),
    completionTokens: charges.reduce((sum, charge) => sum + (charge.usage?.completionTokens ?? 0), 0),
    costUsd: charges.reduce((sum, charge) => sum + charge.costUsd, 0)
  };
}

/** "gpt-6-luna×2, gpt-6-sol×1" in first-use order. */
function modelCounts(calls: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const call of calls) {
    const model = call.split(" ")[1] ?? "?";
    counts.set(model, (counts.get(model) ?? 0) + 1);
  }
  return [...counts].map(([model, count]) => `${model}×${count}`).join(", ") || "-";
}

/** Plain-text table with one row per prompt and a totals row; OK is FAIL when the build worked but its pass check did not. */
export function summaryTable(rows: readonly EvalRow[]): string {
  const header = ["Prompt", "OK", "Critique", "Ops", "Parts", "Models", "In tok", "Cached", "Out tok", "Cost $", "Secs"];
  const line = (row: EvalRow) => [row.prompt.length > 44 ? `${row.prompt.slice(0, 43)}…` : row.prompt, !row.ok ? "NO" : row.checks?.length ? "FAIL" : "yes", critiqueCell(row.critique), String(row.ops), String(row.parts),
    modelCounts(row.calls), String(row.promptTokens), String(row.cachedTokens), String(row.completionTokens), row.costUsd.toFixed(4), row.seconds.toFixed(0)];
  const sum = (key: "ops" | "parts" | "promptTokens" | "cachedTokens" | "completionTokens" | "costUsd" | "seconds") => rows.reduce((total, row) => total + row[key], 0);
  const scores = rows.flatMap((row) => row.critique?.score === undefined ? [] : [row.critique.score]);
  const total = ["Total", `${rows.filter((row) => row.ok && !row.checks?.length).length}/${rows.length}`,
    scores.length ? `avg ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}` : "-", String(sum("ops")), String(sum("parts")), modelCounts(rows.flatMap((row) => row.calls)),
    String(sum("promptTokens")), String(sum("cachedTokens")), String(sum("completionTokens")), sum("costUsd").toFixed(4), sum("seconds").toFixed(0)];
  const table = [header, ...rows.map(line), total];
  const widths = header.map((_, column) => Math.max(...table.map((cells) => cells[column]!.length)));
  const format = (cells: string[]) => cells.map((cell, column) => column === 0 || column === 5 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join("  ");
  return [format(header), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map((row) => format(line(row))), format(total)].join("\n");
}
