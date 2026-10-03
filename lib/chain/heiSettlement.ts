// HEI settlement on devnet (milestone M8; Phantom, 2026-10-02). The homeowner pays the
// payout once into this HEI's own settlement account; then, for each holder, one
// transaction pays the holder its share from that account and burns its tokens, the
// issuer acting as the mint's permanent delegate (owner, 2026-10-02). A holder is never
// burned without being paid, and a burned holder cannot be paid twice.
// The settlement account belongs to a keypair the issuer derives for this HEI, so only
// the issuer (the simulated partner, as servicer) can pay out of it, and nothing else
// ever goes in or out: its balance tells whether the homeowner has paid.
// Delegate: https://solana.com/docs/tokens/extensions/permanent-delegate

import type { Address, Instruction, KeyPairSigner, Signature, TransactionSigner } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getBurnCheckedInstruction } from "@solana-program/token-2022";
import { splitPayout, sumMicroUsd, type PayoutShare } from "../calc/sale";
import { mintTestDollarsInstruction, openPaymentAccountInstruction, paymentAccount, paymentBalance, paymentInstruction, type PaymentToken } from "./payment";
import { issuerDerivedSigner, readSupply, readTokenAccount, sendInstructions, type DevnetRpc } from "./solana";

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

/** The servicer of one HEI: holds the homeowner's payment until it is paid out to the holders. */
export async function servicerFor(issuer: KeyPairSigner, heiMint: Address): Promise<KeyPairSigner> {
  return issuerDerivedSigner(issuer, `ownflow hei servicer v1 mint=${heiMint}`);
}

/** The memo on the homeowner's payment (no personal data). */
export function homeownerPaymentMemo(heiMint: Address, amountMicroUsd: bigint): string {
  return `ownflow settlement payment v1 mint=${heiMint} amount=${amountMicroUsd}`;
}

/**
 * The homeowner's payment into the settlement account. With `fundFrom` the homeowner's
 * money is minted first in the same transaction (SIMULATED: savings, refinancing or a sale).
 */
export async function homeownerPaymentInstructions(input: {
  homeowner: TransactionSigner;
  servicer: Address;
  token: PaymentToken;
  amountMicroUsd: bigint;
  memo: string;
  fundFrom?: TransactionSigner; // the test dollar's mint authority (the issuer)
}): Promise<Instruction[]> {
  const funding = input.fundFrom
    ? [
        await openPaymentAccountInstruction(input.fundFrom, input.homeowner.address, input.token),
        await mintTestDollarsInstruction(input.token, input.fundFrom, input.homeowner.address, input.amountMicroUsd),
      ]
    : [];
  return [getAddMemoInstruction({ memo: input.memo }), ...funding, await paymentInstruction(input.token, input.homeowner, input.servicer, input.amountMicroUsd)];
}

/** One payout transaction for up to HOLDERS_PER_TRANSACTION holders: pay from the settlement account, burn. */
export async function settlementInstructions(input: {
  servicer: TransactionSigner; // owns the settlement account
  issuer: TransactionSigner; // the permanent delegate
  heiMint: Address;
  token: PaymentToken;
  payouts: HolderPayout[];
  memo: string;
}): Promise<Instruction[]> {
  const steps: Instruction[] = [getAddMemoInstruction({ memo: input.memo })];
  for (const payout of input.payouts) {
    steps.push(await paymentInstruction(input.token, input.servicer, payout.owner, payout.payoutMicroUsd));
    steps.push(getBurnCheckedInstruction({ account: payout.account, mint: input.heiMint, authority: input.issuer, amount: payout.tokens, decimals: 0 }));
  }
  return steps;
}

/** What the settlement will pay: each current holder's share, and their sum (what the homeowner pays). */
export type SettlementPlan = { payouts: HolderPayout[]; paidMicroUsd: bigint };

/**
 * Reads the holders and checks them before anyone pays: the shares must not be burned
 * already, and the register must hold the whole on-chain supply. `tokenSupply` is the
 * supply issued (N), so the price per token stays the same if an earlier run stopped
 * half-way.
 */
export async function planSettlement(
  rpc: DevnetRpc,
  input: { heiMint: Address; register: Address[]; payoutMicroUsd: bigint; tokenSupply: bigint },
): Promise<SettlementPlan> {
  const supply = await readSupply(rpc, input.heiMint);
  // Every share burned: an earlier run settled this HEI. Paying "nobody" again must not look like a settlement.
  if (supply === BigInt(0)) throw new Error("This HEI is already settled on-chain: every share is burned");
  const holdings = await readHoldings(rpc, input.register);
  const held = holdings.reduce((sum, holding) => sum + holding.tokens, BigInt(0));
  if (held !== supply) {
    throw new Error(`The register holds ${held} shares but ${supply} exist: some holder is missing, so nobody was paid`);
  }
  const payouts = payoutsFor(input.payoutMicroUsd, holdings, input.tokenSupply);
  return { payouts, paidMicroUsd: sumMicroUsd(payouts.map((payout) => payout.payoutMicroUsd)) };
}

/** `batches` are the transactions that paid and burned; `signatures` also has the account openings before them. */
export type SettlementRun = { payouts: HolderPayout[]; paidMicroUsd: bigint; signatures: Signature[]; batches: Signature[] };

/**
 * Pays every holder from the settlement account and burns its shares. Refuses before
 * paying anyone unless the plan still holds and the homeowner's payment is in the
 * settlement account. `memo` describes the settlement (no personal data); each
 * transaction carries it with its batch number.
 */
export async function settleHeiShares(
  rpc: DevnetRpc,
  input: {
    issuer: KeyPairSigner;
    heiMint: Address;
    token: PaymentToken;
    register: Address[];
    payoutMicroUsd: bigint;
    tokenSupply: bigint;
    memo: string;
    /** SIMULATED: the rest of the homeowner's money, minted into the settlement account in the first payout transaction. */
    topUpMicroUsd?: bigint;
  },
): Promise<SettlementRun> {
  const plan = await planSettlement(rpc, input);
  const servicer = await servicerFor(input.issuer, input.heiMint);
  const topUp = input.topUpMicroUsd ?? BigInt(0);
  const balance = await paymentBalance(rpc, input.token, servicer.address);
  if (balance + topUp < plan.paidMicroUsd) {
    throw new Error(`The settlement account has ${balance} micro-dollars but the holders are owed ${plan.paidMicroUsd}: the homeowner's payment has not arrived`);
  }

  // Holders who never held the payment token need an account to be paid into.
  const signatures: Signature[] = [];
  const unopened: Address[] = [];
  for (const payout of plan.payouts) {
    if (!(await readTokenAccount(rpc, await paymentAccount(payout.owner, input.token)))) unopened.push(payout.owner);
  }
  for (const owners of chunk(unopened, HOLDERS_PER_TRANSACTION)) {
    const opens = await Promise.all(owners.map((owner) => openPaymentAccountInstruction(input.issuer, owner, input.token)));
    signatures.push(await sendInstructions(rpc, input.issuer, opens));
  }

  const batches = chunk(plan.payouts, HOLDERS_PER_TRANSACTION);
  const sent: Signature[] = [];
  for (const [index, batch] of batches.entries()) {
    const memo = `${input.memo} batch=${index + 1}/${batches.length}`;
    const steps = await settlementInstructions({ servicer, issuer: input.issuer, heiMint: input.heiMint, token: input.token, payouts: batch, memo });
    // The simulated rest of the homeowner's money arrives with the first payouts, never on its own.
    const funding = index === 0 && topUp > BigInt(0) ? [await mintTestDollarsInstruction(input.token, input.issuer, servicer.address, topUp)] : [];
    sent.push(await sendInstructions(rpc, input.issuer, [...funding, ...steps]));
  }
  return { payouts: plan.payouts, paidMicroUsd: plan.paidMicroUsd, signatures: [...signatures, ...sent], batches: sent };
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
