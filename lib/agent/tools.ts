// Tools the model may call. Each tool is plain code. A tool that does something
// irreversible (minting, a transfer, an on-chain receipt, contacting a partner)
// sets requiresApproval, and the orchestrator never runs it before the user says yes.

import { checkGoal } from "./goal";
import type { ToolDeclaration } from "./llm";
import type { CaseFile } from "./types";

export type ToolContext = { caseFile: CaseFile; today: string };

export type ToolOutcome = { output: Record<string, unknown>; caseFile: CaseFile };

export type AgentTool = {
  declaration: ToolDeclaration;
  requiresApproval: boolean;
  /** The sentence the user approves or rejects. */
  describeForApproval?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, context: ToolContext) => ToolOutcome | Promise<ToolOutcome>;
};

export const recordGoal: AgentTool = {
  declaration: {
    name: "record_goal",
    description:
      "Save the user's cash goal. Call it once the user has given at least the amount and the date. " +
      "If anything is missing or invalid it returns problems to ask the user about.",
    parameters: {
      type: "object",
      properties: {
        cashNeededUsd: { type: "number", description: "Cash the user needs, in US dollars." },
        neededBy: { type: "string", description: "Date the cash is needed by, as YYYY-MM-DD." },
        repayHorizonYears: { type: "number", description: "Years until the user expects to repay, if they said." },
        keepAssetNotes: {
          type: "array",
          items: { type: "string" },
          description: "Assets the user wants to keep, in their own words.",
        },
        monthlyCapacityUsd: { type: "number", description: "What the user could pay each month, in US dollars, if they said." },
        age62Plus: { type: "boolean", description: "True if the user said they are 62 or older." },
      },
      required: ["cashNeededUsd", "neededBy"],
    },
  },
  requiresApproval: false,
  run(args, { caseFile, today }) {
    const check = checkGoal(args, today);
    if (!check.ok) return { output: { saved: false, problems: check.problems }, caseFile };
    return {
      output: { saved: true, goal: check.goal },
      caseFile: { ...caseFile, goal: check.goal, stage: "capture" },
    };
  },
};

/** The tools available in the current milestone (M3: goal intake only). */
export const AGENT_TOOLS: AgentTool[] = [recordGoal];
