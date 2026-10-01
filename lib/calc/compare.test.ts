import { describe, expect, it } from "vitest";
import {
  amortizedMonthlyPaymentUsd,
  amortizedTotalInterestUsd,
  combinedLoanToValue,
  helocInterestOnlyMonthlyUsd,
  interestOnlyTotalUsd,
} from "./compare";
import { HELOC_RATE } from "./test-fixtures";

describe("helocInterestOnlyMonthlyUsd", () => {
  // Expected value: CLAUDE.md §8.5, last row of the real estate table.
  it("is $886 a month on $150,000 at 7.09%", () => {
    expect(helocInterestOnlyMonthlyUsd(150_000, HELOC_RATE)).toBeCloseTo(886, 0);
  });
});

describe("interestOnlyTotalUsd: $150,000 at 7.09%", () => {
  // Expected values: PLAN §5.3 HELOC column (shown there rounded to whole dollars).
  // Titles below avoid "$" + digit, which it.each reads as a placeholder.
  const cases: [number, number][] = [
    [0.5, 5_317.5],
    [1, 10_635],
    [2, 21_270],
    [3, 31_905],
    [10, 106_350],
  ];

  it.each(cases)("over %s years: %s USD", (years, totalUsd) => {
    expect(interestOnlyTotalUsd(150_000, HELOC_RATE, years)).toBeCloseTo(totalUsd, 2);
  });
});

describe("home equity loan, equal monthly payments (CLAUDE.md §8.6)", () => {
  // $150,000 at the 7.42% fixed average rate.
  it("pays $1,774.27 a month over 10 years, $62,912.37 interest in total", () => {
    expect(amortizedMonthlyPaymentUsd(150_000, 0.0742, 10)).toBeCloseTo(1_774.27, 2);
    expect(amortizedTotalInterestUsd(150_000, 0.0742, 10)).toBeCloseTo(62_912.37, 2);
  });

  it("pays $6,744.48 a month over 2 years", () => {
    expect(amortizedMonthlyPaymentUsd(150_000, 0.0742, 2)).toBeCloseTo(6_744.48, 2);
  });

  it("divides evenly when the rate is 0", () => {
    expect(amortizedMonthlyPaymentUsd(12_000, 0, 1)).toBe(1_000);
  });
});

describe("combinedLoanToValue", () => {
  it("is 55% for a $400,000 mortgage plus $150,000 on a $1,000,000 home", () => {
    expect(combinedLoanToValue(400_000, 150_000, 1_000_000)).toBeCloseTo(0.55, 10);
  });
});
