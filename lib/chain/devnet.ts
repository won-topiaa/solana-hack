// ChainService on Solana devnet. The issuer wallet plays the partners (HEI issuer,
// watch vault) and pays fees; the user wallet signs the receipt. Devnet only.

import { address, type KeyPairSigner } from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import type { ChainService, HeiIssueInput, OnchainRecord, WatchIssueInput } from "./adapter";
import {
  createHeiShareMint,
  createWatchToken,
  ensureFeeSol,
  fundDemoWallet,
  explorerAddressUrl,
  explorerTxUrl,
  recordReceiptMemo,
  requireFunds,
  type DevnetRpc,
  type TokenInfo,
} from "./solana";
import { buildForWallet, landWalletTransaction, readParsedTransaction, walletStandIn } from "./userWallet";

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
function issuanceLabel(input: { passportHash: string; recommendationHash: string }): string {
  return `rec=${input.recommendationHash} passport=${input.passportHash}`;
}

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
      // A retried approval (a lost answer, a reload) finds the receipt it already wrote:
      // the memo holds the receipt's hashes, so the same text means the same receipt.
      const recent = await rpc.getSignaturesForAddress(wallets.user.address, { commitment: "confirmed", limit: 50 }).send();
      const earlier = recent.find((entry) => entry.err === null && entry.memo?.includes(memo));
      if (earlier) return record([earlier.signature]);
      await requireFunds(rpc, wallets.issuer.address);
      await fundDemoWallet(rpc, wallets.issuer, wallets.user.address);
      const signature = await recordReceiptMemo(rpc, wallets.user, memo);
      return record([signature]);
    },

    async prepareWalletReceipt(memo, wallet) {
      const owner = address(wallet);
      await ensureFeeSol(rpc, wallets.issuer, owner);
      return buildForWallet(rpc, owner, [getAddMemoInstruction({ memo, signers: [walletStandIn(owner)] })]);
    },

    async recordWalletReceipt(memo, wallet, signed) {
      const owner = address(wallet);
      const signature = await landWalletTransaction(rpc, signed, owner);
      const parsed = await readParsedTransaction(rpc, signature);
      if (!parsed.signers.includes(owner) || !parsed.memos.includes(memo)) {
        throw new Error(`Transaction ${signature} is not the receipt that was asked for`);
      }
      return { ...record([signature]), signedBy: owner };
    },

    async issueHeiShares(input: HeiIssueInput) {
      await requireFunds(rpc, wallets.issuer.address);
      const created = await createHeiShareMint(rpc, wallets.issuer, input.tokenSupply, heiTokenInfo(input), issuanceLabel(input));
      return { ...record(created.signatures, created.mint), treasury: created.treasury };
    },

    async issueWatchToken(input: WatchIssueInput & { owner?: string }) {
      await requireFunds(rpc, wallets.issuer.address);
      const owner = input.owner ? address(input.owner) : wallets.user.address;
      const created = await createWatchToken(rpc, wallets.issuer, owner, watchTokenInfo(input), issuanceLabel(input));
      return { ...record(created.signatures, created.mint), owner };
    },
  };
}
