import { describe, expect, it } from "vitest";
import { checkGoal } from "./goal";

const TODAY = "2026-10-01";

describe("checkGoal", () => {
  it("accepts a full goal and starts with no asset IDs", () => {
    const result = checkGoal(
      {
        cashNeededUsd: 30_000,
        neededBy: "2026-10-09",
        repayHorizonYears: 2,
        keepAssetNotes: ["my steel sport watch"],
        monthlyCapacityUsd: 500,
        age62Plus: false,
      },
      TODAY,
    );
    expect(result).toEqual({
      ok: true,
      goal: {
        cashNeededUsd: 30_000,
        neededBy: "2026-10-09",
        repayHorizonYears: 2,
        keepAssetIds: [],
        keepAssetNotes: ["my steel sport watch"],
        monthlyCapacityUsd: 500,
        age62Plus: false,
      },
    });
  });

  it("needs only the amount and the date; null means not given", () => {
    const result = checkGoal({ cashNeededUsd: 150_000, neededBy: TODAY, monthlyCapacityUsd: null }, TODAY);
    expect(result).toEqual({ ok: true, goal: { cashNeededUsd: 150_000, neededBy: TODAY, keepAssetIds: [] } });
  });

  const bad: [string, Record<string, unknown>, RegExp][] = [
    ["a missing amount", { neededBy: "2026-10-09" }, /cashNeededUsd/],
    ["an amount sent as text", { cashNeededUsd: "30000", neededBy: "2026-10-09" }, /cashNeededUsd/],
    ["a zero amount", { cashNeededUsd: 0, neededBy: "2026-10-09" }, /cashNeededUsd/],
    ["a date in another format", { cashNeededUsd: 30_000, neededBy: "Oct 9" }, /YYYY-MM-DD/],
    ["a date in the past", { cashNeededUsd: 30_000, neededBy: "2026-09-30" }, /in the past/],
    ["a negative monthly amount", { cashNeededUsd: 30_000, neededBy: "2026-10-09", monthlyCapacityUsd: -1 }, /monthlyCapacityUsd/],
    ["an age answer that is not true/false", { cashNeededUsd: 30_000, neededBy: "2026-10-09", age62Plus: "yes" }, /age62Plus/],
  ];

  it.each(bad)("reports a problem for %s", (_case, raw, problem) => {
    const result = checkGoal(raw, TODAY);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.problems.join(" ")).toMatch(problem);
  });
});
