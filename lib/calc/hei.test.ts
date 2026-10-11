import { describe, expect, it } from "vitest";
import { grossInvestment, heiTerms, maxHeiNetCashUsd, type HeiInput } from "./hei";
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

// Expected values: CLAUDE.md §8.5, "most cash an HEI can pay".
describe("maxHeiNetCashUsd: the most cash an HEI on a home can pay", () => {
  // The §8.5 pricing; the function finds the cash itself.
  const pricing: Omit<HeiInput, "netCashUsd"> = HOME_EXAMPLE;

  it("stops at the 24.99% cap: $240,153 on a $1,000,000 home", () => {
    expect(maxHeiNetCashUsd(pricing)).toBe(240_153);
    expect(heiTerms({ ...pricing, netCashUsd: 240_153 }).eligible).toBe(true);
    expect(heiTerms({ ...pricing, netCashUsd: 240_154 }).eligible).toBe(false);
  });

  it("gives $56,436 on a $235,000 home with a $56,302 mortgage (the cap binds)", () => {
    expect(maxHeiNetCashUsd({ ...pricing, homeValueUsd: 235_000 }, 56_302)).toBe(56_436);
  });

  it("is limited by the mortgage when the investors' claim would not fit behind it", () => {
    // $300,000 home, $250,000 mortgage: G <= $50,000 x 2/3; the $2,000 minimum fee applies.
    const home = { ...pricing, homeValueUsd: 300_000 };
    expect(maxHeiNetCashUsd(home, 250_000)).toBe(31_333);
    const claim = (cash: number) => heiTerms({ ...home, netCashUsd: cash }).shareOfFutureValue * 300_000;
    expect(250_000 + claim(31_333)).toBeLessThanOrEqual(300_000);
    expect(250_000 + claim(31_334)).toBeGreaterThan(300_000);
  });

  it("steps down a dollar when rounding the token supply tips the claim past the home's value", () => {
    // $2,050,000 home, $1,300,000 mortgage: the formula gives $480,500, whose rounded supply is a few dollars too many.
    const home = { ...pricing, homeValueUsd: 2_050_000 };
    const cash = maxHeiNetCashUsd(home, 1_300_000);
    const claim = (amount: number) => heiTerms({ ...home, netCashUsd: amount }).shareOfFutureValue * 2_050_000;
    expect(cash).toBeLessThan(480_500);
    expect(1_300_000 + claim(cash)).toBeLessThanOrEqual(2_050_000);
    expect(1_300_000 + claim(cash + 1)).toBeGreaterThan(2_050_000);
  });

  it("is 0 when no HEI fits", () => {
    expect(maxHeiNetCashUsd({ ...pricing, homeValueUsd: 300_000 }, 300_000)).toBe(0);
    expect(maxHeiNetCashUsd({ ...pricing, homeValueUsd: 300_000 }, 350_000)).toBe(0);
  });
});
