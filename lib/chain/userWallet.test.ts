import { generateKeyPairSigner, getBase58Decoder, getBase64Encoder, getTransactionDecoder } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { describe, expect, it } from "vitest";
import type { DevnetRpc } from "./solana";
import { buildForWallet, changeFor, changeForAccount, parseSignedByWallet, verifyWalletProof, walletProofMessage, walletStandIn } from "./userWallet";

describe("a transaction built for the user's wallet (offline)", () => {
  it("is paid by the wallet and has no signatures yet", async () => {
    const wallet = await generateKeyPairSigner();
    const rpc = {
      getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: BigInt(99) } }) }),
    } as unknown as DevnetRpc;
    const built = await buildForWallet(rpc, wallet.address, [getAddMemoInstruction({ memo: "ownflow test", signers: [walletStandIn(wallet.address)] })]);
    const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(built.transaction));
    expect(Object.keys(transaction.signatures)).toEqual([wallet.address]); // the wallet is the only signer, and pays
    expect(Object.values(transaction.signatures)).toEqual([null]);
    expect(built.lastValidBlockHeight).toBe("99");
  });
});

describe("the browser's answer", () => {
  it("is a signed transaction or a base58 signature, nothing else", () => {
    expect(parseSignedByWallet({ transaction: "AQID" })).toEqual({ transaction: "AQID" });
    const signature = "5".repeat(88);
    expect(parseSignedByWallet({ signature })).toEqual({ signature });
    expect(() => parseSignedByWallet({ signature: "0OIl" })).toThrow();
    expect(() => parseSignedByWallet({})).toThrow();
    expect(() => parseSignedByWallet(null)).toThrow();
  });
});

describe("the wallet proof", () => {
  it("accepts the wallet's signature in base58 or base64, and only over the same message", async () => {
    const wallet = await generateKeyPairSigner();
    const message = walletProofMessage({ caseId: "case-1", wallet: wallet.address, nonce: "n1", issuedAt: "2026-10-01T15:00:00.000Z" });
    const [signed] = await wallet.signMessages([{ content: new TextEncoder().encode(message), signatures: {} }]);
    const bytes = signed[wallet.address];
    expect(await verifyWalletProof(wallet.address, message, getBase58Decoder().decode(bytes))).toBe(true);
    expect(await verifyWalletProof(wallet.address, message, Buffer.from(bytes).toString("base64"))).toBe(true);
    expect(await verifyWalletProof(wallet.address, `${message} `, getBase58Decoder().decode(bytes))).toBe(false);
    expect(await verifyWalletProof(wallet.address, message, "not-a-signature")).toBe(false);
  });
});

describe("reading a payment back", () => {
  it("adds up one owner's change of one token", () => {
    const parsed = {
      signers: ["w"],
      memos: [],
      tokenChanges: [
        { account: "w-dusd", mint: "dusd", owner: "w", change: BigInt(-5) },
        { account: "s-dusd", mint: "dusd", owner: "s", change: BigInt(5) },
        { account: "s-other", mint: "other", owner: "s", change: BigInt(9) },
      ],
    };
    expect(changeFor(parsed, "dusd", "s")).toBe(BigInt(5));
    expect(changeFor(parsed, "dusd", "w")).toBe(BigInt(-5));
    expect(changeFor(parsed, "dusd", "x")).toBe(BigInt(0));
    // By account address: a payment into another account of the same owner does not count.
    expect(changeForAccount(parsed, "s-dusd")).toBe(BigInt(5));
    expect(changeForAccount(parsed, "s-elsewhere")).toBe(BigInt(0));
  });
});
