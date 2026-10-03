// Cash paths for watches (CLAUDE.md §8.3) and the plan that uses them under
// rules W-1 to W-3 (§8.4). Every number comes from lib/calc with registry inputs.

import { minSaleShareToReachGoal, shortfallUsd, sumUsd } from "../calc/cross";
import {
  dealerOfferUsd,
  marketplaceProceedsUsd,
  watchLoanUsd,
  type LtvByCategory,
  type ShareRange,
  type WatchCategory,
} from "../calc/watch";
import { formatUsd } from "../format";
import { pct } from "./realEstate";
import type { PathOption } from "./types";

export type WatchInput = { assetId: string; label: string; valueUsd: number; category: WatchCategory | null; kept: boolean };

export type WatchTerms = {
  dealerOffer: ShareRange;
  marketplaceFee: number;
  ltvByCategory: LtvByCategory;
  loanTermDays: { min: number; max: number };
};

const KEPT = "You want to keep this watch.";

function dealerOption(watch: WatchInput, terms: WatchTerms): PathOption {
  const offer = dealerOfferUsd(watch.valueUsd, terms.dealerOffer);
  return {
    id: `w-dealer-${watch.assetId}`,
    lane: "watch",
    label: `Sell ${watch.label} to a dealer`,
    assetIds: [watch.assetId],
    cashNowUsd: offer.lowUsd,
    cashRangeUsd: { low: offer.lowUsd, high: offer.highUsd },
    totalCostUsd: watch.valueUsd - offer.lowUsd, // what you give up below market value, at the lowest offer
    keepsAsset: false,
    timeToCash: "Same day locally, next day if shipped",
    risks: [
      `Dealers pay about ${pct(1 - terms.dealerOffer.high)} to ${pct(1 - terms.dealerOffer.low)} below market value.`,
      "You give up the watch.",
    ],
    suitable: !watch.kept,
    whyNotSuitable: watch.kept ? KEPT : undefined,
    usedParamKeys: ["watch_dealer_offer_range"],
  };
}

function marketplaceOption(watch: WatchInput, terms: WatchTerms): PathOption {
  const proceeds = marketplaceProceedsUsd(watch.valueUsd, terms.marketplaceFee);
  return {
    id: `w-market-${watch.assetId}`,
    lane: "watch",
    label: `Sell ${watch.label} on a marketplace`,
    assetIds: [watch.assetId],
    cashNowUsd: proceeds,
    totalCostUsd: watch.valueUsd - proceeds,
    keepsAsset: false,
    timeToCash: "When it sells (escrow checkout)",
    risks: [`${pct(terms.marketplaceFee)} seller fee.`, "No guaranteed sale date.", "You give up the watch."],
    suitable: !watch.kept,
    whyNotSuitable: watch.kept ? KEPT : undefined,
    usedParamKeys: ["chrono24_private_seller_fee"],
  };
}

function watchLoanOption(watch: WatchInput, category: WatchCategory, terms: WatchTerms): PathOption {
  return {
    id: `w-loan-${watch.assetId}`,
    lane: "watch",
    label: `Loan against ${watch.label}`,
    assetIds: [watch.assetId],
    cashNowUsd: watchLoanUsd(watch.valueUsd, category, terms.ltvByCategory),
    keepsAsset: true,
    timeToCash: "Fast; the lender holds the watch",
    risks: [
      "Interest rate not published: get a lender quote.",
      `Term ${terms.loanTermDays.min} to ${terms.loanTermDays.max} days; the lender holds the watch until you repay.`,
      "If you do not repay, the lender can sell the watch.",
    ],
    suitable: true,
    usedParamKeys: ["watch_loan_ltv", "watch_loan_term_days"],
  };
}

/**
 * The watch's tokenization path (PLAN §6.1): authenticate, vault, issue a 1-of-1 token.
 * It raises no cash by itself, so the rules never pick it, but the user may choose it.
 */
function vaultTokenOption(watch: WatchInput): PathOption {
  return {
    id: `w-vault-token-${watch.assetId}`,
    lane: "watch",
    label: `Vault ${watch.label} and issue a 1-of-1 token`,
    assetIds: [watch.assetId],
    cashNowUsd: 0,
    keepsAsset: true,
    timeToCash: "After authentication and vault intake (simulated in this demo); cash only when the token is sold or borrowed against",
    risks: [
      "No cash by itself: cash comes only from selling the token or borrowing against it.",
      "Vault and token fees are not published (simulated in this demo).",
      "Redeeming the token takes the watch back out of the vault.",
    ],
    informational: true,
    suitable: false,
    whyNotSuitable: "Raises no cash by itself; choose it if you want to tokenize the watch.",
    usedParamKeys: [],
  };
}

/** Every single path for one watch, for the comparison table. */
export function allWatchOptions(watch: WatchInput, terms: WatchTerms): PathOption[] {
  const options = [dealerOption(watch, terms), marketplaceOption(watch, terms)];
  const loan = watch.category ? [watchLoanOption(watch, watch.category, terms)] : [];
  return [...options, ...loan, vaultTokenOption(watch)];
}

/** Paths the user may choose to prepare: suitable ones, plus the tokenization paths. */
export function isSelectable(option: PathOption): boolean {
  return option.suitable || option.id.startsWith("w-vault-token-");
}

type WatchTiming = { daysUntilNeeded: number; horizonDays: number; urgentDays: number };

/** Which way to use one watch, by rules W-1 to W-3. null = it cannot be used for this goal. */
function chooseWatchPath(
  watch: WatchInput,
  timing: WatchTiming,
  terms: WatchTerms,
): { option: PathOption; rule: "W-1" | "W-2" | "W-3" } | null {
  if (watch.kept) {
    // W-3: the user wants it back, and the need fits within a watch loan's term.
    if (watch.category === null || timing.horizonDays > terms.loanTermDays.max) return null;
    return { option: watchLoanOption(watch, watch.category, terms), rule: "W-3" };
  }
  // W-1: needed within about a day and willing to sell -> dealer. W-2: can wait -> marketplace.
  if (timing.daysUntilNeeded <= timing.urgentDays) return { option: dealerOption(watch, terms), rule: "W-1" };
  return { option: marketplaceOption(watch, terms), rule: "W-2" };
}

/** Adds paths together into one combination (its cash, known cost and monthly payment). */
export function combineOptions(id: string, lane: PathOption["lane"], parts: PathOption[]): PathOption {
  const low = sumUsd(parts.map((part) => part.cashNowUsd));
  const high = sumUsd(parts.map((part) => part.cashRangeUsd?.high ?? part.cashNowUsd));
  const costs = parts.map((part) => part.totalCostUsd);
  const monthly = parts.map((part) => part.monthlyPaymentUsd ?? 0);
  return {
    id,
    lane,
    label: parts.map((part) => part.label).join(" + "),
    assetIds: [...new Set(parts.flatMap((part) => part.assetIds))],
    cashNowUsd: low,
    cashRangeUsd: high > low ? { low, high } : undefined,
    // A part without a published cost (a watch loan) makes the total unknown.
    totalCostUsd: costs.every((cost) => cost !== undefined) ? sumUsd(costs as number[]) : undefined,
    monthlyPaymentUsd: monthly.some((payment) => payment > 0) ? sumUsd(monthly) : undefined,
    keepsAsset: parts.every((part) => part.keepsAsset),
    timeToCash: parts.map((part) => part.timeToCash).join("; "),
    risks: [...new Set(parts.flatMap((part) => part.risks))],
    parts,
    suitable: true,
    usedParamKeys: [...new Set(parts.flatMap((part) => part.usedParamKeys))],
  };
}

/** A note on whether the combination reaches the goal at the low and high offers. */
export function goalNote(plan: PathOption, goalUsd: number): string | null {
  const high = plan.cashRangeUsd?.high ?? plan.cashNowUsd;
  if (plan.cashNowUsd >= goalUsd) return null;
  if (high < goalUsd) return `Short by ${formatUsd(shortfallUsd(goalUsd, high))} even at the best offers.`;
  const sales = (plan.parts ?? [plan]).filter((part) => part.cashRangeUsd);
  if (sales.length === 1) {
    const sale = sales[0];
    const secured = plan.cashNowUsd - sale.cashNowUsd;
    // For a sale, cash plus what is given up below market equals the watch's market value.
    const watchValue = sale.cashNowUsd + (sale.totalCostUsd ?? 0);
    const share = minSaleShareToReachGoal(goalUsd, secured, watchValue);
    return `Reaches ${formatUsd(goalUsd)} only if the sale (${sale.label}) brings at least ${pct(share)} of the watch's value.`;
  }
  return `Short by up to ${formatUsd(shortfallUsd(goalUsd, plan.cashNowUsd))} at the lowest offers.`;
}

/**
 * The watch plan: loans on watches the user keeps first (W-3), then sales
 * (W-1/W-2) from the largest cash down, until the goal is reached.
 */
export function watchPlan(
  watches: WatchInput[],
  goalUsd: number,
  timing: WatchTiming,
  terms: WatchTerms,
): { plan: PathOption | null; rules: string[] } {
  const chosen = watches
    .map((watch) => chooseWatchPath(watch, timing, terms))
    .filter((path): path is NonNullable<typeof path> => path !== null);
  const loans = chosen.filter((path) => path.rule === "W-3");
  const sales = chosen.filter((path) => path.rule !== "W-3").sort((a, b) => b.option.cashNowUsd - a.option.cashNowUsd);

  const picked: typeof chosen = [];
  let secured = 0;
  for (const path of [...loans, ...sales]) {
    if (secured >= goalUsd) break;
    picked.push(path);
    secured += path.option.cashNowUsd;
  }
  if (picked.length === 0) return { plan: null, rules: [] };
  const rules = [...new Set(picked.map((path) => path.rule))];
  const plan = picked.length === 1 ? picked[0].option : combineOptions("watch-plan", "watch", picked.map((path) => path.option));
  return { plan, rules };
}
