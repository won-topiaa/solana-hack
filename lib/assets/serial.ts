// Watch serial numbers are personal data. The raw number stays in the case
// file's PII store; assets (and later the on-chain passport) carry only a keyed
// hash. A plain hash of a short serial could be reversed by trying every
// possible serial, so the hash uses a random salt that never leaves the case file.

import { createHmac, randomBytes } from "node:crypto";

/** "dw 773-1842" and "DW7731842" are the same serial. */
export function normalizeSerial(serial: string): string {
  return serial.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Blanks out the serial wherever it appears in a text, written in any case and with any
 * spaces or dashes between its characters ("DW7731842", "dw 773-1842").
 */
export function redactSerial(text: string, serial: string, mask = "[serial]"): string {
  const characters = normalizeSerial(serial).split(""); // letters and digits only, safe in a pattern
  if (characters.length === 0) return text;
  return text.replace(new RegExp(characters.join("[^A-Za-z0-9]*"), "gi"), mask);
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

/** HMAC-SHA256 of the normalized serial, keyed by the case's salt, as hex. */
export function hashSerial(serial: string, salt: string): string {
  return createHmac("sha256", salt).update(normalizeSerial(serial)).digest("hex");
}
