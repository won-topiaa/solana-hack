// Combining cash paths, within one lane or across lanes (rule X-1, CLAUDE.md §8.4).

import { requireNonNegative, requirePositive } from "./guards";
import type { UsdRange } from "./watch";

export function sumUsd(amountsUsd: number[]): number {
  amountsUsd.forEach((amount, i) => requireNonNegative(`amountsUsd[${i}]`, amount));
  return amountsUsd.reduce((total, amount) => total + amount, 0);
}

/** Adds ranges end to end: lowest with lowest, highest with highest. */
export function sumUsdRanges(ranges: UsdRange[]): UsdRange {
  return {
    lowUsd: sumUsd(ranges.map((range) => range.lowUsd)),
    highUsd: sumUsd(ranges.map((range) => range.highUsd)),
  };
}

/** How much cash is still missing; 0 when the goal is met. */
export function shortfallUsd(goalUsd: number, cashUsd: number): number {
  requirePositive("goalUsd", goalUsd);
  requireNonNegative("cashUsd", cashUsd);
  return Math.max(0, goalUsd - cashUsd);
}

/**
 * Lowest share of an asset's value that a sale must fetch so that the cash
 * already secured plus the sale reaches the goal. 0 means no sale is needed;
 * above 1 means even a full-value sale is not enough.
 */
export function minSaleShareToReachGoal(
  goalUsd: number,
  securedUsd: number,
  assetValueUsd: number,
): number {
  requirePositive("assetValueUsd", assetValueUsd);
  return shortfallUsd(goalUsd, securedUsd) / assetValueUsd;
}
