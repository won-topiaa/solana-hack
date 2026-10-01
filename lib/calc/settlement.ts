// What the homeowner pays back when an HEI settles, and what that costs per year.
// Formulas: CLAUDE.md §8.2. Choosing the settlement value (sale price or
// appraisal) is a separate step: its threshold is still TBD with the owner.

import { UNITS_PER_HOME } from "./hei";
import {
  requireGrowthRate,
  requireNonNegative,
  requirePositive,
} from "./guards";

export type SettlementInput = {
  grossInvestmentUsd: number; // G
  tokenSupply: number; // N
  netCashUsd: number; // C: what the homeowner received at the start
  investorReturnCap: number; // cap per year (hei_investor_return_cap)
  years: number; // t: time from funding to settlement
  homeValueAtSettlementUsd: number; // Vt: sale price or appraisal
};

export type Settlement = {
  uncappedPayoutUsd: number; // P0: the token holders' share of Vt
  capUsd: number; // G * (1 + cap)^t
  payoutUsd: number; // P: what the homeowner actually pays
  capApplied: boolean;
  ownerAnnualCost: number; // (P / C)^(1/t) - 1
  investorAnnualReturn: number; // (P / G)^(1/t) - 1
};

/** Constant yearly rate that turns `startUsd` into `endUsd` over `years`. */
export function annualizedRate(startUsd: number, endUsd: number, years: number): number {
  return (endUsd / startUsd) ** (1 / years) - 1;
}

/** Home value after `years` of steady yearly growth (negative growth = falling prices). */
export function homeValueAfterYears(
  homeValueUsd: number,
  annualGrowth: number,
  years: number,
): number {
  requirePositive("homeValueUsd", homeValueUsd);
  requireGrowthRate("annualGrowth", annualGrowth);
  requireNonNegative("years", years);
  return homeValueUsd * (1 + annualGrowth) ** years;
}

export function settle(input: SettlementInput): Settlement {
  requirePositive("grossInvestmentUsd", input.grossInvestmentUsd);
  requirePositive("tokenSupply", input.tokenSupply);
  requirePositive("netCashUsd", input.netCashUsd);
  requireNonNegative("investorReturnCap", input.investorReturnCap);
  requirePositive("years", input.years);
  requirePositive("homeValueAtSettlementUsd", input.homeValueAtSettlementUsd);

  const uncappedPayoutUsd =
    (input.tokenSupply * input.homeValueAtSettlementUsd) / UNITS_PER_HOME;
  // The cap stops an early settlement from costing the homeowner an extreme yearly rate.
  const capUsd = input.grossInvestmentUsd * (1 + input.investorReturnCap) ** input.years;
  const payoutUsd = Math.min(uncappedPayoutUsd, capUsd);

  return {
    uncappedPayoutUsd,
    capUsd,
    payoutUsd,
    capApplied: capUsd < uncappedPayoutUsd,
    ownerAnnualCost: annualizedRate(input.netCashUsd, payoutUsd, input.years),
    investorAnnualReturn: annualizedRate(input.grossInvestmentUsd, payoutUsd, input.years),
  };
}

/**
 * How many years the cap keeps binding. Before then the homeowner pays the
 * capped amount; after it, the plain share of the home's value.
 * Returns 0 if the cap never binds, and Infinity if prices grow at least as
 * fast as the cap (then the cap binds forever).
 */
export function capBindsUntilYears(input: {
  grossInvestmentUsd: number;
  tokenSupply: number;
  homeValueTodayUsd: number;
  annualGrowth: number;
  investorReturnCap: number;
}): number {
  requirePositive("grossInvestmentUsd", input.grossInvestmentUsd);
  requirePositive("tokenSupply", input.tokenSupply);
  requirePositive("homeValueTodayUsd", input.homeValueTodayUsd);
  requireGrowthRate("annualGrowth", input.annualGrowth);
  requireNonNegative("investorReturnCap", input.investorReturnCap);

  const shareValueTodayUsd = (input.tokenSupply * input.homeValueTodayUsd) / UNITS_PER_HOME;
  // Thanks to the discount the share starts out worth more than G, so the cap binds first.
  const startRatio = shareValueTodayUsd / input.grossInvestmentUsd;
  if (startRatio <= 1) return 0;
  const capGrowthRatio = (1 + input.investorReturnCap) / (1 + input.annualGrowth);
  if (capGrowthRatio <= 1) return Infinity;
  // Solve G * (1 + cap)^t = shareValueToday * (1 + growth)^t for t.
  return Math.log(startRatio) / Math.log(capGrowthRatio);
}
