import { describe, expect, it } from "vitest";
import { entry, makeRegistry } from "../params/test-fixtures";
import { findSettlementScenario, settlementScenarios } from "./settlementScenarios";

const registry = makeRegistry({
  home_price_growth_2y: entry({ value: 0.034113, unit: "yearly home price growth", kind: "market", as_of: "2026-04-01", valid_days: 250 }),
  home_price_growth_10y: entry({ value: 0.068145, unit: "yearly home price growth", kind: "market", as_of: "2026-04-01", valid_days: 250 }),
});

describe("settlement scenarios", () => {
  it("take the home price growth from the FHFA index values in the registry", () => {
    const scenarios = settlementScenarios(registry, 10);
    expect(scenarios.map(({ id, years, growth }) => ({ id, years, growth }))).toEqual([
      { id: "buyback-2y", years: 2, growth: 0.034113 },
      { id: "maturity-10y", years: 10, growth: 0.068145 },
    ]);
    expect(scenarios[0].note).toBe("Home prices move as in the 2 years to 2026-04-01: +3.41% a year (FHFA house price index, US)");
  });

  it("leave out a scenario longer than the HEI's term, and find one by id", () => {
    expect(settlementScenarios(registry, 5).map((scenario) => scenario.id)).toEqual(["buyback-2y"]);
    expect(findSettlementScenario(registry, 5, "maturity-10y")).toBeNull();
    expect(findSettlementScenario(registry, 10, "maturity-10y")?.years).toBe(10);
  });

  it("call a settlement before the end of the term a buyback, and at the end a maturity", () => {
    expect(settlementScenarios(registry, 10).map((scenario) => scenario.label)).toEqual(["Buyback after 2 years", "Maturity after 10 years"]);
    expect(settlementScenarios(registry, 11).map((scenario) => scenario.label)).toEqual(["Buyback after 2 years", "Buyback after 10 years"]);
  });
});
