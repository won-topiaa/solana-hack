import { describe, expect, it } from "vitest";
import { heiPricing, helocRate } from "./inputs";
import { checkParamsFresh, freshnessOf } from "./staleness";
import { entry, testRegistry } from "./test-fixtures";

describe("freshnessOf: one value", () => {
  it("ages market data from its observation date (as_of)", () => {
    const heloc = entry({ kind: "market", as_of: "2026-09-25", valid_days: 7 });
    expect(freshnessOf(heloc, "2026-10-02").stale).toBe(false); // 7 days old: last valid day
    expect(freshnessOf(heloc, "2026-10-03").stale).toBe(true); // 8 days old
  });

  it("ages product terms from our last check (checked_at), not the source date", () => {
    const ltv = entry({ kind: "product", as_of: "2026-03-19", checked_at: "2026-10-01", valid_days: 30 });
    expect(freshnessOf(ltv, "2026-10-31").stale).toBe(false);
    expect(freshnessOf(ltv, "2026-11-01").stale).toBe(true);
  });

  it("treats a product term never checked at its source as stale", () => {
    const unchecked = entry({ kind: "product", checked_at: null, valid_days: 30 });
    expect(freshnessOf(unchecked, "2026-10-01")).toMatchObject({
      stale: true,
      reason: "never confirmed at its source",
    });
  });

  it("never expires design values or lets reference values block", () => {
    const design = entry({ kind: "design", as_of: "2024-09-30", valid_days: null });
    const reference = entry({ kind: "reference", as_of: "2020-01-01", valid_days: 30 });
    expect(freshnessOf(design, "2030-01-01").stale).toBe(false);
    expect(freshnessOf(reference, "2030-01-01").stale).toBe(false);
  });
});

describe("checkParamsFresh: the gate in front of a recommendation", () => {
  const registry = testRegistry();
  // The registry values a real-estate recommendation reads: HEI terms and the HELOC rate.
  const usedKeys = [...heiPricing(registry).usedKeys, ...helocRate(registry).usedKeys];

  it("lets the recommendation through when every value it used is fresh", () => {
    expect(checkParamsFresh(registry, usedKeys, "2026-10-01")).toEqual({
      ok: true,
      registryVersion: "2026-10-01.3",
    });
  });

  it("blocks the recommendation when a value it used is stale, and says which", () => {
    // On 2026-10-03 the HELOC rate observed on 2026-09-25 is 8 days old (valid for 7).
    const result = checkParamsFresh(registry, usedKeys, "2026-10-03");
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      stale: [{ key: "heloc_avg_rate", reason: "8 days old (as_of 2026-09-25), valid for 7" }],
    });
  });

  it("ignores stale values the recommendation did not use", () => {
    // SOFR is stale on 2026-10-03 too, but no real-estate calculation reads it.
    const result = checkParamsFresh(registry, usedKeys, "2026-10-03");
    expect(result.ok ? [] : result.stale.map((item) => item.key)).not.toContain("sofr");
  });

  it("fails loudly on a key that is not in the registry", () => {
    expect(() => checkParamsFresh(registry, ["no_such_key"], "2026-10-01")).toThrow(/Unknown registry key/);
  });
});
