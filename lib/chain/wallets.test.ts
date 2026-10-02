import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { receiptMemo } from "./solana";
import { loadOrCreateWallet } from "./wallets";

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
    expect(memo).toBe(`rwa-liquidity-agent receipt v1 rec=${"a".repeat(64)} passports=${"b".repeat(64)} registry=2026-10-01.5 selected=re-hei`);
    expect(Buffer.byteLength(memo)).toBeLessThan(400); // well inside one transaction
  });
});
