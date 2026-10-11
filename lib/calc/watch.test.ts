import { describe, expect, it } from "vitest";
import { dealerOfferUsd, marketplaceProceedsUsd, medianPriceUsd, watchLoanUsd } from "./watch";
import { DEALER_OFFER, MARKETPLACE_FEE, WATCH_A, WATCH_B, WATCH_LTV } from "./test-fixtures";

describe("one watch: A, sport steel, $25,000", () => {
  it("dealer offer is 70% to 90% of value", () => {
    const offer = dealerOfferUsd(WATCH_A.valueUsd, DEALER_OFFER);
    expect(offer.lowUsd).toBeCloseTo(17_500, 2);
    expect(offer.highUsd).toBeCloseTo(22_500, 2);
  });

  it("marketplace sale keeps value minus the 6.5% fee", () => {
    expect(marketplaceProceedsUsd(WATCH_A.valueUsd, MARKETPLACE_FEE)).toBeCloseTo(23_375, 2);
  });

  it("loan is 75% of value for sport steel", () => {
    expect(watchLoanUsd(WATCH_A.valueUsd, WATCH_A.category, WATCH_LTV)).toBeCloseTo(18_750, 2);
  });
});

describe("one watch: B, dress gold, $15,000", () => {
  it("loan is 70% of value for dress gold", () => {
    expect(watchLoanUsd(WATCH_B.valueUsd, WATCH_B.category, WATCH_LTV)).toBeCloseTo(10_500, 2);
  });
});

describe("bad input", () => {
  it("rejects a dealer range whose low end is above its high end", () => {
    expect(() => dealerOfferUsd(25_000, { low: 0.9, high: 0.7 })).toThrow(RangeError);
  });
});

describe("medianPriceUsd: a market value from asking and sold prices", () => {
  it("takes the middle price, so one rare-dial listing does not move it", () => {
    expect(medianPriceUsd([9_995, 10_468, 25_990])).toBe(10_468);
    expect(medianPriceUsd([25_990, 9_995, 10_468, 11_000])).toBe(10_734); // the two middle prices, averaged
  });

  it("rounds to whole dollars and refuses no prices or a price of zero", () => {
    expect(medianPriceUsd([100, 101])).toBe(101); // 100.5
    expect(() => medianPriceUsd([])).toThrow(RangeError);
    expect(() => medianPriceUsd([0, 10])).toThrow(RangeError);
  });
});
