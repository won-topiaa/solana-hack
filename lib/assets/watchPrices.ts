// The watch price tables: the made-up demo table (the personas' watches, with a source
// and a date for every value) and, on a server that holds the key, the private table of
// US resale asking and sold prices (owner, 2026-10-11; lib/assets/privateWatchPrices.ts).

import table from "../../data/demo/watch-prices.json";
import { medianPriceUsd, type WatchCategory } from "../calc/watch";
import { privateWatchTable, type PrivateWatchRow, type PrivateWatchTable } from "./privateWatchPrices";

type WatchPrice = {
  maker: string;
  model: string;
  reference: string;
  category: WatchCategory;
  priceUsd: number;
  source: string;
  asOf: string;
};

/** "demo 300" and "DEMO-300" are the same reference. */
function normalizeReference(reference: string): string {
  return reference.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Shorter than this, a written reference is too vague to match by its start. */
const MIN_PREFIX = 5;

/**
 * The private row for a written reference: the reference or one of its aliases exactly,
 * else the longest one the written reference starts with ("126610LN-0001" is a 126610LN,
 * "15510ST.OO.1320ST.06" a 15510ST).
 */
export function matchPrivateRow(rows: PrivateWatchRow[], reference: string): PrivateWatchRow | null {
  const key = normalizeReference(reference);
  const names = rows.flatMap((row) => [row.reference, ...row.aliases].map((name) => ({ row, name: normalizeReference(name) })));
  const exact = names.find((item) => item.name === key);
  if (exact) return exact.row;
  const prefixes = names.filter((item) => item.name.length >= MIN_PREFIX && key.startsWith(item.name)).sort((a, b) => b.name.length - a.name.length);
  return prefixes[0]?.row ?? null;
}

/** A private row as a price: the median of its asking and sold prices, from code. */
export function privatePrice(row: PrivateWatchRow, privateTable: Pick<PrivateWatchTable, "collectedOn">): WatchPrice {
  const prices = [...row.askingUsd, ...row.soldUsd];
  return {
    maker: row.maker,
    model: row.model,
    reference: row.reference,
    category: row.category,
    priceUsd: medianPriceUsd(prices),
    source: `Ownflow resale price table (median of ${prices.length} US asking and sold prices)`,
    asOf: privateTable.collectedOn,
  };
}

export function findWatchPrice(reference: string): WatchPrice | null {
  const key = normalizeReference(reference);
  const row = table.watches.find((watch) => normalizeReference(watch.reference) === key);
  if (row) return { ...row, category: row.category as WatchCategory, source: table.source, asOf: table.asOf };
  const privateTable = privateWatchTable();
  const privateRow = privateTable ? matchPrivateRow(privateTable.watches, reference) : null;
  return privateTable && privateRow ? privatePrice(privateRow, privateTable) : null;
}
