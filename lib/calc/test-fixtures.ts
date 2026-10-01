// Inputs of the worked examples in CLAUDE.md §8.5. Tests use these fixed
// numbers, not data/params.json, so that a registry update can never silently
// change what "correct" means for the formulas.

import type { HeiInput } from "./hei";
import type { LtvByCategory, ShareRange, WatchCategory } from "./watch";

/** Real estate: $1,000,000 home, homeowner needs $150,000. */
export const HOME_EXAMPLE: HeiInput = {
  homeValueUsd: 1_000_000,
  netCashUsd: 150_000,
  investorDiscount: 1 / 3,
  feeRate: 0.039,
  feeMinUsd: 2_000,
  maxInvestmentShareOfValue: 0.2499,
};

export const INVESTOR_RETURN_CAP = 0.2;
export const HELOC_RATE = 0.0709;

/** Watches: need $30,000 from watch A and watch B. */
export const WATCH_GOAL_USD = 30_000;
export const WATCH_A = { valueUsd: 25_000, category: "sport_steel" as WatchCategory };
export const WATCH_B = { valueUsd: 15_000, category: "dress_gold" as WatchCategory };

export const DEALER_OFFER: ShareRange = { low: 0.7, high: 0.9 };
export const MARKETPLACE_FEE = 0.065;
export const WATCH_LTV: LtvByCategory = {
  sport_steel: 0.75,
  dress_gold: 0.7,
  specialty_vintage: 0.65,
};
