import { describe, expect, it } from "vitest";
import { helocInterestOnlyMonthlyUsd, interestOnlyTotalUsd } from "./compare";
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
