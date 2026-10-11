import { describe, expect, it } from "vitest";
import type { WatchAsset } from "../assets/types";
import { WATCH_LTV } from "../calc/test-fixtures";
import { testRegistry } from "../params/test-fixtures";
import { personaCase } from "./personas";
import { recommend } from "./recommend";
import { buildWatchLoanTermSheet, describeWatchLoanTermSheet, watchLoanParts } from "./watchLoan";

// The watch loan's term sheet (owner, 2026-10-11): §8.5 watch A, $25,000 steel sport watch at 75%.
const now = new Date("2026-10-01T15:00:00Z");
const terms = { ltvByCategory: WATCH_LTV, loanTermDays: { min: 30, max: 180 } };
const watch: WatchAsset = {
  id: "watch-1",
  kind: "watch",
  maker: "Demo Watch Co.",
  model: "Demo Diver 300",
  reference: "DEMO-300",
  hasBox: true,
  hasPapers: false,
  category: "sport_steel",
  marketValue: { usd: 25_000, source: "Demo price table (made up)", asOf: "2026-10-02" },
  theftCheck: "simulated_clear",
  photoIds: [],
};

describe("the watch loan term sheet", () => {
  it("lends 75% of a steel sport watch's value ($18,750 on $25,000) for the days the user plans", () => {
    const sheet = buildWatchLoanTermSheet(watch, "Demo Diver 300", 120, terms, "v");
    expect(sheet).toMatchObject({ loanUsd: 18_750, loanToValue: 0.75, termDays: 120, termRangeDays: { min: 30, max: 180 } });
    expect(describeWatchLoanTermSheet(sheet)).toEqual([
      "Watch loan term sheet (Demo Diver 300, market value $25,000, Demo price table (made up), 2026-10-02):",
      "You receive $18,750: 75% of the market value (the loan-to-value for steel sport watches).",
      "Term: 120 days, to match when you plan to repay (lenders offer 30 to 180 days).",
      "The lender holds the watch until you repay, then returns it. If you do not repay by the end of the term, the lender can sell the watch.",
      "Interest and fees are not published: the lender quotes them before you sign, and no figure here includes them.",
      "Bring the watch, the box and a photo ID; the lender authenticates the watch at intake (simulated in this demo).",
    ]);
    expect(describeWatchLoanTermSheet({ ...sheet, hasPapers: true }).at(-1)).toBe(
      "Bring the watch, the box, the papers and a photo ID; the lender authenticates the watch at intake (simulated in this demo).",
    );
    expect(describeWatchLoanTermSheet({ ...sheet, hasBox: false }).at(-1)).toBe(
      "Bring the watch and a photo ID; the lender authenticates the watch at intake (simulated in this demo).",
    );
  });

  it("keeps the term within the lenders' 30 to 180 days", () => {
    expect(buildWatchLoanTermSheet(watch, "w", 5, terms, "v").termDays).toBe(30);
    expect(buildWatchLoanTermSheet(watch, "w", 400, terms, "v").termDays).toBe(180);
  });

  it("needs the watch's value and category", () => {
    expect(() => buildWatchLoanTermSheet({ ...watch, marketValue: undefined }, "w", 90, terms, "v")).toThrow(/market value and category/);
    expect(() => buildWatchLoanTermSheet({ ...watch, category: null }, "w", 90, terms, "v")).toThrow(/market value and category/);
  });

  it("finds the loans in a watch plan (persona A: a loan on the sport watch plus a dealer sale)", () => {
    const result = recommend(personaCase("A", now), testRegistry(), "2026-10-01", now);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    const options = result.recommendation.options;
    const plan = options.find((option) => option.id === "watch-plan");
    expect(plan && watchLoanParts(plan).map((part) => part.id)).toEqual(["w-loan-watch-1"]);
    const dealer = options.find((option) => option.id === "w-dealer-watch-2");
    expect(dealer && watchLoanParts(dealer)).toEqual([]);
  });
});
