// A small fixed registry for tests, so they do not change when the real
// data/params.json is refreshed. Values match the registry of 2026-10-01.

import type { ParamEntry, Registry } from "./types";

export function entry(overrides: Partial<ParamEntry>): ParamEntry {
  return {
    value: 0,
    unit: "fraction",
    kind: "market",
    source: "test",
    source_url: null,
    as_of: "2026-10-01",
    checked_at: null,
    valid_days: 7,
    ...overrides,
  };
}

export function makeRegistry(params: Record<string, ParamEntry>, version = "2026-10-01.3"): Registry {
  return {
    registry_version: version,
    created_at: "2026-10-01T16:30:00+09:00",
    status: "test",
    changelog: [{ version, note: "test registry" }],
    rules: {},
    params,
  };
}

/** Every key the calc input bundles read, all fresh on 2026-10-01. */
export function testRegistry(): Registry {
  const checked = { checked_at: "2026-10-01", valid_days: 30 };
  return makeRegistry({
    hei_investor_discount: entry({ kind: "design", value: 0.333333, valid_days: null }),
    hei_fee_rate: entry({ kind: "product", value: 0.039, ...checked }),
    hei_fee_min_usd: entry({ kind: "product", value: 2000, unit: "USD", ...checked }),
    hei_max_investment_pct_of_value: entry({ kind: "design", value: 0.2499, valid_days: null }),
    hei_investor_return_cap: entry({ kind: "design", value: 0.2, valid_days: null }),
    heloc_avg_rate: entry({ kind: "market", value: 0.0709, as_of: "2026-09-25", valid_days: 7 }),
    sofr: entry({ kind: "market", value: 0.039, as_of: "2026-09-28", valid_days: 3 }),
    watch_dealer_offer_range: entry({ kind: "product", value: { low: 0.7, high: 0.9 }, ...checked }),
    chrono24_private_seller_fee: entry({ kind: "product", value: 0.065, ...checked }),
    watch_loan_ltv: entry({
      kind: "product",
      value: { sport_steel: 0.75, dress_gold: 0.7, specialty_vintage: 0.65 },
      ...checked,
    }),
    watch_loan_term_days: entry({ kind: "product", value: { min: 30, max: 180 }, unit: "days", ...checked }),
    avm_median_error: entry({ kind: "reference", value: { off_market: 0.075 }, valid_days: 90 }),
    // Comparison settings (M6)
    home_equity_loan_avg_rate: entry({ kind: "market", value: 0.0742, as_of: "2026-09-25", valid_days: 7 }),
    heloc_avg_rate_cltv_basis: entry({ kind: "market", value: 0.7, as_of: "2026-09-25", valid_days: 7 }),
    comparison_default_horizon_years: entry({ kind: "design", value: 10, valid_days: null }),
    // FHFA index growth (FRED USSTHPI, 2024-Q2 / 2016-Q2 to 2026-Q2), for the settlement demo.
    home_price_growth_2y: entry({ value: 0.034113, unit: "yearly home price growth", as_of: "2026-04-01", checked_at: "2026-10-02", valid_days: 250 }),
    // CFPB Issue Spotlight (Jan 2025): context next to the HEI's cost, never in a calculation.
    cfpb_hei_early_growth: entry({ kind: "reference", value: { low: 0.195, high: 0.22 }, unit: "yearly growth", as_of: "2025-01-15", checked_at: "2026-10-03", valid_days: null }),
    home_price_growth_10y: entry({ value: 0.068145, unit: "yearly home price growth", as_of: "2026-04-01", checked_at: "2026-10-02", valid_days: 250 }),
    hei_scenario_growth_rates: entry({ kind: "design", value: [0, 0.03], valid_days: null }),
    hei_term_years: entry({ kind: "design", value: { default: 10, min: 5, max: 30 }, valid_days: null }),
    heloc_first_threshold_years: entry({ kind: "design", value: 3, valid_days: null }),
    watch_dealer_urgent_days: entry({ kind: "design", value: 1, valid_days: null }),
    reverse_mortgage_min_age: entry({ kind: "product", value: 62, ...checked, valid_days: 365 }),
  });
}
