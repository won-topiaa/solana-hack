import { describe, expect, it } from "vitest";
import { formatPercent, formatUsd } from "./format";

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
