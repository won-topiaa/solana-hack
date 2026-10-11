import { describe, expect, it } from "vitest";
import { openWatchTable, sealWatchTable, type PrivateWatchTable } from "./privateWatchPrices";
import { matchPrivateRow, privatePrice } from "./watchPrices";

// Made-up rows: the real table is private and never appears in tests.
const table: PrivateWatchTable = {
  collectedOn: "2026-10-11",
  watches: [
    { maker: "Example Co.", model: "Diver", reference: "EX-1000LN", aliases: [], category: "sport_steel", askingUsd: [16_000, 15_000], soldUsd: [14_000] },
    { maker: "Example Co.", model: "Field 39", reference: "M7903-0001", aliases: ["M7903", "7903"], category: "sport_steel", askingUsd: [4_000, 3_500], soldUsd: [] },
    { maker: "Example Co.", model: "Dress Gold", reference: "EX-2282", aliases: [], category: "dress_gold", askingUsd: [50_000], soldUsd: [44_000, 47_000, 60_000] },
  ],
};
const secret = "private-table-test-secret-long-enough-0123456789";

describe("the sealed private price table", () => {
  it("opens with the server's secret, and not with another one", () => {
    const copy = sealWatchTable(table, secret);
    expect(copy).not.toContain("Example");
    expect(openWatchTable([copy], secret)).toEqual(table);
    expect(openWatchTable([copy], `${secret}-other`)).toBeNull();
  });

  it("tries each copy, so one file serves every server", () => {
    const copies = [sealWatchTable(table, `${secret}-local`), sealWatchTable(table, secret)];
    expect(openWatchTable(copies, secret)?.watches).toHaveLength(3);
  });

  it("refuses a changed copy and a table the price code could not use", () => {
    const copy = sealWatchTable(table, secret);
    const changed = `${copy.slice(0, -4)}${copy.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    expect(openWatchTable([changed], secret)).toBeNull();
    const bad = { ...table, watches: [{ ...table.watches[0], askingUsd: [0], soldUsd: [] }] };
    expect(() => sealWatchTable(bad, secret)).toThrow(/positive price/);
  });
});

describe("prices from the private table", () => {
  it("matches a reference as written, an alias, or a longer reference that starts with it", () => {
    expect(matchPrivateRow(table.watches, "ex 1000 ln")?.model).toBe("Diver");
    expect(matchPrivateRow(table.watches, "7903")?.model).toBe("Field 39");
    expect(matchPrivateRow(table.watches, "EX-1000LN-0001")?.model).toBe("Diver");
    expect(matchPrivateRow(table.watches, "EX")).toBeNull(); // too short to match by its start
    expect(matchPrivateRow(table.watches, "EX-9999")).toBeNull();
  });

  it("values a watch at the median of its asking and sold prices, and says so without naming sites", () => {
    expect(privatePrice(table.watches[0], table)).toEqual({
      maker: "Example Co.",
      model: "Diver",
      reference: "EX-1000LN",
      category: "sport_steel",
      priceUsd: 15_000,
      source: "Ownflow resale price table (median of 3 US asking and sold prices)",
      asOf: "2026-10-11",
    });
    expect(privatePrice(table.watches[2], table).priceUsd).toBe(48_500); // 47,000 and 50,000 in the middle
  });
});
