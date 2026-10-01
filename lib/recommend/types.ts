// Shapes of a comparison and a recommendation (CLAUDE.md §9, extended in M6).

import type { Goal } from "../agent/types";
import type { WatchCategory } from "../calc/watch";

export type Lane = "real_estate" | "watch" | "cross";

/** One HEI outcome under an assumed yearly home price growth. */
export type Scenario = { growth: number; payoutUsd: number; totalCostUsd: number; effectiveAnnualCost: number };

export type PathOption = {
  id: string;
  lane: Lane;
  label: string;
  assetIds: string[];
  cashNowUsd: number; // the low end when the cash is a range
  cashRangeUsd?: { low: number; high: number };
  totalCostUsd?: number; // over the horizon; undefined = not published (watch loan rates)
  effectiveAnnualCost?: number;
  monthlyPaymentUsd?: number;
  keepsAsset: boolean; // true when the user keeps every asset this path uses
  timeToCash: string;
  risks: string[];
  scenarios?: Scenario[];
  parts?: PathOption[]; // for a combination: the single paths it is made of
  informational?: boolean; // shown for completeness, never recommended
  suitable: boolean;
  whyNotSuitable?: string;
  usedParamKeys: string[];
};

/** What the receipt records about each asset: values and sources, no personal data. */
export type AssetSummary =
  | {
      id: string;
      kind: "real_estate";
      valueUsd: { low: number; mid: number; high: number };
      valueSource: string;
      valueAsOf: string;
      mortgageBalanceUsd?: number;
    }
  | {
      id: string;
      kind: "watch";
      reference?: string;
      category: WatchCategory | null;
      marketValueUsd?: number;
      valueSource?: string;
      valueAsOf?: string;
      hasBox?: boolean;
      hasPapers?: boolean;
    };

export type Recommendation = {
  intent: "home" | "watch" | "unsure";
  chosenId: string | null; // null when no path reaches the goal, or when both lanes work and the user chooses
  laneChoices: { real_estate?: string | null; watch?: string | null }; // best path per lane (null = none reaches the goal)
  options: PathOption[];
  rulesFired: string[];
  reasons: string[];
  inputs: { goal: Goal; assets: AssetSummary[]; horizonYears: number; today: string };
  registryVersion: string;
  createdAt: string;
};

export type RecommendationResult =
  | { status: "ok"; recommendation: Recommendation }
  | { status: "needs_fresh_data"; registryVersion: string; stale: { key: string; reason: string }[] }
  | { status: "not_ready"; problems: string[] };
