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

export function getDayRange(registry: Registry, key: string): { min: number; max: number } {
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
