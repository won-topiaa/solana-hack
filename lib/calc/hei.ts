// Home equity investment (HEI) terms: how much investors pay in total and how
// many tokens stand for their share of the home's future value.
// Formulas: CLAUDE.md §8.1. Values come from data/params.json (param names in comments).

import { combinedLoanToValue } from "./compare";
import {
  requireFraction,
  requireNonNegative,
  requirePositive,
} from "./guards";

/** One unit (and one token) is 1/1,000,000 of the home's value. */
export const UNITS_PER_HOME = 1_000_000;

export type HeiInput = {
  homeValueUsd: number; // V: today's home value
  netCashUsd: number; // C: cash the homeowner receives
  investorDiscount: number; // d (hei_investor_discount)
  feeRate: number; // phi, share of the gross investment (hei_fee_rate)
  feeMinUsd: number; // hei_fee_min_usd
  maxInvestmentShareOfValue: number; // cap on G / V (hei_max_investment_pct_of_value)
};

type HeiTerms = {
  grossInvestmentUsd: number; // G: what investors pay in total
  feeUsd: number; // G - C
  unitValueTodayUsd: number; // u = V / 1,000,000
  tokenPriceUsd: number; // p: what an investor pays per token
  tokenSupply: number; // N: tokens minted
  shareOfFutureValue: number; // s = N / 1,000,000
  eligible: boolean; // true when G is within the cap
};

/**
 * Gross investment and fee. The fee is taken out of the gross investment,
 * so the homeowner still receives exactly the cash they asked for.
 */
export function grossInvestment(
  netCashUsd: number,
  feeRate: number,
  feeMinUsd: number,
): { grossInvestmentUsd: number; feeUsd: number } {
  const grossWithRateFee = netCashUsd / (1 - feeRate);
  const rateFeeUsd = grossWithRateFee - netCashUsd;
  // On a small deal the percentage fee is below the minimum, so the minimum applies.
  if (rateFeeUsd < feeMinUsd) {
    return { grossInvestmentUsd: netCashUsd + feeMinUsd, feeUsd: feeMinUsd };
  }
  return { grossInvestmentUsd: grossWithRateFee, feeUsd: rateFeeUsd };
}

export function heiTerms(input: HeiInput): HeiTerms {
  requirePositive("homeValueUsd", input.homeValueUsd);
  requirePositive("netCashUsd", input.netCashUsd);
  requireFraction("investorDiscount", input.investorDiscount);
  requireFraction("feeRate", input.feeRate);
  requireNonNegative("feeMinUsd", input.feeMinUsd);
  requireFraction("maxInvestmentShareOfValue", input.maxInvestmentShareOfValue);

  const { grossInvestmentUsd, feeUsd } = grossInvestment(
    input.netCashUsd,
    input.feeRate,
    input.feeMinUsd,
  );
  const unitValueTodayUsd = input.homeValueUsd / UNITS_PER_HOME;
  // Investors buy below today's value; the discount is their buffer if prices fall.
  const tokenPriceUsd = unitValueTodayUsd * (1 - input.investorDiscount);
  const tokenSupply = Math.round(grossInvestmentUsd / tokenPriceUsd);

  return {
    grossInvestmentUsd,
    feeUsd,
    unitValueTodayUsd,
    tokenPriceUsd,
    tokenSupply,
    shareOfFutureValue: tokenSupply / UNITS_PER_HOME,
    eligible:
      grossInvestmentUsd <= input.maxInvestmentShareOfValue * input.homeValueUsd,
  };
}

/** True when an HEI of this size passes the cap and, with a known mortgage, fits behind it. */
function heiFits(input: HeiInput, mortgageBalanceUsd: number | undefined): boolean {
  const terms = heiTerms(input);
  if (!terms.eligible) return false;
  if (mortgageBalanceUsd === undefined) return true;
  // The investors' claim is their share of the home's value, the same test the comparison makes.
  return combinedLoanToValue(mortgageBalanceUsd, terms.shareOfFutureValue * input.homeValueUsd, input.homeValueUsd) <= 1;
}

/**
 * The most cash, in whole dollars, an HEI on this home can pay: the gross investment
 * stays within the cap and, when the mortgage is known, the investors' claim
 * (G / (1 - d), more than G because of the discount) still fits behind the mortgage.
 * 0 when no HEI fits. Shown when the user asks for more, so they know what is possible.
 */
export function maxHeiNetCashUsd(input: Omit<HeiInput, "netCashUsd">, mortgageBalanceUsd?: number): number {
  requirePositive("homeValueUsd", input.homeValueUsd);
  if (mortgageBalanceUsd !== undefined) requireNonNegative("mortgageBalanceUsd", mortgageBalanceUsd);
  let maxGrossUsd = input.maxInvestmentShareOfValue * input.homeValueUsd;
  if (mortgageBalanceUsd !== undefined) {
    maxGrossUsd = Math.min(maxGrossUsd, (input.homeValueUsd - mortgageBalanceUsd) * (1 - input.investorDiscount));
  }
  // grossInvestment() run backwards: the rate fee, or the minimum fee on a small deal.
  const netUsd = maxGrossUsd * input.feeRate >= input.feeMinUsd ? maxGrossUsd * (1 - input.feeRate) : maxGrossUsd - input.feeMinUsd;
  let cashUsd = Math.floor(netUsd);
  // Rounding the token supply can tip the last dollar over a limit: step down until it fits.
  while (cashUsd > 0 && !heiFits({ ...input, netCashUsd: cashUsd }, mortgageBalanceUsd)) cashUsd -= 1;
  return Math.max(0, cashUsd);
}
