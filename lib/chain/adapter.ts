// What the agent needs from a blockchain (CLAUDE.md §6 ChainAdapter). The devnet
// implementation is lib/chain/devnet.ts; tests use lib/chain/fake.ts. Only hashes,
// versions and generic labels go on-chain, never personal data (CLAUDE.md §2).

export type OnchainRecord = {
  network: "devnet";
  signatures: string[]; // transaction ids, oldest first
  explorerUrls: string[];
  mint?: string;
  at: string;
};

export type HeiIssueInput = {
  assetId: string;
  tokenSupply: number;
  passportHash: string;
  recommendationHash: string;
};

export type WatchIssueInput = {
  assetId: string;
  passportHash: string;
  recommendationHash: string;
};

export interface ChainService {
  /** Writes the receipt as a memo signed by the user's wallet. */
  recordReceipt(memo: string): Promise<OnchainRecord>;
  /** Creates the HEI share mint (accounts frozen by default) and mints the supply to the issuer's treasury. */
  issueHeiShares(input: HeiIssueInput): Promise<OnchainRecord & { treasury: string }>;
  /** After (simulated) vault intake: creates the watch's 1-of-1 token in the user's wallet. */
  issueWatchToken(input: WatchIssueInput): Promise<OnchainRecord & { owner: string }>;
}
