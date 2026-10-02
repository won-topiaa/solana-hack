import { describe, expect, it } from "vitest";
import { freezeRegistry } from "../params/load";
import { testRegistry } from "../params/test-fixtures";
import { describeRecommendation } from "./display";
import { personaCase, personaCaseOn } from "./personas";
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

describe("persona C: not sure, home and two watches, $40,000 for 3 months", () => {
  const rec = recommendationFor("C");

  it("judges each asset on its own and recommends the home, which covers the goal alone (RE-1)", () => {
    expect(rec.intent).toBe("unsure");
    expect(rec.laneChoices).toEqual({ real_estate: "re-heloc", watch: null });
    expect(rec.chosenId).toBe("re-heloc");
    expect(rec.rulesFired).toEqual(["RE-1", "W-3", "W-2"]);
  });

  it("does not combine the lanes when one of them works alone", () => {
    expect(rec.options.some((option) => option.id === "cross-plan")).toBe(false);
    expect(rec.reasons.join(" ")).toContain("Your watches alone fall short");
  });
});

describe("persona D: not sure, both the home and the watches can cover $30,000", () => {
  const rec = recommendationFor("D");

  it("shows the best path for each asset and lets the user choose", () => {
    expect(rec.laneChoices).toEqual({ real_estate: "re-heloc", watch: "watch-plan" });
    expect(rec.chosenId).toBeNull();
    expect(rec.rulesFired).toEqual(["RE-1", "W-2"]);
    const lines = describeRecommendation(rec);
    expect(lines).toContain("Best path using your home: HELOC of $30,000.");
    expect(lines).toContain("Best path using your watches: Sell Demo Diver 300 on a marketplace + Sell Demo Dress 38 Gold on a marketplace.");
    expect(lines).toContain("Both work: choose which asset you want to use.");
  });
});

describe("intent picks the lane: home and watches are separate situations", () => {
  function withGoal(id: string, change: Record<string, unknown>) {
    const base = personaCase(id, now);
    return { ...base, goal: { ...base.goal!, ...change } };
  }

  it("a user who came for the home sees only home paths", () => {
    const result = recommend(withGoal("C", { intent: "home" }), testRegistry(), TODAY, now);
    expect(result.status === "ok" && result.recommendation.options.every((option) => option.lane === "real_estate")).toBe(true);
  });

  it("a user who came for a watch sees only watch paths", () => {
    const result = recommend(withGoal("C", { intent: "watch" }), testRegistry(), TODAY, now);
    expect(result.status === "ok" && result.recommendation.options.every((option) => option.lane === "watch")).toBe(true);
  });

  it("combines watches and a HELOC (X-1) only when neither asset covers the goal alone", () => {
    // $260,000 is too much for an HEI on this home, and the full HELOC payment is over the $1,400 budget.
    const result = recommend(withGoal("C", { cashNeededUsd: 260_000, monthlyCapacityUsd: 1_400 }), testRegistry(), TODAY, now);
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.recommendation.laneChoices).toEqual({ real_estate: null, watch: null });
    expect(result.recommendation.chosenId).toBe("cross-plan");
    expect(result.recommendation.rulesFired).toContain("X-1");
  });
});

describe("watch tokenization path", () => {
  it("is listed for each watch, raises no cash itself, and is never picked by the rules", () => {
    const rec = recommendationFor("A");
    const token = rec.options.find((option) => option.id === "w-vault-token-watch-2");
    expect(token).toMatchObject({ cashNowUsd: 0, suitable: false, label: "Vault Demo Dress 38 Gold and issue a 1-of-1 token" });
    expect(rec.chosenId).not.toBe("w-vault-token-watch-2");
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

describe("a watch flagged as stolen", () => {
  it("is left out of every path", () => {
    const base = personaCase("A", now);
    const flagged = { ...base, assets: base.assets.map((asset) => (asset.id === "watch-2" ? { ...asset, theftCheck: "flagged" as const } : asset)) };
    const result = recommend(flagged, testRegistry(), TODAY, now);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.recommendation.options.filter((item) => item.assetIds.includes("watch-2"))).toEqual([]);
    expect(result.recommendation.options.some((item) => item.assetIds.includes("watch-1"))).toBe(true);
  });
});

describe("personas on a later day", () => {
  it("keep the same days until the cash is needed, and the same recommendation", () => {
    const later = personaCaseOn("A", now, "2026-10-20");
    expect(later.goal?.neededBy).toBe("2026-10-21"); // one day ahead, as on the demo date
    const result = recommend(later, testRegistry(), "2026-10-20", now);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.recommendation.chosenId).toBe("watch-plan");
    expect(result.recommendation.rulesFired).toEqual(["W-3", "W-1"]);
  });
});

describe("a registry frozen for the judging period", () => {
  const later = "2026-12-01"; // every market value is long past its validity window
  it("checks freshness on the freeze date and records it", () => {
    const frozen = freezeRegistry(testRegistry(), TODAY, later);
    const result = recommend(personaCaseOn("B", now, later), frozen, later, now);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(result.recommendation.valuesFrozenOn).toBe(TODAY);
    expect(describeRecommendation(result.recommendation).join(" ")).toContain(`Values are frozen as of ${TODAY} for the judging period`);
  });

  it("still blocks stale values when the registry is not frozen", () => {
    expect(recommend(personaCaseOn("B", now, later), testRegistry(), later, now).status).toBe("needs_fresh_data");
  });

  it("refuses a freeze date after today or not a date", () => {
    expect(() => freezeRegistry(testRegistry(), "2026-12-02", later)).toThrow(/after today/);
    expect(() => freezeRegistry(testRegistry(), "12/01/2026", later)).toThrow(/YYYY-MM-DD/);
  });
});
