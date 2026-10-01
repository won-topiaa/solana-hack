// Prints how fresh every value in data/params.json is today (US Eastern date).
// Usage: npm run params:check            (today)
//        npm run params:check -- 2026-10-08  (as of another date)

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isIsoDate, todayInNewYork } from "../lib/params/dates";
import { parseRegistry } from "../lib/params/load";
import { freshnessOf } from "../lib/params/staleness";

const dateArg = process.argv[2];
if (dateArg !== undefined && !isIsoDate(dateArg)) {
  console.error(`Not a YYYY-MM-DD date: ${dateArg}`);
  process.exit(1);
}
const today = dateArg ?? todayInNewYork();
const registry = parseRegistry(
  JSON.parse(readFileSync(resolve(process.cwd(), "data/params.json"), "utf8")),
);

console.log(`Registry ${registry.registry_version}, checked for ${today}\n`);
let staleCount = 0;
for (const [key, entry] of Object.entries(registry.params)) {
  const freshness = freshnessOf(entry, today);
  if (freshness.stale) staleCount += 1;
  const status = freshness.stale ? "STALE" : "ok   ";
  console.log(`${status}  ${key.padEnd(34)} ${entry.kind.padEnd(9)} ${freshness.reason}`);
}
console.log(`\n${staleCount} stale value(s).`);
