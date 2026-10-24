/**
 * What a model call really costs, so AI credits stand for money rather than call counts.
 * Prices are USD per 1M tokens on the provider's standard tier.
 */

import { AI_TASK_LIMITS, type AiTask } from "./tasks";

export interface ModelPrice {
  input: number;
  /** Prompt tokens served from the provider's prompt cache. */
  cachedInput: number;
  output: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-6-luna": { input: 0.10, cachedInput: 0.01, output: 0.50 },
  // Cached input $0.20/M per third-party listings (eesel.ai, devtk.ai, Oct 2026), i.e. 10% of input;
  // not confirmed on OpenAI's own pricing page — verify there. Long-context (>=272K input) rates are higher.
  "gpt-6-sol": { input: 2.00, cachedInput: 0.20, output: 10.00 }
};

/** Unknown models are priced like the most expensive one so spending is never under-counted. */
const FALLBACK_PRICE = MODEL_PRICES["gpt-6-sol"]!;

/** One credit is worth this many US dollars of provider spend. */
export const CREDIT_USD = 0.00167;

export interface TokenUsage {
  promptTokens: number;
  /** The part of promptTokens that came from the prompt cache. */
  cachedTokens: number;
  completionTokens: number;
}

/** Exact name first, then a dated or suffixed variant such as "gpt-6-luna-2026-09-01". */
export function priceFor(model: string): ModelPrice {
  const name = model.trim().toLowerCase();
  const exact = MODEL_PRICES[name];
  if (exact) return exact;
  const prefix = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length).find((key) => name.startsWith(`${key}-`));
  return prefix ? MODEL_PRICES[prefix]! : FALLBACK_PRICE;
}

export function callCostUsd(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  return ((usage.promptTokens - cached) * price.input + cached * price.cachedInput + usage.completionTokens * price.output) / 1e6;
}

/** Rounds up so every call costs at least what it spent; the epsilon absorbs float noise on exact multiples. */
export function creditsForCost(usd: number): number {
  return Math.max(0, Math.ceil(usd / CREDIT_USD - 1e-9));
}

/** The most a task may cost before its call: the credits a visitor must hold, in dollars. */
export function worstCaseUsd(task: AiTask): number {
  return AI_TASK_LIMITS[task].worstCaseCredits * CREDIT_USD;
}

/** Reads an OpenAI-style `usage` block; null when the provider did not report one. */
export function readUsage(response: unknown): TokenUsage | null {
  if (!isRecord(response) || !isRecord(response.usage)) return null;
  const { prompt_tokens: prompt, completion_tokens: completion, prompt_tokens_details: details } = response.usage;
  if (!isCount(prompt) || !isCount(completion)) return null;
  const cached = isRecord(details) && isCount(details.cached_tokens) ? details.cached_tokens : 0;
  return { promptTokens: prompt, cachedTokens: cached, completionTokens: completion };
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
