// Builds every path for the user's goal and assets, picks one with the rules of
// CLAUDE.md §8.4, and refuses to finish when a value it used is stale (M2 gate).
// Lane order (CLAUDE.md §8.6): when the repayment horizon fits within the longest
// watch-loan term, watches go first and the home covers any shortfall (X-1);
// otherwise the home lane decides.

import type { CaseFile } from "../agent/types";
import type { RealEstateAsset, WatchAsset } from "../assets/types";
import { formatUsd } from "../format";
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
import { allWatchOptions, combineOptions, goalNote, watchPlan, type WatchInput } from "./watches";

/** Settings the rules read; they are always part of the freshness check. */
const RULE_KEYS = ["heloc_first_threshold_years", "watch_dealer_urgent_days", "comparison_default_horizon_years", "watch_loan_term_days"];

export function watchLabel(watch: WatchAsset): string {
  return watch.model ?? watch.reference ?? watch.id;
}

/** The valued assets of a case, as the comparison sees them. */
function valuedAssets(caseFile: CaseFile): { home?: RealEstateAsset; watches: WatchAsset[] } {
  const home = caseFile.assets.find((asset): asset is RealEstateAsset => asset.kind === "real_estate" && asset.avm !== undefined);
  const watches = caseFile.assets.filter((asset): asset is WatchAsset => asset.kind === "watch" && asset.marketValue !== undefined);
  return { home, watches };
}

/** What the comparison used about each asset: values and sources only, no personal data. */
export function assetSummaries(caseFile: CaseFile): AssetSummary[] {
  const { home, watches } = valuedAssets(caseFile);
  return summarize(home, watches);
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

function cheapest(options: PathOption[]): PathOption {
  return options.reduce((a, b) => ((b.totalCostUsd ?? Infinity) < (a.totalCostUsd ?? Infinity) ? b : a));
}

export function recommend(caseFile: CaseFile, registry: Registry, today: string, now: Date): RecommendationResult {
  const goal = caseFile.goal;
  if (!goal) return { status: "not_ready", problems: ["The goal is not saved yet."] };
  const { home, watches } = valuedAssets(caseFile);
  if (!home && watches.length === 0) {
    return { status: "not_ready", problems: ["No asset has a value yet: look up the home, or add a watch whose reference is in the price table."] };
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

  // Home lane: every home path for the full amount.
  let homeInput: HomeInput | undefined;
  let homePaths: { heloc: PathOption; loan: PathOption; hei: PathOption } | undefined;
  if (home?.avm) {
    homeInput = { assetId: home.id, valueUsd: home.avm.mid, mortgageBalanceUsd: home.mortgageBalanceUsd };
    homePaths = {
      heloc: withBudget(helocOption("re-heloc", homeInput, need, years, reTerms)),
      loan: withBudget(homeEquityLoanOption(homeInput, need, years, reTerms)),
      hei: heiOption(homeInput, need, years, reTerms),
    };
    options.push(homePaths.heloc, homePaths.loan, homePaths.hei);
    if (goal.age62Plus) {
      options.push(reverseMortgageOption(homeInput));
      rulesFired.push("RE-3");
    }
  }

  // Watch lane: every single path, then the plan the W rules make.
  const watchInputs: WatchInput[] = watches.map((watch) => ({
    assetId: watch.id,
    label: watchLabel(watch),
    valueUsd: watch.marketValue?.usd ?? 0,
    category: watch.category,
    kept: kept.has(watch.id),
  }));
  for (const watch of watchInputs) options.push(...allWatchOptions(watch, watchT));
  const timing = { daysUntilNeeded: daysBetween(today, goal.neededBy), horizonDays: years * 365, urgentDays: settings.dealerUrgentDays };
  const { plan, rules: watchRules } = watchPlan(watchInputs, need, timing, watchT);
  if (plan?.parts) options.push(plan);

  let chosen: PathOption | null = null;
  const watchesFirst = plan !== null && (!homeInput || timing.horizonDays <= watchT.loanTermDays.max);
  if (plan && watchesFirst) {
    rulesFired.push(...watchRules);
    const high = plan.cashRangeUsd?.high ?? plan.cashNowUsd;
    const note = goalNote(plan, need);
    if (high >= need) {
      chosen = plan;
      reasons.push(`Your watches can cover the goal within the watch-loan term while you keep the watches you chose to keep (rules ${watchRules.join(", ")}).`);
      if (note) reasons.push(note);
    }
    // X-1: the watches fall short (at least at the lowest offers), so the home covers the rest.
    if (homeInput && plan.cashNowUsd < need) {
      const shortfall = need - plan.cashNowUsd;
      const helocPart = withBudget(helocOption("x-heloc", homeInput, shortfall, years, reTerms));
      const cross: PathOption = {
        ...combineOptions("cross-plan", "cross", [...(plan.parts ?? [plan]), helocPart]),
        suitable: helocPart.suitable,
        whyNotSuitable: helocPart.whyNotSuitable,
      };
      options.push(cross);
      rulesFired.push("X-1");
      if (!chosen && cross.suitable) {
        chosen = cross;
        reasons.push(`Your watches bring ${formatUsd(plan.cashNowUsd)} at the lowest offers, so a HELOC covers the remaining ${formatUsd(shortfall)} (rule X-1).`);
        if (years <= settings.helocFirstYears) rulesFired.push("RE-1");
      } else if (chosen) {
        reasons.push(`If the offers come in low, a HELOC of up to ${formatUsd(shortfall)} could cover the rest (rule X-1).`);
      }
    }
    if (!chosen && note) reasons.push(note);
  } else if (homePaths) {
    chosen = chooseHomePath(homePaths, years, budget, settings.helocFirstYears, settings.heiGrowthScenarios, rulesFired, reasons);
  } else {
    reasons.push("The watches you want to keep cannot be used: watch loans last at most " + `${watchT.loanTermDays.max} days.`);
  }
  if (!chosen) reasons.push("No path reaches the goal with the choices made so far.");

  // M2 gate: every registry value behind these numbers must be fresh.
  const usedKeys = [...new Set([...options.flatMap((option) => option.usedParamKeys), ...RULE_KEYS])];
  const freshness = checkParamsFresh(registry, usedKeys, today);
  if (!freshness.ok) return { status: "needs_fresh_data", registryVersion: freshness.registryVersion, stale: freshness.stale };

  return {
    status: "ok",
    recommendation: {
      chosenId: chosen?.id ?? null,
      options,
      rulesFired: [...new Set(rulesFired)],
      reasons,
      inputs: { goal, assets: summarize(home, watches), horizonYears: years, today },
      registryVersion: registry.registry_version,
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
      `You plan to repay within ${helocFirstYears} years, so a HELOC or home equity loan comes first (rule RE-1). ` +
        `${pick.label} costs least over ${years} years: about ${formatUsd(pick.totalCostUsd ?? 0)} in interest.`,
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
    `Lowest total cost over ${years} years among the paths that fit: about ${formatUsd(pick.totalCostUsd ?? 0)} ` +
      `(the HEI is counted as if prices rise ${pct(Math.max(...growthScenarios))} a year).`,
  );
  return pick;
}
