// HEI settlement on devnet (milestone M8). The homeowner pays each holder its share
// of the payout and, in the same transaction, the issuer burns that holder's tokens
// as the mint's permanent delegate (owner, 2026-10-02). A holder is never burned
// without being paid, and a burned holder cannot be paid twice.
// Delegate: https://solana.com/docs/tokens/extensions/permanent-delegate

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getBurnCheckedInstruction } from "@solana-program/token-2022";
import { splitPayout, sumMicroUsd, type PayoutShare } from "../calc/sale";
import { mintTestDollarsInstruction, openPaymentAccountInstruction, paymentAccount, paymentBalance, paymentInstruction, type PaymentToken } from "./payment";
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

/**
 * One settlement transaction for up to HOLDERS_PER_TRANSACTION holders. With
 * `fundHomeowner` the homeowner's money for this batch is minted first, in the same
 * transaction (SIMULATED: savings, refinancing or a sale).
 */
export async function settlementInstructions(input: {
  homeowner: TransactionSigner;
  issuer: TransactionSigner; // the permanent delegate
  heiMint: Address;
  token: PaymentToken;
  payouts: HolderPayout[];
  memo: string;
  fundHomeowner: boolean;
}): Promise<Instruction[]> {
  const steps: Instruction[] = [getAddMemoInstruction({ memo: input.memo })];
  if (input.fundHomeowner) {
    const batchTotal = sumMicroUsd(input.payouts.map((payout) => payout.payoutMicroUsd));
    steps.push(await mintTestDollarsInstruction(input.token, input.issuer, input.homeowner.address, batchTotal));
  }
  for (const payout of input.payouts) {
    steps.push(await paymentInstruction(input.token, input.homeowner, payout.owner, payout.payoutMicroUsd));
    steps.push(getBurnCheckedInstruction({ account: payout.account, mint: input.heiMint, authority: input.issuer, amount: payout.tokens, decimals: 0 }));
  }
  return steps;
}

/** `batches` are the transactions that paid and burned; `signatures` also has the account openings before them. */
export type SettlementRun = { payouts: HolderPayout[]; paidMicroUsd: bigint; signatures: Signature[]; batches: Signature[] };

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
    fundHomeowner: boolean; // SIMULATED homeowner money, minted in each batch
  },
): Promise<SettlementRun> {
  const supply = await readSupply(rpc, input.heiMint);
  // Every share burned: an earlier run settled this HEI. Paying "nobody" again must not look like a settlement.
  if (supply === BigInt(0)) throw new Error("This HEI is already settled on-chain: every share is burned");
  const holdings = await readHoldings(rpc, input.register);
  const held = holdings.reduce((sum, holding) => sum + holding.tokens, BigInt(0));
  if (held !== supply) {
    throw new Error(`The register holds ${held} shares but ${supply} exist: some holder is missing, so nobody was paid`);
  }
  const payouts = payoutsFor(input.payoutMicroUsd, holdings, input.tokenSupply);
  const paid = sumMicroUsd(payouts.map((payout) => payout.payoutMicroUsd));
  if (!input.fundHomeowner) {
    const balance = await paymentBalance(rpc, input.token, input.homeowner.address);
    if (balance < paid) throw new Error(`The homeowner has ${balance} micro-dollars but the settlement needs ${paid}`);
  }

  // Holders who never held the payment token need an account to be paid into (and the homeowner one to pay from).
  const signatures: Signature[] = [];
  const unopened: Address[] = [];
  for (const owner of [input.homeowner.address, ...payouts.map((payout) => payout.owner)]) {
    if (!(await readTokenAccount(rpc, await paymentAccount(owner, input.token)))) unopened.push(owner);
  }
  for (const owners of chunk(unopened, HOLDERS_PER_TRANSACTION)) {
    const opens = await Promise.all(owners.map((owner) => openPaymentAccountInstruction(input.issuer, owner, input.token)));
    signatures.push(await sendInstructions(rpc, input.issuer, opens));
  }

  const batches = chunk(payouts, HOLDERS_PER_TRANSACTION);
  const sent: Signature[] = [];
  for (const [index, batch] of batches.entries()) {
    const memo = `${input.memo} batch=${index + 1}/${batches.length}`;
    const steps = await settlementInstructions({
      homeowner: input.homeowner,
      issuer: input.issuer,
      heiMint: input.heiMint,
      token: input.token,
      payouts: batch,
      memo,
      fundHomeowner: input.fundHomeowner,
    });
    sent.push(await sendInstructions(rpc, input.issuer, steps));
  }
  return { payouts, paidMicroUsd: paid, signatures: [...signatures, ...sent], batches: sent };
}

/**
 * What each owner received of one token in these transactions, read from the
 * transactions' own balance records (before and after). Other activity on the same
 * wallets (another demo case at the same moment) cannot change the answer.
 */
export async function receivedIn(rpc: DevnetRpc, signatures: Signature[], mint: Address): Promise<Map<string, bigint>> {
  const received = new Map<string, bigint>();
  for (const signature of signatures) {
    const transaction = await rpc
      .getTransaction(signature, { commitment: "confirmed", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 })
      .send();
    const meta = transaction?.meta;
    if (!meta) throw new Error(`Transaction ${signature} could not be read back`);
    const before = new Map((meta.preTokenBalances ?? []).filter((item) => item.mint === mint).map((item) => [item.accountIndex, BigInt(item.uiTokenAmount.amount)]));
    for (const after of (meta.postTokenBalances ?? []).filter((item) => item.mint === mint)) {
      if (!after.owner) continue;
      const change = BigInt(after.uiTokenAmount.amount) - (before.get(after.accountIndex) ?? BigInt(0));
      received.set(after.owner, (received.get(after.owner) ?? BigInt(0)) + change);
    }
  }
  return received;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}
