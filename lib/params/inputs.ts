// Turns registry entries into the inputs the calc functions need. Each bundle
// also lists the keys it read, so the freshness gate and the recommendation
// receipt know exactly which values a result depends on.

import type { HeiInput } from "../calc/hei";
import type { LtvByCategory, ShareRange, WatchCategory } from "../calc/watch";
import type { Registry } from "./types";

function entryValue(registry: Registry, key: string): unknown {
  const entry = registry.params[key];
  if (!entry) throw new Error(`Unknown registry key: ${key}`);
  return entry.value;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getNumber(registry: Registry, key: string): number {
  const value = entryValue(registry, key);
  if (!isNumber(value)) throw new Error(`${key} must be a number`);
  return value;
}

export function getShareRange(registry: Registry, key: string): ShareRange {
  const value = entryValue(registry, key) as Partial<ShareRange> | null;
  if (!value || !isNumber(value.low) || !isNumber(value.high)) {
    throw new Error(`${key} must be an object with numeric low and high`);
  }
  return { low: value.low, high: value.high };
}

function getDayRange(registry: Registry, key: string): { min: number; max: number } {
  const value = entryValue(registry, key) as { min?: unknown; max?: unknown } | null;
  if (!value || !isNumber(value.min) || !isNumber(value.max)) {
    throw new Error(`${key} must be an object with numeric min and max`);
  }
  return { min: value.min, max: value.max };
}

const WATCH_CATEGORIES: readonly WatchCategory[] = ["sport_steel", "dress_gold", "specialty_vintage"];

export function getLtvTable(registry: Registry, key: string): LtvByCategory {
  const value = entryValue(registry, key) as Partial<Record<WatchCategory, unknown>> | null;
  const table = {} as LtvByCategory;
  for (const category of WATCH_CATEGORIES) {
    const ltv = value?.[category];
    if (!isNumber(ltv)) throw new Error(`${key}.${category} must be a number`);
    table[category] = ltv;
  }
  return table;
}

function getNumberList(registry: Registry, key: string): number[] {
  const value = entryValue(registry, key);
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNumber)) {
    throw new Error(`${key} must be a non-empty list of numbers`);
  }
  return value;
}

function getTermYears(registry: Registry, key: string): { default: number; min: number; max: number } {
  const value = entryValue(registry, key) as { default?: unknown; min?: unknown; max?: unknown } | null;
  if (!value || !isNumber(value.default) || !isNumber(value.min) || !isNumber(value.max)) {
    throw new Error(`${key} must be an object with numeric default, min and max`);
  }
  return { default: value.default, min: value.min, max: value.max };
}

type WithKeys<T> = T & { usedKeys: string[] };

/** Everything heiTerms and settle need from the registry (CLAUDE.md §8.1-8.2). */
export function heiPricing(
  registry: Registry,
): WithKeys<Omit<HeiInput, "homeValueUsd" | "netCashUsd"> & { investorReturnCap: number }> {
  return {
    investorDiscount: getNumber(registry, "hei_investor_discount"),
    feeRate: getNumber(registry, "hei_fee_rate"),
    feeMinUsd: getNumber(registry, "hei_fee_min_usd"),
    maxInvestmentShareOfValue: getNumber(registry, "hei_max_investment_pct_of_value"),
    investorReturnCap: getNumber(registry, "hei_investor_return_cap"),
    usedKeys: [
      "hei_investor_discount",
      "hei_fee_rate",
      "hei_fee_min_usd",
      "hei_max_investment_pct_of_value",
      "hei_investor_return_cap",
    ],
  };
}

/** The HELOC rate used for the interest-only comparison (rule RE-2). */
export function helocRate(registry: Registry): WithKeys<{ annualRate: number }> {
  return { annualRate: getNumber(registry, "heloc_avg_rate"), usedKeys: ["heloc_avg_rate"] };
}

/** Everything the watch path functions need (CLAUDE.md §8.3). */
export function watchTerms(registry: Registry): WithKeys<{
  dealerOffer: ShareRange;
  marketplaceFee: number;
  ltvByCategory: LtvByCategory;
  loanTermDays: { min: number; max: number };
}> {
  return {
    dealerOffer: getShareRange(registry, "watch_dealer_offer_range"),
    marketplaceFee: getNumber(registry, "chrono24_private_seller_fee"),
    ltvByCategory: getLtvTable(registry, "watch_loan_ltv"),
    loanTermDays: getDayRange(registry, "watch_loan_term_days"),
    usedKeys: [
      "watch_dealer_offer_range",
      "chrono24_private_seller_fee",
      "watch_loan_ltv",
      "watch_loan_term_days",
    ],
  };
}

/** Rates and settings the comparison reads (CLAUDE.md §8.4, §8.6). */
export function comparisonTerms(registry: Registry): WithKeys<{
  helocRate: number;
  homeEquityLoanRate: number;
  rateCltvBasis: number;
  defaultHorizonYears: number;
  heiGrowthScenarios: number[];
  heiTermYears: { default: number; min: number; max: number };
  helocFirstYears: number;
  dealerUrgentDays: number;
}> {
  return {
    helocRate: getNumber(registry, "heloc_avg_rate"),
    homeEquityLoanRate: getNumber(registry, "home_equity_loan_avg_rate"),
    rateCltvBasis: getNumber(registry, "heloc_avg_rate_cltv_basis"),
    defaultHorizonYears: getNumber(registry, "comparison_default_horizon_years"),
    heiGrowthScenarios: getNumberList(registry, "hei_scenario_growth_rates"),
    heiTermYears: getTermYears(registry, "hei_term_years"),
    helocFirstYears: getNumber(registry, "heloc_first_threshold_years"),
    dealerUrgentDays: getNumber(registry, "watch_dealer_urgent_days"),
    usedKeys: [
      "heloc_avg_rate",
      "home_equity_loan_avg_rate",
      "heloc_avg_rate_cltv_basis",
      "comparison_default_horizon_years",
      "hei_scenario_growth_rates",
      "hei_term_years",
      "heloc_first_threshold_years",
      "watch_dealer_urgent_days",
    ],
  };
}
