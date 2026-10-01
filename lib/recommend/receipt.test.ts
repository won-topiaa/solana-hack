import { describe, expect, it } from "vitest";
import { testRegistry } from "../params/test-fixtures";
import { canonicalJson, hashOf } from "./canonical";
import { buildPassport, buildReceipt } from "./passport";
import { personaCase } from "./personas";
import { realEstateTerms, recommend } from "./recommend";
import { buildHeiTermSheet } from "./termSheet";

const now = new Date("2026-10-01T15:00:00Z");

describe("canonicalJson", () => {
  it("sorts keys and drops undefined, so equal data gives equal text", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, null] } })).toBe('{"a":{"c":[2,null]},"b":1}');
    expect(hashOf({ x: 1, y: 2 })).toBe(hashOf({ y: 2, x: 1 }));
  });
});

describe("recommendation receipt", () => {
  const caseB = personaCase("B", now);
  const result = recommend(caseB, testRegistry(), "2026-10-01", now);
  if (result.status !== "ok") throw new Error("expected ok");
  const rec = result.recommendation;

  it("hashes the same recommendation the same way, and any change differently", () => {
    expect(hashOf(rec)).toBe(hashOf(structuredClone(rec)));
    const tampered = structuredClone(rec);
    tampered.options[0].cashNowUsd += 1;
    expect(hashOf(tampered)).not.toBe(hashOf(rec));
  });

  it("records the registry version and hashes of the passports", () => {
    const { passport } = buildPassport(caseB, "home-1");
    const receipt = buildReceipt(rec, [passport], now, "re-hei");
    expect(receipt).toEqual({
      recommendedOptionId: "re-hei",
      selectedOptionId: "re-hei",
      recommendationHash: hashOf(rec),
      passportHash: hashOf([hashOf(passport)]),
      registryVersion: "2026-10-01.3",
      createdAt: "2026-10-01T15:00:00.000Z",
    });
  });

  it("keeps the recommendation free of personal data", () => {
    expect(JSON.stringify(rec)).not.toContain("Demo Lane");
  });
});

describe("asset passport", () => {
  it("hashes the home address with a salt kept in the case, and reuses that salt", () => {
    const first = buildPassport(personaCase("B", now), "home-1");
    expect(first.passport.identifierHashes.address).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(first.passport)).not.toContain("Demo Lane");
    expect(first.caseFile.pii["pii-1"]).toMatchObject({ kind: "address", salt: expect.stringMatching(/^[0-9a-f]{32}$/) });
    const again = buildPassport(first.caseFile, "home-1");
    expect(again.passport.identifierHashes.address).toBe(first.passport.identifierHashes.address);
  });

  it("gives a watch its serial hash, photo hashes and value", () => {
    const caseA = personaCase("A", now);
    const { passport } = buildPassport(caseA, "watch-1");
    expect(passport).toMatchObject({ kind: "watch", valuation: { marketValue: { usd: 25_000 }, category: "sport_steel" } });
  });
});

describe("HEI term sheet for persona B", () => {
  it("matches the CLAUDE.md §8.5 numbers", () => {
    const sheet = buildHeiTermSheet(
      { assetId: "home-1", valueUsd: 1_000_000, mortgageBalanceUsd: 400_000, valueSource: "test", valueAsOf: "2026-10-01" },
      150_000,
      10,
      realEstateTerms(testRegistry()),
      "2026-10-01.3",
    );
    expect(sheet.grossInvestmentUsd).toBeCloseTo(156_087.41, 2);
    expect(sheet.tokenSupply).toBe(234_131);
    expect(sheet.termYears).toBe(10);
    expect(sheet.settlementExamples.map((example) => Math.round(example.payoutUsd))).toEqual([234_131, 314_652]);
    expect(sheet.capBindsUntilYears.map((item) => Number(item.years.toFixed(2)))).toEqual([2.22, 2.65]);
  });

  it("uses the 5-year minimum term when the plan is shorter", () => {
    const sheet = buildHeiTermSheet(
      { assetId: "home-1", valueUsd: 1_000_000, valueSource: "test", valueAsOf: "2026-10-01" },
      150_000,
      2,
      realEstateTerms(testRegistry()),
      "v",
    );
    expect(sheet).toMatchObject({ termYears: 5, plannedSettlementYears: 2 });
  });
});
