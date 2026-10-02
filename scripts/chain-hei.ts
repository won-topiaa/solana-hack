// Runs milestone M8 on Solana devnet for persona B, end to end: the receipt and the
// HEI shares through the agent's own tools, then the partner's payment at closing,
// the primary sale to KYC-approved investors, and the settlement (each holder paid
// and burned in the same transaction). Payments use test dollars with no value.
// Simulated: the partner, KYC, the appraisal, and the homeowner's settlement money.
// Usage: npm run chain:hei                                  buyback after 2 years, flat prices (the cap applies)
//        npm run chain:hei -- --years 10 --growth 0.03      maturity after 10 years at +3% a year
//        add --yes to skip the question (running it is the approval)

import { createInterface } from "node:readline/promises";
import { address, type Address } from "@solana/kit";
import { createAgentTools } from "../lib/agent/tools";
import { purchaseCostMicroUsd, sumMicroUsd, tokenPriceMicroUsd, toMicroUsd } from "../lib/calc/sale";
import { homeValueAfterYears, settle } from "../lib/calc/settlement";
import { createDevnetChain } from "../lib/chain/devnet";
import { buyShares, payAtClosing } from "../lib/chain/heiSale";
import { settleHeiShares } from "../lib/chain/heiSettlement";
import { loadOrCreateTestDollar, mintTestDollars, paymentBalance, type PaymentToken } from "../lib/chain/payment";
import {
  allowlistInvestor,
  createDevnetRpc,
  explorerAddressUrl,
  explorerTxUrl,
  getSolBalance,
  openFrozenAccount,
  readSupply,
  readTokenAccount,
  transactionLogs,
  type DevnetRpc,
} from "../lib/chain/solana";
import { loadOrCreateWallet } from "../lib/chain/wallets";
import { formatMicroUsd, formatMicroUsdExact, formatPercent, formatUsd } from "../lib/format";
import { createDemoPropertySource } from "../lib/integrations/rentcast";
import { todayInNewYork } from "../lib/params/dates";
import { getRegistry } from "../lib/params/load";
import { personaCase } from "../lib/recommend/personas";
import { createStepRunner } from "./agentSteps";

const MIN_ISSUER_SOL = 0.1;
/** The first investor's tokens; the second buys the rest. */
const FIRST_INVESTOR_TOKENS = BigInt(150_000);
/** What the investor without KYC tries to buy. */
const REJECTED_TOKENS = BigInt(10_000);

function option(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isFinite(value)) throw new Error(`--${name} needs a number`);
  return value;
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function shareBalance(rpc: DevnetRpc, account: Address): Promise<bigint> {
  const state = await readTokenAccount(rpc, account);
  return BigInt(state?.amount ?? "0");
}

async function main() {
  const years = option("years", 2);
  const growth = option("growth", 0);
  const rpc = createDevnetRpc(process.env.SOLANA_RPC_URL || undefined);
  const [issuer, user, investor1, investor2, investorNoKyc] = await Promise.all(
    ["issuer", "user", "investor-kyc", "investor-kyc-2", "investor-no-kyc"].map((name) => loadOrCreateWallet(name)),
  );

  const sol = await getSolBalance(rpc, issuer.address);
  if (sol < MIN_ISSUER_SOL) {
    console.error(`The issuer wallet has ${sol} SOL; it needs at least ${MIN_ISSUER_SOL} devnet SOL (https://faucet.solana.com, network: devnet, ${issuer.address}).`);
    process.exit(1);
  }
  if (!process.argv.includes("--yes")) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal.question(`Run the HEI sale and a settlement after ${years} years at ${growth * 100}% a year on Solana devnet? (y/n) `);
    terminal.close();
    if (answer.trim() !== "y") return;
  }

  // 1. Receipt and shares, through the agent's tools (each approved by running this script).
  section("1. Receipt and HEI shares (agent tools)");
  const now = new Date();
  const tools = createAgentTools({ registry: getRegistry(), propertySource: createDemoPropertySource(), chain: createDevnetChain(rpc, { issuer, user }) });
  const step = createStepRunner(tools, todayInNewYork(now), now);
  let homeCase = personaCase("B", now);
  for (const name of ["compare_paths", "prepare_documents", "record_receipt_onchain", "issue_hei_shares"]) homeCase = await step(homeCase, name);
  const sheet = homeCase.handoff?.termSheet;
  const shares = homeCase.handoff?.onchain?.heiShares;
  if (!sheet || !shares?.mint) throw new Error("No HEI shares were issued");
  const heiMint = address(shares.mint);
  const treasury = address(shares.treasury);
  const supply = BigInt(sheet.tokenSupply);
  const price = tokenPriceMicroUsd(sheet.tokenPriceUsd);

  // 2. KYC allowlist: only these accounts are opened, so only they can ever hold shares.
  section("2. KYC allowlist (KYC itself is simulated)");
  const approved1 = await allowlistInvestor(rpc, issuer, heiMint, investor1.address);
  const approved2 = await allowlistInvestor(rpc, issuer, heiMint, investor2.address);
  const frozen = await openFrozenAccount(rpc, issuer, heiMint, investorNoKyc.address);
  console.log(`Investor 1 (KYC): ${explorerAddressUrl(approved1.account)}`);
  console.log(`Investor 2 (KYC): ${explorerAddressUrl(approved2.account)}`);
  console.log(`Investor without KYC: account frozen (${explorerAddressUrl(frozen.account)})`);
  const register = [treasury, approved1.account, approved2.account];

  // 3. Test dollars: the partner's money for closing and the investors' money.
  section("3. Test dollars (DUSD, no value)");
  const token: PaymentToken = await loadOrCreateTestDollar(rpc, issuer);
  console.log(`Test dollar: ${explorerAddressUrl(token.mint)}`);
  const netCash = toMicroUsd(sheet.netCashUsd);
  const buys = [
    { name: "Investor 1", wallet: investor1, tokens: FIRST_INVESTOR_TOKENS },
    { name: "Investor 2", wallet: investor2, tokens: supply - FIRST_INVESTOR_TOKENS },
  ];
  await mintTestDollars(rpc, issuer, token, issuer.address, netCash);
  for (const buy of buys) await mintTestDollars(rpc, issuer, token, buy.wallet.address, purchaseCostMicroUsd(buy.tokens, price));
  await mintTestDollars(rpc, issuer, token, investorNoKyc.address, purchaseCostMicroUsd(REJECTED_TOKENS, price));
  console.log("Minted to the partner (closing money) and to each investor (purchase money).");

  // 4. Closing: the partner pays the homeowner first, then sells the shares.
  section("4. Closing: the partner pays the homeowner");
  const homeownerBefore = await paymentBalance(rpc, token, user.address);
  const closing = await payAtClosing(rpc, issuer, token, user.address, netCash);
  const received = (await paymentBalance(rpc, token, user.address)) - homeownerBefore;
  console.log(`The homeowner received ${formatMicroUsd(received)} (term sheet: ${formatUsd(sheet.netCashUsd)}): ${explorerTxUrl(closing)}`);
  if (received !== netCash) throw new Error("The homeowner did not receive the net cash");

  // 5. Primary sale: each purchase moves dollars and shares together.
  section("5. Primary sale");
  const rejectedBefore = await paymentBalance(rpc, token, investorNoKyc.address);
  try {
    await buyShares(rpc, issuer, { issuer, buyer: investorNoKyc, heiMint, treasury, token, tokens: REJECTED_TOKENS, priceMicroUsd: price });
    throw new Error("A buyer without KYC received shares");
  } catch (error) {
    // Only the frozen share account may stop this purchase; anything else is a real failure.
    if (!transactionLogs(error).some((line) => line.includes("Account is frozen"))) throw error;
    const unchanged = (await paymentBalance(rpc, token, investorNoKyc.address)) === rejectedBefore;
    console.log(`Investor without KYC: purchase rejected by Token-2022 ("Account is frozen"); money moved: ${unchanged ? "none" : "YES (unexpected)"}.`);
    if (!unchanged) throw new Error("Money moved in a rejected purchase");
  }
  for (const buy of buys) {
    const { signature, costMicroUsd } = await buyShares(rpc, issuer, { issuer, buyer: buy.wallet, heiMint, treasury, token, tokens: buy.tokens, priceMicroUsd: price });
    console.log(`${buy.name} bought ${buy.tokens.toLocaleString("en-US")} shares for ${formatMicroUsd(costMicroUsd)}: ${explorerTxUrl(signature)}`);
  }
  const raised = sumMicroUsd(buys.map((buy) => purchaseCostMicroUsd(buy.tokens, price)));
  console.log(`Raised ${formatMicroUsd(raised)} (term sheet: investors pay ${formatUsd(sheet.grossInvestmentUsd)}); treasury left: ${await shareBalance(rpc, treasury)} shares.`);

  // 6. Settlement: time passes and an appraisal sets the home's value (both simulated).
  section(`6. Settlement after ${years} years (SIMULATED: no time passes; the appraisal is simulated)`);
  const trigger = years >= sheet.termYears ? "maturity" : "buyback";
  const homeValue = homeValueAfterYears(sheet.homeValueUsd, growth, years);
  const result = settle({
    grossInvestmentUsd: sheet.grossInvestmentUsd,
    tokenSupply: sheet.tokenSupply,
    netCashUsd: sheet.netCashUsd,
    investorReturnCap: sheet.investorReturnCapPerYear,
    years,
    homeValueAtSettlementUsd: homeValue,
  });
  const payout = toMicroUsd(result.payoutUsd);
  console.log(
    `Trigger: ${trigger}. Home value ${formatUsd(homeValue)} (appraisal, SIMULATED). ` +
      `Payout ${formatMicroUsd(payout)}${result.capApplied ? ` (the ${formatPercent(sheet.investorReturnCapPerYear * 100)} a year cap applies; uncapped ${formatUsd(result.uncappedPayoutUsd)})` : ""}; ` +
      `homeowner's cost ${formatPercent(result.ownerAnnualCost * 100)} a year.`,
  );
  const homeownerBalance = await paymentBalance(rpc, token, user.address);
  if (homeownerBalance < payout) {
    await mintTestDollars(rpc, issuer, token, user.address, payout - homeownerBalance);
    console.log(`SIMULATED: the homeowner's money for the payout (savings, refinancing or a sale) arrives: +${formatMicroUsd(payout - homeownerBalance)}.`);
  }
  const holdersBefore = await Promise.all(buys.map((buy) => paymentBalance(rpc, token, buy.wallet.address)));
  const memo = `rwa-liquidity-agent settlement v1 mint=${shares.mint} trigger=${trigger} years=${years} value=${homeValue.toFixed(2)} payout=${payout} registry=${sheet.registryVersion}`;
  const run = await settleHeiShares(rpc, { homeowner: user, issuer, heiMint, token, register, payoutMicroUsd: payout, tokenSupply: supply, memo });
  for (const signature of run.signatures) console.log(`Transaction: ${explorerTxUrl(signature)}`);

  // Check on-chain: every holder got its share, and every share is gone.
  section("Check (read back from devnet)");
  let correct = true;
  for (const [index, buy] of buys.entries()) {
    const expected = run.payouts.find((payout) => payout.owner === buy.wallet.address)?.payoutMicroUsd ?? BigInt(0);
    const got = (await paymentBalance(rpc, token, buy.wallet.address)) - holdersBefore[index];
    correct &&= got === expected;
    console.log(`${buy.name}: ${buy.tokens.toLocaleString("en-US")} shares -> paid ${formatMicroUsdExact(got)} DUSD (expected ${formatMicroUsdExact(expected)}) ${got === expected ? "OK" : "WRONG"}`);
  }
  const left = await readSupply(rpc, heiMint);
  correct &&= left === BigInt(0);
  console.log(`Shares left: ${left} ${left === BigInt(0) ? "OK (all burned)" : "WRONG"}`);
  console.log(`Paid in total ${formatMicroUsdExact(run.paidMicroUsd)} of ${formatMicroUsdExact(payout)} (each share rounded down to the micro-dollar).`);
  console.log(`HEI token: ${explorerAddressUrl(shares.mint)}`);
  if (!correct) throw new Error("The settlement did not pay holders correctly");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
