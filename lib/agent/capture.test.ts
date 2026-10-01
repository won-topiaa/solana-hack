import { describe, expect, it } from "vitest";
import { createDemoPropertySource, DEMO_SOURCE_LABEL } from "../integrations/rentcast";
import type { LlmReply } from "./llm";
import { createCaseFile, sendUserMessage } from "./orchestrator";
import { createScriptedLlm } from "./scripted";
import { createAgentTools } from "./tools";
import { PLAID_SANDBOX_LABEL, type MortgageDataSource } from "../integrations/plaid";
import { resolveApproval } from "./orchestrator";
import type { CaseFile } from "./types";

// 2026-10-01 15:00 UTC is 11:00 on 2026-10-01 in New York.
const now = () => new Date("2026-10-01T15:00:00Z");
const DEMO_HOME = "742 Demo Lane, Exampleville, CA 99999";
const tools = createAgentTools({ propertySource: createDemoPropertySource(() => "2026-10-01") });

const say = (text: string): LlmReply => ({ text, toolCalls: [] });
const callTool = (name: string, args: Record<string, unknown>): LlmReply => ({
  text: "",
  toolCalls: [{ name, args, providerCallId: `call-${name}` }],
});

/** A case whose goal is already saved, so the agent is in step 2 (capture). */
function caseInCapture(): CaseFile {
  return {
    ...createCaseFile("case-home", now()),
    stage: "capture",
    goal: { cashNeededUsd: 150_000, neededBy: "2026-11-30", keepAssetIds: [] },
  };
}

describe("home lookup (M4 done-when: address -> AVM range + owner match on demo data)", () => {
  it("stores the value range and the owner check, and keeps personal data out of the model's view", async () => {
    const llm = createScriptedLlm([
      callTool("lookup_home", { address: DEMO_HOME, titleName: "Jordan A. Sample" }),
      say("Here is what I found (demo data). What is the remaining mortgage balance?"),
    ]);
    const turn = await sendUserMessage(caseInCapture(), `My home is ${DEMO_HOME}. The title says Jordan A. Sample.`, {
      llm,
      tools,
      now,
    });

    expect(turn.caseFile.assets).toEqual([
      {
        id: "home-1",
        kind: "real_estate",
        addressRef: "pii-1",
        avm: { low: 930_000, mid: 1_000_000, high: 1_070_000, source: DEMO_SOURCE_LABEL, asOf: "2026-10-01" },
        ownerMatch: "match",
        ownerOccupied: true,
        lastSale: { date: "2015-06-12", priceUsd: 610_000 },
        mortgageBalanceUsd: undefined,
        mortgageSource: undefined,
      },
    ]);

    // The model gets code-made text only: no owner names from the records.
    const toolMessage = llm.requests[1].messages.at(-1);
    expect(toolMessage).toMatchObject({
      role: "tool",
      results: [
        {
          output: {
            found: true,
            assetId: "home-1",
            display: "Estimated value: $930,000 to $1,070,000 (middle $1,000,000). Source: Demo data (simulated RentCast response), 2026-10-01.",
            ownerCheck: "The name on the title matches the owner on public records.",
          },
        },
      ],
    });
    expect(JSON.stringify(toolMessage)).not.toMatch(/Jordan|Demo Lane/);

    // Personal data lives only in the PII store, never in the event log.
    expect(turn.caseFile.pii).toEqual({
      "pii-1": { kind: "address", value: DEMO_HOME },
      "pii-2": { kind: "person_name", value: "Jordan A. Sample" },
    });
    expect(JSON.stringify(turn.caseFile.events)).not.toMatch(/Jordan|Demo Lane/);
  });

  it("flags a home owned by a company for a person to check", async () => {
    const llm = createScriptedLlm([
      callTool("lookup_home", { address: "88 Sample Court, Exampleville, CA 99999", titleName: "Jordan Sample" }),
      say("A person will check the title documents."),
    ]);
    const turn = await sendUserMessage(caseInCapture(), "88 Sample Court", { llm, tools, now });
    expect(turn.caseFile.assets[0]).toMatchObject({ kind: "real_estate", ownerMatch: "partial" });
  });

  it("adds nothing when the address is not found", async () => {
    const llm = createScriptedLlm([
      callTool("lookup_home", { address: "1 Nowhere Rd, Exampleville, CA 99999", titleName: "Jordan Sample" }),
      say("I could not find that address. Could you check it?"),
    ]);
    const turn = await sendUserMessage(caseInCapture(), "1 Nowhere Rd", { llm, tools, now });
    expect(turn.caseFile.assets).toEqual([]);
    expect(turn.caseFile.pii).toEqual({});
  });

  it("updates the same home instead of adding it twice", async () => {
    const lookup = { address: DEMO_HOME, titleName: "Jordan Sample" };
    const llm = createScriptedLlm([callTool("lookup_home", lookup), say("Found."), callTool("lookup_home", lookup), say("Same home.")]);
    const first = await sendUserMessage(caseInCapture(), "my home", { llm, tools, now });
    const second = await sendUserMessage(first.caseFile, "check again", { llm, tools, now });
    expect(second.caseFile.assets).toHaveLength(1);
  });
});

describe("mortgage balance (typed by the user; Plaid comes when keys arrive)", () => {
  it("saves the balance the user states", async () => {
    const llm = createScriptedLlm([
      callTool("lookup_home", { address: DEMO_HOME, titleName: "Jordan Sample" }),
      say("What is the remaining balance?"),
      callTool("record_mortgage", { assetId: "home-1", balanceUsd: 400_000 }),
      say("Saved."),
    ]);
    const first = await sendUserMessage(caseInCapture(), "my home", { llm, tools, now });
    const second = await sendUserMessage(first.caseFile, "About $400,000 left.", { llm, tools, now });
    expect(second.caseFile.assets[0]).toMatchObject({ mortgageBalanceUsd: 400_000, mortgageSource: "user_stated" });
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      results: [{ output: { saved: true, display: "Mortgage balance (as you stated): $400,000." } }],
    });
  });

  it("refuses a negative balance or an unknown home", async () => {
    const llm = createScriptedLlm([
      callTool("record_mortgage", { assetId: "home-9", balanceUsd: 400_000 }),
      say("Please look the home up first."),
    ]);
    const turn = await sendUserMessage(caseInCapture(), "400k", { llm, tools, now });
    expect(turn.caseFile.assets).toEqual([]);
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({ results: [{ output: { saved: false } }] });
  });
});

describe("step gating", () => {
  it("does not offer or run the home lookup before the goal is saved", async () => {
    const llm = createScriptedLlm([callTool("lookup_home", { address: DEMO_HOME, titleName: "Jordan Sample" }), say("First, your goal.")]);
    const turn = await sendUserMessage(createCaseFile("case-early", now()), "Look up my home", { llm, tools, now });
    expect(llm.requests[0].tools.map((tool) => tool.name)).toEqual(["record_goal"]);
    expect(turn.caseFile.assets).toEqual([]);
    expect(llm.requests[1].messages.at(-1)).toMatchObject({
      results: [{ output: { error: "lookup_home is not available at this step" } }],
    });
  });
});

describe("mortgage from the lender through Plaid (approval required)", () => {
  function fakeLender(calls: string[]): MortgageDataSource {
    return {
      async readMortgages() {
        calls.push("readMortgages");
        return [{ balanceUsd: 56_302.06, interestRatePercent: 3.99, interestRateType: "fixed", nextMonthlyPaymentUsd: 3141.54, source: PLAID_SANDBOX_LABEL }];
      },
    };
  }

  it("asks first, contacts Plaid only after a yes, then saves the balance", async () => {
    const calls: string[] = [];
    const plaidTools = createAgentTools({
      propertySource: createDemoPropertySource(() => "2026-10-01"),
      mortgageSource: fakeLender(calls),
    });
    const llm = createScriptedLlm([
      callTool("lookup_home", { address: DEMO_HOME, titleName: "Jordan Sample" }),
      say("Type the balance, or connect your lender?"),
      callTool("connect_mortgage_account", { assetId: "home-1" }),
      say("Saved from your lender."),
    ]);
    const deps = { llm, tools: plaidTools, now };
    const first = await sendUserMessage(caseInCapture(), "my home", deps);
    expect(llm.requests[0].system).toContain("connect_mortgage_account");

    const asked = await sendUserMessage(first.caseFile, "Connect my lender", deps);
    expect(asked.awaitingApproval?.summary).toBe(
      "Connect a lender account through Plaid (sandbox test data) to read the mortgage balance",
    );
    expect(calls).toEqual([]); // nothing sent to Plaid before the user says yes

    const done = await resolveApproval(asked.caseFile, asked.awaitingApproval!.id, true, deps);
    expect(calls).toEqual(["readMortgages"]);
    expect(done.caseFile.assets[0]).toMatchObject({ mortgageBalanceUsd: 56_302.06, mortgageSource: "plaid" });
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      results: [
        {
          output: {
            saved: true,
            display: "Mortgage from the lender (Plaid sandbox (test data)): balance $56,302; rate 3.99% fixed; next payment $3,142.",
          },
        },
      ],
    });
  });

  it("is not offered when Plaid keys are missing", async () => {
    const llm = createScriptedLlm([say("What is the remaining balance?")]);
    await sendUserMessage(caseInCapture(), "my home", { llm, tools, now });
    expect(llm.requests[0].tools.map((tool) => tool.name)).not.toContain("connect_mortgage_account");
    expect(llm.requests[0].system).not.toContain("connect_mortgage_account");
  });
});
