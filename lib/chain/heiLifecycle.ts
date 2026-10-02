// The HEI after its shares are issued, on devnet (milestone M8): KYC, the partner's
// payment at closing, the primary sale, and the settlement. Used by scripts/chain-hei.ts
// and by the web app's partner page, so both run the same steps.
// Simulated: the partner (the issuer wallet), KYC, the appraisal, and the homeowner's
// money for the settlement. Payments use test dollars with no value.
// Amounts are kept as strings of micro-dollars, so the records stay plain JSON.

import { address, type Address, type KeyPairSigner } from "@solana/kit";
import { purchaseCostMicroUsd, sumMicroUsd, tokenPriceMicroUsd, toMicroUsd } from "../calc/sale";
import { homeValueAfterYears, settle } from "../calc/settlement";
import type { HeiTermSheet } from "../recommend/termSheet";
import { buyShares, payAtClosing } from "./heiSale";
import { settleHeiShares } from "./heiSettlement";
import { loadOrCreateTestDollar, mintTestDollars, paymentBalance, type PaymentToken } from "./payment";
import { allowlistInvestor, openFrozenAccount, readSupply, readTokenAccount, requireFunds, transactionLogs, type DevnetRpc } from "./solana";

/** What the sale and the settlement need from the term sheet. */
export type HeiDeal = Pick<
  HeiTermSheet,
  "homeValueUsd" | "netCashUsd" | "grossInvestmentUsd" | "tokenPriceUsd" | "tokenSupply" | "investorReturnCapPerYear" | "termYears" | "registryVersion"
>;

export type HeiWallets = {
  issuer: KeyPairSigner; // plays the partner (issuer and its treasury)
  homeowner: KeyPairSigner;
  investors: { name: string; wallet: KeyPairSigner }[]; // KYC-approved buyers, in buying order
  noKyc: KeyPairSigner; // tries to buy and must be refused
};

export type SaleRecord = {
  paymentMint: string;
  closing: { amountMicroUsd: string; signature: string };
  kyc: { name: string; owner: string; account: string; signature: string | null }[]; // null: already open
  frozenAccount: string; // the buyer without KYC
  rejected: { tokens: string; reason: string; moneyMoved: boolean };
  purchases: { name: string; owner: string; tokens: string; costMicroUsd: string; signature: string | null }[]; // null: bought in an earlier, interrupted run
  raisedMicroUsd: string;
  register: string[]; // the share accounts the issuer opened: only these can hold shares
  at: string;
};

export type SettlementRecord = {
  trigger: "buyback" | "maturity";
  years: number;
  growth: number;
  homeValueUsd: number; // the (simulated) appraisal
  payoutMicroUsd: string;
  uncappedPayoutUsd: number;
  capApplied: boolean;
  ownerAnnualCost: number;
  topUpMicroUsd: string; // SIMULATED: money added to the homeowner's wallet to pay
  payouts: { owner: string; tokens: string; payoutMicroUsd: string; receivedMicroUsd: string }[];
  paidMicroUsd: string;
  supplyLeft: string;
  correct: boolean; // every holder got its share and every share is burned
  signatures: string[];
  memo: string;
  at: string;
};

/** The first investor buys up to this many shares; the next buys the rest. */
const FIRST_INVESTOR_TOKENS = BigInt(150_000);
/** What the buyer without KYC tries to buy. */
const REJECTED_TOKENS = BigInt(10_000);

/** How the shares are split among the KYC-approved investors, in buying order. */
export function allocation(supply: bigint, investorCount: number): bigint[] {
  if (investorCount < 1) throw new RangeError("At least one investor is needed");
  if (investorCount === 1 || supply <= FIRST_INVESTOR_TOKENS) return [supply, ...Array<bigint>(investorCount - 1).fill(BigInt(0))];
  return [FIRST_INVESTOR_TOKENS, supply - FIRST_INVESTOR_TOKENS, ...Array<bigint>(investorCount - 2).fill(BigInt(0))];
}

/** Shares still to buy for an investor who may already hold some from an earlier, interrupted run. */
export function sharesToBuy(allocated: bigint, alreadyHeld: bigint): bigint {
  return alreadyHeld >= allocated ? BigInt(0) : allocated - alreadyHeld;
}

/** Mints test dollars only up to what the wallet needs, so a retry does not mint again. */
async function topUp(rpc: DevnetRpc, wallets: HeiWallets, token: PaymentToken, owner: Address, needed: bigint): Promise<void> {
  const balance = await paymentBalance(rpc, token, owner);
  if (balance < needed) await mintTestDollars(rpc, wallets.issuer, token, owner, needed - balance);
}

/**
 * KYC, closing and the primary sale. The partner pays the homeowner first (owner,
 * 2026-10-02), then sells; a buyer without KYC is refused on-chain. Safe to run again
 * after an interruption: each step looks at the chain first and skips what is done
 * (open KYC accounts, the closing payment's memo, shares an investor already holds).
 */
export async function runPrimarySale(
  rpc: DevnetRpc,
  wallets: HeiWallets,
  input: { heiMint: string; treasury: string; deal: HeiDeal },
  now: () => Date = () => new Date(),
): Promise<SaleRecord> {
  const { issuer, homeowner, noKyc } = wallets;
  const heiMint = address(input.heiMint);
  const treasury = address(input.treasury);
  const price = tokenPriceMicroUsd(input.deal.tokenPriceUsd);
  const supply = BigInt(input.deal.tokenSupply);
  const amounts = allocation(supply, wallets.investors.length);
  await requireFunds(rpc, issuer.address);

  // KYC (simulated): open and thaw the approved investors' accounts; the other stays frozen.
  const kyc: SaleRecord["kyc"] = [];
  for (const investor of wallets.investors) {
    const opened = await allowlistInvestor(rpc, issuer, heiMint, investor.wallet.address);
    kyc.push({ name: investor.name, owner: investor.wallet.address, account: opened.account, signature: opened.signature });
  }
  const frozen = await openFrozenAccount(rpc, issuer, heiMint, noKyc.address);

  // Where the sale stands: shares the investors already hold must be all that left the treasury.
  const held = await Promise.all(kyc.map(async (item) => BigInt((await readTokenAccount(rpc, address(item.account)))?.amount ?? "0")));
  const inTreasury = BigInt((await readTokenAccount(rpc, treasury))?.amount ?? "0");
  if (inTreasury + held.reduce((sum, amount) => sum + amount, BigInt(0)) !== supply) {
    throw new Error("The shares are not where the sale left them: the treasury and the investors do not add up to the supply");
  }

  // Test dollars: the partner's money for closing and each buyer's money (only what is missing).
  const token = await loadOrCreateTestDollar(rpc, issuer);
  const netCash = toMicroUsd(input.deal.netCashUsd);
  const toBuy = amounts.map((amount, index) => sharesToBuy(amount, held[index]));
  await topUp(rpc, wallets, token, issuer.address, netCash);
  for (const [index, investor] of wallets.investors.entries()) {
    if (toBuy[index] > BigInt(0)) await topUp(rpc, wallets, token, investor.wallet.address, purchaseCostMicroUsd(toBuy[index], price));
  }

  // Closing: the partner pays the homeowner the net cash, once.
  const closing = await payAtClosing(rpc, issuer, token, homeowner.address, netCash, heiMint);

  // The buyer without KYC, while the treasury still has shares, so only KYC can stop it.
  let rejected: SaleRecord["rejected"];
  if (inTreasury >= REJECTED_TOKENS) {
    await topUp(rpc, wallets, token, noKyc.address, purchaseCostMicroUsd(REJECTED_TOKENS, price));
    const before = await paymentBalance(rpc, token, noKyc.address);
    let reason = "";
    try {
      await buyShares(rpc, issuer, { issuer, buyer: noKyc, heiMint, treasury, token, tokens: REJECTED_TOKENS, priceMicroUsd: price });
    } catch (error) {
      if (!transactionLogs(error).some((line) => line.includes("Account is frozen"))) throw error;
      reason = "Account is frozen";
    }
    if (!reason) throw new Error("A buyer without KYC received shares");
    const moneyMoved = (await paymentBalance(rpc, token, noKyc.address)) !== before;
    if (moneyMoved) throw new Error("Money moved in a rejected purchase");
    rejected = { tokens: String(REJECTED_TOKENS), reason, moneyMoved };
  } else {
    rejected = { tokens: String(REJECTED_TOKENS), reason: "Not tried again: the shares were already sold", moneyMoved: false };
  }

  const purchases: SaleRecord["purchases"] = [];
  for (const [index, investor] of wallets.investors.entries()) {
    if (amounts[index] === BigInt(0)) continue;
    let signature: string | null = null;
    if (toBuy[index] > BigInt(0)) {
      const bought = await buyShares(rpc, issuer, { issuer, buyer: investor.wallet, heiMint, treasury, token, tokens: toBuy[index], priceMicroUsd: price });
      signature = bought.signature;
    }
    purchases.push({
      name: investor.name,
      owner: investor.wallet.address,
      tokens: String(amounts[index]),
      costMicroUsd: String(purchaseCostMicroUsd(amounts[index], price)),
      signature,
    });
  }

  return {
    paymentMint: token.mint,
    closing: { amountMicroUsd: String(netCash), signature: closing.signature },
    kyc,
    frozenAccount: frozen.account,
    rejected,
    purchases,
    raisedMicroUsd: String(sumMicroUsd(purchases.map((purchase) => BigInt(purchase.costMicroUsd)))),
    register: [treasury, ...kyc.map((item) => item.account)],
    at: now().toISOString(),
  };
}

/**
 * Settlement after `years` (buyback, or maturity at the end of the term) with the home
 * valued by a simulated appraisal at `growth` a year. Pays every holder and burns its
 * shares in the same transaction, then reads the balances back.
 */
export async function runSettlement(
  rpc: DevnetRpc,
  wallets: HeiWallets,
  input: { heiMint: string; deal: HeiDeal; sale: SaleRecord; years: number; growth: number },
  now: () => Date = () => new Date(),
): Promise<SettlementRecord> {
  const { issuer, homeowner } = wallets;
  const { deal, years, growth } = input;
  if (!(years > 0 && years <= deal.termYears)) throw new RangeError(`Settle after more than 0 and at most ${deal.termYears} years`);
  const heiMint = address(input.heiMint);
  await requireFunds(rpc, issuer.address);
  const token = await loadOrCreateTestDollar(rpc, issuer);
  if (token.mint !== input.sale.paymentMint) throw new Error("The test dollar changed since the sale");

  const homeValueUsd = homeValueAfterYears(deal.homeValueUsd, growth, years);
  const result = settle({
    grossInvestmentUsd: deal.grossInvestmentUsd,
    tokenSupply: deal.tokenSupply,
    netCashUsd: deal.netCashUsd,
    investorReturnCap: deal.investorReturnCapPerYear,
    years,
    homeValueAtSettlementUsd: homeValueUsd,
  });
  const payout = toMicroUsd(result.payoutUsd);
  const trigger = years >= deal.termYears ? "maturity" : "buyback";

  // SIMULATED: the homeowner's money for the payout (savings, refinancing or a sale).
  const balance = await paymentBalance(rpc, token, homeowner.address);
  const topUp = balance < payout ? payout - balance : BigInt(0);
  if (topUp > BigInt(0)) await mintTestDollars(rpc, issuer, token, homeowner.address, topUp);

  const owners = input.sale.purchases.map((purchase) => address(purchase.owner));
  const before = await Promise.all(owners.map((owner) => paymentBalance(rpc, token, owner)));
  const memo = `ownflow settlement v1 mint=${heiMint} trigger=${trigger} years=${years} value=${homeValueUsd.toFixed(2)} payout=${payout} registry=${deal.registryVersion}`;
  const run = await settleHeiShares(rpc, {
    homeowner,
    issuer,
    heiMint,
    token,
    register: input.sale.register.map((account) => address(account)),
    payoutMicroUsd: payout,
    tokenSupply: BigInt(deal.tokenSupply),
    memo,
  });

  // Read back: each holder's dollars went up by its share, and no shares are left.
  const payouts: SettlementRecord["payouts"] = [];
  let correct = true;
  for (const [index, owner] of owners.entries()) {
    const expected = run.payouts.find((item) => item.owner === owner);
    const received = (await paymentBalance(rpc, token, owner)) - before[index];
    correct &&= received === (expected?.payoutMicroUsd ?? BigInt(0));
    payouts.push({ owner, tokens: String(expected?.tokens ?? BigInt(0)), payoutMicroUsd: String(expected?.payoutMicroUsd ?? BigInt(0)), receivedMicroUsd: String(received) });
  }
  const supplyLeft = await readSupply(rpc, heiMint);
  correct &&= supplyLeft === BigInt(0);

  return {
    trigger,
    years,
    growth,
    homeValueUsd,
    payoutMicroUsd: String(payout),
    uncappedPayoutUsd: result.uncappedPayoutUsd,
    capApplied: result.capApplied,
    ownerAnnualCost: result.ownerAnnualCost,
    topUpMicroUsd: String(topUp),
    payouts,
    paidMicroUsd: String(run.paidMicroUsd),
    supplyLeft: String(supplyLeft),
    correct,
    signatures: run.signatures,
    memo,
    at: now().toISOString(),
  };
}
