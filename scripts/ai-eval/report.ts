// Pure helpers for `npm run ai:eval`: the fixed 3/4 screenshot camera and the per-prompt summary.
import type { CallCharge } from "../../src/ai/credits";

type Vec3 = [number, number, number];

/** Front-right and above, looking down at the build: the same 3/4 direction for every prompt. */
const VIEW_DIRECTION: Vec3 = [1, 0.8, 1];

/** Camera position and target that fit the bounds in view from the fixed 3/4 direction; the editor default when empty. */
export function frameThreeQuarter(bounds: { min: number[]; max: number[] } | null, fovDegrees: number, aspect: number): { position: Vec3; target: Vec3 } {
  if (!bounds) return { position: [7, 6, 9], target: [0, 0.8, 0] };
  const target = bounds.min.map((value, axis) => (value + bounds.max[axis]!) / 2) as Vec3;
  const radius = Math.max(0.5, Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]!)) / 2);
  const vertical = (fovDegrees * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.05;
  const length = Math.hypot(...VIEW_DIRECTION);
  return { position: target.map((value, axis) => value + (VIEW_DIRECTION[axis]! / length) * distance) as Vec3, target };
}

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

/** Plain-text table with one row per prompt and a totals row. */
export function summaryTable(rows: readonly EvalRow[]): string {
  const header = ["Prompt", "OK", "Ops", "Parts", "Models", "In tok", "Cached", "Out tok", "Cost $", "Secs"];
  const line = (row: EvalRow) => [row.prompt.length > 44 ? `${row.prompt.slice(0, 43)}…` : row.prompt, row.ok ? "yes" : "NO", String(row.ops), String(row.parts),
    modelCounts(row.calls), String(row.promptTokens), String(row.cachedTokens), String(row.completionTokens), row.costUsd.toFixed(4), row.seconds.toFixed(0)];
  const sum = (key: "ops" | "parts" | "promptTokens" | "cachedTokens" | "completionTokens" | "costUsd" | "seconds") => rows.reduce((total, row) => total + row[key], 0);
  const total = ["Total", `${rows.filter((row) => row.ok).length}/${rows.length}`, String(sum("ops")), String(sum("parts")), modelCounts(rows.flatMap((row) => row.calls)),
    String(sum("promptTokens")), String(sum("cachedTokens")), String(sum("completionTokens")), sum("costUsd").toFixed(4), sum("seconds").toFixed(0)];
  const table = [header, ...rows.map(line), total];
  const widths = header.map((_, column) => Math.max(...table.map((cells) => cells[column]!.length)));
  const format = (cells: string[]) => cells.map((cell, column) => column === 0 || column === 4 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join("  ");
  return [format(header), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map((row) => format(line(row))), format(total)].join("\n");
}
