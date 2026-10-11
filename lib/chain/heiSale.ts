// HEI primary sale on devnet (milestone M8). Funding model (owner, 2026-10-02): the
// partner pays the homeowner at closing from its own money, then sells the share
// tokens to KYC-approved investors, the way HEI companies fund first and sell later.
// The partner is simulated by the issuer wallet.

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token-2022";
import { purchaseCostMicroUsd } from "../calc/sale";
import { mintTestDollarsInstruction, openPaymentAccountInstruction, paymentInstruction, type PaymentToken } from "./payment";
import { sendInstructions, tokenAccount, type DevnetRpc } from "./solana";
import { payOnce } from "./oncePayment";

/** The memo on a closing payment: it names the HEI, for anyone reading the transaction. */
function closingMemo(heiMint: Address): string {
  return `ownflow closing v1 mint=${heiMint}`;
}

/**
 * Closing: the partner pays the homeowner the net cash C, once (the closing memo names
 * the HEI, and its once-only marker comes from that memo).
 * SIMULATED: the partner's own funds, minted as test dollars in the same transaction.
 */
export async function payAtClosing(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  token: PaymentToken,
  homeowner: Address,
  amountMicroUsd: bigint,
  heiMint: Address,
): Promise<{ signature: Signature; alreadyPaid: boolean }> {
  return payOnce(rpc, issuer, { token, to: homeowner, amountMicroUsd, memo: closingMemo(heiMint) });
}

type Purchase = {
  issuer: TransactionSigner; // owns the treasury and receives the money
  buyer: TransactionSigner;
  heiMint: Address;
  treasury: Address; // the issuer's share account
  token: PaymentToken;
  tokens: bigint;
  priceMicroUsd: bigint;
  /** SIMULATED: mint the buyer's test dollars in the same transaction (the demo investors have none). */
  fundBuyer: boolean;
};

/**
 * One purchase as one transaction: the buyer's dollars go to the issuer and the
 * shares go to the buyer, both or neither. A buyer without KYC has a frozen share
 * account (or none), so the share transfer fails and no money moves.
 */
export async function purchaseInstructions(purchase: Purchase): Promise<Instruction[]> {
  const cost = purchaseCostMicroUsd(purchase.tokens, purchase.priceMicroUsd);
  const funding = purchase.fundBuyer
    ? [
        await openPaymentAccountInstruction(purchase.issuer, purchase.buyer.address, purchase.token),
        await mintTestDollarsInstruction(purchase.token, purchase.issuer, purchase.buyer.address, cost),
      ]
    : [];
  return [
    await openPaymentAccountInstruction(purchase.issuer, purchase.issuer.address, purchase.token),
    ...funding,
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
