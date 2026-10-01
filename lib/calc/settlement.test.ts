import { describe, expect, it } from "vitest";
import { heiTerms } from "./hei";
import { capBindsUntilYears, homeValueAfterYears, settle } from "./settlement";
import { HOME_EXAMPLE, INVESTOR_RETURN_CAP } from "./test-fixtures";

// Expected values: CLAUDE.md §8.5, real estate table.
const terms = heiTerms(HOME_EXAMPLE);

function settleAfter(years: number, annualGrowth: number) {
  return settle({
    grossInvestmentUsd: terms.grossInvestmentUsd,
    tokenSupply: terms.tokenSupply,
    netCashUsd: HOME_EXAMPLE.netCashUsd,
    investorReturnCap: INVESTOR_RETURN_CAP,
    years,
    homeValueAtSettlementUsd: homeValueAfterYears(HOME_EXAMPLE.homeValueUsd, annualGrowth, years),
  });
}

describe("settle: what the homeowner pays back", () => {
  // years, yearly home price growth, payout (USD), cap applied?, owner cost (%/yr)
  const cases: [number, number, number, boolean, number][] = [
    [0.5, 0, 170_985, true, 29.9],
    [1, 0, 187_305, true, 24.9],
    [2, 0, 224_766, true, 22.4],
    [3, 0, 234_131, false, 16.0],
    [3, 0.03, 255_841, false, 19.5],
    [10, 0, 234_131, false, 4.6],
    [10, 0.03, 314_652, false, 7.7],
  ];

  it.each(cases)(
    "after %s years at %s yearly growth: pays %s USD",
    (years, growth, payoutUsd, capApplied, ownerCostPct) => {
      const result = settleAfter(years, growth);
      expect(result.payoutUsd).toBeCloseTo(payoutUsd, 0);
      expect(result.capApplied).toBe(capApplied);
      expect(result.ownerAnnualCost * 100).toBeCloseTo(ownerCostPct, 1);
    },
  );

  it("gives investors 14.5% a year after 3 flat years", () => {
    expect(settleAfter(3, 0).investorAnnualReturn * 100).toBeCloseTo(14.5, 1);
  });

  it("values the home at $1,092,727 after 3 years of +3%", () => {
    expect(homeValueAfterYears(1_000_000, 0.03, 3)).toBeCloseTo(1_092_727, 0);
  });
});

describe("capBindsUntilYears", () => {
  const base = {
    grossInvestmentUsd: terms.grossInvestmentUsd,
    tokenSupply: terms.tokenSupply,
    homeValueTodayUsd: HOME_EXAMPLE.homeValueUsd,
    investorReturnCap: INVESTOR_RETURN_CAP,
  };

  it("binds for 2.22 years when prices stay flat", () => {
    expect(capBindsUntilYears({ ...base, annualGrowth: 0 })).toBeCloseTo(2.22, 2);
  });

  it("binds for 2.65 years when prices rise 3% a year", () => {
    expect(capBindsUntilYears({ ...base, annualGrowth: 0.03 })).toBeCloseTo(2.65, 2);
  });

  it("binds forever when prices grow as fast as the cap", () => {
    expect(capBindsUntilYears({ ...base, annualGrowth: 0.2 })).toBe(Infinity);
  });
});
