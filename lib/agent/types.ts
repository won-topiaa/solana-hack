// Shared shapes for the agent: the user's goal, the case file (everything the
// agent knows about one user's case) and the messages exchanged with the model.

import type { Asset, Photo, PiiItem } from "../assets/types";
import type { OnchainRecord } from "../chain/adapter";
import type { SaleRecord, SettlementRecord } from "../chain/heiLifecycle";
import type { AssetPassport, Receipt } from "../recommend/passport";
import type { HeiTermSheet } from "../recommend/termSheet";
import type { Recommendation } from "../recommend/types";

/** Which asset the user came to use: home and watches are separate situations (owner, 2026-10-02). */
export type Intent = "home" | "watch" | "unsure";

/** CLAUDE.md §9. keepAssetIds is filled once assets are captured (step 2). */
export type Goal = {
  intent?: Intent; // missing = unsure
  cashNeededUsd: number;
  neededBy: string; // YYYY-MM-DD
  repayHorizonYears?: number;
  keepAssetIds: string[];
  keepAssetNotes?: string[]; // assets to keep, in the user's words, until they have IDs
  monthlyCapacityUsd?: number;
  age62Plus?: boolean;
};

/** Steps of CLAUDE.md §5 built so far: goal, capture (+ verify, value), compare, prepare, execute. */
export type Stage = "goal" | "capture" | "compare" | "prepare" | "execute";

export type ToolCall = {
  id: string; // our id, unique within the case
  providerCallId?: string; // the model's own id for the call, sent back with the result
  name: string;
  args: Record<string, unknown>;
};

export type ToolResult = {
  callId: string;
  providerCallId?: string;
  name: string;
  output: Record<string, unknown>;
};

export type AgentMessage =
  | { role: "user"; text: string }
  // raw is the provider's original reply. Gemini 3 needs it back unchanged.
  | { role: "model"; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: "tool"; results: ToolResult[] };

/** A tool call that waits for the user's yes or no before it may run. */
export type PendingApproval = {
  id: string;
  call: ToolCall;
  summary: string; // the sentence the user approves or rejects
  heldResults: ToolResult[]; // results of the other calls in the same model reply
  insertAt: number; // where this call's result goes among heldResults
  requestedAt: string;
};

/** Audit trail entry. Never put raw personal data in `detail`. */
export type CaseEvent = { at: string; type: string; detail: string };

export type CaseFile = {
  id: string;
  createdAt: string;
  stage: Stage;
  goal?: Goal;
  assets: Asset[];
  pii: Record<string, PiiItem>; // personal data, referenced by key from assets; never logged
  photos: Record<string, Photo>; // uploaded photos (may show serial numbers); off-chain
  recommendation?: Recommendation; // the latest comparison (step 5)
  handoff?: {
    termSheet?: HeiTermSheet;
    passports: AssetPassport[];
    receipt: Receipt;
    onchain?: {
      receipt?: OnchainRecord;
      heiShares?: OnchainRecord & { treasury: string };
      watchToken?: OnchainRecord & { owner: string };
      heiSale?: SaleRecord; // the partner's steps after issuance (simulated partner, devnet)
      heiSettlement?: SettlementRecord;
    };
  }; // steps 6 (off-chain), 7 (on-chain, devnet) and 8 (settlement)
  messages: AgentMessage[];
  pendingApproval: PendingApproval | null;
  events: CaseEvent[];
};
