import { describe, expect, it } from "vitest";
import { getRegistry } from "./load";
import { applyMarketUpdates, FRED_SERIES, latestObservation, nextRegistryVersion } from "./refresh";
import { entry, makeRegistry } from "./test-fixtures";

// Shape of a FRED series/observations JSON response (https://fred.stlouisfed.org/docs/api/fred/series_observations.html).
function fredResponse(observations: { date: string; value: string }[]) {
  return {
    realtime_start: "2026-10-01",
    realtime_end: "2026-10-01",
    units: "lin",
    sort_order: "desc",
    count: observations.length,
    observations: observations.map((o) => ({ realtime_start: "2026-10-01", realtime_end: "2026-10-01", ...o })),
  };
}

describe("latestObservation", () => {
  it("takes the newest numeric value and turns percent into a fraction", () => {
    const json = fredResponse([
      { date: "2026-10-01", value: "." }, // no data yet for that day
      { date: "2026-09-30", value: "3.90" },
      { date: "2026-09-29", value: "3.92" },
    ]);
    expect(latestObservation(json)).toEqual({ date: "2026-09-30", value: 0.039 });
  });

  it("keeps clean fractions (7.03% is exactly 0.0703)", () => {
    expect(latestObservation(fredResponse([{ date: "2026-09-24", value: "7.03" }]))?.value).toBe(0.0703);
  });

  it("returns null when no row has a number, and throws on a malformed response", () => {
    expect(latestObservation(fredResponse([{ date: "2026-10-01", value: "." }]))).toBeNull();
    expect(() => latestObservation({ error_message: "Bad Request" })).toThrow(/no observations/);
  });
});

describe("nextRegistryVersion", () => {
  it("counts up within a day and restarts at .1 on a new day", () => {
    expect(nextRegistryVersion("2026-10-01.3", "2026-10-01")).toBe("2026-10-01.4");
    expect(nextRegistryVersion("2026-10-01.3", "2026-10-02")).toBe("2026-10-02.1");
  });
});

describe("applyMarketUpdates", () => {
  const registry = makeRegistry({
    sofr: entry({ kind: "market", value: 0.039, as_of: "2026-09-28", valid_days: 3 }),
    hei_fee_rate: entry({ kind: "product", value: 0.039, checked_at: "2026-10-01", valid_days: 30 }),
  });

  it("updates value, as_of and checked_at, and records a new version", () => {
    const update = { key: "sofr", observation: { date: "2026-09-30", value: 0.0388 } };
    const result = applyMarketUpdates(registry, [update], "2026-10-02");
    expect(result.registry.params.sofr).toMatchObject({ value: 0.0388, as_of: "2026-09-30", checked_at: "2026-10-02" });
    expect(result.registry.registry_version).toBe("2026-10-02.1");
    expect(result.registry.changelog.at(-1)?.note).toContain("sofr 0.039 -> 0.0388");
    expect(result.registry.params.hei_fee_rate).toEqual(registry.params.hei_fee_rate);
    expect(registry.params.sofr.value).toBe(0.039); // the input registry is not changed
  });

  it("changes nothing for the same or older data", () => {
    const same = { key: "sofr", observation: { date: "2026-09-28", value: 0.039 } };
    const older = { key: "sofr", observation: { date: "2026-09-27", value: 0.05 } };
    const result = applyMarketUpdates(registry, [same, older], "2026-10-02");
    expect(result.changes).toEqual([]);
    expect(result.registry).toBe(registry);
  });

  it("refuses to touch anything but market data", () => {
    const update = { key: "hei_fee_rate", observation: { date: "2026-10-02", value: 0.05 } };
    expect(() => applyMarketUpdates(registry, [update], "2026-10-02")).toThrow(/not market data/);
  });
});

describe("FRED_SERIES", () => {
  it("maps only to market values that exist in data/params.json", () => {
    const params = getRegistry().params;
    for (const key of Object.keys(FRED_SERIES)) {
      expect(params[key]?.kind).toBe("market");
    }
  });
});
