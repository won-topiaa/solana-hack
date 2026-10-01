import { describe, expect, it } from "vitest";
import {
  createDemoPropertySource,
  createMemoryStore,
  createRentcastSource,
  DEMO_SOURCE_LABEL,
  normalizeAddress,
  withCache,
  type PropertyDataSource,
} from "./rentcast";

const ADDRESS = "742 Demo Lane, Exampleville, CA 99999";

/** A fake fetch that answers like RentCast and records each request. */
function fakeFetch(answer: (path: string) => { status: number; body?: unknown }) {
  const requests: { url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const { status, body } = answer(url.pathname);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe("createRentcastSource (live API shape, tested offline)", () => {
  it("calls both documented endpoints with the address and the X-Api-Key header", async () => {
    const { fetchImpl, requests } = fakeFetch((path) =>
      path.endsWith("/properties")
        ? { status: 200, body: [{ id: "p1", formattedAddress: ADDRESS, owner: { names: ["Jordan Sample"] } }] }
        : { status: 200, body: { price: 1_000_000, priceRangeLow: 930_000, priceRangeHigh: 1_070_000 } },
    );
    const result = await createRentcastSource("test-key", fetchImpl, () => "2026-10-01").lookup(ADDRESS);

    expect(requests.map((r) => r.url.origin + r.url.pathname)).toEqual([
      "https://api.rentcast.io/v1/properties",
      "https://api.rentcast.io/v1/avm/value",
    ]);
    expect(requests.every((r) => r.url.searchParams.get("address") === ADDRESS)).toBe(true);
    expect(requests.every((r) => r.headers["X-Api-Key"] === "test-key")).toBe(true);
    expect(result).toEqual({
      property: { id: "p1", formattedAddress: ADDRESS, owner: { names: ["Jordan Sample"] } },
      value: { price: 1_000_000, priceRangeLow: 930_000, priceRangeHigh: 1_070_000 },
      source: "RentCast",
      fetchedAt: "2026-10-01",
    });
  });

  it("treats an empty list or a 404 as 'no record'", async () => {
    const { fetchImpl } = fakeFetch((path) => (path.endsWith("/properties") ? { status: 200, body: [] } : { status: 404 }));
    expect(await createRentcastSource("k", fetchImpl).lookup(ADDRESS)).toMatchObject({ property: null, value: null });
  });

  it("names the endpoint, not the address, when the API fails", async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 500 }));
    await expect(createRentcastSource("k", fetchImpl).lookup(ADDRESS)).rejects.toThrow(/^RentCast \/properties: HTTP 500$/);
  });
});

describe("createDemoPropertySource", () => {
  it("finds a demo home however the address is written", async () => {
    const result = await createDemoPropertySource().lookup("742 demo lane exampleville CA 99999");
    expect(result.source).toBe(DEMO_SOURCE_LABEL);
    expect(result.value).toEqual({ price: 1_000_000, priceRangeLow: 930_000, priceRangeHigh: 1_070_000 });
  });

  it("returns no record for an address that is not in the demo data", async () => {
    expect(await createDemoPropertySource().lookup("1 Nowhere Rd, Exampleville, CA 99999")).toMatchObject({
      property: null,
      value: null,
    });
  });
});

describe("withCache", () => {
  it("asks the source once per address, however it is written", async () => {
    let calls = 0;
    const counting: PropertyDataSource = {
      async lookup(address) {
        calls += 1;
        return createDemoPropertySource().lookup(address);
      },
    };
    const cached = withCache(counting);
    await cached.lookup(ADDRESS);
    await cached.lookup("742 DEMO LANE, Exampleville, CA 99999");
    expect(calls).toBe(1);
    expect(normalizeAddress("742 Demo Ln., Exampleville")).toBe("742 demo ln exampleville");
  });

  it("fetches again once the cached value is more than 30 days old", async () => {
    let calls = 0;
    const counting: PropertyDataSource = {
      async lookup(address) {
        calls += 1;
        return createDemoPropertySource(() => "2026-08-01").lookup(address);
      },
    };
    const store = createMemoryStore();
    await withCache(counting, store, () => "2026-08-01").lookup(ADDRESS); // fetched
    await withCache(counting, store, () => "2026-08-31").lookup(ADDRESS); // 30 days: cached
    await withCache(counting, store, () => "2026-09-01").lookup(ADDRESS); // 31 days: fetched again
    expect(calls).toBe(2);
  });
});
