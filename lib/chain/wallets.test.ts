import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, SolanaError } from "@solana/kit";
import { describeChainError, receiptMemo, requireFunds, withRetries, type DevnetRpc } from "./solana";
import { loadOrCreateWallet, walletEnvName } from "./wallets";

describe("loadOrCreateWallet (offline)", () => {
  it("creates a key once in the CLI format and loads the same address next time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wallets-"));
    const first = await loadOrCreateWallet("issuer", dir);
    const again = await loadOrCreateWallet("issuer", dir);
    expect(again.address).toBe(first.address);
    const file = join(dir, "issuer.json");
    expect((JSON.parse(readFileSync(file, "utf8")) as number[]).length).toBe(64);
    expect(statSync(file).mode & 0o777).toBe(0o600); // readable by this user only
  });

  it("refuses odd wallet names (they become file names)", async () => {
    await expect(loadOrCreateWallet("../escape", mkdtempSync(join(tmpdir(), "wallets-")))).rejects.toThrow(/Bad wallet name/);
  });
});

describe("receiptMemo", () => {
  it("contains only hashes, the registry version and the chosen path id", () => {
    const memo = receiptMemo({ recommendationHash: "a".repeat(64), passportHash: "b".repeat(64), registryVersion: "2026-10-01.5", selectedOptionId: "re-hei" });
    expect(memo).toBe(`ownflow receipt v1 rec=${"a".repeat(64)} passports=${"b".repeat(64)} registry=2026-10-01.5 selected=re-hei`);
    expect(Buffer.byteLength(memo)).toBeLessThan(400); // well inside one transaction
  });
});

describe("wallets on a server without files", () => {
  it("come from DEVNET_WALLET_<NAME>, and no file is written", async () => {
    const source = mkdtempSync(join(tmpdir(), "wallets-"));
    const original = await loadOrCreateWallet("investor-kyc-2", source);
    const bytes = readFileSync(join(source, "investor-kyc-2.json"), "utf8");
    const empty = mkdtempSync(join(tmpdir(), "wallets-"));
    const fromEnv = await loadOrCreateWallet("investor-kyc-2", empty, { [walletEnvName("investor-kyc-2")]: bytes });
    expect(walletEnvName("investor-kyc-2")).toBe("DEVNET_WALLET_INVESTOR_KYC_2");
    expect(fromEnv.address).toBe(original.address);
    expect(existsSync(join(empty, "investor-kyc-2.json"))).toBe(false);
  });
});

describe("requireFunds", () => {
  const rpcWith = (lamports: bigint) => ({ getBalance: () => ({ send: async () => ({ value: lamports }) }) }) as unknown as DevnetRpc;
  it("pauses on-chain steps when the paying wallet is low", async () => {
    await expect(requireFunds(rpcWith(BigInt(100_000_000)), "11111111111111111111111111111111" as never)).rejects.toThrow(/low on test SOL \(0\.100 SOL\)/);
    await expect(requireFunds(rpcWith(BigInt(500_000_000)), "11111111111111111111111111111111" as never)).resolves.toBeUndefined();
  });
});

describe("a malformed wallet in the environment", () => {
  it("names the variable without showing the value", async () => {
    const secretish = "[12,34,56,not-a-number]";
    const attempt = loadOrCreateWallet("issuer", mkdtempSync(join(tmpdir(), "wallets-")), { DEVNET_WALLET_ISSUER: secretish });
    await expect(attempt).rejects.toThrow("DEVNET_WALLET_ISSUER must be the 64-number JSON array from .wallets/devnet/issuer.json");
    await expect(attempt).rejects.not.toThrow(/12,34/);
  });
});

describe("RPC retries", () => {
  const httpError = (statusCode: number) =>
    new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: "Too Many Requests", statusCode });

  function flaky(failures: unknown[]) {
    const calls: number[] = [];
    const transport = (async () => {
      calls.push(calls.length + 1);
      const failure = failures.shift();
      if (failure) throw failure;
      return { result: "ok" };
    }) as never;
    return { transport, calls };
  }

  it("waits longer each time and tries again when the RPC is rate limited", async () => {
    const waits: number[] = [];
    const { transport, calls } = flaky([httpError(429), httpError(503)]);
    const retrying = withRetries(transport, { sleep: async (ms) => void waits.push(ms) }) as unknown as (config: unknown) => Promise<unknown>;
    await expect(retrying({})).resolves.toEqual({ result: "ok" });
    expect(calls).toEqual([1, 2, 3]);
    expect(waits).toEqual([500, 1000]);
  });

  it("does not retry other failures, and stops after the last attempt", async () => {
    const bad = flaky([httpError(400)]);
    await expect((withRetries(bad.transport, { sleep: async () => {} }) as unknown as (c: unknown) => Promise<unknown>)({})).rejects.toThrow();
    expect(bad.calls).toEqual([1]);
    const busy = flaky([httpError(429), httpError(429), httpError(429)]);
    await expect((withRetries(busy.transport, { attempts: 3, sleep: async () => {} }) as unknown as (c: unknown) => Promise<unknown>)({})).rejects.toThrow();
    expect(busy.calls).toEqual([1, 2, 3]);
  });

  it("tells a person to try again later when the RPC is rate limited", () => {
    expect(describeChainError(httpError(429))).toMatch(/busy.*try again in a minute/);
    expect(describeChainError(new Error("something else"))).toBe("something else");
  });
});
