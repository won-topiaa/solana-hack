// The watch price table. A real watch price source is still TBD (CLAUDE.md §4),
// so the MVP uses a table with a source and a date for every value.

import table from "../../data/demo/watch-prices.json";
import type { WatchCategory } from "../calc/watch";

export type WatchPrice = {
  maker: string;
  model: string;
  reference: string;
  category: WatchCategory;
  priceUsd: number;
  source: string;
  asOf: string;
};

/** "demo 300" and "DEMO-300" are the same reference. */
export function normalizeReference(reference: string): string {
  return reference.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function findWatchPrice(reference: string): WatchPrice | null {
  const key = normalizeReference(reference);
  const row = table.watches.find((watch) => normalizeReference(watch.reference) === key);
  if (!row) return null;
  return { ...row, category: row.category as WatchCategory, source: table.source, asOf: table.asOf };
}
