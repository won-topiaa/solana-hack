// Runs milestone M7 on Solana devnet without the chat, through the agent's own
// tools: persona B's HEI (receipt, share tokens, KYC allowlist) and persona A's
// watch token. Devnet only; partners are simulated.
// Usage: npm run chain:demo             asks before sending transactions (SOLANA_RPC_URL overrides the public devnet RPC)
//        npm run chain:demo -- --yes    no question (running it is the approval)
// The issuer wallet needs devnet SOL: npm run chain:wallets, or https://faucet.solana.com

import { createInterface } from "node:readline/promises";
import { createAgentTools } from "../lib/agent/tools";
import type { CaseFile } from "../lib/agent/types";
import { createDevnetChain } from "../lib/chain/devnet";
import {
  allowlistInvestor,
  createDevnetRpc,
  explorerAddressUrl,
  explorerTxUrl,
  getSolBalance,
  openFrozenAccount,
  readTokenAccount,
} from "../lib/chain/solana";
import { loadOrCreateWallet } from "../lib/chain/wallets";
import { createDemoPropertySource } from "../lib/integrations/rentcast";
import { todayInNewYork } from "../lib/params/dates";
import { getRegistry } from "../lib/params/load";
import { personaCase } from "../lib/recommend/personas";
import { createStepRunner } from "./agentSteps";

const MIN_ISSUER_SOL = 0.05;

async function main() {
  const rpc = createDevnetRpc(process.env.SOLANA_RPC_URL || undefined);
  const issuer = await loadOrCreateWallet("issuer");
  const user = await loadOrCreateWallet("user");
  const investorKyc = await loadOrCreateWallet("investor-kyc");
  const investorNoKyc = await loadOrCreateWallet("investor-no-kyc");

  const balance = await getSolBalance(rpc, issuer.address);
  if (balance < MIN_ISSUER_SOL) {
    console.error(`The issuer wallet has ${balance} SOL; it needs at least ${MIN_ISSUER_SOL} devnet SOL.`);
    console.error(`Send devnet SOL to ${issuer.address} (https://faucet.solana.com, network: devnet).`);
    process.exit(1);
  }
  if (!process.argv.includes("--yes")) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await terminal.question("Send the demo transactions to Solana devnet? (y/n) ");
    terminal.close();
    if (answer.trim() !== "y") return;
  }

  const now = new Date();
  const today = todayInNewYork(now);
  const tools = createAgentTools({
    registry: getRegistry(),
    propertySource: createDemoPropertySource(),
    chain: createDevnetChain(rpc, { issuer, user }),
  });
  const step = createStepRunner(tools, today, now);

  console.log("=== Persona B: HEI share tokens ===");
  let homeCase = personaCase("B", now);
  for (const name of ["compare_paths", "prepare_documents", "record_receipt_onchain", "issue_hei_shares"]) {
    homeCase = await step(homeCase, name);
  }
  const mint = homeCase.handoff?.onchain?.heiShares?.mint;
  if (!mint) throw new Error("No HEI mint");
  // KYC allowlist: the approved investor's account is opened; the other stays frozen.
  const approved = await allowlistInvestor(rpc, issuer, mint as never, investorKyc.address);
  const notApproved = await openFrozenAccount(rpc, issuer, mint as never, investorNoKyc.address);
  console.log("\n[KYC allowlist]");
  for (const [label, item] of [["KYC-approved investor", approved], ["investor without KYC", notApproved]] as const) {
    const state = await readTokenAccount(rpc, item.account);
    console.log(`${label}: token account ${state?.state ?? "missing"} (${explorerAddressUrl(item.account)}), tx ${explorerTxUrl(item.signature)}`);
  }

  console.log("\n=== Persona A: watch 1-of-1 token ===");
  const base = personaCase("A", now);
  // Persona A already ran the (simulated) stolen-watch check, which a vault requires.
  let watchCase: CaseFile = { ...base, assets: base.assets.map((asset) => (asset.kind === "watch" ? { ...asset, theftCheck: "simulated_clear" as const } : asset)) };
  watchCase = await step(watchCase, "compare_paths");
  watchCase = await step(watchCase, "prepare_documents", { optionId: "w-vault-token-watch-1" });
  watchCase = await step(watchCase, "record_receipt_onchain");
  watchCase = await step(watchCase, "issue_watch_token");
  const token = watchCase.handoff?.onchain?.watchToken;
  console.log(`\nWatch token mint: ${token?.mint} (${token?.explorerUrls.at(-1)})`);
  console.log(`Issuer wallet balance now: ${(await getSolBalance(rpc, issuer.address)).toFixed(4)} SOL`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
