import { describe, expect, it } from "vitest";
import { grossInvestment, heiTerms } from "./hei";
import { HOME_EXAMPLE } from "./test-fixtures";

// Expected values: CLAUDE.md §8.5, real estate table.
describe("heiTerms: $1,000,000 home, $150,000 cash", () => {
  const terms = heiTerms(HOME_EXAMPLE);

  it("grosses up the cash so the 3.9% fee comes out of the investment", () => {
    expect(terms.grossInvestmentUsd).toBeCloseTo(156_087.41, 2);
    expect(terms.feeUsd).toBeCloseTo(6_087.41, 2);
  });

  it("prices a token at a one-third discount to today's unit value", () => {
    expect(terms.unitValueTodayUsd).toBe(1);
    expect(terms.tokenPriceUsd).toBeCloseTo(0.666667, 6);
  });

  it("mints 234,131 tokens, a 23.41% share of future value", () => {
    expect(terms.tokenSupply).toBe(234_131);
    expect(terms.shareOfFutureValue * 100).toBeCloseTo(23.41, 2);
  });

  it("is eligible: the investment is 15.6% of value, under the 24.99% cap", () => {
    expect(terms.eligible).toBe(true);
  });
});

describe("grossInvestment: minimum fee", () => {
  it("charges the $2,000 minimum when 3.9% would be less", () => {
    // 3.9% of a ~$20,812 gross is ~$812, below the minimum.
    const result = grossInvestment(20_000, 0.039, 2_000);
    expect(result.feeUsd).toBe(2_000);
    expect(result.grossInvestmentUsd).toBe(22_000);
  });
});

describe("heiTerms: limits", () => {
  it("is not eligible when the investment is above the cap", () => {
    // $300,000 cash needs ~$312,175 gross, above 24.99% of $1,000,000.
    expect(heiTerms({ ...HOME_EXAMPLE, netCashUsd: 300_000 }).eligible).toBe(false);
  });

  it("rejects an impossible input instead of returning a number", () => {
    expect(() => heiTerms({ ...HOME_EXAMPLE, homeValueUsd: 0 })).toThrow(RangeError);
    expect(() => heiTerms({ ...HOME_EXAMPLE, feeRate: 1 })).toThrow(RangeError);
  });
});
