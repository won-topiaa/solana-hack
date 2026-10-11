// Cash paths for a home: HELOC, home equity loan, HEI and, for 62 and older, a
// reverse mortgage. Every number comes from lib/calc with registry inputs.

import {
  amortizedMonthlyPaymentUsd,
  amortizedTotalInterestUsd,
  combinedLoanToValue,
  helocInterestOnlyMonthlyUsd,
  interestOnlyTotalUsd,
} from "../calc/compare";
import { heiTerms, maxHeiNetCashUsd, type HeiInput } from "../calc/hei";
import { capBindsUntilYears, homeValueAfterYears, settle } from "../calc/settlement";
import { formatPercent, formatUsd, pricesText } from "../format";
import type { PathOption, PriceScenario, Scenario } from "./types";

export type HomeInput = { assetId: string; valueUsd: number; mortgageBalanceUsd?: number };

export type RealEstateTerms = {
  helocRate: number;
  homeEquityLoanRate: number;
  rateCltvBasis: number;
  hei: Omit<HeiInput, "homeValueUsd" | "netCashUsd"> & { investorReturnCap: number };
  heiGrowthScenarios: number[];
  /** The FHFA index's yearly growth over the past years: one more scenario (owner, 2026-10-11). */
  heiPastGrowth: { growth: number; years: number; asOf: string; usedKeys: string[] };
  heiTermYears: { min: number; max: number };
  /** For scale, never in a calculation: how fast the amount owed grows early in many HEI contracts (CFPB). */
  heiCostBenchmark?: { low: number; high: number };
};

/** The CFPB benchmark next to this HEI's cap, as one sentence (null without the registry value). */
export function heiBenchmarkText(terms: RealEstateTerms): string | null {
  const benchmark = terms.heiCostBenchmark;
  if (!benchmark) return null;
  return (
    `For scale: the CFPB found that under many home equity contracts the amount owed grows ${pct(benchmark.low)} to ${pct(benchmark.high)} a year ` +
    `in the early years (January 2025). This HEI caps it at ${pct(terms.hei.investorReturnCap)} a year.`
  );
}

/** 0.0709 -> "7.09%". */
export const pct = (fraction: number) => formatPercent(fraction * 100);

/** The HEI's price scenarios: the fixed rates, then prices moving as in the past years of the FHFA index. */
export function heiPriceScenarios(terms: RealEstateTerms): PriceScenario[] {
  const { growth, years, asOf } = terms.heiPastGrowth;
  return [...terms.heiGrowthScenarios.map((rate) => ({ growth: rate })), { growth, past: { years, asOf } }];
}

/** "stay flat", "rise 3% a year", or "move as in the 10 years to 2026-04-01 (+6.81% a year, FHFA house price index)". */
export function scenarioPricesText(scenario: PriceScenario): string {
  if (!scenario.past) return pricesText(scenario.growth);
  const signed = `${scenario.growth >= 0 ? "+" : ""}${pct(scenario.growth)}`;
  return `move as in the ${scenario.past.years} years to ${scenario.past.asOf} (${signed} a year, FHFA house price index)`;
}

/** What an HEI on this home can pay at most, said when the user asked for more. */
function heiMaxText(home: HomeInput, terms: RealEstateTerms): string {
  const max = maxHeiNetCashUsd({ homeValueUsd: home.valueUsd, ...terms.hei }, home.mortgageBalanceUsd);
  return max > 0 ? `An HEI on this home can pay at most ${formatUsd(max)}.` : "No HEI fits this home.";
}

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
    usedParamKeys: [...HEI_KEYS, ...terms.heiPastGrowth.usedKeys, ...(terms.heiCostBenchmark ? ["cfpb_hei_early_growth"] : [])],
  };
  if (!hei.eligible) {
    const share = hei.grossInvestmentUsd / home.valueUsd;
    const reason = `It would need ${pct(share)} of the home value; the limit is ${pct(terms.hei.maxInvestmentShareOfValue)}. ${heiMaxText(home, terms)}`;
    return { ...base, cashNowUsd: 0, risks: [reason], informational: true, suitable: false, whyNotSuitable: reason };
  }
  // The investors' claim (their share of the home's value, more than they paid because of
  // the discount) comes after the mortgage, so the home must have room for it too.
  const overMortgage = overEquity(home, hei.shareOfFutureValue * home.valueUsd, "investors' share");
  if (overMortgage) {
    const tooMuch = `${overMortgage} ${heiMaxText(home, terms)}`;
    return { ...base, cashNowUsd: 0, risks: [tooMuch], informational: true, suitable: false, whyNotSuitable: tooMuch };
  }

  // Settlement at the user's planned horizon (early settlement is allowed), never past the longest term.
  const settleYears = Math.min(years, terms.heiTermYears.max);
  const scenarios: Scenario[] = heiPriceScenarios(terms).map(({ growth, past }) => {
    const result = settle({
      grossInvestmentUsd: hei.grossInvestmentUsd,
      tokenSupply: hei.tokenSupply,
      netCashUsd: amountUsd,
      investorReturnCap: terms.hei.investorReturnCap,
      years: settleYears,
      homeValueAtSettlementUsd: homeValueAfterYears(home.valueUsd, growth, settleYears),
    });
    return { growth, ...(past ? { past } : {}), years: settleYears, payoutUsd: result.payoutUsd, totalCostUsd: result.payoutUsd - amountUsd, effectiveAnnualCost: result.ownerAnnualCost };
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
      ...(heiBenchmarkText(terms) ? [heiBenchmarkText(terms) as string] : []),
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
