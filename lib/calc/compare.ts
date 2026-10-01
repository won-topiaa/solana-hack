// Loan-side numbers used to compare a HELOC or a home equity loan with an HEI.
// Rule RE-2 (CLAUDE.md §8.4) compares the user's monthly capacity with the
// HELOC interest-only payment; PLAN §5.3 shows interest over time next to HEI
// costs. Home equity loans repay in equal monthly payments (CLAUDE.md §8.6).

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

/** Equal monthly payment that repays `principalUsd` with interest over `years` (standard amortization). */
export function amortizedMonthlyPaymentUsd(principalUsd: number, annualRate: number, years: number): number {
  requirePositive("principalUsd", principalUsd);
  requireNonNegative("annualRate", annualRate);
  requirePositive("years", years);
  const months = Math.round(years * 12);
  const monthlyRate = annualRate / 12;
  if (monthlyRate === 0) return principalUsd / months;
  return (principalUsd * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

/** Interest paid over the life of that amortized loan: all payments minus the principal. */
export function amortizedTotalInterestUsd(principalUsd: number, annualRate: number, years: number): number {
  return amortizedMonthlyPaymentUsd(principalUsd, annualRate, years) * Math.round(years * 12) - principalUsd;
}

/** Combined loan-to-value: all loans on the home (existing + new) divided by its value. */
export function combinedLoanToValue(existingLoansUsd: number, newLoanUsd: number, homeValueUsd: number): number {
  requireNonNegative("existingLoansUsd", existingLoansUsd);
  requireNonNegative("newLoanUsd", newLoanUsd);
  requirePositive("homeValueUsd", homeValueUsd);
  return (existingLoansUsd + newLoanUsd) / homeValueUsd;
}
