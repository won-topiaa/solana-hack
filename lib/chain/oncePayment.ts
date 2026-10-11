// A payment from a simulated partner that can happen only once: the HEI's closing
// payment and a watch loan's payout. Its transaction creates a marker account only the
// issuer can create, so a second payment fails on-chain; a retry finds the first
// payment through the marker and returns it instead of paying again.

import type { Address, KeyPairSigner, Signature } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { mintTestDollarsInstruction, openPaymentAccountInstruction, paymentInstruction, type PaymentToken } from "./payment";
import { accountExists, oldestSignatures, onceMarker, onceMarkerInstruction, sendInstructions, type DevnetRpc } from "./solana";
import { changeFor, readParsedTransaction } from "./userWallet";

type OncePayment = { token: PaymentToken; to: Address; amountMicroUsd: bigint; memo: string };

/**
 * The earlier payment, found through the once-only marker, and checked: it must carry
 * this memo and have paid this recipient the amount. Anything else at the marker
 * (someone sent it lamports, or another case's recipient was paid) is refused rather
 * than taken as paid.
 */
async function earlierPayment(rpc: DevnetRpc, marker: Address, expected: OncePayment): Promise<Signature | null> {
  if (!(await accountExists(rpc, marker))) return null;
  const [signature] = await oldestSignatures(rpc, marker, 1);
  if (!signature) throw new Error(`The payment marker ${marker} exists but its transaction was not found; try again in a minute`);
  const parsed = await readParsedTransaction(rpc, signature);
  if (!parsed.memos.includes(expected.memo) || changeFor(parsed, expected.token.mint, expected.to) !== expected.amountMicroUsd) {
    throw new Error(`This payment's marker belongs to transaction ${signature}, which did not pay this recipient the amount; nothing more was paid`);
  }
  return signature;
}

/**
 * Pays `to` once, with the memo naming what the payment is for (the marker comes from
 * the memo too). SIMULATED: the partner's own funds, minted as test dollars in the same
 * transaction.
 */
export async function payOnce(rpc: DevnetRpc, issuer: KeyPairSigner, payment: OncePayment): Promise<{ signature: Signature; alreadyPaid: boolean }> {
  const marker = await onceMarker(issuer, payment.memo);
  const earlier = await earlierPayment(rpc, marker.address, payment);
  if (earlier) return { signature: earlier, alreadyPaid: true };
  try {
    const signature = await sendInstructions(rpc, issuer, [
      getAddMemoInstruction({ memo: payment.memo }),
      await onceMarkerInstruction(rpc, issuer, marker),
      await openPaymentAccountInstruction(issuer, issuer.address, payment.token),
      await mintTestDollarsInstruction(payment.token, issuer, issuer.address, payment.amountMicroUsd),
      await openPaymentAccountInstruction(issuer, payment.to, payment.token),
      await paymentInstruction(payment.token, issuer, payment.to, payment.amountMicroUsd),
    ]);
    return { signature, alreadyPaid: false };
  } catch (error) {
    // Another run may have paid at the same moment: then its payment is the one.
    const paid = await earlierPayment(rpc, marker.address, payment).catch(() => null);
    if (paid) return { signature: paid, alreadyPaid: true };
    throw error;
  }
}
