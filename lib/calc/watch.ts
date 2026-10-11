// Cash from one watch: dealer sale, marketplace sale or a watch-backed loan.
// Formulas: CLAUDE.md §8.3. Market values come from the price table (with source + date).

import { requireFraction, requirePositive, requireShareUpToOne } from "./guards";

export type WatchCategory = "sport_steel" | "dress_gold" | "specialty_vintage";

export type UsdRange = { lowUsd: number; highUsd: number };

/** Share-of-value range, e.g. dealers pay 0.70-0.90 of market value (watch_dealer_offer_range). */
export type ShareRange = { low: number; high: number };

/** Loan-to-value ratio per category (watch_loan_ltv). */
export type LtvByCategory = Record<WatchCategory, number>;

/** Dealers buy below market value, so the offer is a range, not one number. */
export function dealerOfferUsd(marketValueUsd: number, offer: ShareRange): UsdRange {
  requirePositive("marketValueUsd", marketValueUsd);
  requireShareUpToOne("offer.low", offer.low);
  requireShareUpToOne("offer.high", offer.high);
  if (offer.low > offer.high) {
    throw new RangeError(`offer.low (${offer.low}) is above offer.high (${offer.high})`);
  }
  return { lowUsd: marketValueUsd * offer.low, highUsd: marketValueUsd * offer.high };
}

/** What the seller keeps after the marketplace fee, which is charged after the sale. */
export function marketplaceProceedsUsd(marketValueUsd: number, sellerFeeRate: number): number {
  requirePositive("marketValueUsd", marketValueUsd);
  requireFraction("sellerFeeRate", sellerFeeRate);
  return marketValueUsd * (1 - sellerFeeRate);
}

/** Loan amount. The lender holds the watch and returns it when the loan is repaid. */
export function watchLoanUsd(
  marketValueUsd: number,
  category: WatchCategory,
  ltvByCategory: LtvByCategory,
): number {
  requirePositive("marketValueUsd", marketValueUsd);
  const ltv = ltvByCategory[category];
  requireShareUpToOne(`ltv for ${category}`, ltv);
  return marketValueUsd * ltv;
}

/**
 * A watch's market value from resale prices, asking and sold together (owner, 2026-10-11):
 * the median, so one unusual listing (a rare dial, a full set) does not move it much.
 * Whole dollars.
 */
export function medianPriceUsd(pricesUsd: number[]): number {
  if (pricesUsd.length === 0) throw new RangeError("At least one price is needed");
  for (const price of pricesUsd) requirePositive("price", price);
  const sorted = [...pricesUsd].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(median);
}
