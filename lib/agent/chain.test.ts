import { describe, expect, it } from "vitest";
import type { ChainService } from "../chain/adapter";
import { createFakeChain } from "../chain/fake";
import { createDemoPropertySource } from "../integrations/rentcast";
import { testRegistry } from "../params/test-fixtures";
import { personaCase } from "../recommend/personas";
import type { LlmReply } from "./llm";
import { resolveApproval, sendUserMessage, type AgentDeps } from "./orchestrator";
import { createScriptedLlm } from "./scripted";
import { createAgentTools } from "./tools";
import type { CaseFile } from "./types";

// M7 with a stand-in chain (no network). The devnet run is scripts/chain-demo.ts.
const now = () => new Date("2026-10-01T15:00:00Z");
const say = (text: string): LlmReply => ({ text, toolCalls: [] });
const callTool = (name: string, args: Record<string, unknown> = {}): LlmReply => ({
  text: "",
  toolCalls: [{ name, args, providerCallId: `call-${name}` }],
});

function toolsWith(chain: ChainService) {
  return createAgentTools({ registry: testRegistry(), propertySource: createDemoPropertySource(() => "2026-10-01"), chain });
}

/** Runs a turn and approves whatever the agent asks for, as a user saying "yes" would. */
async function turnApproving(caseFile: CaseFile, text: string, deps: AgentDeps) {
  let turn = await sendUserMessage(caseFile, text, deps);
  while (turn.awaitingApproval) turn = await resolveApproval(turn.caseFile, turn.awaitingApproval.id, true, deps);
  return turn;
}

describe("HEI on Solana devnet (persona B)", () => {
  it("records the receipt, then issues the share tokens, each only after approval", async () => {
    const chain = createFakeChain();
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("Compared."),
      callTool("prepare_documents"),
      say("Prepared."),
      callTool("record_receipt_onchain"),
      say("Recorded."),
      callTool("issue_hei_shares"),
      say("Issued."),
    ]);
    const deps = { llm, tools: toolsWith(chain), now };
    const compared = await sendUserMessage(personaCase("B", now()), "Compare.", deps);
    const prepared = await sendUserMessage(compared.caseFile, "Prepare.", deps);

    const asked = await sendUserMessage(prepared.caseFile, "Record the receipt.", deps);
    expect(asked.awaitingApproval?.summary).toContain("receipt");
    expect(chain.calls).toEqual([]); // nothing on-chain before the yes
    const recorded = await resolveApproval(asked.caseFile, asked.awaitingApproval!.id, true, deps);
    expect(recorded.caseFile.handoff?.receipt.txId).toBe("fake-sig-1");
    expect(recorded.caseFile.stage).toBe("execute");

    const issued = await turnApproving(recorded.caseFile, "Issue the tokens.", deps);
    expect(chain.calls.map((call) => call.method)).toEqual(["recordReceipt", "issueHeiShares"]);
    expect(chain.calls[1].input).toMatchObject({ assetId: "home-1", tokenSupply: 234_131 });
    expect(issued.caseFile.handoff?.onchain?.heiShares?.mint).toMatch(/^fake-mint-/);
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("Token: fake://address/fake-mint-");
  });

  it("puts only hashes and ids on-chain: no address, no names", async () => {
    const chain = createFakeChain();
    const llm = createScriptedLlm([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok"), callTool("record_receipt_onchain"), say("ok")]);
    const deps = { llm, tools: toolsWith(chain), now };
    let file = (await sendUserMessage(personaCase("B", now()), "c", deps)).caseFile;
    file = (await sendUserMessage(file, "p", deps)).caseFile;
    await turnApproving(file, "r", deps);
    const memo = String(chain.calls[0].input);
    expect(memo).toMatch(/^ownflow receipt v1 rec=[0-9a-f]{64} passports=[0-9a-f]{64} registry=2026-10-01\.3 selected=re-hei$/);
    expect(memo).not.toMatch(/Demo Lane|Jordan|Exampleville/);
  });

  it("refuses to issue tokens before the receipt is on-chain", async () => {
    const chain = createFakeChain();
    const llm = createScriptedLlm([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok"), callTool("issue_hei_shares"), say("Receipt first.")]);
    const deps = { llm, tools: toolsWith(chain), now };
    let file = (await sendUserMessage(personaCase("B", now()), "c", deps)).caseFile;
    file = (await sendUserMessage(file, "p", deps)).caseFile;
    const turn = await turnApproving(file, "issue", deps);
    expect(chain.calls).toEqual([]);
    expect(turn.caseFile.handoff?.onchain?.heiShares).toBeUndefined();
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("Record the receipt on-chain first");
  });
});

describe("watch token on Solana devnet (persona A, tokenization path)", () => {
  it("issues the 1-of-1 token into the user's wallet after the receipt", async () => {
    const chain = createFakeChain();
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("ok"),
      callTool("prepare_documents", { optionId: "w-vault-token-watch-1" }),
      say("ok"),
      callTool("record_receipt_onchain"),
      say("ok"),
      callTool("issue_watch_token"),
      say("Issued."),
      callTool("issue_hei_shares"),
      say("That is only for an HEI."),
    ]);
    const deps = { llm, tools: toolsWith(chain), now };
    const base = personaCase("A", now());
    const checked = { ...base, assets: base.assets.map((asset) => (asset.kind === "watch" ? { ...asset, theftCheck: "simulated_clear" as const } : asset)) };
    let file = (await sendUserMessage(checked, "c", deps)).caseFile;
    file = (await sendUserMessage(file, "tokenize", deps)).caseFile;
    file = (await turnApproving(file, "record", deps)).caseFile;
    const issued = await turnApproving(file, "issue", deps);
    expect(chain.calls.map((call) => call.method)).toEqual(["recordReceipt", "issueWatchToken"]);
    expect(chain.calls[1].input).toMatchObject({ assetId: "watch-1" });
    expect(JSON.stringify(llm.requests[7].messages.at(-1))).toContain("Vault intake: SIMULATED");

    // Asking for HEI tokens on a watch path is refused.
    const wrong = await turnApproving(issued.caseFile, "hei too", deps);
    expect(chain.calls).toHaveLength(2);
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("only for a prepared HEI path");
    expect(wrong.caseFile.handoff?.onchain?.heiShares).toBeUndefined();
  });
});

describe("a failed devnet call", () => {
  it("becomes a problem the agent can explain, not a crash", async () => {
    const failing: ChainService = {
      ...createFakeChain(),
      async recordReceipt() {
        throw new Error("HTTP error (429): Too Many Requests");
      },
    };
    const llm = createScriptedLlm([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok"), callTool("record_receipt_onchain"), say("It failed.")]);
    const deps = { llm, tools: toolsWith(failing), now };
    let file = (await sendUserMessage(personaCase("B", now()), "c", deps)).caseFile;
    file = (await sendUserMessage(file, "p", deps)).caseFile;
    const turn = await turnApproving(file, "r", deps);
    expect(turn.caseFile.handoff?.receipt.txId).toBeUndefined();
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("The devnet transaction failed: HTTP error (429)");
  });
});

describe("changes after the documents are prepared", () => {
  const smallerGoal = { intent: "home", cashNeededUsd: 120_000, neededBy: "2026-11-30", repayHorizonYears: 10, monthlyCapacityUsd: 0 };

  it("lets the user change the goal, and never puts the old documents on-chain", async () => {
    const chain = createFakeChain();
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("ok"),
      callTool("prepare_documents"),
      say("ok"),
      callTool("record_goal", smallerGoal),
      say("Updated."),
      callTool("record_receipt_onchain"),
      say("Compare again first."),
      callTool("compare_paths"),
      say("ok"),
      callTool("prepare_documents"),
      say("ok"),
      callTool("record_receipt_onchain"),
      say("Recorded."),
    ]);
    const deps = { llm, tools: toolsWith(chain), now };
    let file = (await sendUserMessage(personaCase("B", now()), "c", deps)).caseFile;
    file = (await sendUserMessage(file, "p", deps)).caseFile;
    file = (await sendUserMessage(file, "I only need $120,000.", deps)).caseFile;
    expect(file.goal?.cashNeededUsd).toBe(120_000); // record_goal is offered after the documents

    file = (await turnApproving(file, "record", deps)).caseFile;
    expect(chain.calls).toEqual([]); // the old documents describe $150,000
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("changed after the documents were prepared");

    file = (await sendUserMessage(file, "compare", deps)).caseFile;
    file = (await sendUserMessage(file, "prepare", deps)).caseFile;
    file = (await turnApproving(file, "record", deps)).caseFile;
    expect(chain.calls).toHaveLength(1);
    expect(String(chain.calls[0].input)).toContain(file.handoff?.receipt.recommendationHash ?? "missing");
  });

  it("keeps the chosen path fixed once the receipt is on-chain", async () => {
    const chain = createFakeChain();
    const llm = createScriptedLlm([
      callTool("compare_paths"),
      say("ok"),
      callTool("prepare_documents"),
      say("ok"),
      callTool("record_receipt_onchain"),
      say("Recorded."),
      callTool("record_goal", smallerGoal),
      say("This case cannot change any more."),
    ]);
    const deps = { llm, tools: toolsWith(chain), now };
    let file = (await sendUserMessage(personaCase("B", now()), "c", deps)).caseFile;
    file = (await sendUserMessage(file, "p", deps)).caseFile;
    file = (await turnApproving(file, "record", deps)).caseFile;
    file = (await sendUserMessage(file, "I only need $120,000.", deps)).caseFile;
    expect(file.goal?.cashNeededUsd).toBe(150_000);
    expect(JSON.stringify(llm.requests.at(-1)?.messages.at(-1))).toContain("record_goal is not available at this step");
  });
});

describe("a path without tokens", () => {
  it("mentions only the receipt as the next on-chain step", async () => {
    const llm = createScriptedLlm([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok")]);
    const deps = { llm, tools: toolsWith(createFakeChain()), now };
    let file = (await sendUserMessage(personaCase("B2", now()), "c", deps)).caseFile;
    file = (await sendUserMessage(file, "p", deps)).caseFile;
    expect(file.handoff?.receipt.selectedOptionId).toBe("re-heloc");
    const shown = JSON.stringify(llm.requests.at(-1)?.messages.at(-1));
    expect(shown).toContain("Recording the receipt on Solana is a separate step");
    expect(shown).not.toContain("issuing tokens");
  });
});
