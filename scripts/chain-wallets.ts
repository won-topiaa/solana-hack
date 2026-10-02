// Creates (once) and shows the devnet demo wallets, and tops up the ones that pay fees.
// Usage: npm run chain:wallets
// Wallet files live in the git-ignored .wallets/devnet folder. Devnet only.

import { createDevnetRpc, explorerAddressUrl, getSolBalance, requestDevnetSol } from "../lib/chain/solana";
import { DEMO_WALLETS, loadOrCreateWallet } from "../lib/chain/wallets";

// Only these wallets pay fees in the demo; the others just hold tokens.
const FEE_PAYERS: Record<string, number> = { issuer: 2, user: 0.2 };

async function main() {
  const rpc = createDevnetRpc(process.env.SOLANA_RPC_URL || undefined);
  for (const name of DEMO_WALLETS) {
    const wallet = await loadOrCreateWallet(name);
    let balance = await getSolBalance(rpc, wallet.address);
    const target = FEE_PAYERS[name];
    if (target !== undefined && balance < target / 2) {
      try {
        await requestDevnetSol(rpc, wallet.address, target);
        balance = await getSolBalance(rpc, wallet.address);
      } catch (error) {
        console.log(`  airdrop for ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log(`${name.padEnd(16)} ${wallet.address}  ${balance.toFixed(3)} SOL  ${explorerAddressUrl(wallet.address)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
