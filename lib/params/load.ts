// Reads and checks data/params.json. Every number the agent shows comes from
// this registry, so a malformed entry must stop the app instead of being guessed.

import registryJson from "../../data/params.json";
import { isIsoDate } from "./dates";
import type { ParamEntry, ParamKind, Registry } from "./types";

const KINDS: readonly ParamKind[] = ["market", "product", "design", "reference"];

function fail(path: string, problem: string): never {
  throw new Error(`params.json: ${path} ${problem}`);
}

function asObject(path: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "must be an object");
  }
  return value as Record<string, unknown>;
}

function asString(path: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail(path, "must be a non-empty string");
  return value;
}

function asDate(path: string, value: unknown): string {
  const text = asString(path, value);
  if (!isIsoDate(text)) fail(path, `must be a YYYY-MM-DD date, got "${text}"`);
  return text;
}

function checkEntry(key: string, raw: unknown): ParamEntry {
  const path = `params.${key}`;
  const entry = asObject(path, raw);
  if (!("value" in entry)) fail(path, "has no value");
  asString(`${path}.unit`, entry.unit);
  asString(`${path}.source`, entry.source);
  if (!KINDS.includes(entry.kind as ParamKind)) {
    fail(`${path}.kind`, `must be one of ${KINDS.join(", ")}`);
  }
  if (entry.source_url !== null) asString(`${path}.source_url`, entry.source_url);
  asDate(`${path}.as_of`, entry.as_of);
  if (entry.checked_at !== null) asDate(`${path}.checked_at`, entry.checked_at);
  const validDays = entry.valid_days;
  if (validDays !== null && !(Number.isInteger(validDays) && (validDays as number) >= 0)) {
    fail(`${path}.valid_days`, "must be null or a whole number of days");
  }
  // Market data and partner terms must expire; only design and reference values may not.
  if ((entry.kind === "market" || entry.kind === "product") && validDays === null) {
    fail(`${path}.valid_days`, `must be a number of days for a ${String(entry.kind)} value`);
  }
  return entry as ParamEntry;
}

/** Checks the registry's shape and every entry; throws on the first problem. */
export function parseRegistry(data: unknown): Registry {
  const root = asObject("registry", data);
  asString("registry_version", root.registry_version);
  const params = asObject("params", root.params);
  for (const [key, raw] of Object.entries(params)) checkEntry(key, raw);
  return root as Registry;
}

/** The format the refresh script writes, so diffs stay small and predictable. */
export function formatRegistry(registry: Registry): string {
  return `${JSON.stringify(registry, null, 2)}\n`;
}

/**
 * The registry frozen on a date (owner decision 2026-10-02, judging period): values are
 * checked for freshness on `frozenOn` instead of today, and every recommendation records
 * the date, so the page can say the values are as of that day. Never a date after today.
 */
export function freezeRegistry(registry: Registry, frozenOn: string, today: string): Registry {
  if (!isIsoDate(frozenOn)) throw new Error(`REGISTRY_FROZEN_ON must be a YYYY-MM-DD date, got "${frozenOn}"`);
  if (frozenOn > today) throw new Error(`REGISTRY_FROZEN_ON (${frozenOn}) is after today (${today})`);
  // Freezing before the newest value was observed or checked would claim data the page did not have.
  const dates = Object.values(registry.params)
    .filter((entry) => entry.kind === "market" || entry.kind === "product")
    .map((entry) => (entry.kind === "market" ? entry.as_of : (entry.checked_at ?? entry.as_of)));
  const newest = dates.reduce((a, b) => (b > a ? b : a), "");
  if (frozenOn < newest) throw new Error(`REGISTRY_FROZEN_ON (${frozenOn}) is before the newest registry value (${newest})`);
  return { ...registry, frozenOn };
}

let cached: Registry | undefined;

/** The registry bundled with the app (data/params.json at build time). */
export function getRegistry(): Registry {
  cached ??= parseRegistry(registryJson);
  return cached;
}
