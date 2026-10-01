import { describe, expect, it } from "vitest";
import { findWatchPrice } from "./watchPrices";

describe("findWatchPrice (demo price table)", () => {
  it("finds a reference however it is written, with its source and date", () => {
    expect(findWatchPrice("demo 300")).toEqual({
      maker: "Demo Watch Co.",
      model: "Demo Diver 300",
      reference: "DEMO-300",
      category: "sport_steel",
      priceUsd: 25_000,
      source: "Demo price table (made up)",
      asOf: "2026-10-02",
    });
  });

  it("matches the CLAUDE.md §8.5 watches: A $25,000 steel sport, B $15,000 dress gold", () => {
    expect(findWatchPrice("DEMO-300")).toMatchObject({ priceUsd: 25_000, category: "sport_steel" });
    expect(findWatchPrice("DEMO-38G")).toMatchObject({ priceUsd: 15_000, category: "dress_gold" });
  });

  it("returns null for a reference that is not in the table", () => {
    expect(findWatchPrice("REAL-123")).toBeNull();
  });
});
