// The HEI after its shares are issued, on devnet (milestone M8): KYC, the partner's
// payment at closing, the primary sale, and the settlement. Used by scripts/chain-hei.ts
// and by the web app's partner page, so both run the same steps.
// The homeowner is either a demo wallet the server holds, or the user's own wallet
// (Phantom): then the closing pays that wallet and the user signs the settlement payment.
// Simulated: the partner (the issuer wallet), KYC, the appraisal, and the homeowner's
// money for the settlement. Payments use test dollars with no value.
// Amounts are kept as strings of micro-dollars, so the records stay plain JSON.

import { address, type Address, type KeyPairSigner } from "@solana/kit";
import { purchaseCostMicroUsd, sumMicroUsd, tokenPriceMicroUsd, toMicroUsd } from "../calc/sale";
import { homeValueAfterYears, settle } from "../calc/settlement";
import type { HeiTermSheet } from "../recommend/termSheet";
import { simulatedIdentity, type IdentityVerifier } from "../integrations/identity";
import { buyShares, payAtClosing } from "./heiSale";
import { attestKyc, checkKycAttestation, kycReference, NO_KYC_ATTESTATION, revokeKyc } from "./kyc";
import { homeownerPaymentInstructions, homeownerPaymentMemo, payoutsFor, planSettlement, receivedIn, servicerFor, settleHeiShares } from "./heiSettlement";
import { loadOrCreateTestDollar, openPaymentAccountInstruction, paymentAccount, paymentBalance, type PaymentToken } from "./payment";
import {
  accountExists,
  allowlistInvestor,
  ensureFeeSol,
  onceMarker,
  onceMarkerInstruction,
  openFrozenAccount,
  readSupply,
  readTokenAccount,
  requireFunds,
  sendInstructions,
  transactionLogs,
  type DevnetRpc,
} from "./solana";
import { buildForWallet, changeFor, changeForAccount, landWalletTransaction, readParsedTransaction, walletStandIn, type SignedByWallet, type UnsignedForWallet } from "./userWallet";

/** What the sale and the settlement need from the term sheet. */
export type HeiDeal = Pick<
  HeiTermSheet,
  "homeValueUsd" | "netCashUsd" | "grossInvestmentUsd" | "tokenPriceUsd" | "tokenSupply" | "investorReturnCapPerYear" | "termYears" | "registryVersion"
>;

export type HeiWallets = {
  issuer: KeyPairSigner; // plays the partner (issuer and its treasury)
  homeowner: KeyPairSigner; // the demo homeowner, when the user has not connected a wallet
  investors: { name: string; wallet: KeyPairSigner }[]; // KYC-approved buyers, in buying order
  noKyc: KeyPairSigner; // tries to buy and must be refused
};

export type SaleRecord = {
  paymentMint: string;
  closing: { amountMicroUsd: string; signature: string };
  kyc: {
    name: string;
    owner: string;
    account: string;
    signature: string | null; // opening the share account; null: already open
    attestation?: string; // the investor's KYC attestation (Solana Attestation Service), checked before opening
    verifiedBy?: string; // who verified the identity, as written in the attestation
    attestationSignature?: string | null; // null: attested in an earlier sale
  }[];
  frozenAccount: string; // the buyer without KYC
  noKycCheck?: string; // why the buyer without KYC got no share account (the on-chain check's answer)
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
  scenario?: string; // where the growth comes from (the FHFA index), for the page
  homeValueUsd: number; // the (simulated) appraisal
  payoutMicroUsd: string;
  uncappedPayoutUsd: number;
  capApplied: boolean;
  ownerAnnualCost: number;
  topUpMicroUsd: string; // SIMULATED: test dollars minted to the homeowner for the payout (savings, refinancing or a sale)
  /** The homeowner's payment into the HEI's settlement account (missing in records made before it existed). */
  homeownerPayment?: { by: "user wallet" | "demo wallet"; owner: string; amountMicroUsd: string; signature: string | null }; // null: paid in an earlier, interrupted run
  payouts: { owner: string; tokens: string; payoutMicroUsd: string; receivedMicroUsd: string }[];
  paidMicroUsd: string;
  supplyLeft: string;
  correct: boolean; // every holder got its share and every share is burned
  signatures: string[];
  memo: string;
  recovered?: boolean; // rebuilt from the chain after an interrupted request
  at: string;
};

/** The first investor buys up to this many shares; the next buys the rest. */
const FIRST_INVESTOR_TOKENS = BigInt(150_000);
/** What the buyer without KYC tries to buy. */
const REJECTED_TOKENS = BigInt(10_000);

/**
 * Opens (thaws) a wallet's share account only after its KYC attestation is read back from
 * the chain and checks out. Without a valid one, the identity is verified and a new
 * attestation written first; an invalid one (expired, or from a simulated check once a
 * real one is set up) is closed and replaced. Used by the sale and by scripts/chain-demo.ts.
 */
export async function openAfterKyc(rpc: DevnetRpc, issuer: KeyPairSigner, heiMint: Address, wallet: Address, identity: IdentityVerifier, name: string) {
  let check = await checkKycAttestation(rpc, issuer.address, wallet);
  const replace = check.ok ? check.data.provider !== identity.provider && identity.provider !== simulatedIdentity.provider : check.reason !== NO_KYC_ATTESTATION;
  if (replace) {
    await revokeKyc(rpc, issuer, wallet);
    check = await checkKycAttestation(rpc, issuer.address, wallet);
  }
  let attestationSignature: string | null = null;
  if (!check.ok) {
    const verified = await identity.verify(wallet);
    attestationSignature = await attestKyc(rpc, issuer, wallet, { provider: identity.provider, reference: kycReference(verified.id) });
    check = await checkKycAttestation(rpc, issuer.address, wallet);
    if (!check.ok) throw new Error(`${name}'s KYC attestation did not check out (${check.reason}); the share account stays frozen`);
  }
  const opened = await allowlistInvestor(rpc, issuer, heiMint, wallet);
  return { account: opened.account, signature: opened.signature, attestation: check.attestation, verifiedBy: check.data.provider, attestationSignature };
}

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

/**
 * KYC, closing and the primary sale. The partner pays the homeowner first (owner,
 * 2026-10-02), then sells; a buyer without KYC is refused on-chain. Safe to run again
 * after an interruption: each step looks at the chain first and skips what is done
 * (open KYC accounts, the closing payment's once-only marker, shares an investor
 * already holds). SIMULATED money (test dollars) is minted inside the transaction that
 * spends it, so runs at the same time on the shared demo wallets cannot mix up balances.
 */
export async function runPrimarySale(
  rpc: DevnetRpc,
  wallets: HeiWallets,
  input: { heiMint: string; treasury: string; deal: HeiDeal; homeowner?: string }, // homeowner: the user's own wallet, if connected
  now: () => Date = () => new Date(),
  identity: IdentityVerifier = simulatedIdentity,
): Promise<SaleRecord> {
  const { issuer, noKyc } = wallets;
  const homeowner = input.homeowner ? address(input.homeowner) : wallets.homeowner.address;
  const heiMint = address(input.heiMint);
  const treasury = address(input.treasury);
  const price = tokenPriceMicroUsd(input.deal.tokenPriceUsd);
  const supply = BigInt(input.deal.tokenSupply);
  const amounts = allocation(supply, wallets.investors.length);
  await requireFunds(rpc, issuer.address);

  // KYC: an investor's share account is opened (thawed) only after its KYC attestation is
  // read back from the chain and checks out. Without one, the identity is verified first
  // and the attestation written. The buyer without KYC has none, so its account stays frozen.
  const kyc: SaleRecord["kyc"] = [];
  for (const investor of wallets.investors) {
    const opened = await openAfterKyc(rpc, issuer, heiMint, investor.wallet.address, identity, investor.name);
    kyc.push({ name: investor.name, owner: investor.wallet.address, ...opened });
  }
  const noKycCheck = await checkKycAttestation(rpc, issuer.address, noKyc.address);
  if (noKycCheck.ok) throw new Error("The buyer meant to have no KYC has a KYC attestation; the demo cannot show a refusal");
  const frozen = await openFrozenAccount(rpc, issuer, heiMint, noKyc.address);

  // Where the sale stands: shares the investors already hold must be all that left the treasury.
  const held = await Promise.all(kyc.map(async (item) => BigInt((await readTokenAccount(rpc, address(item.account)))?.amount ?? "0")));
  const inTreasury = BigInt((await readTokenAccount(rpc, treasury))?.amount ?? "0");
  if (inTreasury + held.reduce((sum, amount) => sum + amount, BigInt(0)) !== supply) {
    throw new Error("The shares are not where the sale left them: the treasury and the investors do not add up to the supply");
  }

  const token = await loadOrCreateTestDollar(rpc, issuer);
  const netCash = toMicroUsd(input.deal.netCashUsd);
  const toBuy = amounts.map((amount, index) => sharesToBuy(amount, held[index]));

  // Closing: the partner pays the homeowner the net cash, once.
  const closing = await payAtClosing(rpc, issuer, token, homeowner, netCash, heiMint);

  // The buyer without KYC, while the treasury still has shares, so only KYC can stop it.
  let rejected: SaleRecord["rejected"];
  if (inTreasury >= REJECTED_TOKENS) {
    const before = await paymentBalance(rpc, token, noKyc.address);
    let reason = "";
    try {
      await buyShares(rpc, issuer, { issuer, buyer: noKyc, heiMint, treasury, token, tokens: REJECTED_TOKENS, priceMicroUsd: price, fundBuyer: true });
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
      const bought = await buyShares(rpc, issuer, { issuer, buyer: investor.wallet, heiMint, treasury, token, tokens: toBuy[index], priceMicroUsd: price, fundBuyer: true });
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
    noKycCheck: noKycCheck.reason,
    rejected,
    purchases,
    raisedMicroUsd: String(sumMicroUsd(purchases.map((purchase) => BigInt(purchase.costMicroUsd)))),
    register: [treasury, ...kyc.map((item) => item.account)],
    at: now().toISOString(),
  };
}

/** The settlement's numbers before anything moves: the simulated appraisal and the capped payout. */
export function settlementTerms(deal: HeiDeal, years: number, growth: number) {
  if (!(years > 0 && years <= deal.termYears)) throw new RangeError(`Settle after more than 0 and at most ${deal.termYears} years`);
  const homeValueUsd = homeValueAfterYears(deal.homeValueUsd, growth, years);
  const result = settle({
    grossInvestmentUsd: deal.grossInvestmentUsd,
    tokenSupply: deal.tokenSupply,
    netCashUsd: deal.netCashUsd,
    investorReturnCap: deal.investorReturnCapPerYear,
    years,
    homeValueAtSettlementUsd: homeValueUsd,
  });
  const trigger: SettlementRecord["trigger"] = years >= deal.termYears ? "maturity" : "buyback";
  return { homeValueUsd, result, payoutMicroUsd: toMicroUsd(result.payoutUsd), trigger };
}

type SettlementInput = { heiMint: string; deal: HeiDeal; sale: SaleRecord; years: number; growth: number; scenario?: string };

/** The settlement memo: it names the HEI, the scenario and the payout, so a later run can find these transactions. */
function settlementMemo(heiMint: Address, trigger: string, input: SettlementInput, homeValueUsd: number, payout: bigint): string {
  return `ownflow settlement v1 mint=${heiMint} trigger=${trigger} years=${input.years} value=${homeValueUsd.toFixed(2)} payout=${payout} registry=${input.deal.registryVersion}`;
}

/** What the settlement needs from the chain: the test dollar, the holders' plan, and the settlement account. */
async function settlementState(rpc: DevnetRpc, wallets: HeiWallets, input: SettlementInput) {
  const terms = settlementTerms(input.deal, input.years, input.growth);
  const heiMint = address(input.heiMint);
  await requireFunds(rpc, wallets.issuer.address);
  const token = await loadOrCreateTestDollar(rpc, wallets.issuer);
  if (token.mint !== input.sale.paymentMint) throw new Error("The test dollar changed since the sale");
  const plan = await planSettlement(rpc, {
    heiMint,
    register: input.sale.register.map((account) => address(account)),
    payoutMicroUsd: terms.payoutMicroUsd,
    tokenSupply: BigInt(input.deal.tokenSupply),
  });
  const servicer = await servicerFor(wallets.issuer, heiMint);
  const servicerAccount = await paymentAccount(servicer.address, token);
  const received = await paymentBalance(rpc, token, servicer.address);
  // More than this payout already in: it was paid for another settlement, and paying holders less would strand the rest.
  if (received > plan.paidMicroUsd) {
    throw new Error("The settlement account already holds the homeowner's payment for a larger settlement; settle with the scenario that was paid for");
  }
  // What the homeowner still has to pay in (0 when an earlier run already paid).
  const due = plan.paidMicroUsd - received;
  return { terms, heiMint, token, plan, servicer, servicerAccount, due };
}

/** A payment the user's wallet must sign: what it pays from its test dollars, and the simulated rest. */
export type WalletPaymentRequest = UnsignedForWallet & { owner: string; amountMicroUsd: string; restMicroUsd: string };

/**
 * Before the user's wallet pays: gives it devnet SOL for the fee once, opens the
 * settlement account, and builds the payment for the wallet to sign: the test dollars
 * the wallet holds (the closing payment), up to what is due. The rest of the
 * homeowner's money (SIMULATED: savings, refinancing or a sale) is added by the partner
 * in the first payout transaction. The server never opens or funds the user's own
 * accounts, so replaying this request costs it at most a fee. null when nothing is due.
 */
export async function prepareWalletSettlementPayment(
  rpc: DevnetRpc,
  wallets: HeiWallets,
  input: SettlementInput & { wallet: string },
): Promise<WalletPaymentRequest | null> {
  const { issuer } = wallets;
  const { heiMint, token, plan, servicer, servicerAccount, due } = await settlementState(rpc, wallets, input);
  if (due === BigInt(0)) return null;
  const wallet = address(input.wallet);
  const balance = await paymentBalance(rpc, token, wallet);
  if (balance === BigInt(0)) {
    // Already paid in what it had (an earlier, interrupted run): only the simulated rest is left.
    if (due < plan.paidMicroUsd) return null;
    throw new Error("Your wallet holds no test dollars to pay with (the closing payment went to it); nothing was sent");
  }
  const amount = balance < due ? balance : due;
  await ensureFeeSol(rpc, issuer, wallet);
  if (!(await readTokenAccount(rpc, servicerAccount))) await sendInstructions(rpc, issuer, [await openPaymentAccountInstruction(issuer, servicer.address, token)]);
  const steps = await homeownerPaymentInstructions({ homeowner: walletStandIn(wallet), servicer: servicer.address, token, amountMicroUsd: amount, memo: homeownerPaymentMemo(heiMint, amount) });
  return { ...(await buildForWallet(rpc, wallet, steps)), owner: wallet, amountMicroUsd: String(amount), restMicroUsd: String(due - amount) };
}

/** The homeowner's side of the settlement: a payment already signed by the user's wallet, or the demo wallet. */
export type HomeownerSide =
  | { kind: "demo" }
  | { kind: "wallet"; wallet: string; signed?: SignedByWallet; amountMicroUsd: string; lastValidBlockHeight?: string }; // signed: missing when nothing was due

/**
 * Lands the user's signed payment and checks on-chain that exactly the asked amount left
 * the wallet and arrived in the settlement account (by its address, not just its owner).
 */
async function landWalletPayment(rpc: DevnetRpc, side: Extract<HomeownerSide, { kind: "wallet" }>, token: PaymentToken, servicerAccount: Address, heiMint: Address) {
  const wallet = address(side.wallet);
  const amount = BigInt(side.amountMicroUsd);
  if (!side.signed) throw new Error("The homeowner's wallet has not signed the settlement payment; nobody was paid");
  const expiry = side.lastValidBlockHeight ? BigInt(side.lastValidBlockHeight) : undefined;
  const signature = await landWalletTransaction(rpc, side.signed, wallet, expiry);
  const parsed = await readParsedTransaction(rpc, signature);
  const ok =
    parsed.signers.includes(wallet) &&
    parsed.memos.includes(homeownerPaymentMemo(heiMint, amount)) &&
    changeForAccount(parsed, servicerAccount) === amount &&
    changeFor(parsed, token.mint, wallet) === -amount;
  if (!ok) throw new Error(`Transaction ${signature} landed but is not the settlement payment that was asked for, so no holder was paid; check it on the explorer`);
  return { signature, amount };
}

/**
 * Settlement after `years` (buyback, or maturity at the end of the term) with the home
 * valued by a simulated appraisal at `growth` a year. The homeowner pays into the HEI's
 * settlement account (the user's own signed payment, or the demo wallet); then each
 * holder is paid and its shares are burned in the same transaction. Finally it reads
 * back from those transactions what each holder received, and the supply left.
 * If an earlier, interrupted request already finished on-chain, the record is rebuilt
 * from the chain instead.
 */
export async function runSettlement(
  rpc: DevnetRpc,
  wallets: HeiWallets,
  input: SettlementInput & { homeowner?: HomeownerSide },
  now: () => Date = () => new Date(),
): Promise<SettlementRecord> {
  const { issuer } = wallets;
  const side: HomeownerSide = input.homeowner ?? { kind: "demo" };
  const heiMint = address(input.heiMint);
  if ((await readSupply(rpc, heiMint)) === BigInt(0)) return recoverSettlement(rpc, wallets, input, side, now);
  const { terms, token, plan, servicer, servicerAccount, due } = await settlementState(rpc, wallets, input);
  const { homeValueUsd, result, trigger } = terms;
  const payout = terms.payoutMicroUsd;

  // The homeowner pays in, unless an earlier run already did.
  const owner = side.kind === "wallet" ? side.wallet : wallets.homeowner.address;
  let paymentSignature: string | null = null;
  let paidByHomeowner = plan.paidMicroUsd - due; // already in from an earlier run
  let simulated = BigInt(0);
  if (due > BigInt(0)) {
    if (side.kind === "wallet") {
      // Sending a signed payment that already landed is harmless (it is the same transaction).
      if (side.signed) paymentSignature = (await landWalletPayment(rpc, side, token, servicerAccount, heiMint)).signature;
      else if (due === plan.paidMicroUsd) throw new Error("The homeowner's wallet has not signed the settlement payment; nobody was paid");
      // What is in the account now is the homeowner's; the rest is added with the first payouts.
      paidByHomeowner = await paymentBalance(rpc, token, servicer.address);
      simulated = paidByHomeowner >= plan.paidMicroUsd ? BigInt(0) : plan.paidMicroUsd - paidByHomeowner;
    } else {
      // SIMULATED: the demo homeowner's money, minted in the same transaction that pays it
      // in. The once-only marker stops a second payment for this HEI, even from runs at once.
      const marker = await onceMarker(issuer, `ownflow homeowner payment v1 mint=${heiMint}`);
      if (await accountExists(rpc, marker.address)) {
        throw new Error("The demo homeowner already paid into this HEI's settlement account for another amount; settle with the scenario that was paid for");
      }
      const steps = await homeownerPaymentInstructions({
        homeowner: wallets.homeowner,
        servicer: servicer.address,
        token,
        amountMicroUsd: due,
        memo: homeownerPaymentMemo(heiMint, due),
        fundFrom: issuer,
      });
      paymentSignature = await sendInstructions(rpc, issuer, [
        await onceMarkerInstruction(rpc, issuer, marker),
        await openPaymentAccountInstruction(issuer, servicer.address, token),
        ...steps,
      ]);
      paidByHomeowner += due;
      simulated = due;
    }
  }

  const owners = input.sale.purchases.map((purchase) => address(purchase.owner));
  const memo = settlementMemo(heiMint, trigger, input, homeValueUsd, payout);
  const run = await settleHeiShares(rpc, {
    issuer,
    heiMint,
    token,
    register: input.sale.register.map((account) => address(account)),
    payoutMicroUsd: payout,
    tokenSupply: BigInt(input.deal.tokenSupply),
    memo,
    topUpMicroUsd: side.kind === "wallet" ? simulated : BigInt(0),
  });

  // Read back: each holder received its share in the settlement transactions, and no shares are left.
  const receivedBy = await receivedIn(rpc, run.batches, token.mint);
  const payouts: SettlementRecord["payouts"] = [];
  let correct = run.payouts.length > 0;
  for (const holder of owners) {
    const expected = run.payouts.find((item) => item.owner === holder);
    const received = receivedBy.get(holder) ?? BigInt(0);
    correct &&= received === (expected?.payoutMicroUsd ?? BigInt(0));
    payouts.push({ owner: holder, tokens: String(expected?.tokens ?? BigInt(0)), payoutMicroUsd: String(expected?.payoutMicroUsd ?? BigInt(0)), receivedMicroUsd: String(received) });
  }
  const supplyLeft = await readSupply(rpc, heiMint);
  correct &&= supplyLeft === BigInt(0);

  return {
    trigger,
    years: input.years,
    growth: input.growth,
    scenario: input.scenario,
    homeValueUsd,
    payoutMicroUsd: String(payout),
    uncappedPayoutUsd: result.uncappedPayoutUsd,
    capApplied: result.capApplied,
    ownerAnnualCost: result.ownerAnnualCost,
    topUpMicroUsd: String(simulated),
    homeownerPayment: { by: side.kind === "wallet" ? "user wallet" : "demo wallet", owner, amountMicroUsd: String(paidByHomeowner), signature: paymentSignature },
    payouts,
    paidMicroUsd: String(run.paidMicroUsd),
    supplyLeft: String(supplyLeft),
    correct,
    signatures: [...(paymentSignature ? [paymentSignature] : []), ...run.signatures],
    memo,
    at: now().toISOString(),
  };
}

/**
 * Every share is already burned, but the case has no settlement record: an earlier
 * request finished on-chain and its answer was lost. Rebuilds the record from the chain:
 * the payout transactions carry this settlement's memo, and what each holder received
 * is read from them. Refuses if the HEI was settled under another scenario.
 */
async function recoverSettlement(rpc: DevnetRpc, wallets: HeiWallets, input: SettlementInput, side: HomeownerSide, now: () => Date): Promise<SettlementRecord> {
  const terms = settlementTerms(input.deal, input.years, input.growth);
  const heiMint = address(input.heiMint);
  const memo = settlementMemo(heiMint, terms.trigger, input, terms.homeValueUsd, terms.payoutMicroUsd);
  const history = await rpc.getSignaturesForAddress(heiMint, { commitment: "confirmed" }).send();
  const batches = [...history]
    .reverse()
    .filter((entry) => entry.err === null && entry.memo?.includes(memo))
    .map((entry) => entry.signature);
  if (batches.length === 0) throw new Error("This HEI is already settled on-chain, under another scenario or by another case");
  const token = await loadOrCreateTestDollar(rpc, wallets.issuer);
  const receivedBy = await receivedIn(rpc, batches, token.mint);
  // What each holder was owed: the shares the sale left with it (the treasury keeps any unsold rest).
  const sold = input.sale.purchases.reduce((sum, purchase) => sum + BigInt(purchase.tokens), BigInt(0));
  const holdings = [
    ...input.sale.purchases.map((purchase) => ({ account: address(purchase.owner), owner: address(purchase.owner), tokens: BigInt(purchase.tokens) })),
    ...(BigInt(input.deal.tokenSupply) > sold ? [{ account: wallets.issuer.address, owner: wallets.issuer.address, tokens: BigInt(input.deal.tokenSupply) - sold }] : []),
  ];
  const owed = payoutsFor(terms.payoutMicroUsd, holdings, BigInt(input.deal.tokenSupply));
  const payouts = input.sale.purchases.map((purchase) => {
    const expected = owed.find((item) => item.owner === purchase.owner);
    return { owner: purchase.owner, tokens: purchase.tokens, payoutMicroUsd: String(expected?.payoutMicroUsd ?? BigInt(0)), receivedMicroUsd: String(receivedBy.get(purchase.owner) ?? BigInt(0)) };
  });
  const paid = owed.reduce((sum, item) => sum + item.payoutMicroUsd, BigInt(0));
  return {
    trigger: terms.trigger,
    years: input.years,
    growth: input.growth,
    scenario: input.scenario,
    homeValueUsd: terms.homeValueUsd,
    payoutMicroUsd: String(terms.payoutMicroUsd),
    uncappedPayoutUsd: terms.result.uncappedPayoutUsd,
    capApplied: terms.result.capApplied,
    ownerAnnualCost: terms.result.ownerAnnualCost,
    topUpMicroUsd: "0",
    homeownerPayment: { by: side.kind === "wallet" ? "user wallet" : "demo wallet", owner: side.kind === "wallet" ? side.wallet : wallets.homeowner.address, amountMicroUsd: String(paid), signature: null },
    payouts,
    paidMicroUsd: String(paid),
    supplyLeft: "0",
    correct: payouts.every((item) => item.payoutMicroUsd === item.receivedMicroUsd),
    signatures: batches,
    memo,
    recovered: true,
    at: now().toISOString(),
  };
}
