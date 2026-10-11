import { describe, expect, it } from "vitest";
import { checkGoal } from "./goal";
import { personaCase } from "../recommend/personas";
import { recordGoal } from "./tools/goal";

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

  it("refuses a repayment horizon of zero, which would quietly become the default", () => {
    const result = checkGoal({ cashNeededUsd: 30_000, neededBy: "2026-10-09", repayHorizonYears: 0 }, TODAY);
    expect(result.ok).toBe(false);
  });
});

describe("record_goal on a goal that exists", () => {
  it("changes only what the update names; the budget and the repayment plan stay", async () => {
    const caseFile = personaCase("B", new Date("2026-10-01T15:00:00Z"));
    const before = caseFile.goal;
    const outcome = await recordGoal.run({ cashNeededUsd: 300_000, neededBy: "2026-12-10", monthlyCapacityUsd: null }, { caseFile, today: TODAY, now: new Date() });
    expect(outcome.caseFile.goal).toEqual({ ...before, cashNeededUsd: 300_000, neededBy: "2026-12-10" });
    expect(outcome.caseFile.goal).toMatchObject({ intent: "home", repayHorizonYears: 10, monthlyCapacityUsd: 0 });
  });
});
