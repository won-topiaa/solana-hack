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
 * Latest observation with a numeric value from a FRED series/observations JSON
 * response. FRED reports percent; the registry stores fractions.
 */
export function latestObservation(fredJson: unknown): Observation | null {
  const observations = (fredJson as { observations?: unknown })?.observations;
  if (!Array.isArray(observations)) throw new Error("FRED response has no observations list");
  let latest: Observation | null = null;
  for (const item of observations as { date?: unknown; value?: unknown }[]) {
    const percent = Number(item.value);
    // Days without data come back as a non-number (e.g. "."), so they are skipped.
    if (typeof item.date !== "string" || item.value === "" || !Number.isFinite(percent)) continue;
    if (latest === null || item.date > latest.date) {
      latest = { date: item.date, value: Number((percent / 100).toFixed(6)) };
    }
  }
  return latest;
}

/** Next registry version: YYYY-MM-DD.N, counting up within the same day. */
export function nextRegistryVersion(current: string, today: string): string {
  const [day, counter] = current.split(".");
  return day === today ? `${today}.${Number(counter) + 1}` : `${today}.1`;
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
