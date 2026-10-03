// On-chain on Solana devnet (step 7, M7). Every one of these needs the user's approval.

import type { ChainService } from "../../chain/adapter";
import { describeChainError, receiptMemo } from "../../chain/solana";
import { hashOf } from "../../recommend/canonical";
import type { CaseFile } from "../types";
import { type AgentTool, type ToolOutcome, documentsChanged, selectedPathLabel } from "./shared";

function staleDocuments(caseFile: CaseFile): ToolOutcome {
  return { output: { done: false, problem: "The goal or assets changed after the documents were prepared. Call compare_paths and prepare_documents again." }, caseFile };
}

function chainFailure(caseFile: CaseFile, error: unknown): ToolOutcome {
  const message = describeChainError(error);
  return { output: { done: false, problem: `The devnet transaction failed: ${message}. Is the issuer wallet funded? (npm run chain:wallets)` }, caseFile };
}

export function createRecordReceipt(chain: ChainService): AgentTool {
  return {
    declaration: {
      name: "record_receipt_onchain",
      description:
        "Write the recommendation receipt (hashes only, no personal data) to Solana devnet, signed by the user's wallet. " +
        "The app asks the user to approve first.",
      parameters: { type: "object", properties: {} },
    },
    stages: ["prepare", "execute"],
    requiresApproval: true,
    describeForApproval: (_args, caseFile) =>
      `Write the receipt for "${selectedPathLabel(caseFile)}" (hashes only) to Solana devnet, ` +
      (caseFile.wallet ? "signed in your own wallet" : "signed by the demo wallet on your behalf") +
      ". After this the chosen path is final for this case",
    async run(_args, { caseFile, signed }) {
      const handoff = caseFile.handoff;
      if (!handoff) return { output: { done: false, problem: "Prepare the documents first." }, caseFile };
      if (documentsChanged(caseFile)) return staleDocuments(caseFile);
      if (handoff.onchain?.receipt) {
        return { output: { done: true, display: `The receipt is already on Solana devnet: ${handoff.onchain.receipt.explorerUrls[0]}` }, caseFile };
      }
      const wallet = caseFile.wallet?.address;
      if (wallet && !signed) {
        return { output: { done: false, problem: "The receipt must be signed in the user's own wallet. Ask the user to approve again and sign in the wallet." }, caseFile };
      }
      try {
        const memo = receiptMemo(handoff.receipt);
        const record = wallet && signed ? await chain.recordWalletReceipt(memo, wallet, signed) : await chain.recordReceipt(memo);
        const receipt = { ...handoff.receipt, txId: record.signatures[0] };
        const signer = record.signedBy ? "Signed by your own wallet." : "Signed by the demo wallet on your behalf.";
        return {
          output: {
            done: true,
            display: `Receipt recorded on Solana devnet in transaction ${record.signatures[0]}. ${signer} Check it: ${record.explorerUrls[0]} . It holds only hashes, the parameter registry version and the chosen path id.`,
          },
          caseFile: { ...caseFile, handoff: { ...handoff, receipt, onchain: { ...handoff.onchain, receipt: record } }, stage: "execute" },
        };
      } catch (error) {
        return chainFailure(caseFile, error);
      }
    },
  };
}

export function createIssueHeiShares(chain: ChainService): AgentTool {
  return {
    declaration: {
      name: "issue_hei_shares",
      description:
        "For an HEI: create the HEI share tokens on Solana devnet, issued by the simulated partner into its treasury for the " +
        "primary sale. Token accounts start frozen; only KYC-approved wallets are opened. Needs the user's approval and the " +
        "receipt on-chain first.",
      parameters: { type: "object", properties: {} },
    },
    stages: ["prepare", "execute"],
    requiresApproval: true,
    describeForApproval: (_args, caseFile) => {
      const supply = caseFile.handoff?.termSheet?.tokenSupply;
      const count = supply === undefined ? "the" : `${supply.toLocaleString("en-US")}`;
      return `Create ${count} HEI share tokens on Solana devnet for the simulated partner's primary sale (accounts frozen until KYC)`;
    },
    async run(_args, { caseFile }) {
      const handoff = caseFile.handoff;
      const sheet = handoff?.termSheet;
      if (!handoff || !sheet || handoff.receipt.selectedOptionId !== "re-hei") {
        return { output: { done: false, problem: "This is only for a prepared HEI path." }, caseFile };
      }
      if (documentsChanged(caseFile)) return staleDocuments(caseFile);
      if (!handoff.onchain?.receipt) return { output: { done: false, problem: "Record the receipt on-chain first (record_receipt_onchain)." }, caseFile };
      if (handoff.onchain.heiShares) return { output: { done: true, display: `The HEI share tokens already exist: ${handoff.onchain.heiShares.explorerUrls.at(-1)}` }, caseFile };
      const passport = handoff.passports.find((item) => item.assetId === sheet.assetId);
      if (!passport) return { output: { done: false, problem: "The home's passport is missing; prepare the documents again." }, caseFile };
      try {
        const record = await chain.issueHeiShares({
          assetId: sheet.assetId,
          tokenSupply: sheet.tokenSupply,
          passportHash: hashOf(passport),
          recommendationHash: handoff.receipt.recommendationHash,
        });
        return {
          output: {
            done: true,
            display:
              `HEI share tokens created on Solana devnet: ${sheet.tokenSupply.toLocaleString("en-US")} tokens in the issuer's treasury ` +
              `for the primary sale (the issuer is a simulated partner). The supply is fixed: no more can ever be minted. ` +
              `New token accounts start frozen; only KYC-approved wallets are opened. ` +
              `Token: ${record.explorerUrls.at(-1)} . Transactions: ${record.explorerUrls.slice(0, -1).join(" , ")} .`,
          },
          caseFile: { ...caseFile, handoff: { ...handoff, onchain: { ...handoff.onchain, heiShares: record } }, stage: "execute" },
        };
      } catch (error) {
        return chainFailure(caseFile, error);
      }
    },
  };
}

export function createIssueWatchToken(chain: ChainService): AgentTool {
  return {
    declaration: {
      name: "issue_watch_token",
      description:
        "For the watch tokenization path: record the simulated vault intake and create the watch's 1-of-1 token in the " +
        "user's wallet on Solana devnet. Needs the user's approval and the receipt on-chain first.",
      parameters: { type: "object", properties: {} },
    },
    stages: ["prepare", "execute"],
    requiresApproval: true,
    describeForApproval: () =>
      "Record the simulated vault intake and create your watch's 1-of-1 token on Solana devnet",
    async run(_args, { caseFile }) {
      const handoff = caseFile.handoff;
      const selected = handoff?.receipt.selectedOptionId ?? "";
      if (!handoff || !selected.startsWith("w-vault-token-")) {
        return { output: { done: false, problem: "This is only for a prepared watch tokenization path." }, caseFile };
      }
      if (documentsChanged(caseFile)) return staleDocuments(caseFile);
      if (!handoff.onchain?.receipt) return { output: { done: false, problem: "Record the receipt on-chain first (record_receipt_onchain)." }, caseFile };
      if (handoff.onchain.watchToken) return { output: { done: true, display: `The watch token already exists: ${handoff.onchain.watchToken.explorerUrls.at(-1)}` }, caseFile };
      const assetId = selected.replace("w-vault-token-", "");
      const passport = handoff.passports.find((item) => item.assetId === assetId);
      if (!passport) return { output: { done: false, problem: "The watch's passport is missing; prepare the documents again." }, caseFile };
      try {
        const record = await chain.issueWatchToken({ assetId, passportHash: hashOf(passport), recommendationHash: handoff.receipt.recommendationHash, owner: caseFile.wallet?.address });
        return {
          output: {
            done: true,
            display:
              "Vault intake: SIMULATED (no watch was shipped or stored). " +
              `Your watch's 1-of-1 token was created on Solana devnet in ${record.owner === caseFile.wallet?.address ? "your own wallet" : "the demo wallet that stands for yours"}: ${record.explorerUrls.at(-1)} . ` +
              "Minting is closed, so no second token can ever be made. " +
              `Transactions: ${record.explorerUrls.slice(0, -1).join(" , ")} .`,
          },
          caseFile: { ...caseFile, handoff: { ...handoff, onchain: { ...handoff.onchain, watchToken: record } }, stage: "execute" },
        };
      } catch (error) {
        return chainFailure(caseFile, error);
      }
    },
  };
}
