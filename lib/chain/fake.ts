// A stand-in chain for tests and offline demos: no network, predictable ids,
// and a log of every call so tests can check what would have gone on-chain.

import type { ChainService, HeiIssueInput, OnchainRecord, WatchIssueInput } from "./adapter";

export type FakeChain = ChainService & { calls: { method: string; input: unknown }[] };

export function createFakeChain(now: () => Date = () => new Date("2026-10-02T00:00:00Z")): FakeChain {
  const calls: { method: string; input: unknown }[] = [];
  let counter = 0;
  const record = (count: number, withMint: boolean): OnchainRecord => {
    const signatures = Array.from({ length: count }, () => `fake-sig-${(counter += 1)}`);
    const mint = withMint ? `fake-mint-${counter}` : undefined;
    // Same order as the devnet chain: transactions first, then the token's page.
    const explorerUrls = [...signatures.map((sig) => `fake://tx/${sig}`), ...(mint ? [`fake://address/${mint}`] : [])];
    return { network: "devnet", signatures, explorerUrls, mint, at: now().toISOString() };
  };
  return {
    calls,
    async recordReceipt(memo: string) {
      calls.push({ method: "recordReceipt", input: memo });
      return record(1, false);
    },
    async prepareWalletReceipt(memo: string, wallet: string) {
      calls.push({ method: "prepareWalletReceipt", input: { memo, wallet } });
      return { transaction: "ZmFrZS10cmFuc2FjdGlvbg==", lastValidBlockHeight: "0" };
    },
    async recordWalletReceipt(memo: string, wallet: string, signed) {
      calls.push({ method: "recordWalletReceipt", input: { memo, wallet, signed } });
      return { ...record(1, false), signedBy: wallet };
    },
    async issueHeiShares(input: HeiIssueInput) {
      calls.push({ method: "issueHeiShares", input });
      return { ...record(2, true), treasury: "fake-treasury" };
    },
    async issueWatchToken(input: WatchIssueInput & { owner?: string }) {
      calls.push({ method: "issueWatchToken", input });
      return { ...record(2, true), owner: input.owner ?? "fake-user-wallet" };
    },
  };
}
