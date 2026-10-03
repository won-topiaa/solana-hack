// Canonical JSON and hashes for receipts and passports. Keys are sorted and
// undefined values dropped, so the same data always gives the same hash and
// anyone can recompute it later.

import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** SHA-256 of the canonical JSON of `value`, as hex. */
export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
