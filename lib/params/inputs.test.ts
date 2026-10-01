import { describe, expect, it } from "vitest";
import { heiTerms } from "../calc/hei";
import { getRegistry } from "./load";
import { getLtvTable, getNumber, heiPricing, helocRate, watchTerms } from "./inputs";
import { entry, makeRegistry, testRegistry } from "./test-fixtures";

describe("input bundles from the registry", () => {
  const registry = testRegistry();

  it("heiPricing reads the five HEI values and lists their keys", () => {
    const pricing = heiPricing(registry);
    expect(pricing).toMatchObject({
      investorDiscount: 0.333333,
      feeRate: 0.039,
      feeMinUsd: 2000,
      maxInvestmentShareOfValue: 0.2499,
      investorReturnCap: 0.2,
    });
    expect(pricing.usedKeys).toHaveLength(5);
  });

  it("registry values reproduce the CLAUDE.md §8.5 example: 234,131 tokens", () => {
    const terms = heiTerms({ homeValueUsd: 1_000_000, netCashUsd: 150_000, ...heiPricing(registry) });
    expect(terms.tokenSupply).toBe(234_131);
  });

  it("helocRate and watchTerms read their values", () => {
    expect(helocRate(registry).annualRate).toBe(0.0709);
    expect(watchTerms(registry)).toMatchObject({
      dealerOffer: { low: 0.7, high: 0.9 },
      marketplaceFee: 0.065,
      ltvByCategory: { sport_steel: 0.75, dress_gold: 0.7, specialty_vintage: 0.65 },
      loanTermDays: { min: 30, max: 180 },
    });
  });
});

describe("typed getters refuse the wrong shape", () => {
  it("getNumber rejects a range", () => {
    const registry = makeRegistry({ range: entry({ value: { low: 0.7, high: 0.9 } }) });
    expect(() => getNumber(registry, "range")).toThrow(/must be a number/);
  });

  it("getLtvTable rejects a table missing a category", () => {
    const registry = makeRegistry({ ltv: entry({ value: { sport_steel: 0.75 } }) });
    expect(() => getLtvTable(registry, "ltv")).toThrow(/dress_gold/);
  });
});

describe("the real data/params.json", () => {
  it("has every key the input bundles read, with the right shapes", () => {
    const registry = getRegistry();
    expect(() => [heiPricing(registry), helocRate(registry), watchTerms(registry)]).not.toThrow();
  });
});
