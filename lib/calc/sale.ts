// HEI money on-chain: the primary sale and the settlement split. Tokens move in
// whole units and dollars in whole micro-dollars (6 decimals, like USDC), so every
// amount here is a bigint and every rounding rule is written down once.
// Prices and payouts come from lib/calc/hei.ts and lib/calc/settlement.ts (CLAUDE.md §8.1, §8.2).

import { requireNonNegative } from "./guards";

/** The payment token's decimals: 6, the same as USDC, so a later switch keeps every amount. */
export const PAYMENT_DECIMALS = 6;
export const MICRO_PER_USD = 1_000_000;

/** Dollars to whole micro-dollars, rounded to the nearest. */
export function toMicroUsd(usd: number): bigint {
  requireNonNegative("usd", usd);
  return BigInt(Math.round(usd * MICRO_PER_USD));
}

/** The term sheet's token price p, rounded to the micro-dollar (0.6666667 -> 666,667). */
export function tokenPriceMicroUsd(tokenPriceUsd: number): bigint {
  const price = toMicroUsd(tokenPriceUsd);
  if (price <= BigInt(0)) throw new RangeError(`tokenPriceUsd must be at least one micro-dollar, got ${tokenPriceUsd}`);
  return price;
}

/** What a buyer pays for whole tokens in the primary sale. */
export function purchaseCostMicroUsd(tokens: bigint, priceMicroUsd: bigint): bigint {
  if (tokens <= BigInt(0)) throw new RangeError(`tokens must be at least 1, got ${tokens}`);
  return tokens * priceMicroUsd;
}

export type Holding = { id: string; tokens: bigint };
export type PayoutShare = Holding & { payoutMicroUsd: bigint };

/**
 * Splits the settlement payout across holders in proportion to their tokens:
 * a holder of `tokens` gets payout * tokens / tokenSupply. Each share is rounded
 * down to the micro-dollar and the homeowner pays the sum, so nothing is left over;
 * the sum is below the payout by less than one micro-dollar per holder.
 * `tokenSupply` is the supply issued (N), so a settlement that stopped half-way
 * can finish with the remaining holders at the same price per token.
 */
export function splitPayout(payoutMicroUsd: bigint, holdings: Holding[], tokenSupply: bigint): PayoutShare[] {
  if (payoutMicroUsd < BigInt(0)) throw new RangeError(`payout must be zero or more, got ${payoutMicroUsd}`);
  if (tokenSupply <= BigInt(0)) throw new RangeError(`tokenSupply must be at least 1, got ${tokenSupply}`);
  const held = holdings.reduce((sum, holding) => sum + holding.tokens, BigInt(0));
  if (holdings.some((holding) => holding.tokens < BigInt(0)) || held > tokenSupply) {
    throw new RangeError(`Holders have ${held} tokens, more than the supply of ${tokenSupply}`);
  }
  return holdings
    .filter((holding) => holding.tokens > BigInt(0))
    .map((holding) => ({ ...holding, payoutMicroUsd: (payoutMicroUsd * holding.tokens) / tokenSupply }));
}

/** Sum of micro-dollar amounts. */
export function sumMicroUsd(amounts: bigint[]): bigint {
  return amounts.reduce((sum, amount) => sum + amount, BigInt(0));
}
