// Tools the model may call. Each tool is plain code. A tool that does something
// irreversible (minting, a transfer, an on-chain receipt, contacting a partner)
// sets requiresApproval, and the orchestrator never runs it before the user says yes.
// Numbers go back to the model as finished `display` text, formatted by code.
// One file per step: shared.ts (the tool shape), goal.ts, home.ts, watch.ts, documents.ts, onchain.ts.

import type { ChainService } from "../../chain/adapter";
import type { MortgageDataSource } from "../../integrations/plaid";
import type { PropertyDataSource } from "../../integrations/rentcast";
import type { WatchVision } from "../../integrations/vision";
import type { Registry } from "../../params/types";
import { createComparePaths, createPrepareDocuments } from "./documents";
import { recordGoal, setKeepAssets } from "./goal";
import { createConnectMortgage, createLookupHome, recordMortgage } from "./home";
import { createIssueHeiShares, createIssueWatchToken, createRecordReceipt } from "./onchain";
import type { AgentTool } from "./shared";
import { checkWatchRegistry, createReadWatchPhotos, recordWatch } from "./watch";

export type { AgentTool } from "./shared";

/** All tools so far (M7: goal, assets, compare, prepare, on-chain). Optional services add their tools. */
export function createAgentTools(services: {
  registry: Registry;
  propertySource: PropertyDataSource;
  mortgageSource?: MortgageDataSource;
  vision?: WatchVision;
  chain?: ChainService;
}): AgentTool[] {
  return [
    recordGoal,
    createLookupHome(services.propertySource),
    recordMortgage,
    ...(services.mortgageSource ? [createConnectMortgage(services.mortgageSource)] : []),
    ...(services.vision ? [createReadWatchPhotos(services.vision)] : []),
    recordWatch,
    checkWatchRegistry,
    setKeepAssets,
    createComparePaths(services.registry),
    createPrepareDocuments(services.registry),
    ...(services.chain
      ? [createRecordReceipt(services.chain), createIssueHeiShares(services.chain), createIssueWatchToken(services.chain)]
      : []),
  ];
}
