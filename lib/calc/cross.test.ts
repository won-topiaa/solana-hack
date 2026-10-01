import { describe, expect, it } from "vitest";
import { minSaleShareToReachGoal, shortfallUsd, sumUsd, sumUsdRanges } from "./cross";
import { dealerOfferUsd, marketplaceProceedsUsd, watchLoanUsd } from "./watch";
import {
  DEALER_OFFER,
  MARKETPLACE_FEE,
  WATCH_A,
  WATCH_B,
  WATCH_GOAL_USD,
  WATCH_LTV,
} from "./test-fixtures";

// Expected values: CLAUDE.md §8.5, watch table. The user needs $30,000.
const loanOnA = watchLoanUsd(WATCH_A.valueUsd, WATCH_A.category, WATCH_LTV);
const loanOnB = watchLoanUsd(WATCH_B.valueUsd, WATCH_B.category, WATCH_LTV);

describe("using both watches", () => {
  it("dealer sale of both: $28,000 to $36,000", () => {
    const both = sumUsdRanges([
      dealerOfferUsd(WATCH_A.valueUsd, DEALER_OFFER),
      dealerOfferUsd(WATCH_B.valueUsd, DEALER_OFFER),
    ]);
    expect(both.lowUsd).toBeCloseTo(28_000, 2);
    expect(both.highUsd).toBeCloseTo(36_000, 2);
  });

  it("marketplace sale of both: $37,400", () => {
    const both = sumUsd([
      marketplaceProceedsUsd(WATCH_A.valueUsd, MARKETPLACE_FEE),
      marketplaceProceedsUsd(WATCH_B.valueUsd, MARKETPLACE_FEE),
    ]);
    expect(both).toBeCloseTo(37_400, 2);
  });

  it("loans on both: $29,250, which is $750 short", () => {
    const both = sumUsd([loanOnA, loanOnB]);
    expect(both).toBeCloseTo(29_250, 2);
    expect(shortfallUsd(WATCH_GOAL_USD, both)).toBeCloseTo(750, 2);
  });
});

describe("keep watch A: loan on A, sell B to a dealer", () => {
  it("B must fetch at least 75.0% of its value", () => {
    expect(minSaleShareToReachGoal(WATCH_GOAL_USD, loanOnA, WATCH_B.valueUsd)).toBeCloseTo(0.75, 3);
  });

  it("at 80% of B's value the total is $30,750", () => {
    expect(sumUsd([loanOnA, WATCH_B.valueUsd * 0.8])).toBeCloseTo(30_750, 2);
  });

  it("needs no sale when the cash already secured meets the goal", () => {
    expect(minSaleShareToReachGoal(10_000, loanOnA, WATCH_B.valueUsd)).toBe(0);
  });
});
