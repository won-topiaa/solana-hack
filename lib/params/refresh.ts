// Pure parts of scripts/refresh-params.ts: reading FRED responses and applying
// market updates to the registry. Network and file access stay in the script,
// so everything here can be tested without the internet.

import type { Registry } from "./types";

/** Registry key -> FRED series ID. The 30- and 15-year rates are Freddie Mac PMMS data on FRED. */
export const FRED_SERIES: Readonly<Record<string, string>> = {
  sofr: "SOFR",
  mortgage_30y_fixed_avg: "MORTGAGE30US",
  mortgage_15y_fixed_avg: "MORTGAGE15US",
};

export type Observation = { date: string; value: number }; // value as a fraction, e.g. 0.039

/**
 * FHFA All-Transactions House Price Index for the United States (quarterly, 1980:Q1 = 100,
 * not seasonally adjusted). Its FRED page carries no third-party copyright note, unlike
 * the Case-Shiller indexes. https://fred.stlouisfed.org/series/USSTHPI
 */
export const FRED_HOME_PRICE_SERIES = "USSTHPI";

/** Registry key -> years back: the yearly home price growth over that many years, to the latest quarter. */
export const HOME_PRICE_GROWTH_YEARS: Readonly<Record<string, number>> = {
  home_price_growth_2y: 2,
  home_price_growth_10y: 10,
};

/** Index levels from a FRED observations response, numeric rows only, oldest first. */
export function indexObservations(fredJson: unknown): Observation[] {
  const observations = (fredJson as { observations?: unknown })?.observations;
  if (!Array.isArray(observations)) throw new Error("FRED response has no observations list");
  return (observations as { date?: unknown; value?: unknown }[])
    .filter((item): item is { date: string; value: string } => typeof item.date === "string" && typeof item.value === "string" && /^\d+(\.\d+)?$/.test(item.value.trim()))
    .map((item) => ({ date: item.date, value: Number(item.value) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Yearly growth from the observation exactly `years` before the latest one (same month
 * and day) to the latest: (latest / earlier)^(1 / years) - 1, to 6 decimals. Dated at the
 * latest observation. null when that earlier quarter is missing.
 */
export function yearlyIndexGrowth(observations: Observation[], years: number): (Observation & { from: Observation; to: Observation }) | null {
  const to = observations.at(-1);
  if (!to) return null;
  const fromDate = `${Number(to.date.slice(0, 4)) - years}${to.date.slice(4)}`;
  const from = observations.find((item) => item.date === fromDate);
  if (!from || !(from.value > 0)) return null;
  const growth = Number((Math.pow(to.value / from.value, 1 / years) - 1).toFixed(6));
  return { date: to.date, value: growth, from, to };
}

/**
 * Latest observation with a numeric value from a FRED series/observations JSON
 * response. FRED reports percent; the registry stores fractions.
 */
export function latestObservation(fredJson: unknown): Observation | null {
  const observations = (fredJson as { observations?: unknown })?.observations;
  if (!Array.isArray(observations)) throw new Error("FRED response has no observations list");
  let latest: Observation | null = null;
  for (const item of observations as { date?: unknown; value?: unknown }[]) {
    // Days without data come back as a non-number (e.g. "."), so they are skipped;
    // so is anything that is not a plain decimal string (null would read as 0%).
    if (typeof item.date !== "string" || typeof item.value !== "string" || !/^-?\d+(\.\d+)?$/.test(item.value.trim())) continue;
    const percent = Number(item.value);
    if (latest === null || item.date > latest.date) {
      latest = { date: item.date, value: Number((percent / 100).toFixed(6)) };
    }
  }
  return latest;
}

/** Next registry version: YYYY-MM-DD.N, counting up within the same day. */
export function nextRegistryVersion(current: string, today: string): string {
  const [day, counter] = current.split(".");
  // Never go back or repeat: a version dated today or later (e.g. a hand edit in another
  // time zone) keeps its day and counts up, so every receipt names one set of values.
  return day >= today ? `${day}.${Number(counter) + 1}` : `${today}.1`;
}

export type MarketUpdate = { key: string; observation: Observation };

/**
 * Applies new market observations. Only market values may change here; a new
 * version and a changelog line are added only when a value or its date changed.
 */
export function applyMarketUpdates(
  registry: Registry,
  updates: MarketUpdate[],
  today: string,
): { registry: Registry; changes: string[] } {
  const params = structuredClone(registry.params);
  const changes: string[] = [];
  for (const { key, observation } of updates) {
    const entry = params[key];
    if (!entry) throw new Error(`Unknown registry key: ${key}`);
    if (entry.kind !== "market") throw new Error(`${key} is ${entry.kind}, not market data`);
    // Never replace newer data with older data.
    if (observation.date < entry.as_of) continue;
    if (observation.date === entry.as_of && observation.value === entry.value) continue;
    changes.push(`${key} ${entry.value} -> ${observation.value} (as_of ${entry.as_of} -> ${observation.date})`);
    params[key] = { ...entry, value: observation.value, as_of: observation.date, checked_at: today };
  }
  if (changes.length === 0) return { registry, changes };
  const version = nextRegistryVersion(registry.registry_version, today);
  return {
    registry: {
      ...registry,
      registry_version: version,
      changelog: [...registry.changelog, { version, note: `refresh-params: ${changes.join("; ")}` }],
      params,
    },
    changes,
  };
}
