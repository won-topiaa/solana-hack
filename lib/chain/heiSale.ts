// HEI primary sale on devnet (milestone M8). Funding model (owner, 2026-10-02): the
// partner pays the homeowner at closing from its own money, then sells the share
// tokens to KYC-approved investors, the way HEI companies fund first and sell later.
// The partner is simulated by the issuer wallet.

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token-2022";
import { purchaseCostMicroUsd } from "../calc/sale";
import { openPaymentAccountInstruction, paymentInstruction, type PaymentToken } from "./payment";
import { sendInstructions, tokenAccount, type DevnetRpc } from "./solana";

/** Closing: the partner pays the homeowner the net cash C. */
export async function payAtClosing(rpc: DevnetRpc, issuer: KeyPairSigner, token: PaymentToken, homeowner: Address, amountMicroUsd: bigint): Promise<Signature> {
  return sendInstructions(rpc, issuer, [
    await openPaymentAccountInstruction(issuer, homeowner, token),
    await paymentInstruction(token, issuer, homeowner, amountMicroUsd),
  ]);
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
