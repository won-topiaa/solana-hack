import { describe, expect, it } from "vitest";
import { createDemoPropertySource } from "../integrations/rentcast";
import { testRegistry } from "../params/test-fixtures";
import { personaCase } from "../recommend/personas";
import type { LlmReply } from "./llm";
import { sendUserMessage } from "./orchestrator";
import { createScriptedLlm } from "./scripted";
import { createAgentTools } from "./tools";

const now = () => new Date("2026-10-01T15:00:00Z");
const tools = createAgentTools({ registry: testRegistry(), propertySource: createDemoPropertySource(() => "2026-10-01") });
const say = (text: string): LlmReply => ({ text, toolCalls: [] });
const callTool = (name: string, args: Record<string, unknown> = {}): LlmReply => ({
  text: "",
  toolCalls: [{ name, args, providerCallId: `call-${name}` }],
});

describe("compare and prepare, through the agent", () => {
  it("records keep choices, compares, and prepares the HEI documents for persona B", async () => {
    const llm = createScriptedLlm([
      callTool("set_keep_assets", { assetIds: ["home-1"] }),
      callTool("compare_paths"),
      say("Recommended: the HEI. Shall I prepare the documents?"),
      callTool("prepare_documents"),
      say("Prepared."),
    ]);
    const deps = { llm, tools, now };
    const compared = await sendUserMessage(personaCase("B", now()), "I keep my home. Compare please.", deps);
    expect(compared.caseFile.stage).toBe("compare");
    expect(compared.caseFile.recommendation?.chosenId).toBe("re-hei");
    const compareOutput = llm.requests[2].messages.at(-1);
    expect(JSON.stringify(compareOutput)).toContain("Recommended: Home equity investment (HEI) of $150,000, tokenized.");

    const prepared = await sendUserMessage(compared.caseFile, "Go ahead.", deps);
    expect(prepared.caseFile.stage).toBe("prepare");
    expect(prepared.caseFile.handoff?.termSheet?.tokenSupply).toBe(234_131);
    expect(prepared.caseFile.handoff?.passports.map((passport) => passport.assetId)).toEqual(["home-1"]);
    expect(prepared.caseFile.handoff?.receipt.recommendationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("Nothing was signed, sent or recorded on-chain.");
  });

  it("refuses to prepare documents after the goal changed, until compared again", async () => {
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("Compared."),
      callTool("record_goal", { cashNeededUsd: 120_000, neededBy: "2026-11-30", repayHorizonYears: 10, monthlyCapacityUsd: 0 }),
      callTool("prepare_documents"),
      say("Let me compare again first."),
    ]);
    const deps = { llm, tools, now };
    const compared = await sendUserMessage(personaCase("B", now()), "Compare.", deps);
    const changed = await sendUserMessage(compared.caseFile, "Actually $120,000, and prepare it.", deps);
    expect(changed.caseFile.handoff).toBeUndefined();
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("Call compare_paths again");
    expect(changed.caseFile.goal?.keepAssetIds).toEqual(["home-1"]); // keep choices survive the goal update
  });

  it("rejects keep choices for assets that do not exist", async () => {
    const llm = createScriptedLlm([callTool("set_keep_assets", { assetIds: ["watch-9"] }), say("Which asset?")]);
    const turn = await sendUserMessage(personaCase("B", now()), "Keep watch 9", { llm, tools, now });
    expect(turn.caseFile.goal?.keepAssetIds).toEqual(["home-1"]);
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("Unknown asset ids: watch-9");
  });
});

describe("the user chooses a path", () => {
  it("asks for a choice when both assets work, then prepares the one the user picked", async () => {
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("Both work. Which asset do you want to use?"),
      callTool("prepare_documents"),
      callTool("prepare_documents", { optionId: "watch-plan" }),
      say("Prepared."),
    ]);
    const deps = { llm, tools, now };
    const compared = await sendUserMessage(personaCase("D", now()), "Compare.", deps);
    expect(compared.caseFile.recommendation?.chosenId).toBeNull();

    const prepared = await sendUserMessage(compared.caseFile, "Use my watches.", deps);
    expect(JSON.stringify(llm.requests[3].messages.at(-1))).toContain("Ask the user which path they want");
    expect(prepared.caseFile.handoff?.receipt).toMatchObject({ recommendedOptionId: null, selectedOptionId: "watch-plan" });
    expect(prepared.caseFile.handoff?.passports.map((passport) => passport.assetId)).toEqual(["watch-1", "watch-2"]);
  });

  it("lets a watch owner tokenize the watch instead of the recommendation, and records both", async () => {
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("Compared."),
      callTool("prepare_documents", { optionId: "w-vault-token-watch-1" }),
      say("Prepared."),
    ]);
    const deps = { llm, tools, now };
    const compared = await sendUserMessage(personaCase("A", now()), "Compare.", deps);
    const prepared = await sendUserMessage(compared.caseFile, "I want to tokenize my sport watch.", deps);
    expect(prepared.caseFile.handoff?.receipt).toMatchObject({ recommendedOptionId: "watch-plan", selectedOptionId: "w-vault-token-watch-1" });
    const text = JSON.stringify(llm.requests.at(-1)?.messages.at(-1));
    expect(text).toContain("Prepared for the path you chose: Vault Demo Diver 300 and issue a 1-of-1 token.");
    expect(text).toContain("Token design: a 1-of-1 token");
  });

  it("refuses a path that does not fit, such as a loan over the monthly budget", async () => {
    const llm = createScriptedLlm([callTool("compare_paths"), say("Compared."), callTool("prepare_documents", { optionId: "re-heloc" }), say("That one does not fit.")]);
    const deps = { llm, tools, now };
    const compared = await sendUserMessage(personaCase("B", now()), "Compare.", deps);
    const refused = await sendUserMessage(compared.caseFile, "Prepare the HELOC.", deps);
    expect(refused.caseFile.handoff).toBeUndefined();
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("cannot be prepared");
  });
});
