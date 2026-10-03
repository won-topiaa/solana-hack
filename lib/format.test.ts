import { describe, expect, it } from "vitest";
import { formatMicroUsd, formatMicroUsdExact, formatPercent, formatUsd, formatUsdCompact, formatYears, pricesText } from "./format";

describe("formatUsd", () => {
  it("writes whole US dollars with separators", () => {
    expect(formatUsd(1_000_000)).toBe("$1,000,000");
    expect(formatUsd(930_000.4)).toBe("$930,000");
    expect(formatUsd(0)).toBe("$0");
  });
});

describe("formatPercent", () => {
  it("writes a percentage without float noise", () => {
    expect(formatPercent(3.99)).toBe("3.99%");
    expect(formatPercent(7.090000000000001)).toBe("7.09%");
    expect(formatPercent(4.5531)).toBe("4.55%");
    expect(formatPercent(23.4131)).toBe("23.41%");
  });
});

describe("formatMicroUsd", () => {
  it("writes on-chain micro-dollars as dollars and cents, or exactly", () => {
    expect(formatMicroUsd(BigInt(144_000_069_760))).toBe("$144,000.07");
    expect(formatMicroUsdExact(BigInt(144_000_069_760))).toBe("144,000.069760");
    expect(formatMicroUsdExact(BigInt(1))).toBe("0.000001");
    expect(formatMicroUsdExact(BigInt(-2_500_000))).toBe("-2.500000");
  });
});

describe("formatUsdCompact", () => {
  it("shortens amounts for chart axes", () => {
    expect(formatUsdCompact(150_000)).toBe("$150k");
    expect(formatUsdCompact(2_500)).toBe("$2.5k");
    expect(formatUsdCompact(1_200_000)).toBe("$1.2M");
    expect(formatUsdCompact(900)).toBe("$900");
    expect(formatUsdCompact(0)).toBe("$0");
  });
});

describe("formatYears and pricesText", () => {
  it("write a length of time the same way everywhere", () => {
    expect(formatYears(10)).toBe("10 years");
    expect(formatYears(1)).toBe("1 year");
    expect(formatYears(16 / 12)).toBe("1.33 years");
    expect(formatYears(0.25)).toBe("3 months");
    expect(formatYears(1 / 12)).toBe("1 month");
    expect(formatYears(0.01)).toBe("1 month"); // never "0 months"
  });

  it("write a price scenario with its direction", () => {
    expect(pricesText(0)).toBe("stay flat");
    expect(pricesText(0.03)).toBe("rise 3% a year");
    expect(pricesText(-0.02)).toBe("fall 2% a year");
  });
});
