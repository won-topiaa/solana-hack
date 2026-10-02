// Runs milestone M8 on Solana devnet for persona B, end to end: the receipt and the
// HEI shares through the agent's own tools, then the partner's payment at closing,
// the primary sale to KYC-approved investors, and the settlement (each holder paid
// and burned in the same transaction). The steps after issuance are lib/chain/heiLifecycle.ts,
// the same code the web app's partner page runs. Payments use test dollars with no value.
// Simulated: the partner, KYC, the appraisal, and the homeowner's settlement money.
// Usage: npm run chain:hei                                  buyback after 2 years, flat prices (the cap applies)
//        npm run chain:hei -- --years 10 --growth 0.03      maturity after 10 years at +3% a year
//        add --yes to skip the question (running it is the approval)

import { createInterface } from "node:readline/promises";
import { createAgentTools } from "../lib/agent/tools";
import { createDevnetChain } from "../lib/chain/devnet";
import { runPrimarySale, runSettlement, type HeiWallets } from "../lib/chain/heiLifecycle";
import { createDevnetRpc, explorerAddressUrl, explorerTxUrl, getSolBalance, MIN_ISSUER_SOL } from "../lib/chain/solana";
import { loadOrCreateWallet } from "../lib/chain/wallets";
import { formatMicroUsd, formatMicroUsdExact, formatPercent, formatUsd } from "../lib/format";
import { createDemoPropertySource } from "../lib/integrations/rentcast";
import { todayInNewYork } from "../lib/params/dates";
import { getRegistry } from "../lib/params/load";
import { personaCase } from "../lib/recommend/personas";
import { createStepRunner } from "./agentSteps";


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

async function main() {
  const years = option("years", 2);
  const growth = option("growth", 0);
  const rpc = createDevnetRpc(process.env.SOLANA_RPC_URL || undefined);
  const [issuer, user, investor1, investor2, investorNoKyc] = await Promise.all(
    ["issuer", "user", "investor-kyc", "investor-kyc-2", "investor-no-kyc"].map((name) => loadOrCreateWallet(name)),
  );
  const wallets: HeiWallets = {
    issuer,
    homeowner: user,
    investors: [
      { name: "Investor 1", wallet: investor1 },
      { name: "Investor 2", wallet: investor2 },
    ],
    noKyc: investorNoKyc,
  };

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
  const deal = homeCase.handoff?.termSheet;
  const shares = homeCase.handoff?.onchain?.heiShares;
  if (!deal || !shares?.mint) throw new Error("No HEI shares were issued");

  // 2. KYC (simulated), closing, primary sale.
  section("2. KYC, closing and the primary sale (KYC and the partner are simulated)");
  const sale = await runPrimarySale(rpc, wallets, { heiMint: shares.mint, treasury: shares.treasury, deal });
  console.log(`Test dollar (DUSD, no value): ${explorerAddressUrl(sale.paymentMint)}`);
  for (const item of sale.kyc) console.log(`${item.name} (KYC): ${explorerAddressUrl(item.account)}`);
  console.log(`Investor without KYC: account frozen (${explorerAddressUrl(sale.frozenAccount)})`);
  console.log(`Closing: the homeowner received ${formatMicroUsd(BigInt(sale.closing.amountMicroUsd))} (term sheet: ${formatUsd(deal.netCashUsd)}): ${explorerTxUrl(sale.closing.signature)}`);
  console.log(`Investor without KYC: purchase rejected by Token-2022 ("${sale.rejected.reason}"); money moved: ${sale.rejected.moneyMoved ? "YES" : "none"}.`);
  for (const purchase of sale.purchases) {
    console.log(`${purchase.name} bought ${BigInt(purchase.tokens).toLocaleString("en-US")} shares for ${formatMicroUsd(BigInt(purchase.costMicroUsd))}: ${purchase.signature ? explorerTxUrl(purchase.signature) : "(in an earlier run)"}`);
  }
  console.log(`Raised ${formatMicroUsd(BigInt(sale.raisedMicroUsd))} (term sheet: investors pay ${formatUsd(deal.grossInvestmentUsd)}).`);

  // 3. Settlement: time passes and an appraisal sets the home's value (both simulated).
  section(`3. Settlement after ${years} years (SIMULATED: no time passes; the appraisal is simulated)`);
  const settled = await runSettlement(rpc, wallets, { heiMint: shares.mint, deal, sale, years, growth });
  console.log(
    `Trigger: ${settled.trigger}. Home value ${formatUsd(settled.homeValueUsd)} (appraisal, SIMULATED). ` +
      `Payout ${formatMicroUsd(BigInt(settled.payoutMicroUsd))}${settled.capApplied ? ` (the ${formatPercent(deal.investorReturnCapPerYear * 100)} a year cap applies; uncapped ${formatUsd(settled.uncappedPayoutUsd)})` : ""}; ` +
      `homeowner's cost ${formatPercent(settled.ownerAnnualCost * 100)} a year.`,
  );
  if (BigInt(settled.topUpMicroUsd) > BigInt(0)) {
    console.log(`SIMULATED: the homeowner's money for the payout (savings, refinancing or a sale), minted as test dollars: ${formatMicroUsd(BigInt(settled.topUpMicroUsd))}.`);
  }
  const paidIn = settled.homeownerPayment;
  if (paidIn) {
    console.log(
      `The homeowner (${paidIn.by}) paid ${formatMicroUsd(BigInt(paidIn.amountMicroUsd))} into the HEI's settlement account: ` +
        `${paidIn.signature ? explorerTxUrl(paidIn.signature) : "(in an earlier run)"}`,
    );
  }
  for (const signature of settled.signatures.filter((item) => item !== paidIn?.signature)) console.log(`Payout and burn: ${explorerTxUrl(signature)}`);

  section("Check (read back from devnet)");
  for (const [index, payout] of settled.payouts.entries()) {
    const ok = payout.receivedMicroUsd === payout.payoutMicroUsd;
    console.log(
      `${sale.purchases[index]?.name ?? payout.owner}: ${BigInt(payout.tokens).toLocaleString("en-US")} shares -> paid ${formatMicroUsdExact(BigInt(payout.receivedMicroUsd))} DUSD ` +
        `(expected ${formatMicroUsdExact(BigInt(payout.payoutMicroUsd))}) ${ok ? "OK" : "WRONG"}`,
    );
  }
  console.log(`Shares left: ${settled.supplyLeft} ${settled.supplyLeft === "0" ? "OK (all burned)" : "WRONG"}`);
  console.log(`Paid in total ${formatMicroUsdExact(BigInt(settled.paidMicroUsd))} of ${formatMicroUsdExact(BigInt(settled.payoutMicroUsd))} (each share rounded down to the micro-dollar).`);
  console.log(`HEI token: ${explorerAddressUrl(shares.mint)}`);
  if (!settled.correct) throw new Error("The settlement did not pay holders correctly");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
