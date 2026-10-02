// The numbers behind the case panel's charts. Computed here by code from the comparison
// and the term sheet (CLAUDE.md §3 rule 3); the browser only draws them. Every value a
// chart prints comes with its finished text.

import type { CaseFile } from "../agent/types";
import { homeValueAfterYears, settle } from "../calc/settlement";
import { formatPercent, formatUsd } from "../format";
import type { HeiTermSheet } from "../recommend/termSheet";
import type { PathOption, Recommendation } from "../recommend/types";

/** One bar: a value, or a range from `low` to `high` (cash from a dealer, an HEI's cost by price scenario). */
export type ChartBar = {
  id: string;
  label: string; // short, for the chart
  fullLabel: string; // the path's full name, on hover
  low: number;
  high: number;
  text: string; // the value as finished text
  recommended: boolean;
  suitable: boolean;
};

/** A labeled reference line across the bars: the goal, or the monthly budget. */
export type ChartLine = { value: number; text: string };

export type BarPanel = { title: string; bars: ChartBar[]; line: ChartLine | null; note: string | null };

export type ComparisonChart = { panels: BarPanel[] };

/** Short names for the home paths, whose full names repeat the amount; other paths keep theirs. */
const SHORT_LABELS: Record<string, string> = {
  "re-heloc": "HELOC",
  "re-home-equity-loan": "Home equity loan",
  "re-hei": "HEI (tokenized)",
  "re-reverse-mortgage": "Reverse mortgage",
};

function bar(option: PathOption, chosenId: string | null, low: number, high: number, text: string): ChartBar {
  return {
    id: option.id,
    label: SHORT_LABELS[option.id] ?? option.label,
    fullLabel: option.label,
    low,
    high,
    text,
    recommended: option.id === chosenId,
    suitable: option.suitable,
  };
}

function rangeText(low: number, high: number): string {
  return low === high ? formatUsd(low) : `${formatUsd(low)} to ${formatUsd(high)}`;
}

/**
 * Three panels for the paths that pay cash: cash now against the goal, the monthly
 * payment against the budget, and the total cost over the horizon (an HEI as the
 * range of its price scenarios). Information-only paths are left out.
 */
export function comparisonChart(rec: Recommendation): ComparisonChart {
  const paths = rec.options.filter((option) => !option.informational);
  const goal = rec.inputs.goal;
  const years = rec.inputs.horizonYears;

  const cash = paths.map((option) => {
    const low = option.cashRangeUsd?.low ?? option.cashNowUsd;
    const high = option.cashRangeUsd?.high ?? option.cashNowUsd;
    return bar(option, rec.chosenId, low, high, rangeText(low, high));
  });

  const monthly = paths
    .filter((option) => option.monthlyPaymentUsd !== undefined)
    .map((option) => {
      const amount = option.monthlyPaymentUsd ?? 0;
      return bar(option, rec.chosenId, amount, amount, amount === 0 ? "None" : formatUsd(amount));
    });

  const costs = paths.flatMap((option) => {
    if (option.scenarios && option.scenarios.length > 0) {
      const values = option.scenarios.map((scenario) => scenario.totalCostUsd);
      return [bar(option, rec.chosenId, Math.min(...values), Math.max(...values), rangeText(Math.min(...values), Math.max(...values)))];
    }
    return option.totalCostUsd === undefined ? [] : [bar(option, rec.chosenId, option.totalCostUsd, option.totalCostUsd, formatUsd(option.totalCostUsd))];
  });
  const unpublished = paths.filter((option) => !option.scenarios && option.totalCostUsd === undefined).length;
  const growths = paths.find((option) => option.scenarios && option.scenarios.length > 1)?.scenarios?.map((scenario) => scenario.growth);

  const panels: BarPanel[] = [{ title: "Cash now", bars: cash, line: { value: goal.cashNeededUsd, text: `Goal ${formatUsd(goal.cashNeededUsd)}` }, note: null }];
  if (monthly.length > 0) {
    const budget = goal.monthlyCapacityUsd;
    panels.push({
      title: "Monthly payment",
      bars: monthly,
      line: budget === undefined ? null : { value: budget, text: `Your budget ${budget === 0 ? "$0" : formatUsd(budget)}` },
      note: null,
    });
  }
  if (costs.length > 0) {
    const notes = [
      growths ? `HEI: from prices flat to ${growths.map((growth) => (growth === 0 ? "" : `+${formatPercent(growth * 100)} a year`)).filter(Boolean).join(", ")}.` : null,
      unpublished > 0 ? "Watch loans: rates are not published, so no cost is shown." : null,
    ].filter((item): item is string => item !== null);
    panels.push({ title: `Total cost over ${yearsText(years)}`, bars: costs, line: null, note: notes.length > 0 ? notes.join(" ") : null });
  }
  return { panels };
}

function yearsText(years: number): string {
  if (years < 1) return `${Math.round(years * 12)} months`;
  return years === 1 ? "1 year" : `${Number(years.toFixed(2))} years`;
}

// ---- The HEI over time ----------------------------------------------------------

export type HeiSeries = { name: string; kind: "payout" | "cap" | "cash"; growth?: number; points: { years: number; usd: number }[] };

export type HeiChart = {
  termYears: number;
  plannedYears: number;
  series: HeiSeries[];
  /** Where the 20%-a-year cap stops binding, per price scenario. */
  capEnds: { growth: number; years: number; usd: number; text: string }[];
  /** The term sheet's settlement examples, as dots with finished text. */
  examples: { growth: number; years: number; usd: number; text: string }[];
  share: { investors: number; owner: number; investorsText: string; ownerText: string };
  maxUsd: number;
};

/** How many points each curve has across the term. */
const CURVE_STEPS = 40;

function scenarioName(growth: number): string {
  return growth === 0 ? "Prices flat" : `Prices ${growth > 0 ? "+" : ""}${formatPercent(growth * 100)} a year`;
}

/**
 * What the homeowner pays back if the HEI settles after any number of years, for each
 * price scenario on the term sheet, with the cap line and the cash received for scale.
 * The same settle() as the term sheet, at each step.
 */
export function heiChart(sheet: HeiTermSheet): HeiChart {
  const growths = [...new Set(sheet.settlementExamples.map((example) => example.growth))];
  const steps = Array.from({ length: CURVE_STEPS + 1 }, (_, index) => (sheet.termYears * index) / CURVE_STEPS);
  const deal = {
    grossInvestmentUsd: sheet.grossInvestmentUsd,
    tokenSupply: sheet.tokenSupply,
    netCashUsd: sheet.netCashUsd,
    investorReturnCap: sheet.investorReturnCapPerYear,
  };
  // At the start the cap equals the investment itself, so the payout starts at G.
  const payoutAt = (growth: number, years: number) =>
    years === 0 ? sheet.grossInvestmentUsd : settle({ ...deal, years, homeValueAtSettlementUsd: homeValueAfterYears(sheet.homeValueUsd, growth, years) }).payoutUsd;
  const capAt = (years: number) => sheet.grossInvestmentUsd * (1 + sheet.investorReturnCapPerYear) ** years;

  const series: HeiSeries[] = [
    ...growths.map((growth) => ({ name: scenarioName(growth), kind: "payout" as const, growth, points: steps.map((years) => ({ years, usd: payoutAt(growth, years) })) })),
    { name: `Cap: ${formatPercent(sheet.investorReturnCapPerYear * 100)} a year`, kind: "cap", points: steps.map((years) => ({ years, usd: capAt(years) })) },
    { name: `Cash you receive: ${formatUsd(sheet.netCashUsd)}`, kind: "cash", points: [{ years: 0, usd: sheet.netCashUsd }, { years: sheet.termYears, usd: sheet.netCashUsd }] },
  ];
  const capEnds = sheet.capBindsUntilYears
    .filter((item) => Number.isFinite(item.years) && item.years > 0 && item.years <= sheet.termYears)
    .map((item) => ({ growth: item.growth, years: item.years, usd: capAt(item.years), text: `Cap ends after ${Number(item.years.toFixed(2))} years` }));
  const examples = sheet.settlementExamples.map((example) => ({
    growth: example.growth,
    years: example.years,
    usd: example.payoutUsd,
    text: `${formatUsd(example.payoutUsd)} after ${yearsText(example.years)} (${formatPercent(example.ownerAnnualCost * 100)} a year)`,
  }));
  const payoutMax = Math.max(...series.filter((item) => item.kind !== "cap").flatMap((item) => item.points.map((point) => point.usd)));
  const investors = sheet.shareOfFutureValue;
  return {
    termYears: sheet.termYears,
    plannedYears: sheet.plannedSettlementYears,
    series,
    capEnds,
    examples,
    share: {
      investors,
      owner: 1 - investors,
      investorsText: `Investors: ${formatPercent(investors * 100)} of the home's value at settlement`,
      ownerText: `You keep ${formatPercent((1 - investors) * 100)}`,
    },
    // The cap grows fast; the chart's scale follows the payouts, and the cap line runs off the top.
    maxUsd: payoutMax,
  };
}

// ---- Where the case stands --------------------------------------------------------

export type ProgressStep = { label: string; state: "done" | "current" | "todo" };

/** The case's steps, from the goal to the on-chain records (and the settlement, for an HEI). */
export function progressOf(caseFile: CaseFile): ProgressStep[] {
  const onchain = caseFile.handoff?.onchain;
  const isHei = caseFile.handoff?.receipt.selectedOptionId === "re-hei";
  const steps: { label: string; done: boolean }[] = [
    { label: "Goal", done: Boolean(caseFile.goal) },
    { label: "Assets", done: caseFile.assets.length > 0 },
    { label: "Compare", done: Boolean(caseFile.recommendation) },
    { label: "Documents", done: Boolean(caseFile.handoff) },
    { label: "On-chain", done: Boolean(onchain?.receipt && (!isHei || onchain.heiShares) && (!caseFile.handoff?.receipt.selectedOptionId.startsWith("w-vault-token-") || onchain.watchToken)) },
    ...(isHei ? [{ label: "Sale", done: Boolean(onchain?.heiSale) }, { label: "Settlement", done: Boolean(onchain?.heiSettlement) }] : []),
  ];
  const current = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ label: step.label, state: step.done ? "done" : index === current ? "current" : "todo" }));
}
