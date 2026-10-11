// The private watch price table (owner, 2026-10-11): US resale asking and sold prices per
// reference. It is not public: the repository holds only a sealed copy
// (data/watch-prices.sealed.json, AES-256-GCM, one copy per server's CASE_SECRET, made by
// scripts/seal-watch-prices.ts), and the server opens it the first time it needs a price.
// Without the secret (tests, CI) the table is empty and only the demo table is used.
// Node's built-in crypto and zlib, like the case token.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import sealed from "../../data/watch-prices.sealed.json";
import type { WatchCategory } from "../calc/watch";

export type PrivateWatchRow = {
  maker: string;
  model: string;
  reference: string;
  aliases: string[]; // other ways the reference is written, e.g. "79030N" for "M79030N-0001"
  category: WatchCategory;
  askingUsd: number[];
  soldUsd: number[];
};

export type PrivateWatchTable = { collectedOn: string; watches: PrivateWatchRow[] };

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CATEGORIES: WatchCategory[] = ["sport_steel", "dress_gold", "specialty_vintage"];

/** Its own key from the secret (not the case token's), so one key never serves two purposes. */
function keyFrom(secret: string): Buffer {
  if (secret.length < 32) throw new Error("CASE_SECRET must be at least 32 characters");
  return createHash("sha256").update("ownflow watch prices v1\0").update(secret).digest();
}

/** Refuses a table the price code could not use: bad categories, or prices that are not positive numbers. */
export function checkWatchTable(value: unknown): PrivateWatchTable {
  const table = value as PrivateWatchTable;
  if (!table || typeof table.collectedOn !== "string" || !Array.isArray(table.watches)) throw new Error("The watch table needs collectedOn and watches");
  for (const row of table.watches) {
    const prices = [...(row.askingUsd ?? []), ...(row.soldUsd ?? [])];
    if (!row.reference || !row.maker || !row.model || !Array.isArray(row.aliases)) throw new Error(`Watch ${row.reference ?? "?"} needs maker, model, reference and aliases`);
    if (!CATEGORIES.includes(row.category)) throw new Error(`Watch ${row.reference} has an unknown category`);
    if (prices.length === 0 || prices.some((price) => typeof price !== "number" || !Number.isFinite(price) || price <= 0)) {
      throw new Error(`Watch ${row.reference} needs at least one positive price`);
    }
  }
  return table;
}

export function sealWatchTable(table: PrivateWatchTable, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(checkWatchTable(table)))), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** The table from the first sealed copy this secret opens; null when none does. */
export function openWatchTable(copies: string[], secret: string): PrivateWatchTable | null {
  const key = keyFrom(secret);
  for (const copy of copies) {
    const [version, payload] = copy.split(".");
    if (version !== VERSION || !payload) continue;
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.length <= IV_BYTES + TAG_BYTES) continue;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
      decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const json = gunzipSync(Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]));
      return checkWatchTable(JSON.parse(json.toString("utf8")));
    } catch {
      // Sealed for another server's secret, or changed: try the next copy.
    }
  }
  return null;
}

let cached: PrivateWatchTable | null | undefined;

/** The private table on this server, opened once with CASE_SECRET; null without it. */
export function privateWatchTable(): PrivateWatchTable | null {
  if (cached !== undefined) return cached;
  const secret = process.env.CASE_SECRET;
  cached = secret && secret.length >= 32 ? openWatchTable(sealed.copies, secret) : null;
  if (secret && cached === null && sealed.copies.length > 0) {
    console.warn("[watch prices] the sealed price table does not open with this server's CASE_SECRET; only the demo table is used");
  }
  return cached;
}
