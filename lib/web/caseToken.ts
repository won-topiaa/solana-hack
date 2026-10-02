// The web app keeps no case on the server: the browser carries the case file as a
// sealed token and sends it with every request. Sealing (AES-256-GCM over the
// gzipped JSON) keeps the personal data in it unreadable outside the server, and
// any change to the token makes it fail to open, so the browser cannot alter a
// recommendation, an approval or an on-chain record.
// Key: CASE_SECRET (server only). Node's built-in crypto and zlib; no extra package.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { CaseFile } from "../agent/types";

const VERSION = "v1";
const IV_BYTES = 12; // the GCM standard nonce size
const TAG_BYTES = 16;

/** A 32-byte key from the secret, so any long random string works as CASE_SECRET. */
function keyFrom(secret: string): Buffer {
  if (secret.length < 32) throw new Error("CASE_SECRET must be at least 32 characters");
  return createHash("sha256").update(secret).digest();
}

export function sealCase(caseFile: CaseFile, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(caseFile))), cipher.final()]);
  return `${VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Opens a sealed case. Throws on a changed, foreign or unknown-version token. */
export function openCase(token: string, secret: string): CaseFile {
  const [version, payload] = token.split(".");
  if (version !== VERSION || !payload) throw new Error("Unknown case token");
  const bytes = Buffer.from(payload, "base64url");
  if (bytes.length <= IV_BYTES + TAG_BYTES) throw new Error("Case token too short");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), bytes.subarray(0, IV_BYTES));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    const json = gunzipSync(Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]));
    return JSON.parse(json.toString("utf8")) as CaseFile;
  } catch {
    throw new Error("The case token was changed or sealed with another key");
  }
}
