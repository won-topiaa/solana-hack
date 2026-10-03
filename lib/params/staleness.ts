// Decides whether registry values are too old to use (rule: "staleness" in
// data/params.json). A recommendation may only be finalized when every value
// it used is fresh; otherwise the agent shows "needs fresh data".

import { daysBetween } from "./dates";
import type { ParamEntry, Registry } from "./types";

type Freshness = {
  stale: boolean;
  basis: "as_of" | "checked_at" | null; // which date the age counts from
  ageDays: number | null;
  reason: string;
};

export function freshnessOf(entry: ParamEntry, today: string): Freshness {
  // Design values are our own choices; reference values never feed a calculation.
  if (entry.kind === "design" || entry.kind === "reference" || entry.valid_days === null) {
    return { stale: false, basis: null, ageDays: null, reason: `${entry.kind} value, does not expire` };
  }
  // Market data ages from its observation date; product terms from our last check.
  const basis = entry.kind === "market" ? "as_of" : "checked_at";
  const date = basis === "as_of" ? entry.as_of : entry.checked_at;
  if (date === null) {
    return { stale: true, basis, ageDays: null, reason: "never confirmed at its source" };
  }
  const ageDays = daysBetween(date, today);
  // A date after the check date is a typo or a freeze date set too early: not fresh.
  if (ageDays < 0) return { stale: true, basis, ageDays, reason: `dated ${date}, after the check date ${today}` };
  const stale = ageDays > entry.valid_days;
  const reason = `${ageDays} days old (${basis} ${date}), valid for ${entry.valid_days}`;
  return { stale, basis, ageDays, reason };
}

type StaleParam = { key: string; reason: string };

type FreshnessCheck =
  | { ok: true; registryVersion: string }
  | { ok: false; registryVersion: string; stale: StaleParam[] };

/** Gate in front of every recommendation: all registry values it used must be fresh. */
export function checkParamsFresh(
  registry: Registry,
  usedKeys: readonly string[],
  today: string,
): FreshnessCheck {
  const stale: StaleParam[] = [];
  for (const key of usedKeys) {
    const entry = registry.params[key];
    // An unknown key is a bug in our code, not old data, so it must not pass silently.
    if (!entry) throw new Error(`Unknown registry key: ${key}`);
    const freshness = freshnessOf(entry, today);
    if (freshness.stale) stale.push({ key, reason: freshness.reason });
  }
  const registryVersion = registry.registry_version;
  return stale.length === 0 ? { ok: true, registryVersion } : { ok: false, registryVersion, stale };
}
