// The HEI after its shares are issued, on devnet (milestone M8): KYC, the partner's
// payment at closing, the primary sale, and the settlement. Used by scripts/chain-hei.ts
// and by the web app's partner page, so both run the same steps.
// Simulated: the partner (the issuer wallet), KYC, the appraisal, and the homeowner's
// money for the settlement. Payments use test dollars with no value.
// Amounts are kept as strings of micro-dollars, so the records stay plain JSON.

import { address, type KeyPairSigner } from "@solana/kit";
import { purchaseCostMicroUsd, sumMicroUsd, tokenPriceMicroUsd, toMicroUsd } from "../calc/sale";
import { homeValueAfterYears, settle } from "../calc/settlement";
import type { HeiTermSheet } from "../recommend/termSheet";
import { buyShares, payAtClosing } from "./heiSale";
import { settleHeiShares } from "./heiSettlement";
import { loadOrCreateTestDollar, mintTestDollars, paymentBalance } from "./payment";
import { allowlistInvestor, openFrozenAccount, readSupply, readTokenAccount, transactionLogs, type DevnetRpc } from "./solana";

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
  kyc: { name: string; owner: string; account: string; signature: string }[];
  frozenAccount: string; // the buyer without KYC
  rejected: { tokens: string; reason: string; moneyMoved: boolean };
  purchases: { name: string; owner: string; tokens: string; costMicroUsd: string; signature: string }[];
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

/**
 * KYC, closing and the primary sale. The partner pays the homeowner first (owner,
 * 2026-10-02), then sells; a buyer without KYC is refused on-chain.
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
  if ((await readTokenAccount(rpc, treasury))?.amount !== String(supply)) {
    throw new Error("The treasury does not hold the whole supply: the sale already ran or the shares were not issued");
  }

  // KYC (simulated): open and thaw the approved investors' accounts; the other stays frozen.
  const kyc: SaleRecord["kyc"] = [];
  for (const investor of wallets.investors) {
    const opened = await allowlistInvestor(rpc, issuer, heiMint, investor.wallet.address);
    kyc.push({ name: investor.name, owner: investor.wallet.address, account: opened.account, signature: opened.signature });
  }
  const frozen = await openFrozenAccount(rpc, issuer, heiMint, noKyc.address);

  // Test dollars: the partner's money for closing and each buyer's money.
  const token = await loadOrCreateTestDollar(rpc, issuer);
  const netCash = toMicroUsd(input.deal.netCashUsd);
  const amounts = allocation(supply, wallets.investors.length);
  await mintTestDollars(rpc, issuer, token, issuer.address, netCash);
  for (const [index, investor] of wallets.investors.entries()) {
    if (amounts[index] > BigInt(0)) await mintTestDollars(rpc, issuer, token, investor.wallet.address, purchaseCostMicroUsd(amounts[index], price));
  }
  await mintTestDollars(rpc, issuer, token, noKyc.address, purchaseCostMicroUsd(REJECTED_TOKENS, price));

  // Closing: the partner pays the homeowner the net cash.
  const before = await paymentBalance(rpc, token, homeowner.address);
  const closing = await payAtClosing(rpc, issuer, token, homeowner.address, netCash);
  if ((await paymentBalance(rpc, token, homeowner.address)) - before !== netCash) throw new Error("The homeowner did not receive the net cash");

  // The buyer without KYC first, while the treasury still has shares, so only KYC can stop it.
  const rejectedBefore = await paymentBalance(rpc, token, noKyc.address);
  let reason = "";
  try {
    await buyShares(rpc, issuer, { issuer, buyer: noKyc, heiMint, treasury, token, tokens: REJECTED_TOKENS, priceMicroUsd: price });
  } catch (error) {
    if (!transactionLogs(error).some((line) => line.includes("Account is frozen"))) throw error;
    reason = "Account is frozen";
  }
  if (!reason) throw new Error("A buyer without KYC received shares");
  const moneyMoved = (await paymentBalance(rpc, token, noKyc.address)) !== rejectedBefore;
  if (moneyMoved) throw new Error("Money moved in a rejected purchase");

  const purchases: SaleRecord["purchases"] = [];
  for (const [index, investor] of wallets.investors.entries()) {
    if (amounts[index] === BigInt(0)) continue;
    const bought = await buyShares(rpc, issuer, { issuer, buyer: investor.wallet, heiMint, treasury, token, tokens: amounts[index], priceMicroUsd: price });
    purchases.push({ name: investor.name, owner: investor.wallet.address, tokens: String(amounts[index]), costMicroUsd: String(bought.costMicroUsd), signature: bought.signature });
  }

  return {
    paymentMint: token.mint,
    closing: { amountMicroUsd: String(netCash), signature: closing },
    kyc,
    frozenAccount: frozen.account,
    rejected: { tokens: String(REJECTED_TOKENS), reason, moneyMoved },
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
  const memo = `rwa-liquidity-agent settlement v1 mint=${heiMint} trigger=${trigger} years=${years} value=${homeValueUsd.toFixed(2)} payout=${payout} registry=${deal.registryVersion}`;
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
