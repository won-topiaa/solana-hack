import { describe, expect, it } from "vitest";
import { testRegistry } from "../params/test-fixtures";
import { describeRecommendation } from "./display";
import { personaCase } from "./personas";
import { recommend } from "./recommend";
import type { PathOption, Recommendation } from "./types";

// M6 done-when: each demo persona gets the expected recommendation and rules (CLAUDE.md §8.6).
const TODAY = "2026-10-01";
const now = new Date("2026-10-01T15:00:00Z");

function recommendationFor(id: string, today = TODAY): Recommendation {
  const result = recommend(personaCase(id, now), testRegistry(), today, now);
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result.recommendation;
}

function option(rec: Recommendation, id: string): PathOption {
  const found = rec.options.find((item) => item.id === id);
  if (!found) throw new Error(`no option ${id}`);
  return found;
}

describe("persona A: $30,000 by tomorrow, two watches, keeps the sport watch", () => {
  const rec = recommendationFor("A");

  it("recommends a loan on the sport watch plus a dealer sale of the dress watch (W-3, W-1)", () => {
    expect(rec.chosenId).toBe("watch-plan");
    expect(rec.rulesFired).toEqual(["W-3", "W-1"]);
    const plan = option(rec, "watch-plan");
    expect(plan.label).toBe("Loan against Demo Diver 300 + Sell Demo Dress 38 Gold to a dealer");
    expect(plan.cashRangeUsd).toEqual({ low: 29_250, high: 32_250 });
  });

  it("says the goal is reached only if the dress watch brings at least 75% of its value", () => {
    expect(rec.reasons.join(" ")).toContain("brings at least 75% of the watch's value");
  });

  it("marks selling the kept watch as not suitable", () => {
    expect(option(rec, "w-dealer-watch-1")).toMatchObject({ suitable: false, whyNotSuitable: "You want to keep this watch." });
  });
});

describe("persona B: home, $150,000 over 10 years, no monthly budget", () => {
  const rec = recommendationFor("B");

  it("recommends the HEI because the budget is below the HELOC payment (RE-2)", () => {
    expect(rec.chosenId).toBe("re-hei");
    expect(rec.rulesFired).toEqual(["RE-2"]);
  });

  it("shows the HEI cost under both price scenarios (CLAUDE.md §8.5 numbers)", () => {
    const [flat, rising] = option(rec, "re-hei").scenarios ?? [];
    expect(flat.payoutUsd).toBeCloseTo(234_131, 0);
    expect(flat.effectiveAnnualCost * 100).toBeCloseTo(4.6, 1);
    expect(rising.payoutUsd).toBeCloseTo(314_652, 0);
    expect(rising.effectiveAnnualCost * 100).toBeCloseTo(7.7, 1);
  });

  it("rules out both loans because their payments exceed the budget", () => {
    expect(option(rec, "re-heloc")).toMatchObject({ suitable: false });
    expect(option(rec, "re-heloc").monthlyPaymentUsd).toBeCloseTo(886.25, 2);
    expect(option(rec, "re-home-equity-loan").monthlyPaymentUsd).toBeCloseTo(1_774.27, 2);
  });
});

describe("persona B2: same home, repays in 2 years, $1,000 a month", () => {
  const rec = recommendationFor("B2");

  it("recommends the HELOC first because repayment is within 3 years (RE-1)", () => {
    expect(rec.chosenId).toBe("re-heloc");
    expect(rec.rulesFired).toEqual(["RE-1"]);
    expect(option(rec, "re-heloc").totalCostUsd).toBeCloseTo(21_270, 2);
  });

  it("rules out the home equity loan: $6,744 a month is over the budget", () => {
    expect(option(rec, "re-home-equity-loan")).toMatchObject({ suitable: false });
    expect(option(rec, "re-home-equity-loan").monthlyPaymentUsd).toBeCloseTo(6_744.48, 2);
  });
});

describe("persona C: home and two watches, $40,000 for 3 months", () => {
  const rec = recommendationFor("C");

  it("uses the watches first and a HELOC for the rest (W-3, W-2, X-1, RE-1)", () => {
    expect(rec.chosenId).toBe("cross-plan");
    expect(rec.rulesFired).toEqual(["W-3", "W-2", "X-1", "RE-1"]);
    const cross = option(rec, "cross-plan");
    expect(cross.cashNowUsd).toBeCloseTo(40_000, 2);
    expect(cross.parts?.map((part) => part.label)).toEqual([
      "Loan against Demo Diver 300",
      "Sell Demo Dress 38 Gold on a marketplace",
      "HELOC of $7,225",
    ]);
    expect(cross.monthlyPaymentUsd).toBeCloseTo(42.69, 2);
  });
});

describe("freshness gate (M2) in front of the recommendation", () => {
  it("refuses persona B on 2026-10-03: the home loan rates are 8 days old", () => {
    const result = recommend(personaCase("B", now), testRegistry(), "2026-10-03", now);
    expect(result.status).toBe("needs_fresh_data");
    expect(result.status === "needs_fresh_data" && result.stale.map((item) => item.key)).toEqual([
      "heloc_avg_rate",
      "heloc_avg_rate_cltv_basis",
      "home_equity_loan_avg_rate",
    ]);
  });

  it("still serves persona A that day: no stale value is used for watches", () => {
    expect(recommendationFor("A", "2026-10-03").chosenId).toBe("watch-plan");
  });
});

describe("display text", () => {
  it("names the recommendation, the rules and the not-advice notice", () => {
    const lines = describeRecommendation(recommendationFor("B"));
    expect(lines).toContain("Recommended: Home equity investment (HEI) of $150,000, tokenized.");
    expect(lines.at(-2)).toBe("Rules applied: RE-2. Values from parameter registry 2026-10-01.3.");
    expect(lines.at(-1)).toBe("This is not investment or financial advice.");
  });
});
