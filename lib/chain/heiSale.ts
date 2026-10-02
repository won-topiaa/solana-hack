// HEI primary sale on devnet (milestone M8). Funding model (owner, 2026-10-02): the
// partner pays the homeowner at closing from its own money, then sells the share
// tokens to KYC-approved investors, the way HEI companies fund first and sell later.
// The partner is simulated by the issuer wallet.

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferCheckedInstruction } from "@solana-program/token-2022";
import { purchaseCostMicroUsd } from "../calc/sale";
import { openPaymentAccountInstruction, paymentAccount, paymentInstruction, type PaymentToken } from "./payment";
import { sendInstructions, tokenAccount, type DevnetRpc } from "./solana";

/** The memo on a closing payment: it names the HEI, so a retried sale can see the payment was made. */
export function closingMemo(heiMint: Address): string {
  return `ownflow closing v1 mint=${heiMint}`;
}

/** The successful earlier closing payment for this HEI, from the memos on the homeowner's account. */
export function findClosing(entries: readonly { signature: string; memo: string | null; err: unknown }[], heiMint: Address): string | null {
  const marker = closingMemo(heiMint);
  return entries.find((entry) => entry.err === null && entry.memo?.includes(marker))?.signature ?? null;
}

/**
 * Closing: the partner pays the homeowner the net cash C, once. If an earlier attempt
 * already paid (its memo is on the homeowner's account), that payment is returned instead.
 */
export async function payAtClosing(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  token: PaymentToken,
  homeowner: Address,
  amountMicroUsd: bigint,
  heiMint: Address,
): Promise<{ signature: Signature; alreadyPaid: boolean }> {
  const account = await paymentAccount(homeowner, token);
  if (await readExists(rpc, account)) {
    const recent = await rpc.getSignaturesForAddress(account, { limit: 50 }).send();
    const earlier = findClosing(recent, heiMint);
    if (earlier) return { signature: earlier as Signature, alreadyPaid: true };
  }
  const signature = await sendInstructions(rpc, issuer, [
    getAddMemoInstruction({ memo: closingMemo(heiMint) }),
    await openPaymentAccountInstruction(issuer, homeowner, token),
    await paymentInstruction(token, issuer, homeowner, amountMicroUsd),
  ]);
  return { signature, alreadyPaid: false };
}

async function readExists(rpc: DevnetRpc, account: Address): Promise<boolean> {
  const { value } = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
  return value !== null;
}

export type Purchase = {
  issuer: TransactionSigner; // owns the treasury and receives the money
  buyer: TransactionSigner;
  heiMint: Address;
  treasury: Address; // the issuer's share account
  token: PaymentToken;
  tokens: bigint;
  priceMicroUsd: bigint;
};

/**
 * One purchase as one transaction: the buyer's dollars go to the issuer and the
 * shares go to the buyer, both or neither. A buyer without KYC has a frozen share
 * account (or none), so the share transfer fails and no money moves.
 */
export async function purchaseInstructions(purchase: Purchase): Promise<Instruction[]> {
  const cost = purchaseCostMicroUsd(purchase.tokens, purchase.priceMicroUsd);
  return [
    await openPaymentAccountInstruction(purchase.issuer, purchase.issuer.address, purchase.token),
    await paymentInstruction(purchase.token, purchase.buyer, purchase.issuer.address, cost),
    getTransferCheckedInstruction({
      source: purchase.treasury,
      mint: purchase.heiMint,
      destination: await tokenAccount(purchase.buyer.address, purchase.heiMint),
      authority: purchase.issuer,
      amount: purchase.tokens,
      decimals: 0,
    }),
  ];
}

/** Sends one purchase; the issuer pays the fee, so buyers need no SOL. */
export async function buyShares(rpc: DevnetRpc, feePayer: KeyPairSigner, purchase: Purchase): Promise<{ signature: Signature; costMicroUsd: bigint }> {
  const signature = await sendInstructions(rpc, feePayer, await purchaseInstructions(purchase));
  return { signature, costMicroUsd: purchaseCostMicroUsd(purchase.tokens, purchase.priceMicroUsd) };
}
