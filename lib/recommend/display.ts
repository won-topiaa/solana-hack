// Code-made text for the comparison. The model quotes these lines and never
// writes a figure itself (CLAUDE.md §3 rule 3).

import { formatUsd } from "../format";
import { pct } from "./realEstate";
import type { PathOption, Recommendation } from "./types";

function cashText(option: PathOption): string {
  const range = option.cashRangeUsd;
  return range ? `${formatUsd(range.low)} to ${formatUsd(range.high)}` : formatUsd(option.cashNowUsd);
}

function costText(option: PathOption, years: number): string {
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

export function describeOption(option: PathOption, years: number): string {
  if (option.informational && option.cashNowUsd === 0) {
    return `${option.label}: for information. ${option.risks.join(" ")}`;
  }
  const parts = [`${cashText(option)} now`];
  if (option.monthlyPaymentUsd === 0) parts.push("no monthly payments");
  else if (option.monthlyPaymentUsd !== undefined) parts.push(`${formatUsd(option.monthlyPaymentUsd)} a month`);
  parts.push(costText(option, years));
  parts.push(option.keepsAsset ? "you keep the asset" : "you give up the asset");
  const line = `${option.label}: ${parts.join("; ")}.`;
  return option.suitable ? line : `${line} Not suitable: ${option.whyNotSuitable}`;
}

export function describeRecommendation(recommendation: Recommendation): string[] {
  const years = recommendation.inputs.horizonYears;
  const chosen = recommendation.options.find((option) => option.id === recommendation.chosenId);
  const lines = [
    `Every path compared for ${formatUsd(recommendation.inputs.goal.cashNeededUsd)} by ${recommendation.inputs.goal.neededBy}:`,
    ...recommendation.options.map((option, index) => `${index + 1}. ${describeOption(option, years)}`),
    chosen ? `Recommended: ${chosen.label}.` : "No path reaches the goal yet.",
    `Why: ${recommendation.reasons.join(" ")}`,
  ];
  if (chosen) lines.push(`Main risks: ${chosen.risks.join(" ")}`);
  lines.push(
    `Rules applied: ${recommendation.rulesFired.join(", ") || "none"}. Values from parameter registry ${recommendation.registryVersion}.`,
    "This is not investment or financial advice.",
  );
  return lines;
}
