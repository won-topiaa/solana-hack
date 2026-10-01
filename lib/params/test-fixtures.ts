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
  });
}
