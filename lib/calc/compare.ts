// Loan-side numbers used to compare a HELOC with an HEI.
// Rule RE-2 (CLAUDE.md §8.4) compares the user's monthly capacity with the
// HELOC interest-only payment; PLAN §5.3 shows interest over time next to HEI costs.

import { requireNonNegative, requirePositive } from "./guards";

/** Monthly payment while only interest is paid: balance × yearly rate ÷ 12. */
export function helocInterestOnlyMonthlyUsd(balanceUsd: number, annualRate: number): number {
  requirePositive("balanceUsd", balanceUsd);
  requireNonNegative("annualRate", annualRate);
  return (balanceUsd * annualRate) / 12;
}

/**
 * Total interest over `years` when the balance is never paid down, assuming the
 * rate stays fixed. Real HELOC rates are variable, so this is an estimate.
 */
export function interestOnlyTotalUsd(
  balanceUsd: number,
  annualRate: number,
  years: number,
): number {
  requirePositive("balanceUsd", balanceUsd);
  requireNonNegative("annualRate", annualRate);
  requireNonNegative("years", years);
  return balanceUsd * annualRate * years;
}
