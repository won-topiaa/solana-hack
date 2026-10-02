// Keeps RentCast lookups on disk between runs, so repeated runs do not spend
// the free plan's 50 requests a month. The files hold personal data (owner
// names, addresses), so the folder is git-ignored and file names are hashes.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CacheStore, PropertyLookup } from "./rentcast";

export const DEFAULT_CACHE_DIR = ".cache/rentcast";

function fileFor(dir: string, key: string): string {
  return join(dir, `${createHash("sha256").update(key).digest("hex")}.json`);
}

export function createFileStore(dir: string = DEFAULT_CACHE_DIR): CacheStore {
  return {
    get(key) {
      try {
        return JSON.parse(readFileSync(fileFor(dir, key), "utf8")) as PropertyLookup;
      } catch {
        return undefined; // not cached yet, or unreadable: fetch again
      }
    },
    set(key, lookup) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(fileFor(dir, key), JSON.stringify(lookup), { mode: 0o600 });
      } catch {
        // A read-only disk (serverless hosting): the lookup still answers, it is just not kept.
      }
    },
  };
}
