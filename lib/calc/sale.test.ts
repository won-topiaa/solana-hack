import { describe, expect, it } from "vitest";
import { heiTerms } from "./hei";
import { purchaseCostMicroUsd, splitPayout, sumMicroUsd, tokenPriceMicroUsd, toMicroUsd } from "./sale";
import { homeValueAfterYears, settle } from "./settlement";
import { HOME_EXAMPLE, INVESTOR_RETURN_CAP } from "./test-fixtures";

// The §8.5 home ($1,000,000, $150,000 cash, 234,131 tokens) sold to two investors:
// 150,000 and 84,131 tokens. Expected amounts were checked separately in Python.
const terms = heiTerms(HOME_EXAMPLE);
const supply = BigInt(terms.tokenSupply);
const holdings = [
  { id: "investor-1", tokens: BigInt(150_000) },
  { id: "investor-2", tokens: BigInt(84_131) },
];

function payoutAfter(years: number, growth: number): bigint {
  const result = settle({
    grossInvestmentUsd: terms.grossInvestmentUsd,
    tokenSupply: terms.tokenSupply,
    netCashUsd: HOME_EXAMPLE.netCashUsd,
    investorReturnCap: INVESTOR_RETURN_CAP,
    years,
    homeValueAtSettlementUsd: homeValueAfterYears(HOME_EXAMPLE.homeValueUsd, growth, years),
  });
  return toMicroUsd(result.payoutUsd);
}

describe("primary sale amounts", () => {
  it("prices a token at the term sheet's p, to the micro-dollar", () => {
    expect(tokenPriceMicroUsd(terms.tokenPriceUsd)).toBe(BigInt(666_667));
  });

  it("charges each buyer tokens x price", () => {
    const price = tokenPriceMicroUsd(terms.tokenPriceUsd);
    expect(purchaseCostMicroUsd(BigInt(150_000), price)).toBe(BigInt(100_000_050_000)); // $100,000.05
    expect(purchaseCostMicroUsd(BigInt(84_131), price)).toBe(BigInt(56_087_361_377)); // $56,087.361377
  });

  it("collects G for the whole supply, give or take the price rounding", () => {
    const total = purchaseCostMicroUsd(supply, tokenPriceMicroUsd(terms.tokenPriceUsd));
    expect(total).toBe(BigInt(156_087_411_377));
    expect(Number(total - toMicroUsd(terms.grossInvestmentUsd))).toBeLessThan(10_000); // under one cent
  });

  it("refuses an empty purchase", () => {
    expect(() => purchaseCostMicroUsd(BigInt(0), BigInt(666_667))).toThrow(RangeError);
  });
});

describe("settlement split", () => {
  it("pays holders pro rata after 2 years, flat prices (cap applies: $224,765.87)", () => {
    const payout = payoutAfter(2, 0);
    expect(payout).toBe(BigInt(224_765_868_887));
    const shares = splitPayout(payout, holdings, supply);
    expect(shares.map((share) => share.payoutMicroUsd)).toEqual([BigInt(144_000_069_760), BigInt(80_765_799_126)]);
    expect(payout - sumMicroUsd(shares.map((share) => share.payoutMicroUsd))).toBe(BigInt(1)); // rounding, below one cent
  });

  it("pays holders pro rata after 10 years at +3% a year ($314,652.49)", () => {
    const shares = splitPayout(payoutAfter(10, 0.03), holdings, supply);
    expect(shares.map((share) => share.payoutMicroUsd)).toEqual([BigInt(201_587_456_901), BigInt(113_065_028_910)]);
  });

  it("keeps the price per token when a settlement finishes with the remaining holders", () => {
    const payout = payoutAfter(2, 0);
    const all = splitPayout(payout, holdings, supply);
    const rest = splitPayout(payout, [holdings[1]], supply);
    expect(rest[0].payoutMicroUsd).toBe(all[1].payoutMicroUsd);
  });

  it("skips empty accounts and refuses more tokens than the supply", () => {
    expect(splitPayout(BigInt(1_000), [{ id: "empty", tokens: BigInt(0) }], supply)).toEqual([]);
    expect(() => splitPayout(BigInt(1_000), [...holdings, { id: "extra", tokens: BigInt(1) }], supply)).toThrow(/more than the supply/);
  });
});
