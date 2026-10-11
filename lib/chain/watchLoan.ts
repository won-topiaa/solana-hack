// A watch loan after its receipt is on-chain, on devnet (owner, 2026-10-11): the lender
// takes the watch in (intake and authentication, simulated), pays the loan, and when the
// borrower repays, gives the watch back (release, simulated). The lender is simulated by
// the issuer wallet; money moves in test dollars with no value. Lenders do not publish
// interest or fees, so the repayment is the loan amount itself and the page says so.
// The borrower is the demo wallet the server holds, or the user's own wallet (Phantom):
// then the loan is paid to it and the user signs the repayment.
// Amounts are kept as strings of micro-dollars, so the records stay plain JSON.

import { address, type KeyPairSigner, type Signature } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { formatMicroUsd } from "../format";
import { payOnce } from "./oncePayment";
import { loadOrCreateTestDollar, mintTestDollarsInstruction, openPaymentAccountInstruction, paymentAccount, paymentBalance, paymentInstruction, type PaymentToken } from "./payment";
import { ensureFeeSol, issuerDerivedSigner, onceMarker, onceMarkerInstruction, readTokenAccount, requireFunds, sendInstructions, type DevnetRpc } from "./solana";
import { buildForWallet, changeFor, changeForAccount, landWalletTransaction, readParsedTransaction, walletStandIn, type SignedByWallet, type UnsignedForWallet } from "./userWallet";

export type WatchLoanRecord = {
  paymentMint: string;
  amountMicroUsd: string;
  termDays: number;
  borrower: string; // the wallet the loan was paid to; it repays
  lenderAccount: string; // the lender's account for this loan: the repayment goes here
  opened: { signature: string; at: string };
  /** A repayment built for the user's wallet to sign, waiting for the signature. */
  repayPending?: { lastValidBlockHeight: string; preparedAt: string };
  repaid?: { signature: string; by: "user wallet" | "demo wallet"; at: string };
};

export type WatchLoanInput = { recommendationHash: string; amountMicroUsd: bigint; termDays: number };

/** The memo on the loan payment (no personal data): which receipt, how much, how long. */
export function watchLoanOpenMemo(input: WatchLoanInput): string {
  return `ownflow watch-loan v1 open rec=${input.recommendationHash} amount=${input.amountMicroUsd} days=${input.termDays} intake=simulated`;
}

/** The memo on the repayment; the watch's release is a partner step, simulated. */
export function watchLoanRepaidMemo(recommendationHash: string, amountMicroUsd: bigint): string {
  return `ownflow watch-loan v1 repaid rec=${recommendationHash} amount=${amountMicroUsd} release=simulated`;
}

/** The lender's key for one loan, derived by the issuer from the receipt, so a retry finds the same account. */
async function lenderFor(issuer: KeyPairSigner, recommendationHash: string): Promise<KeyPairSigner> {
  return issuerDerivedSigner(issuer, `ownflow watch-loan lender v1 rec=${recommendationHash}`);
}

async function testDollar(rpc: DevnetRpc, issuer: KeyPairSigner, record?: WatchLoanRecord): Promise<PaymentToken> {
  const token = await loadOrCreateTestDollar(rpc, issuer);
  if (record && token.mint !== record.paymentMint) throw new Error("The test dollar changed since the loan was paid (devnet reset?); start a new case");
  return token;
}

/**
 * Intake and payout: the lender pays the borrower the loan, once (a retry finds the
 * first payment). SIMULATED: the intake and authentication, and the lender's money,
 * minted as test dollars in the same transaction.
 */
export async function openWatchLoan(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  input: WatchLoanInput & { borrower: string },
  now: () => Date = () => new Date(),
): Promise<WatchLoanRecord> {
  await requireFunds(rpc, issuer.address);
  const token = await testDollar(rpc, issuer);
  const paid = await payOnce(rpc, issuer, { token, to: address(input.borrower), amountMicroUsd: input.amountMicroUsd, memo: watchLoanOpenMemo(input) });
  const lender = await lenderFor(issuer, input.recommendationHash);
  return {
    paymentMint: token.mint,
    amountMicroUsd: String(input.amountMicroUsd),
    termDays: input.termDays,
    borrower: input.borrower,
    lenderAccount: await paymentAccount(lender.address, token),
    opened: { signature: paid.signature, at: now().toISOString() },
  };
}

/**
 * The repayment, when the lender's account for this loan already holds it: found by its
 * memo among the account's latest transactions. null when it is not repaid yet.
 */
async function earlierRepayment(rpc: DevnetRpc, record: WatchLoanRecord, memo: string): Promise<Signature | null> {
  const held = BigInt((await readTokenAccount(rpc, address(record.lenderAccount)))?.amount ?? "0");
  if (held < BigInt(record.amountMicroUsd)) return null;
  const entries = await rpc.getSignaturesForAddress(address(record.lenderAccount), { commitment: "confirmed", limit: 10 }).send();
  for (const entry of entries) {
    if (entry.err !== null) continue;
    if ((await readParsedTransaction(rpc, entry.signature)).memos.includes(memo)) return entry.signature;
  }
  throw new Error(`The lender's account ${record.lenderAccount} holds the repayment but its transaction was not found; try again in a minute`);
}

/**
 * The demo borrower repays the loan into the lender's account, once (a marker made from
 * the memo stops a second payment). SIMULATED: the borrower's money (savings), minted
 * as test dollars in its payment, like the demo homeowner's HEI settlement.
 */
export async function repayFromDemoWallet(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  borrower: KeyPairSigner,
  record: WatchLoanRecord,
  recommendationHash: string,
): Promise<Signature> {
  const amount = BigInt(record.amountMicroUsd);
  const memo = watchLoanRepaidMemo(recommendationHash, amount);
  const earlier = await earlierRepayment(rpc, record, memo);
  if (earlier) return earlier;
  if (borrower.address !== record.borrower) throw new Error("The loan was paid to another wallet; that wallet must repay it");
  await requireFunds(rpc, issuer.address);
  const token = await testDollar(rpc, issuer, record);
  const lender = await lenderFor(issuer, recommendationHash);
  const marker = await onceMarker(issuer, memo);
  try {
    return await sendInstructions(rpc, issuer, [
      getAddMemoInstruction({ memo }),
      await onceMarkerInstruction(rpc, issuer, marker),
      await openPaymentAccountInstruction(issuer, lender.address, token),
      await openPaymentAccountInstruction(issuer, borrower.address, token),
      await mintTestDollarsInstruction(token, issuer, borrower.address, amount),
      await paymentInstruction(token, borrower, lender.address, amount),
    ]);
  } catch (error) {
    // Another run may have repaid at the same moment: then its payment is the repayment.
    const repaid = await earlierRepayment(rpc, record, memo).catch(() => null);
    if (repaid) return repaid;
    throw error;
  }
}

/**
 * With the user's own wallet as the borrower: gives it devnet SOL for the fee once,
 * opens the lender's account, and builds the repayment for the wallet to sign, paid
 * from the test dollars it holds (the loan went to it). null when already repaid.
 */
export async function prepareWalletRepayment(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  record: WatchLoanRecord,
  recommendationHash: string,
): Promise<UnsignedForWallet | null> {
  const amount = BigInt(record.amountMicroUsd);
  const memo = watchLoanRepaidMemo(recommendationHash, amount);
  if (await earlierRepayment(rpc, record, memo)) return null;
  const token = await testDollar(rpc, issuer, record);
  const wallet = address(record.borrower);
  const balance = await paymentBalance(rpc, token, wallet);
  if (balance < amount) {
    throw new Error(`Your wallet holds ${formatMicroUsd(balance)} in test dollars; repaying the loan takes ${formatMicroUsd(amount)} (the loan payment went to it). Nothing was sent`);
  }
  await ensureFeeSol(rpc, issuer, wallet);
  const lender = await lenderFor(issuer, recommendationHash);
  if (!(await readTokenAccount(rpc, address(record.lenderAccount)))) {
    await sendInstructions(rpc, issuer, [await openPaymentAccountInstruction(issuer, lender.address, token)]);
  }
  return buildForWallet(rpc, wallet, [getAddMemoInstruction({ memo }), await paymentInstruction(token, walletStandIn(wallet), lender.address, amount)]);
}

/**
 * Lands the user's signed repayment and checks on-chain that exactly the loan amount left
 * the wallet and arrived in the lender's account for this loan (by its address).
 */
export async function landWalletRepayment(
  rpc: DevnetRpc,
  record: WatchLoanRecord,
  recommendationHash: string,
  signed: SignedByWallet | undefined,
  lastValidBlockHeight?: string,
): Promise<Signature> {
  const amount = BigInt(record.amountMicroUsd);
  const memo = watchLoanRepaidMemo(recommendationHash, amount);
  const earlier = await earlierRepayment(rpc, record, memo);
  if (earlier) return earlier;
  if (!signed) throw new Error("Your wallet has not signed the repayment; nothing was sent");
  const wallet = address(record.borrower);
  const signature = await landWalletTransaction(rpc, signed, wallet, lastValidBlockHeight ? BigInt(lastValidBlockHeight) : undefined);
  const parsed = await readParsedTransaction(rpc, signature);
  const ok =
    parsed.signers.includes(wallet) &&
    parsed.memos.includes(memo) &&
    changeForAccount(parsed, record.lenderAccount) === amount &&
    changeFor(parsed, record.paymentMint, wallet) === -amount;
  if (!ok) throw new Error(`Transaction ${signature} landed but is not the loan repayment that was asked for; check it on the explorer`);
  return signature;
}
