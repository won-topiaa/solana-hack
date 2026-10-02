// HEI settlement on devnet (milestone M8). The homeowner pays each holder its share
// of the payout and, in the same transaction, the issuer burns that holder's tokens
// as the mint's permanent delegate (owner, 2026-10-02). A holder is never burned
// without being paid, and a burned holder cannot be paid twice.
// Delegate: https://solana.com/docs/tokens/extensions/permanent-delegate

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getBurnCheckedInstruction } from "@solana-program/token-2022";
import { splitPayout, sumMicroUsd, type PayoutShare } from "../calc/sale";
import { openPaymentAccountInstruction, paymentAccount, paymentBalance, paymentInstruction, type PaymentToken } from "./payment";
import { readSupply, readTokenAccount, sendInstructions, type DevnetRpc } from "./solana";

/** A share account with its owner and balance. */
export type ShareHolding = { account: Address; owner: Address; tokens: bigint };
export type HolderPayout = ShareHolding & { payoutMicroUsd: bigint };

/** Holders in one transaction: each adds a payment and a burn. A test checks a full batch fits. */
export const HOLDERS_PER_TRANSACTION = 4;

/**
 * Balances of the share accounts the issuer opened (its treasury and the KYC-approved
 * investors). New accounts start frozen, so no other account can hold shares; the
 * settlement still checks this against the on-chain supply before paying anyone.
 */
export async function readHoldings(rpc: DevnetRpc, register: Address[]): Promise<ShareHolding[]> {
  const holdings: ShareHolding[] = [];
  for (const account of new Set(register)) {
    const state = await readTokenAccount(rpc, account);
    if (state && BigInt(state.amount) > BigInt(0)) holdings.push({ account, owner: state.owner, tokens: BigInt(state.amount) });
  }
  return holdings;
}

/** Each holder's share of the payout, by the pro-rata rule in lib/calc/sale.ts. */
export function payoutsFor(payoutMicroUsd: bigint, holdings: ShareHolding[], tokenSupply: bigint): HolderPayout[] {
  const byAccount = new Map(holdings.map((holding) => [holding.account as string, holding]));
  const shares: PayoutShare[] = splitPayout(payoutMicroUsd, holdings.map((holding) => ({ id: holding.account, tokens: holding.tokens })), tokenSupply);
  return shares.flatMap((share) => {
    const holding = byAccount.get(share.id);
    return holding ? [{ ...holding, payoutMicroUsd: share.payoutMicroUsd }] : [];
  });
}

/** One settlement transaction for up to HOLDERS_PER_TRANSACTION holders. */
export async function settlementInstructions(input: {
  homeowner: TransactionSigner;
  issuer: TransactionSigner; // the permanent delegate
  heiMint: Address;
  token: PaymentToken;
  payouts: HolderPayout[];
  memo: string;
}): Promise<Instruction[]> {
  const steps: Instruction[] = [getAddMemoInstruction({ memo: input.memo })];
  for (const payout of input.payouts) {
    steps.push(await paymentInstruction(input.token, input.homeowner, payout.owner, payout.payoutMicroUsd));
    steps.push(getBurnCheckedInstruction({ account: payout.account, mint: input.heiMint, authority: input.issuer, amount: payout.tokens, decimals: 0 }));
  }
  return steps;
}

export type SettlementRun = { payouts: HolderPayout[]; paidMicroUsd: bigint; signatures: Signature[] };

/**
 * Settles every holder in the register. `tokenSupply` is the supply issued (N), so the
 * price per token stays the same if an earlier run stopped half-way. `memo` describes
 * the settlement (no personal data); each transaction carries it with its batch number.
 */
export async function settleHeiShares(
  rpc: DevnetRpc,
  input: {
    homeowner: KeyPairSigner;
    issuer: KeyPairSigner;
    heiMint: Address;
    token: PaymentToken;
    register: Address[];
    payoutMicroUsd: bigint;
    tokenSupply: bigint;
    memo: string;
  },
): Promise<SettlementRun> {
  const holdings = await readHoldings(rpc, input.register);
  const held = holdings.reduce((sum, holding) => sum + holding.tokens, BigInt(0));
  const supply = await readSupply(rpc, input.heiMint);
  if (held !== supply) {
    throw new Error(`The register holds ${held} shares but ${supply} exist: some holder is missing, so nobody was paid`);
  }
  const payouts = payoutsFor(input.payoutMicroUsd, holdings, input.tokenSupply);
  const paid = sumMicroUsd(payouts.map((payout) => payout.payoutMicroUsd));
  const balance = await paymentBalance(rpc, input.token, input.homeowner.address);
  if (balance < paid) throw new Error(`The homeowner has ${balance} micro-dollars but the settlement needs ${paid}`);

  // Holders who never held the payment token need an account to be paid into.
  const signatures: Signature[] = [];
  const unopened: Address[] = [];
  for (const payout of payouts) {
    if (!(await readTokenAccount(rpc, await paymentAccount(payout.owner, input.token)))) unopened.push(payout.owner);
  }
  for (const owners of chunk(unopened, HOLDERS_PER_TRANSACTION)) {
    const opens = await Promise.all(owners.map((owner) => openPaymentAccountInstruction(input.issuer, owner, input.token)));
    signatures.push(await sendInstructions(rpc, input.issuer, opens));
  }

  const batches = chunk(payouts, HOLDERS_PER_TRANSACTION);
  for (const [index, batch] of batches.entries()) {
    const memo = `${input.memo} batch=${index + 1}/${batches.length}`;
    const steps = await settlementInstructions({ homeowner: input.homeowner, issuer: input.issuer, heiMint: input.heiMint, token: input.token, payouts: batch, memo });
    signatures.push(await sendInstructions(rpc, input.issuer, steps));
  }
  return { payouts, paidMicroUsd: paid, signatures };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}
