import { describe, expect, it } from "vitest";
import { callCostUsd, CREDIT_USD, creditsForCost, priceFor, readUsage, worstCaseUsd } from "../../src/ai/pricing";

describe("AI pricing", () => {
  it("prices prompt, cached, and completion tokens separately", () => {
    // 8000 fresh * $0.10 + 2000 cached * $0.01 + 1000 out * $0.50, per 1M tokens.
    expect(callCostUsd("gpt-6-luna", { promptTokens: 10_000, cachedTokens: 2_000, completionTokens: 1_000 })).toBeCloseTo(0.00132, 12);
    expect(callCostUsd("gpt-6-sol", { promptTokens: 10_000, cachedTokens: 2_000, completionTokens: 1_000 })).toBeCloseTo(0.0264, 12);
  });

  it("never under-counts unknown models and accepts dated variants", () => {
    expect(priceFor("mystery-model")).toEqual(priceFor("gpt-6-sol"));
    expect(priceFor("gpt-6-luna-2026-09-01")).toEqual(priceFor("gpt-6-luna"));
    expect(priceFor("gpt-6-lunatic")).toEqual(priceFor("gpt-6-sol"));
  });

  it("rounds cost up to whole credits without float noise", () => {
    expect(creditsForCost(0)).toBe(0);
    expect(creditsForCost(0.00001)).toBe(1);
    expect(creditsForCost(CREDIT_USD * 3)).toBe(3);
    expect(creditsForCost(CREDIT_USD * 3 + 0.000001)).toBe(4);
    expect(worstCaseUsd("scene_review")).toBeCloseTo(0.0501, 12);
  });

  it("reads provider usage, defaulting cached tokens to zero", () => {
    expect(readUsage({ usage: { prompt_tokens: 50, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 20 } } }))
      .toEqual({ promptTokens: 50, cachedTokens: 20, completionTokens: 7 });
    expect(readUsage({ usage: { prompt_tokens: 50, completion_tokens: 7 } })).toEqual({ promptTokens: 50, cachedTokens: 0, completionTokens: 7 });
    expect(readUsage({ choices: [] })).toBeNull();
    expect(readUsage({ usage: { prompt_tokens: "50" } })).toBeNull();
  });
});
