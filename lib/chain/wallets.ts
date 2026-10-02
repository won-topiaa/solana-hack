// Devnet wallets for the demo, kept in the git-ignored .wallets/devnet folder as
// 64-byte secret key arrays (the Solana CLI keypair format). Devnet only: these
// keys must never hold real funds.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Encoder,
  type KeyPairSigner,
} from "@solana/kit";

export const WALLET_DIR = ".wallets/devnet";

/** issuer: plays the partners (HEI issuer, watch vault) on devnet; user: the homeowner or watch owner. */
export const DEMO_WALLETS = ["issuer", "user", "investor-kyc", "investor-kyc-2", "investor-no-kyc"] as const;

/** The environment variable that can hold a wallet on a server without the files (Vercel). */
export function walletEnvName(name: string): string {
  return `DEVNET_WALLET_${name.toUpperCase().replaceAll("-", "_")}`;
}

/**
 * Parses a wallet from the environment. The error names the variable but never shows its
 * value: a JSON parse message can quote part of the input, which here is a secret key.
 */
function keyBytesFromEnv(variable: string, raw: string, name: string): Uint8Array {
  let numbers: unknown;
  try {
    numbers = JSON.parse(raw);
  } catch {
    numbers = null;
  }
  const valid = Array.isArray(numbers) && numbers.length === 64 && numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (!valid) throw new Error(`${variable} must be the 64-number JSON array from .wallets/devnet/${name}.json`);
  return Uint8Array.from(numbers as number[]);
}

export async function loadOrCreateWallet(name: string, dir: string = WALLET_DIR, env: Record<string, string | undefined> = process.env): Promise<KeyPairSigner> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Bad wallet name: ${name}`);
  // First the environment (same 64-number JSON array as the file), then the file, else a new key.
  const fromEnv = env[walletEnvName(name)];
  if (fromEnv) return createKeyPairSignerFromBytes(keyBytesFromEnv(walletEnvName(name), fromEnv, name));
  const file = join(dir, `${name}.json`);
  if (existsSync(file)) {
    const bytes = Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]);
    return createKeyPairSignerFromBytes(bytes);
  }
  // A new key: 32 random bytes, then the public key, as the CLI stores it.
  const seed = randomBytes(32);
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const secretKey = new Uint8Array(64);
  secretKey.set(seed, 0);
  secretKey.set(getBase58Encoder().encode(signer.address), 32);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(Array.from(secretKey)), { mode: 0o600 });
  return createKeyPairSignerFromBytes(secretKey);
}
