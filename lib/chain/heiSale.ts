// HEI primary sale on devnet (milestone M8). Funding model (owner, 2026-10-02): the
// partner pays the homeowner at closing from its own money, then sells the share
// tokens to KYC-approved investors, the way HEI companies fund first and sell later.
// The partner is simulated by the issuer wallet.

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferCheckedInstruction } from "@solana-program/token-2022";
import { purchaseCostMicroUsd } from "../calc/sale";
import { mintTestDollarsInstruction, openPaymentAccountInstruction, paymentInstruction, type PaymentToken } from "./payment";
import { accountExists, oldestSignatures, onceMarker, onceMarkerInstruction, sendInstructions, tokenAccount, type DevnetRpc } from "./solana";
import { changeFor, readParsedTransaction } from "./userWallet";

/** The memo on a closing payment: it names the HEI, for anyone reading the transaction. */
function closingMemo(heiMint: Address): string {
  return `ownflow closing v1 mint=${heiMint}`;
}

/**
 * The earlier closing payment of this HEI, found through its once-only marker, and
 * checked: it must carry this HEI's closing memo and have paid this homeowner the amount.
 * Anything else at the marker (someone sent it lamports, or another case's homeowner was
 * paid) is refused rather than taken as paid.
 */
async function earlierClosing(rpc: DevnetRpc, marker: Address, expected: { heiMint: Address; homeowner: Address; token: PaymentToken; amountMicroUsd: bigint }): Promise<Signature | null> {
  if (!(await accountExists(rpc, marker))) return null;
  const [signature] = await oldestSignatures(rpc, marker, 1);
  if (!signature) throw new Error(`The closing marker ${marker} exists but its transaction was not found; try again in a minute`);
  const parsed = await readParsedTransaction(rpc, signature);
  if (!parsed.memos.includes(closingMemo(expected.heiMint)) || changeFor(parsed, expected.token.mint, expected.homeowner) !== expected.amountMicroUsd) {
    throw new Error(`This HEI's closing marker belongs to transaction ${signature}, which did not pay this homeowner the closing amount; nothing more was paid`);
  }
  return signature;
}

/**
 * Closing: the partner pays the homeowner the net cash C, once. The payment creates a
 * marker account only the issuer can create, so a second payment for the same HEI fails
 * on-chain; a retry finds the first payment through the marker and returns it.
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
  const marker = await onceMarker(issuer, closingMemo(heiMint));
  const expected = { heiMint, homeowner, token, amountMicroUsd };
  const earlier = await earlierClosing(rpc, marker.address, expected);
  if (earlier) return { signature: earlier, alreadyPaid: true };
  try {
    const signature = await sendInstructions(rpc, issuer, [
      getAddMemoInstruction({ memo: closingMemo(heiMint) }),
      await onceMarkerInstruction(rpc, issuer, marker),
      await openPaymentAccountInstruction(issuer, issuer.address, token),
      await mintTestDollarsInstruction(token, issuer, issuer.address, amountMicroUsd),
      await openPaymentAccountInstruction(issuer, homeowner, token),
      await paymentInstruction(token, issuer, homeowner, amountMicroUsd),
    ]);
    return { signature, alreadyPaid: false };
  } catch (error) {
    // Another run may have paid at the same moment: then its payment is the closing.
    const paid = await earlierClosing(rpc, marker.address, expected).catch(() => null);
    if (paid) return { signature: paid, alreadyPaid: true };
    throw error;
  }
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
