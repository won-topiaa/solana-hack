// What the agent needs from a blockchain (CLAUDE.md §6 ChainAdapter). The devnet
// implementation is lib/chain/devnet.ts; tests use lib/chain/fake.ts. Only hashes,
// versions and generic labels go on-chain, never personal data (CLAUDE.md §2).

import type { SignedByWallet, UnsignedForWallet } from "./userWallet";

export type OnchainRecord = {
  network: "devnet";
  signatures: string[]; // transaction ids, oldest first
  explorerUrls: string[];
  mint?: string;
  signedBy?: string; // the user's own wallet, when it signed (missing: the demo wallet)
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
  /** Writes the receipt as a memo signed by the demo user wallet (the server holds it). */
  recordReceipt(memo: string): Promise<OnchainRecord>;
  /** Builds the receipt memo for the user's own wallet to sign (and gives it devnet SOL for the fee if low). */
  prepareWalletReceipt(memo: string, wallet: string): Promise<UnsignedForWallet>;
  /** Sends the receipt the user's wallet signed, then checks on-chain that it holds the memo and the wallet's signature. */
  recordWalletReceipt(memo: string, wallet: string, signed: SignedByWallet): Promise<OnchainRecord>;
  /** Creates the HEI share mint (accounts frozen by default) and mints the supply to the issuer's treasury. */
  issueHeiShares(input: HeiIssueInput): Promise<OnchainRecord & { treasury: string }>;
  /** After (simulated) vault intake: creates the watch's 1-of-1 token in `owner` (the user's wallet), else the demo wallet. */
  issueWatchToken(input: WatchIssueInput & { owner?: string }): Promise<OnchainRecord & { owner: string }>;
}
