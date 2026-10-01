// Shared shapes for the agent: the user's goal, the case file (everything the
// agent knows about one user's case) and the messages exchanged with the model.

import type { Asset, PiiItem } from "../assets/types";

/** CLAUDE.md §9. keepAssetIds is filled once assets are captured (step 2). */
export type Goal = {
  cashNeededUsd: number;
  neededBy: string; // YYYY-MM-DD
  repayHorizonYears?: number;
  keepAssetIds: string[];
  keepAssetNotes?: string[]; // assets to keep, in the user's words, until they have IDs
  monthlyCapacityUsd?: number;
  age62Plus?: boolean;
};

/** Steps of CLAUDE.md §5 built so far. */
export type Stage = "goal" | "capture";

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
  messages: AgentMessage[];
  pendingApproval: PendingApproval | null;
  events: CaseEvent[];
};
