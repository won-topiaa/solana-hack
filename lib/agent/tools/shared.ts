// What every agent tool shares: the tool shape, the steps where the case can still change,
// the private store for personal data, and the checks that the documents still describe the case.

import type { PiiItem } from "../../assets/types";
import type { SignedByWallet } from "../../chain/userWallet";
import { hashOf } from "../../recommend/canonical";
import { buildPassport } from "../../recommend/passport";
import { assetSummaries, watchLabel } from "../../recommend/recommend";
import type { ToolDeclaration } from "../llm";
import type { CaseFile, Stage } from "../types";

/** `signed`: the user's wallet signature for the step being approved, when the case has the user's own wallet. */
type ToolContext = { caseFile: CaseFile; today: string; now: Date; signed?: SignedByWallet };

export type ToolOutcome = { output: Record<string, unknown>; caseFile: CaseFile };

export type AgentTool = {
  declaration: ToolDeclaration;
  stages: Stage[]; // the steps in which the model is offered this tool
  requiresApproval: boolean;
  /** The sentence the user approves or rejects. */
  describeForApproval?: (args: Record<string, unknown>, caseFile: CaseFile) => string;
  run: (args: Record<string, unknown>, context: ToolContext) => ToolOutcome | Promise<ToolOutcome>;
};

/**
 * Until something is on-chain the user may still change the goal and the assets, even
 * after the documents are prepared (compare_paths then starts over). Once the receipt is
 * on-chain (stage "execute") the recorded choice is final.
 */
export const EDITABLE_STAGES: Stage[] = ["capture", "compare", "prepare"];

/** Puts personal data in the case file's PII store and returns its key. */
export function storePii(caseFile: CaseFile, item: PiiItem): { caseFile: CaseFile; ref: string } {
  const ref = `pii-${Object.keys(caseFile.pii).length + 1}`;
  return { caseFile: { ...caseFile, pii: { ...caseFile.pii, [ref]: item } }, ref };
}

/** A name for an asset that carries no personal data (no address, no serial). */
export function assetLabel(caseFile: CaseFile, assetId: string): string {
  const asset = caseFile.assets.find((item) => item.id === assetId);
  if (!asset) return assetId;
  return asset.kind === "real_estate" ? `your home (${asset.id})` : `${watchLabel(asset)} (${asset.id})`;
}

/** True when the goal or the asset values differ from what the latest comparison used. */
export function inputsChanged(caseFile: CaseFile): boolean {
  const rec = caseFile.recommendation;
  if (!rec) return true;
  return hashOf(rec.inputs.goal) !== hashOf(caseFile.goal) || hashOf(rec.inputs.assets) !== hashOf(assetSummaries(caseFile));
}

/**
 * The goal and assets can still change after the documents are prepared; then the
 * documents no longer describe the case and must not go on-chain. Besides the values the
 * comparison used, each passport is rebuilt from the case: a new serial number, theft
 * check or photo changes its hash.
 */
export function documentsChanged(caseFile: CaseFile): boolean {
  const handoff = caseFile.handoff;
  if (!handoff || inputsChanged(caseFile)) return true;
  return handoff.passports.some((passport) => {
    try {
      return hashOf(buildPassport(caseFile, passport.assetId).passport) !== hashOf(passport);
    } catch {
      return true; // the asset or its address is gone
    }
  });
}

/** The label of the path the documents were prepared for, for the approval sentence. */
export function selectedPathLabel(caseFile: CaseFile): string {
  const selected = caseFile.handoff?.receipt.selectedOptionId;
  return caseFile.recommendation?.options.find((option) => option.id === selected)?.label ?? selected ?? "the prepared path";
}
