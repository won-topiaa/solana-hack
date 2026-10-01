// Property data from RentCast: public records (owner, last sale) and the
// automated valuation (AVM) range.
// Docs: https://developers.rentcast.io/reference/property-records
//       https://developers.rentcast.io/reference/value-estimate
// The free plan allows 50 requests a month and each lookup uses two, so the
// agent always goes through withCache. Terms (storing and showing the data to
// users is allowed, no attribution needed): https://www.rentcast.io/terms-api

import demoData from "../../data/demo/properties.json";
import { daysBetween, todayInNewYork } from "../params/dates";

export const RENTCAST_BASE_URL = "https://api.rentcast.io/v1";

/** The fields we use from GET /v1/properties (the response is an array of these). */
export type RentcastProperty = {
  id: string;
  formattedAddress: string;
  propertyType?: string;
  lastSaleDate?: string;
  lastSalePrice?: number;
  ownerOccupied?: boolean;
  owner?: { names?: string[]; type?: string };
};

/** The fields we use from GET /v1/avm/value. */
export type RentcastValueEstimate = { price: number; priceRangeLow: number; priceRangeHigh: number };

export type PropertyLookup = {
  property: RentcastProperty | null; // null = no record for that address
  value: RentcastValueEstimate | null;
  source: string; // shown to the user next to the numbers
  fetchedAt: string; // YYYY-MM-DD the data was fetched; the value's "as of" date
};

export interface PropertyDataSource {
  lookup(address: string): Promise<PropertyLookup>;
}

/** Same address written differently ("Ln." vs "ln") should hit the same cache entry. */
export function normalizeAddress(address: string): string {
  return address.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}

export function createRentcastSource(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  today: () => string = () => todayInNewYork(),
): PropertyDataSource {
  async function get<T>(path: string, address: string): Promise<T | null> {
    const url = new URL(`${RENTCAST_BASE_URL}${path}`);
    url.searchParams.set("address", address);
    const response = await fetchImpl(url, { headers: { "X-Api-Key": apiKey, Accept: "application/json" } });
    if (response.status === 404) return null;
    // Errors name the endpoint only; the URL holds the user's address.
    if (!response.ok) throw new Error(`RentCast ${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  return {
    async lookup(address) {
      const records = await get<RentcastProperty[]>("/properties", address);
      const value = await get<RentcastValueEstimate>("/avm/value", address);
      return { property: records?.[0] ?? null, value, source: "RentCast", fetchedAt: today() };
    },
  };
}

export const DEMO_SOURCE_LABEL = "Demo data (simulated RentCast response)";

/** Made-up properties from data/demo/properties.json, used when there is no RentCast key. */
export function createDemoPropertySource(today: () => string = () => todayInNewYork()): PropertyDataSource {
  return {
    async lookup(address) {
      const item = demoData.properties.find((p) => normalizeAddress(p.address) === normalizeAddress(address));
      return {
        property: item?.record ?? null,
        value: item?.valueEstimate ?? null,
        source: DEMO_SOURCE_LABEL,
        fetchedAt: today(),
      };
    },
  };
}

/** Where cached lookups are kept: in memory, or on disk (rentcastCache.ts). */
export type CacheStore = {
  get(key: string): PropertyLookup | undefined;
  set(key: string, lookup: PropertyLookup): void;
};

export function createMemoryStore(): CacheStore {
  const entries = new Map<string, PropertyLookup>();
  return { get: (key) => entries.get(key), set: (key, lookup) => void entries.set(key, lookup) };
}

/** Values older than this are fetched again, so a cached value range never gets too old. */
export const CACHE_MAX_AGE_DAYS = 30;

/** Remembers lookups by address so the same home is fetched once, not on every run. */
export function withCache(
  source: PropertyDataSource,
  store: CacheStore = createMemoryStore(),
  today: () => string = () => todayInNewYork(),
): PropertyDataSource {
  return {
    async lookup(address) {
      const key = normalizeAddress(address);
      const cached = store.get(key);
      if (cached && daysBetween(cached.fetchedAt, today()) <= CACHE_MAX_AGE_DAYS) return cached;
      const result = await source.lookup(address);
      store.set(key, result);
      return result;
    },
  };
}
