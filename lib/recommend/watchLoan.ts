// The watch loan's term sheet (owner, 2026-10-11): what a loan against a watch pays,
// for how long, and what happens to the watch. Every figure comes from lib/calc with
// registry inputs. Lenders do not publish interest or fees, so no figure includes them.

import type { WatchAsset } from "../assets/types";
import { watchLoanUsd, type WatchCategory } from "../calc/watch";
import { formatUsd } from "../format";
import { pct } from "./realEstate";
import type { PathOption } from "./types";
import type { WatchTerms } from "./watches";

export type WatchLoanTermSheet = {
  assetId: string;
  label: string; // the watch's name
  marketValueUsd: number;
  valueSource: string;
  valueAsOf: string;
  category: WatchCategory;
  loanToValue: number;
  loanUsd: number;
  termDays: number; // when the user plans to repay, kept within the lenders' range
  termRangeDays: { min: number; max: number };
  hasBox?: boolean;
  hasPapers?: boolean;
  registryVersion: string;
};

const CATEGORY_TEXT: Record<WatchCategory, string> = {
  sport_steel: "steel sport watches",
  dress_gold: "dress or gold watches",
  specialty_vintage: "specialty or vintage watches",
};

/** The watch loans in a chosen path: the path itself, or the loan parts of a watch plan. */
export function watchLoanParts(option: PathOption): PathOption[] {
  return (option.parts ?? [option]).filter((part) => part.id.startsWith("w-loan-"));
}

export function buildWatchLoanTermSheet(
  watch: WatchAsset,
  label: string,
  horizonDays: number,
  terms: Pick<WatchTerms, "ltvByCategory" | "loanTermDays">,
  registryVersion: string,
): WatchLoanTermSheet {
  if (!watch.marketValue || !watch.category) throw new Error("A watch loan needs the watch's market value and category");
  const range = terms.loanTermDays;
  return {
    assetId: watch.id,
    label,
    marketValueUsd: watch.marketValue.usd,
    valueSource: watch.marketValue.source,
    valueAsOf: watch.marketValue.asOf,
    category: watch.category,
    loanToValue: terms.ltvByCategory[watch.category],
    // The same function and inputs as the comparison's loan path, so the amounts match.
    loanUsd: watchLoanUsd(watch.marketValue.usd, watch.category, terms.ltvByCategory),
    termDays: Math.min(range.max, Math.max(range.min, horizonDays)),
    termRangeDays: { min: range.min, max: range.max },
    hasBox: watch.hasBox,
    hasPapers: watch.hasPapers,
    registryVersion,
  };
}

export function describeWatchLoanTermSheet(sheet: WatchLoanTermSheet): string[] {
  const bring = ["the watch", sheet.hasBox ? "the box" : null, sheet.hasPapers ? "the papers" : null, "a photo ID"].filter((item): item is string => item !== null);
  return [
    `Watch loan term sheet (${sheet.label}, market value ${formatUsd(sheet.marketValueUsd)}, ${sheet.valueSource}, ${sheet.valueAsOf}):`,
    `You receive ${formatUsd(sheet.loanUsd)}: ${pct(sheet.loanToValue)} of the market value (the loan-to-value for ${CATEGORY_TEXT[sheet.category]}).`,
    `Term: ${sheet.termDays} days, to match when you plan to repay (lenders offer ${sheet.termRangeDays.min} to ${sheet.termRangeDays.max} days).`,
    "The lender holds the watch until you repay, then returns it. If you do not repay by the end of the term, the lender can sell the watch.",
    "Interest and fees are not published: the lender quotes them before you sign, and no figure here includes them.",
    `Bring ${bring.slice(0, -1).join(", ")} and ${bring.at(-1)}; the lender authenticates the watch at intake (simulated in this demo).`,
  ];
}
