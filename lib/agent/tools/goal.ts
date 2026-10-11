// The user's goal (step 1) and the assets to keep.

import { checkGoal } from "../goal";
import { type AgentTool, EDITABLE_STAGES, assetLabel } from "./shared";

export const recordGoal: AgentTool = {
  declaration: {
    name: "record_goal",
    description:
      "Save the user's cash goal. Call it once the user has given at least the amount and the date, " +
      "and again if they change it: then pass what changed; fields you leave out keep their earlier values. " +
      "If anything is missing or invalid it returns problems to ask about.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["home", "watch", "unsure"],
          description: "Which asset the user wants to use or tokenize: their home, a watch, or not sure yet.",
        },
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
  stages: ["goal", ...EDITABLE_STAGES],
  requiresApproval: false,
  run(args, { caseFile, today }) {
    // An update often names only what changed ("$300,000 instead"); the rest of the goal stays,
    // so a monthly budget or a repayment plan is never lost by leaving it out (found in a demo run, 2026-10-11).
    const given = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== undefined));
    const check = checkGoal(caseFile.goal ? { ...caseFile.goal, ...given } : given, today);
    if (!check.ok) return { output: { saved: false, problems: check.problems }, caseFile };
    return {
      output: { saved: true, goal: check.goal },
      // Keep choices made earlier survive a goal update.
      caseFile: {
        ...caseFile,
        goal: { ...check.goal, keepAssetIds: caseFile.goal?.keepAssetIds ?? [] },
        stage: caseFile.stage === "goal" ? "capture" : caseFile.stage,
      },
    };
  },
};

export const setKeepAssets: AgentTool = {
  declaration: {
    name: "set_keep_assets",
    description:
      "Record which assets the user wants to keep, by assetId from earlier tool results (an empty list = none). " +
      "Confirm with the user first.",
    parameters: {
      type: "object",
      properties: { assetIds: { type: "array", items: { type: "string" } } },
      required: ["assetIds"],
    },
  },
  stages: EDITABLE_STAGES,
  requiresApproval: false,
  run(args, { caseFile }) {
    if (!caseFile.goal) return { output: { saved: false, problem: "Save the goal first." }, caseFile };
    const ids = Array.isArray(args.assetIds) ? args.assetIds.filter((id): id is string => typeof id === "string") : [];
    const unknown = ids.filter((id) => !caseFile.assets.some((asset) => asset.id === id));
    if (unknown.length > 0) {
      const known = caseFile.assets.map((asset) => assetLabel(caseFile, asset.id)).join(", ") || "none yet";
      return { output: { saved: false, problem: `Unknown asset ids: ${unknown.join(", ")}. Known assets: ${known}.` }, caseFile };
    }
    const keep = [...new Set(ids)];
    return {
      output: { saved: true, display: `Assets to keep: ${keep.map((id) => assetLabel(caseFile, id)).join(", ") || "none"}.` },
      caseFile: { ...caseFile, goal: { ...caseFile.goal, keepAssetIds: keep } },
    };
  },
};
