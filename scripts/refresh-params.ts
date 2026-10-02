// Refreshes the market values in data/params.json from FRED: SOFR, the Freddie Mac
// PMMS 30- and 15-year mortgage rates, and the yearly home price growth from the FHFA
// house price index. Product, design and reference values are never changed here
// (they need a person).
//
// Usage: npm run params:refresh             writes data/params.json
//        npm run params:refresh -- --dry-run  only prints what would change
// Needs FRED_API_KEY in .env.local (see .env.example).

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { todayInNewYork } from "../lib/params/dates";
import { formatRegistry, parseRegistry } from "../lib/params/load";
import {
  applyMarketUpdates,
  FRED_HOME_PRICE_SERIES,
  FRED_SERIES,
  HOME_PRICE_GROWTH_YEARS,
  indexObservations,
  latestObservation,
  yearlyIndexGrowth,
  type MarketUpdate,
} from "../lib/params/refresh";
import { freshnessOf } from "../lib/params/staleness";

const REGISTRY_PATH = resolve(process.cwd(), "data/params.json");
const FRED_OBSERVATIONS_URL = "https://api.stlouisfed.org/fred/series/observations";

async function fetchObservations(seriesId: string, apiKey: string, limit: number): Promise<unknown> {
  const url = new URL(FRED_OBSERVATIONS_URL);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));
  const response = await fetch(url);
  // The URL holds the API key, so errors name the series instead of printing the URL.
  if (!response.ok) throw new Error(`FRED ${seriesId}: HTTP ${response.status}`);
  return response.json();
}

async function fetchLatest(seriesId: string, apiKey: string) {
  return latestObservation(await fetchObservations(seriesId, apiKey, 10));
}

async function main() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    console.error("FRED_API_KEY is not set. Add it to .env.local (see .env.example).");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");
  const registry = parseRegistry(JSON.parse(readFileSync(REGISTRY_PATH, "utf8")));
  const today = todayInNewYork();

  const updates: MarketUpdate[] = [];
  for (const [key, seriesId] of Object.entries(FRED_SERIES)) {
    const observation = await fetchLatest(seriesId, apiKey);
    if (observation) updates.push({ key, observation });
    else console.warn(`${seriesId}: no numeric observation in the latest 10 rows`);
  }
  // Quarterly index: 11 years of quarters reach the 10-year comparison.
  const homePrices = indexObservations(await fetchObservations(FRED_HOME_PRICE_SERIES, apiKey, 50));
  for (const [key, years] of Object.entries(HOME_PRICE_GROWTH_YEARS)) {
    const growth = yearlyIndexGrowth(homePrices, years);
    if (!growth) {
      console.warn(`${FRED_HOME_PRICE_SERIES}: no quarter ${years} years before the latest`);
      continue;
    }
    console.log(`${key}: index ${growth.from.value} (${growth.from.date}) -> ${growth.to.value} (${growth.to.date}) = ${(growth.value * 100).toFixed(2)}% a year`);
    updates.push({ key, observation: { date: growth.date, value: growth.value } });
  }

  const result = applyMarketUpdates(registry, updates, today);
  if (result.changes.length === 0) {
    console.log(`No changes. Registry stays at ${registry.registry_version}.`);
  } else {
    result.changes.forEach((change) => console.log(`changed: ${change}`));
    if (dryRun) console.log("Dry run: data/params.json was not written.");
    else {
      writeFileSync(REGISTRY_PATH, formatRegistry(result.registry));
      console.log(`Wrote data/params.json (registry ${result.registry.registry_version}).`);
    }
  }

  // Values that are still stale need a person, e.g. HELOC rates entered by hand weekly.
  for (const [key, entry] of Object.entries(result.registry.params)) {
    const freshness = freshnessOf(entry, today);
    if (freshness.stale) console.log(`still stale: ${key} (${freshness.reason})`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
