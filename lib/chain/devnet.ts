// ChainService on Solana devnet. The issuer wallet plays the partners (HEI issuer,
// watch vault) and pays fees; the user wallet signs the receipt. Devnet only.

import type { KeyPairSigner } from "@solana/kit";
import type { ChainService, HeiIssueInput, OnchainRecord, WatchIssueInput } from "./adapter";
import {
  createHeiShareMint,
  createWatchToken,
  explorerAddressUrl,
  explorerTxUrl,
  getSolBalance,
  recordReceiptMemo,
  requireFunds,
  sendDevnetSol,
  type DevnetRpc,
  type TokenInfo,
} from "./solana";

/** What the HEI share token says about itself on-chain: hashes and generic labels, no personal data. */
export function heiTokenInfo(input: HeiIssueInput): TokenInfo {
  return {
    name: `HEI share ${input.assetId} (demo)`,
    symbol: "HEIS",
    fields: [
      ["passport", input.passportHash],
      ["recommendation", input.recommendationHash],
      ["unit", "1/1,000,000 of the home's value at settlement"],
      ["kyc", "accounts frozen by default; the issuer thaws KYC-approved wallets"],
    ],
  };
}

/** What the watch's 1-of-1 token says about itself on-chain. */
export function watchTokenInfo(input: WatchIssueInput): TokenInfo {
  return {
    name: `Vaulted watch ${input.assetId} (demo)`,
    symbol: "VWATCH",
    fields: [
      ["passport", input.passportHash],
      ["recommendation", input.recommendationHash],
      ["vault", "simulated vault intake (demo)"],
      ["redeem", "burn the token to release the watch"],
    ],
  };
}

/** Names a token by the receipt it carries out: one receipt and passport, one token. */
export function issuanceLabel(input: { passportHash: string; recommendationHash: string }): string {
  return `rec=${input.recommendationHash} passport=${input.passportHash}`;
}

/** Enough SOL for the user wallet to pay for a few memo transactions. */
const USER_FEE_SOL = 0.01;

export function createDevnetChain(rpc: DevnetRpc, wallets: { issuer: KeyPairSigner; user: KeyPairSigner }, now: () => Date = () => new Date()): ChainService {
  const record = (signatures: string[], mint?: string): OnchainRecord => ({
    network: "devnet",
    signatures,
    explorerUrls: [...signatures.map(explorerTxUrl), ...(mint ? [explorerAddressUrl(mint)] : [])],
    mint,
    at: now().toISOString(),
  });

  return {
    async recordReceipt(memo) {
      await requireFunds(rpc, wallets.issuer.address);
      if ((await getSolBalance(rpc, wallets.user.address)) < USER_FEE_SOL / 2) {
        await sendDevnetSol(rpc, wallets.issuer, wallets.user.address, USER_FEE_SOL);
      }
      const signature = await recordReceiptMemo(rpc, wallets.user, memo);
      return record([signature]);
    },

    async issueHeiShares(input: HeiIssueInput) {
      await requireFunds(rpc, wallets.issuer.address);
      const created = await createHeiShareMint(rpc, wallets.issuer, input.tokenSupply, heiTokenInfo(input), issuanceLabel(input));
      return { ...record(created.signatures, created.mint), treasury: created.treasury };
    },

    async issueWatchToken(input: WatchIssueInput) {
      await requireFunds(rpc, wallets.issuer.address);
      const created = await createWatchToken(rpc, wallets.issuer, wallets.user.address, watchTokenInfo(input), issuanceLabel(input));
      return { ...record(created.signatures, created.mint), owner: wallets.user.address };
    },
  };
}
