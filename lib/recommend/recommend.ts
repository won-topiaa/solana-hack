// Builds every path for the user's goal and assets, picks one with the rules of
// CLAUDE.md §8.4, and refuses to finish when a value it used is stale (M2 gate).
// Home and watches are separate situations (owner, 2026-10-02): the user's intent
// picks the lane. When unsure, each lane is judged on its own; both working means
// the user chooses, and only when neither works alone are they combined (X-1).

import type { CaseFile } from "../agent/types";
import type { RealEstateAsset, WatchAsset } from "../assets/types";
import { formatUsd, formatYears } from "../format";
import { daysBetween } from "../params/dates";
import { comparisonTerms, heiPricing, watchTerms } from "../params/inputs";
import { checkParamsFresh } from "../params/staleness";
import type { Registry } from "../params/types";
import {
  heiOption,
  helocOption,
  homeEquityLoanOption,
  pct,
  reverseMortgageOption,
  type HomeInput,
  type RealEstateTerms,
} from "./realEstate";
import type { AssetSummary, PathOption, RecommendationResult } from "./types";
import { allWatchOptions, combineOptions, goalNote, watchPlan, type WatchInput, type WatchTerms } from "./watches";

/** Settings the rules read; they are always part of the freshness check. */
/** Registry values the rules read, per lane, so a home case is not blocked by a watch value. */
const RULE_KEYS = {
  common: ["comparison_default_horizon_years"],
  home: ["heloc_first_threshold_years"],
  watch: ["watch_dealer_urgent_days", "watch_loan_term_days"],
};

export function watchLabel(watch: WatchAsset): string {
  return watch.model ?? watch.reference ?? watch.id;
}

/** The valued assets of a case, as the comparison sees them. */
function valuedAssets(caseFile: CaseFile): { home?: RealEstateAsset; watches: WatchAsset[] } {
  const home = caseFile.assets.find((asset): asset is RealEstateAsset => asset.kind === "real_estate" && asset.avm !== undefined);
  // A watch flagged as stolen cannot be sold, pledged or vaulted, so it is left out of every path.
  const watches = caseFile.assets.filter(
    (asset): asset is WatchAsset => asset.kind === "watch" && asset.marketValue !== undefined && asset.theftCheck !== "flagged",
  );
  return { home, watches };
}

/** What the comparison used about each asset: values and sources only, no personal data. */
export function assetSummaries(caseFile: CaseFile): AssetSummary[] {
  const { home, watches } = valuedAssets(caseFile);
  const intent = caseFile.goal?.intent ?? "unsure";
  return summarize(intent === "watch" ? undefined : home, intent === "home" ? [] : watches);
}

function summarize(home: RealEstateAsset | undefined, watches: WatchAsset[]): AssetSummary[] {
  const summaries: AssetSummary[] = [];
  if (home?.avm) {
    summaries.push({
      id: home.id,
      kind: "real_estate",
      valueUsd: { low: home.avm.low, mid: home.avm.mid, high: home.avm.high },
      valueSource: home.avm.source,
      valueAsOf: home.avm.asOf,
      mortgageBalanceUsd: home.mortgageBalanceUsd,
    });
  }
  for (const watch of watches) {
    summaries.push({
      id: watch.id,
      kind: "watch",
      reference: watch.reference,
      category: watch.category,
      marketValueUsd: watch.marketValue?.usd,
      valueSource: watch.marketValue?.source,
      valueAsOf: watch.marketValue?.asOf,
      hasBox: watch.hasBox,
      hasPapers: watch.hasPapers,
    });
  }
  return summaries;
}

/** Home-lane rates and HEI pricing from the registry. */
export function realEstateTerms(registry: Registry): RealEstateTerms {
  const settings = comparisonTerms(registry);
  const pricing = heiPricing(registry);
  return {
    helocRate: settings.helocRate,
    homeEquityLoanRate: settings.homeEquityLoanRate,
    rateCltvBasis: settings.rateCltvBasis,
    hei: {
      investorDiscount: pricing.investorDiscount,
      feeRate: pricing.feeRate,
      feeMinUsd: pricing.feeMinUsd,
      maxInvestmentShareOfValue: pricing.maxInvestmentShareOfValue,
      investorReturnCap: pricing.investorReturnCap,
    },
    heiGrowthScenarios: settings.heiGrowthScenarios,
    heiTermYears: settings.heiTermYears,
  };
}

/**
 * A single watch path is suitable only when it can reach the goal by itself (the plan
 * combines watches), and a watch loan only when you repay within its longest term.
 */
function watchSuitability(option: PathOption, need: number, horizonDays: number, terms: WatchTerms): PathOption {
  if (!option.suitable) return option;
  if (option.id.startsWith("w-loan-") && horizonDays > terms.loanTermDays.max) {
    return { ...option, suitable: false, whyNotSuitable: `Watch loans last at most ${terms.loanTermDays.max} days; you plan to repay later.` };
  }
  const high = option.cashRangeUsd?.high ?? option.cashNowUsd;
  if (high < need) return { ...option, suitable: false, whyNotSuitable: `Brings at most ${formatUsd(high)} of the ${formatUsd(need)} you need.` };
  return option;
}

function cheapest(options: PathOption[]): PathOption {
  return options.reduce((a, b) => ((b.totalCostUsd ?? Infinity) < (a.totalCostUsd ?? Infinity) ? b : a));
}

export function recommend(caseFile: CaseFile, registry: Registry, today: string, now: Date): RecommendationResult {
  const goal = caseFile.goal;
  if (!goal) return { status: "not_ready", problems: ["The goal is not saved yet."] };
  const intent = goal.intent ?? "unsure";
  const valued = valuedAssets(caseFile);
  // Home and watches are separate situations: use only the lane the user came for.
  const home = intent === "watch" ? undefined : valued.home;
  const watches = intent === "home" ? [] : valued.watches;
  if (!home && watches.length === 0) {
    const missing = intent === "home" ? "Look up the home first." : intent === "watch" ? "Add a watch whose reference is in the price table first." : "No asset has a value yet.";
    return { status: "not_ready", problems: [missing] };
  }

  const settings = comparisonTerms(registry);
  const watchT = watchTerms(registry);
  const reTerms = realEstateTerms(registry);
  const years = goal.repayHorizonYears && goal.repayHorizonYears > 0 ? goal.repayHorizonYears : settings.defaultHorizonYears;
  const need = goal.cashNeededUsd;
  const kept = new Set(goal.keepAssetIds);
  const budget = goal.monthlyCapacityUsd;
  const withBudget = (option: PathOption): PathOption =>
    budget === undefined || (option.monthlyPaymentUsd ?? 0) <= budget
      ? option
      : { ...option, suitable: false, whyNotSuitable: `${formatUsd(option.monthlyPaymentUsd ?? 0)} a month is above your ${formatUsd(budget)} monthly budget.` };

  const options: PathOption[] = [];
  const rulesFired: string[] = [];
  const reasons: string[] = [];
  const laneChoices: { real_estate?: string | null; watch?: string | null } = {};

  // Home lane: every home path for the full amount, then rules RE-1..RE-3.
  let homeInput: HomeInput | undefined;
  let homeChoice: PathOption | null = null;
  if (home?.avm) {
    homeInput = { assetId: home.id, valueUsd: home.avm.mid, mortgageBalanceUsd: home.mortgageBalanceUsd };
    const paths = {
      heloc: withBudget(helocOption("re-heloc", homeInput, need, years, reTerms)),
      loan: withBudget(homeEquityLoanOption(homeInput, need, years, reTerms)),
      hei: heiOption(homeInput, need, years, reTerms),
    };
    options.push(paths.heloc, paths.loan, paths.hei);
    if (goal.age62Plus) {
      options.push(reverseMortgageOption(homeInput));
      rulesFired.push("RE-3");
    }
    homeChoice = chooseHomePath(paths, years, budget, settings.helocFirstYears, settings.heiGrowthScenarios, rulesFired, reasons);
    laneChoices.real_estate = homeChoice?.id ?? null;
  }

  // Watch lane: every single path, then the plan rules W-1..W-3 make.
  let plan: PathOption | null = null;
  let watchChoice: PathOption | null = null;
  if (watches.length > 0) {
    const watchInputs: WatchInput[] = watches.map((watch) => ({
      assetId: watch.id,
      label: watchLabel(watch),
      valueUsd: watch.marketValue?.usd ?? 0,
      category: watch.category,
      kept: kept.has(watch.id),
    }));
    // Loan terms are in days and the horizon in years: count it in 30-day months, so "6 months" (0.5 years) is 180 days, the longest watch loan.
    const timing = { daysUntilNeeded: daysBetween(today, goal.neededBy), horizonDays: Math.round(years * 12) * 30, urgentDays: settings.dealerUrgentDays };
    for (const watch of watchInputs) options.push(...allWatchOptions(watch, watchT).map((option) => watchSuitability(option, need, timing.horizonDays, watchT)));
    const result = watchPlan(watchInputs, need, timing, watchT);
    plan = result.plan;
    if (plan?.parts) {
      const high = plan.cashRangeUsd?.high ?? plan.cashNowUsd;
      options.push(high >= need ? plan : { ...plan, suitable: false, whyNotSuitable: goalNote(plan, need) ?? "Does not reach the goal." });
    }
    rulesFired.push(...result.rules);
    const high = plan ? plan.cashRangeUsd?.high ?? plan.cashNowUsd : 0;
    if (plan && high >= need) {
      watchChoice = plan;
      reasons.push(`Your watches can cover the goal while you keep the watches you chose to keep (rules ${result.rules.join(", ")}).`);
      const note = goalNote(plan, need);
      if (note) reasons.push(note);
    } else if (plan) {
      reasons.push(`Your watches alone fall short: ${goalNote(plan, need)}`);
    } else {
      reasons.push(`The watches you want to keep cannot be used: watch loans last at most ${watchT.loanTermDays.max} days.`);
    }
    laneChoices.watch = watchChoice?.id ?? null;
  }

  // Which path to recommend: the lane the user came for; if unsure, the lane that works.
  let chosen: PathOption | null = intent === "home" ? homeChoice : intent === "watch" ? watchChoice : homeChoice ?? watchChoice;
  if (intent === "unsure" && homeChoice && watchChoice) {
    chosen = null;
    reasons.push("Both your home and your watches can cover the goal. They are separate options, so choose which asset you want to use.");
  }
  // X-1, only when unsure and neither lane reaches the goal alone: watches first, a HELOC for the rest.
  if (intent === "unsure" && !homeChoice && !watchChoice && plan && homeInput && plan.cashNowUsd < need) {
    const shortfall = need - plan.cashNowUsd;
    const helocPart = withBudget(helocOption("x-heloc", homeInput, shortfall, years, reTerms));
    const cross: PathOption = {
      ...combineOptions("cross-plan", "cross", [...(plan.parts ?? [plan]), helocPart]),
      suitable: helocPart.suitable,
      whyNotSuitable: helocPart.whyNotSuitable,
    };
    options.push(cross);
    rulesFired.push("X-1");
    if (cross.suitable) {
      chosen = cross;
      reasons.push(`Neither asset covers the goal alone, so the watches bring ${formatUsd(plan.cashNowUsd)} and a HELOC covers the remaining ${formatUsd(shortfall)} (rule X-1).`);
    }
  }
  if (!chosen && !(intent === "unsure" && homeChoice && watchChoice)) reasons.push("No path reaches the goal with the choices made so far.");

  // M2 gate: every registry value behind these numbers must be fresh (on the freeze date
  // when the registry is frozen for the judging period).
  const ruleKeys = [...RULE_KEYS.common, ...(homeInput ? RULE_KEYS.home : []), ...(watches.length > 0 ? RULE_KEYS.watch : [])];
  const usedKeys = [...new Set([...options.flatMap((option) => option.usedParamKeys), ...ruleKeys])];
  const freshness = checkParamsFresh(registry, usedKeys, registry.frozenOn ?? today);
  if (!freshness.ok) return { status: "needs_fresh_data", registryVersion: freshness.registryVersion, stale: freshness.stale };

  return {
    status: "ok",
    recommendation: {
      intent,
      chosenId: chosen?.id ?? null,
      laneChoices,
      options,
      rulesFired: [...new Set(rulesFired)],
      reasons,
      inputs: { goal, assets: summarize(home, watches), horizonYears: years, today },
      registryVersion: registry.registry_version,
      ...(registry.frozenOn ? { valuesFrozenOn: registry.frozenOn } : {}),
      createdAt: now.toISOString(),
    },
  };
}

/** Home lane rules: RE-1 (short horizon -> loans), RE-2 (no room for payments -> HEI), else lowest cost. */
function chooseHomePath(
  paths: { heloc: PathOption; loan: PathOption; hei: PathOption },
  years: number,
  budget: number | undefined,
  helocFirstYears: number,
  growthScenarios: number[],
  rulesFired: string[],
  reasons: string[],
): PathOption | null {
  const loans = [paths.heloc, paths.loan].filter((option) => option.suitable);
  if (years <= helocFirstYears && loans.length > 0) {
    const pick = cheapest(loans);
    rulesFired.push("RE-1");
    reasons.push(
      `You plan to repay within ${formatYears(helocFirstYears)}, so a HELOC or home equity loan comes first (rule RE-1). ` +
        `${pick.label} costs least over ${formatYears(years)}: about ${formatUsd(pick.totalCostUsd ?? 0)} in interest.`,
    );
    return pick;
  }
  const helocPayment = paths.heloc.monthlyPaymentUsd ?? 0;
  if (budget !== undefined && budget < helocPayment && paths.hei.suitable) {
    rulesFired.push("RE-2");
    reasons.push(
      `Your monthly budget of ${formatUsd(budget)} is below the HELOC's interest-only payment of ${formatUsd(helocPayment)}, ` +
        "so an HEI, which has no monthly payments, fits (rule RE-2).",
    );
    return paths.hei;
  }
  const candidates = [paths.heloc, paths.loan, paths.hei].filter((option) => option.suitable);
  if (candidates.length === 0) return null;
  const pick = cheapest(candidates);
  reasons.push(
    `Lowest total cost over ${formatYears(years)} among the paths that fit: about ${formatUsd(pick.totalCostUsd ?? 0)} ` +
      `(the HEI is counted as if prices rise ${pct(Math.max(...growthScenarios))} a year).`,
  );
  return pick;
}
