// Cash paths for a home: HELOC, home equity loan, HEI and, for 62 and older, a
// reverse mortgage. Every number comes from lib/calc with registry inputs.

import {
  amortizedMonthlyPaymentUsd,
  amortizedTotalInterestUsd,
  combinedLoanToValue,
  helocInterestOnlyMonthlyUsd,
  interestOnlyTotalUsd,
} from "../calc/compare";
import { heiTerms, type HeiInput } from "../calc/hei";
import { capBindsUntilYears, homeValueAfterYears, settle } from "../calc/settlement";
import { formatPercent, formatUsd } from "../format";
import type { PathOption, Scenario } from "./types";

export type HomeInput = { assetId: string; valueUsd: number; mortgageBalanceUsd?: number };

export type RealEstateTerms = {
  helocRate: number;
  homeEquityLoanRate: number;
  rateCltvBasis: number;
  hei: Omit<HeiInput, "homeValueUsd" | "netCashUsd"> & { investorReturnCap: number };
  heiGrowthScenarios: number[];
  heiTermYears: { min: number; max: number };
};

/** 0.0709 -> "7.09%". */
export const pct = (fraction: number) => formatPercent(fraction * 100);

const HEI_KEYS = [
  "hei_investor_discount",
  "hei_fee_rate",
  "hei_fee_min_usd",
  "hei_max_investment_pct_of_value",
  "hei_investor_return_cap",
  "hei_scenario_growth_rates",
  "hei_term_years",
];

/**
 * Why the home cannot carry this amount at all: the mortgage plus the new money would be
 * more than the home is worth. Lenders' own limits are lower; this is only the floor of
 * what is possible. null when it fits or the mortgage is unknown.
 */
function overEquity(home: HomeInput, amountUsd: number, label: string): string | null {
  if (home.mortgageBalanceUsd === undefined) return null;
  const share = combinedLoanToValue(home.mortgageBalanceUsd, amountUsd, home.valueUsd);
  return share > 1 ? `The mortgage plus this ${label} would be ${pct(share)} of the home's value: more than the home is worth.` : null;
}

/** A warning when all loans together pass the loan-to-value the average rates assume. */
function cltvRisk(home: HomeInput, amountUsd: number, basis: number): string[] {
  if (home.mortgageBalanceUsd === undefined) {
    return ["Mortgage balance unknown: the lender will check how much you can borrow."];
  }
  const cltv = combinedLoanToValue(home.mortgageBalanceUsd, amountUsd, home.valueUsd);
  if (cltv <= basis) return [];
  return [`All loans together would be ${pct(cltv)} of the home value, above the ${pct(basis)} the average rate assumes, so your rate may be higher.`];
}

export function helocOption(id: string, home: HomeInput, amountUsd: number, years: number, terms: RealEstateTerms): PathOption {
  const tooMuch = overEquity(home, amountUsd, "loan");
  return {
    id,
    lane: "real_estate",
    label: `HELOC of ${formatUsd(amountUsd)}`,
    assetIds: [home.assetId],
    cashNowUsd: amountUsd,
    totalCostUsd: interestOnlyTotalUsd(amountUsd, terms.helocRate, years),
    effectiveAnnualCost: terms.helocRate,
    monthlyPaymentUsd: helocInterestOnlyMonthlyUsd(amountUsd, terms.helocRate),
    keepsAsset: true,
    timeToCash: "After lender approval",
    risks: [
      `Variable rate (about ${pct(terms.helocRate)} on average now): the payment can rise.`,
      `Interest-only payments; the ${formatUsd(amountUsd)} itself is still owed at the end.`,
      "Needs lender approval (credit and home equity).",
      ...cltvRisk(home, amountUsd, terms.rateCltvBasis),
    ],
    suitable: tooMuch === null,
    whyNotSuitable: tooMuch ?? undefined,
    usedParamKeys: ["heloc_avg_rate", "heloc_avg_rate_cltv_basis"],
  };
}

export function homeEquityLoanOption(home: HomeInput, amountUsd: number, years: number, terms: RealEstateTerms): PathOption {
  const monthly = amortizedMonthlyPaymentUsd(amountUsd, terms.homeEquityLoanRate, years);
  const tooMuch = overEquity(home, amountUsd, "loan");
  return {
    id: "re-home-equity-loan",
    lane: "real_estate",
    label: `Home equity loan of ${formatUsd(amountUsd)} (fixed rate)`,
    assetIds: [home.assetId],
    cashNowUsd: amountUsd,
    totalCostUsd: amortizedTotalInterestUsd(amountUsd, terms.homeEquityLoanRate, years),
    effectiveAnnualCost: terms.homeEquityLoanRate,
    monthlyPaymentUsd: monthly,
    keepsAsset: true,
    timeToCash: "After lender approval",
    risks: [
      `Fixed rate (about ${pct(terms.homeEquityLoanRate)} on average now), equal payments of ${formatUsd(monthly)} a month for ${years} years.`,
      "Needs lender approval (credit and home equity).",
      ...cltvRisk(home, amountUsd, terms.rateCltvBasis),
    ],
    suitable: tooMuch === null,
    whyNotSuitable: tooMuch ?? undefined,
    usedParamKeys: ["home_equity_loan_avg_rate", "heloc_avg_rate_cltv_basis"],
  };
}

export function heiOption(home: HomeInput, amountUsd: number, years: number, terms: RealEstateTerms): PathOption {
  const hei = heiTerms({ homeValueUsd: home.valueUsd, netCashUsd: amountUsd, ...terms.hei });
  const base = {
    id: "re-hei",
    lane: "real_estate" as const,
    label: `Home equity investment (HEI) of ${formatUsd(amountUsd)}, tokenized`,
    assetIds: [home.assetId],
    keepsAsset: true,
    timeToCash: "After appraisal and closing (partner steps are simulated in this demo)",
    usedParamKeys: HEI_KEYS,
  };
  if (!hei.eligible) {
    const share = hei.grossInvestmentUsd / home.valueUsd;
    const reason = `It would need ${pct(share)} of the home value; the limit is ${pct(terms.hei.maxInvestmentShareOfValue)}.`;
    return { ...base, cashNowUsd: 0, risks: [reason], informational: true, suitable: false, whyNotSuitable: reason };
  }
  // The investors' claim comes after the mortgage, so the home must have room for it too.
  const tooMuch = overEquity(home, hei.grossInvestmentUsd, "investment");
  if (tooMuch) return { ...base, cashNowUsd: 0, risks: [tooMuch], informational: true, suitable: false, whyNotSuitable: tooMuch };

  // Settlement at the user's planned horizon (early settlement is allowed), never past the longest term.
  const settleYears = Math.min(years, terms.heiTermYears.max);
  const scenarios: Scenario[] = terms.heiGrowthScenarios.map((growth) => {
    const result = settle({
      grossInvestmentUsd: hei.grossInvestmentUsd,
      tokenSupply: hei.tokenSupply,
      netCashUsd: amountUsd,
      investorReturnCap: terms.hei.investorReturnCap,
      years: settleYears,
      homeValueAtSettlementUsd: homeValueAfterYears(home.valueUsd, growth, settleYears),
    });
    return { growth, years: settleYears, payoutUsd: result.payoutUsd, totalCostUsd: result.payoutUsd - amountUsd, effectiveAnnualCost: result.ownerAnnualCost };
  });
  // Ranking uses the costliest scenario, so an HEI is never chosen on an optimistic guess.
  const costliest = scenarios.reduce((a, b) => (b.totalCostUsd > a.totalCostUsd ? b : a));
  const capYears = capBindsUntilYears({
    grossInvestmentUsd: hei.grossInvestmentUsd,
    tokenSupply: hei.tokenSupply,
    homeValueTodayUsd: home.valueUsd,
    annualGrowth: 0,
    investorReturnCap: terms.hei.investorReturnCap,
  });
  return {
    ...base,
    cashNowUsd: amountUsd,
    totalCostUsd: costliest.totalCostUsd,
    effectiveAnnualCost: costliest.effectiveAnnualCost,
    monthlyPaymentUsd: 0,
    scenarios,
    risks: [
      `No monthly payments. At settlement you pay ${pct(hei.shareOfFutureValue)} of the home's value at that time, capped at ${pct(terms.hei.investorReturnCap)} a year on the ${formatUsd(hei.grossInvestmentUsd)} invested.`,
      `Settling early costs the most: if prices stay flat the cap applies for about the first ${capYears.toFixed(1)} years.`,
      "If you cannot settle at the end of the term, you may have to sell the home or refinance (CFPB).",
    ],
    suitable: true,
  };
}

/** Rule RE-3: shown to homeowners 62 and older, without numbers (amounts need a lender quote). */
export function reverseMortgageOption(home: HomeInput): PathOption {
  return {
    id: "re-reverse-mortgage",
    lane: "real_estate",
    label: "Reverse mortgage (62 and older)",
    assetIds: [home.assetId],
    cashNowUsd: 0,
    keepsAsset: true,
    timeToCash: "After lender approval",
    risks: [
      "Only for homeowners 62 or older (CFPB).",
      "No monthly payment, but the loan balance grows every month (CFPB).",
      "The amount depends on age, home value and rates: ask a lender for a quote.",
    ],
    informational: true,
    suitable: false,
    whyNotSuitable: "Shown for information; the amount needs a lender quote.",
    usedParamKeys: ["reverse_mortgage_min_age"],
  };
}
