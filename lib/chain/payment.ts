// The payment token for the HEI primary sale and settlement (milestone M8).
// On devnet it is our own "Demo USD" test token with no value (owner, 2026-10-02):
// Circle's devnet USDC faucet gives 20 USDC per address every 2 hours
// (https://faucet.circle.com), far below a $150,000 sale. It has USDC's 6 decimals
// (devnet USDC 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU, checked over RPC), and
// the code takes the token's mint and program as data, so another token could be
// used without changing any amount. Only the test token has been tried.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { address, generateKeyPairSigner, type Address, type Instruction, type KeyPairSigner, type Signature, type TransactionSigner } from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
  getTransferCheckedInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { PAYMENT_DECIMALS } from "../calc/sale";
import { createMint, readTokenAccount, sendInstructions, type DevnetRpc, type MintOptions, type TokenInfo } from "./solana";
import { WALLET_DIR } from "./wallets";

export type PaymentToken = { mint: Address; program: Address; decimals: number; symbol: string };

const TEST_DOLLAR_INFO: TokenInfo = {
  name: "Demo USD (test token, no value)",
  symbol: "DUSD",
  fields: [["purpose", "devnet test dollars for the Ownflow demo; no value"]],
};
const TEST_DOLLAR_MINT: MintOptions = { decimals: PAYMENT_DECIMALS, frozenByDefault: false, freezeAuthority: false, permanentDelegate: false };

/**
 * The demo's test dollar. Created once by the issuer wallet (which can mint more, like a
 * faucet); its address is kept next to the wallets in the git-ignored .wallets/devnet.
 */
export async function loadOrCreateTestDollar(rpc: DevnetRpc, issuer: KeyPairSigner, dir: string = WALLET_DIR): Promise<PaymentToken> {
  const file = join(dir, "test-dollar.json");
  const token = (mint: Address): PaymentToken => ({ mint, program: TOKEN_2022_PROGRAM_ADDRESS, decimals: PAYMENT_DECIMALS, symbol: TEST_DOLLAR_INFO.symbol });
  // On a server without the file (Vercel), the mint comes from the environment and is never created there.
  if (process.env.DEVNET_TEST_DOLLAR_MINT) return token(address(process.env.DEVNET_TEST_DOLLAR_MINT));
  // Vercel cannot keep a new mint's address (read-only disk), so it would make a new one each time.
  if (process.env.VERCEL) throw new Error("DEVNET_TEST_DOLLAR_MINT is not set in the hosting's environment variables (see .env.example)");
  if (existsSync(file)) {
    const saved = address((JSON.parse(readFileSync(file, "utf8")) as { mint: string }).mint);
    // Devnet can be reset; then the saved mint is gone and a new one is made.
    const { value } = await rpc.getAccountInfo(saved, { encoding: "base64" }).send();
    if (value) return token(saved);
  }
  const mint = await generateKeyPairSigner();
  await createMint(rpc, issuer, mint, TEST_DOLLAR_INFO, TEST_DOLLAR_MINT);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ mint: mint.address }));
  return token(mint.address);
}

/** The owner's account for the payment token (an associated token account). */
export async function paymentAccount(owner: Address, token: PaymentToken): Promise<Address> {
  const [account] = await findAssociatedTokenPda({ owner, mint: token.mint, tokenProgram: token.program });
  return account;
}

/** Opens the owner's payment account if it does not exist yet; the issuer pays the rent. */
export async function openPaymentAccountInstruction(issuer: TransactionSigner, owner: Address, token: PaymentToken): Promise<Instruction> {
  return getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner, mint: token.mint, tokenProgram: token.program });
}

/** A payment from `from` to `to`, checked against the token's decimals. */
export async function paymentInstruction(token: PaymentToken, from: TransactionSigner, to: Address, amountMicroUsd: bigint): Promise<Instruction> {
  return getTransferCheckedInstruction(
    {
      source: await paymentAccount(from.address, token),
      mint: token.mint,
      destination: await paymentAccount(to, token),
      authority: from,
      amount: amountMicroUsd,
      decimals: token.decimals,
    },
    { programAddress: token.program },
  );
}

/**
 * Test dollars only: the issuer mints them into a wallet's account (a faucet for the
 * demo). The account must exist, or be opened earlier in the same transaction. Minting
 * the exact amount inside the transaction that spends it means two demo cases running at
 * once never spend each other's money.
 */
export async function mintTestDollarsInstruction(token: PaymentToken, issuer: TransactionSigner, owner: Address, amountMicroUsd: bigint): Promise<Instruction> {
  return getMintToInstruction({ mint: token.mint, token: await paymentAccount(owner, token), mintAuthority: issuer, amount: amountMicroUsd }, { programAddress: token.program });
}

/** Test dollars only: opens the wallet's account if needed and mints into it. */
export async function mintTestDollars(rpc: DevnetRpc, issuer: KeyPairSigner, token: PaymentToken, owner: Address, amountMicroUsd: bigint): Promise<Signature> {
  return sendInstructions(rpc, issuer, [
    await openPaymentAccountInstruction(issuer, owner, token),
    await mintTestDollarsInstruction(token, issuer, owner, amountMicroUsd),
  ]);
}

/** The owner's payment balance in micro-dollars (0 when the account does not exist). */
export async function paymentBalance(rpc: DevnetRpc, token: PaymentToken, owner: Address): Promise<bigint> {
  const account = await readTokenAccount(rpc, await paymentAccount(owner, token));
  return BigInt(account?.amount ?? "0");
}
