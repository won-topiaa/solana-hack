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
