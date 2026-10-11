import { describe, expect, it } from "vitest";
import { watchLoanOpenMemo, watchLoanRepaidMemo } from "./watchLoan";

describe("the watch loan's memos", () => {
  it("name the receipt, the amount and the days, and say what is simulated, with no personal data", () => {
    const rec = "a".repeat(64);
    expect(watchLoanOpenMemo({ recommendationHash: rec, amountMicroUsd: BigInt(11_846_250_000), termDays: 120 })).toBe(
      `ownflow watch-loan v1 open rec=${rec} amount=11846250000 days=120 intake=simulated`,
    );
    expect(watchLoanRepaidMemo(rec, BigInt(11_846_250_000))).toBe(`ownflow watch-loan v1 repaid rec=${rec} amount=11846250000 release=simulated`);
  });
});
