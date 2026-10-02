// Code-made text for the comparison. The model quotes these lines and never
// writes a figure itself (CLAUDE.md §3 rule 3).

import { formatUsd } from "../format";
import { pct } from "./realEstate";
import type { PathOption, Recommendation } from "./types";

export function cashText(option: PathOption): string {
  const range = option.cashRangeUsd;
  return range ? `${formatUsd(range.low)} to ${formatUsd(range.high)}` : formatUsd(option.cashNowUsd);
}

export function costText(option: PathOption, years: number): string {
  if (option.scenarios) {
    return option.scenarios
      .map(
        (scenario) =>
          `if prices ${scenario.growth === 0 ? "stay flat" : `rise ${pct(scenario.growth)} a year`}, you pay ` +
          `${formatUsd(scenario.payoutUsd)} at settlement in ${years} years (${pct(scenario.effectiveAnnualCost)} a year)`,
      )
      .join("; ");
  }
  if (option.totalCostUsd === undefined) return "cost not published (get a quote)";
  if (option.lane === "watch" && option.monthlyPaymentUsd === undefined) {
    return `${formatUsd(option.totalCostUsd)} below market value at most`;
  }
  return `about ${formatUsd(option.totalCostUsd)} over ${years} years`;
}

/** Said wherever a recommendation rests on a frozen registry (judging period). */
export function frozenNote(frozenOn: string): string {
  return `Values are frozen as of ${frozenOn} for the judging period. Normally a value older than its validity window stops the recommendation until it is updated.`;
}

export function describeOption(option: PathOption, years: number): string {
  if (option.informational && option.cashNowUsd === 0) {
    return `${option.label}: ${option.risks.join(" ")} (id: ${option.id})`;
  }
  const parts = [`${cashText(option)} now`];
  if (option.monthlyPaymentUsd === 0) parts.push("no monthly payments");
  else if (option.monthlyPaymentUsd !== undefined) parts.push(`${formatUsd(option.monthlyPaymentUsd)} a month`);
  parts.push(costText(option, years));
  parts.push(option.keepsAsset ? "you keep the asset" : "you give up the asset");
  const line = `${option.label}: ${parts.join("; ")}.`;
  const verdict = option.suitable ? "" : ` Not suitable: ${option.whyNotSuitable}`;
  return `${line}${verdict} (id: ${option.id})`;
}

export function describeRecommendation(recommendation: Recommendation): string[] {
  const years = recommendation.inputs.horizonYears;
  const byId = (id: string | null | undefined) => recommendation.options.find((option) => option.id === id);
  const chosen = byId(recommendation.chosenId);
  const lanes = recommendation.laneChoices;
  const bothLanesWork = Boolean(lanes.real_estate && lanes.watch);
  const lines = [
    `Every path compared for ${formatUsd(recommendation.inputs.goal.cashNeededUsd)} by ${recommendation.inputs.goal.neededBy}:`,
    ...recommendation.options.map((option, index) => `${index + 1}. ${describeOption(option, years)}`),
  ];
  if (recommendation.intent === "unsure" && "real_estate" in lanes && "watch" in lanes) {
    lines.push(
      `Best path using your home: ${byId(lanes.real_estate)?.label ?? "none reaches the goal"}.`,
      `Best path using your watches: ${byId(lanes.watch)?.label ?? "none reaches the goal"}.`,
    );
  }
  lines.push(
    chosen ? `Recommended: ${chosen.label}.` : bothLanesWork ? "Both work: choose which asset you want to use." : "No path reaches the goal yet.",
    `Why: ${recommendation.reasons.join(" ")}`,
  );
  if (chosen) lines.push(`Main risks: ${chosen.risks.join(" ")}`);
  lines.push(
    `Rules applied: ${recommendation.rulesFired.join(", ") || "none"}. Values from parameter registry ${recommendation.registryVersion}.`,
    ...(recommendation.valuesFrozenOn ? [frozenNote(recommendation.valuesFrozenOn)] : []),
    "This is not investment or financial advice.",
  );
  return lines;
}
