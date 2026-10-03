// Compare every path (step 5) and prepare the handoff documents (step 6, off-chain).

import { checkParamsFresh } from "../../params/staleness";
import type { Registry } from "../../params/types";
import { hashOf } from "../../recommend/canonical";
import { describeRecommendation } from "../../recommend/display";
import { buildPassport, buildReceipt, type AssetPassport } from "../../recommend/passport";
import { realEstateTerms, recommend } from "../../recommend/recommend";
import { buildHeiTermSheet, describeTermSheet, type HeiTermSheet } from "../../recommend/termSheet";
import { isSelectable } from "../../recommend/watches";
import { type AgentTool, EDITABLE_STAGES, assetLabel, inputsChanged } from "./shared";

export function createComparePaths(registry: Registry): AgentTool {
  return {
    declaration: {
      name: "compare_paths",
      description:
        "Compare every way to raise the cash for the saved goal and assets, and recommend one with fixed rules. " +
        "Call it when the goal, the assets and the keep choices are covered, and again after any change. " +
        "Explain only with the reasons it gives.",
      parameters: { type: "object", properties: {} },
    },
    stages: EDITABLE_STAGES,
    requiresApproval: false,
    run(_args, { caseFile, today, now }) {
      const result = recommend(caseFile, registry, today, now);
      if (result.status === "not_ready") return { output: { compared: false, problems: result.problems }, caseFile };
      if (result.status === "needs_fresh_data") {
        const keys = result.stale.map((item) => item.key).join(", ");
        return {
          output: { compared: false, status: "needs_fresh_data", display: `Needs fresh data: these values are out of date, so no recommendation can be finished: ${keys}.` },
          caseFile: { ...caseFile, recommendation: undefined, handoff: undefined },
        };
      }
      const recommendation = result.recommendation;
      return {
        output: {
          compared: true,
          chosenId: recommendation.chosenId,
          rulesFired: recommendation.rulesFired,
          display: describeRecommendation(recommendation).join("\n"),
        },
        caseFile: { ...caseFile, recommendation, handoff: undefined, stage: "compare" },
      };
    },
  };
}

export function createPrepareDocuments(registry: Registry): AgentTool {
  return {
    declaration: {
      name: "prepare_documents",
      description:
        "Prepare the handoff for a path: the HEI term sheet (when the path is an HEI), an asset passport for each " +
        "asset it uses, and the recommendation receipt with their hashes. Use the recommended path, or the optionId " +
        "of the path the user chose. Nothing is signed, sent or recorded on-chain.",
      parameters: {
        type: "object",
        properties: {
          optionId: { type: "string", description: "The id of the path the user chose; leave out to use the recommended one." },
        },
      },
    },
    stages: ["compare", "prepare"],
    requiresApproval: false,
    run(args, { caseFile, now, today }) {
      const recommendation = caseFile.recommendation;
      if (!recommendation) return { output: { prepared: false, problem: "Compare the paths first." }, caseFile };
      if (inputsChanged(caseFile)) {
        return { output: { prepared: false, problem: "The goal or assets changed after the comparison. Call compare_paths again." }, caseFile };
      }
      const optionId = typeof args.optionId === "string" ? args.optionId : recommendation.chosenId;
      if (!optionId) {
        return { output: { prepared: false, problem: "There is no single recommended path. Ask the user which path they want and pass its optionId." }, caseFile };
      }
      const chosen = recommendation.options.find((option) => option.id === optionId);
      if (!chosen) return { output: { prepared: false, problem: `No path with id ${optionId} in the comparison.` }, caseFile };
      if (!isSelectable(chosen)) {
        return { output: { prepared: false, problem: `${chosen.label} cannot be prepared: ${chosen.whyNotSuitable ?? "it is shown for information only"}` }, caseFile };
      }
      // The documents must rest on the same, still fresh values as the comparison (M2 gate).
      if (recommendation.registryVersion !== registry.registry_version) {
        return { output: { prepared: false, problem: "The parameter registry changed since the comparison. Call compare_paths again." }, caseFile };
      }
      const freshness = checkParamsFresh(registry, chosen.usedParamKeys, registry.frozenOn ?? today);
      if (!freshness.ok) {
        return { output: { prepared: false, problem: `These values went out of date since the comparison: ${freshness.stale.map((item) => item.key).join(", ")}. Call compare_paths again.` }, caseFile };
      }
      // A vault takes a watch only after a passing stolen-watch check, so the passport must already include it.
      const tokenizesWatch = chosen.id.startsWith("w-vault-token-");
      const vaultedWatch = tokenizesWatch
        ? caseFile.assets.find((asset) => asset.id === chosen.assetIds[0] && asset.kind === "watch")
        : undefined;
      if (vaultedWatch?.kind === "watch" && vaultedWatch.theftCheck !== "clear" && vaultedWatch.theftCheck !== "simulated_clear") {
        return { output: { prepared: false, problem: "Run the stolen-watch registry check first (check_watch_registry); a vault needs it." }, caseFile };
      }
      const recommended = recommendation.options.find((option) => option.id === recommendation.chosenId);

      let file = caseFile;
      const passports: AssetPassport[] = [];
      for (const assetId of chosen.assetIds) {
        const built = buildPassport(file, assetId);
        file = built.caseFile;
        passports.push(built.passport);
      }
      let termSheet: HeiTermSheet | undefined;
      const home = file.assets.find((asset) => asset.id === chosen.assetIds[0]);
      if (chosen.id === "re-hei" && home?.kind === "real_estate" && home.avm) {
        termSheet = buildHeiTermSheet(
          { assetId: home.id, valueUsd: home.avm.mid, mortgageBalanceUsd: home.mortgageBalanceUsd, valueSource: home.avm.source, valueAsOf: home.avm.asOf },
          recommendation.inputs.goal.cashNeededUsd,
          recommendation.inputs.horizonYears,
          realEstateTerms(registry),
          recommendation.registryVersion,
        );
      }
      const receipt = buildReceipt(recommendation, passports, now, chosen.id);
      const whose =
        chosen.id === recommendation.chosenId
          ? `Prepared for the recommended path: ${chosen.label}.`
          : `Prepared for the path you chose: ${chosen.label}. ${recommended ? `The recommendation was ${recommended.label}; ` : ""}the receipt records both.`;
      const tokenDesign = tokenizesWatch
        ? ["Token design: a 1-of-1 token (supply 1, no decimals) that stands for the vaulted watch; redeeming it releases the watch. Vault intake is simulated in this demo."]
        : [];
      const lines = [
        `${whose} Nothing was signed, sent or recorded on-chain.`,
        ...(termSheet ? describeTermSheet(termSheet) : []),
        ...tokenDesign,
        ...passports.map((passport) => `Asset passport for ${assetLabel(file, passport.assetId)}: hash ${hashOf(passport)}.`),
        `Recommendation receipt: recommendation hash ${receipt.recommendationHash}; passports hash ${receipt.passportHash}; parameter registry ${receipt.registryVersion}.`,
        chosen.id === "re-hei" || tokenizesWatch
          ? "Recording the receipt on Solana and issuing tokens are separate steps, and each needs your approval."
          : "Recording the receipt on Solana is a separate step and needs your approval.",
      ];
      return {
        output: { prepared: true, display: lines.join("\n") },
        caseFile: { ...file, handoff: { termSheet, passports, receipt }, stage: "prepare" },
      };
    },
  };
}
