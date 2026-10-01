import { describe, expect, it } from "vitest";
import { createCaseFile, MAX_MODEL_CALLS_PER_TURN, resolveApproval, sendUserMessage } from "./orchestrator";
import { createScriptedLlm } from "./scripted";
import { createDemoPropertySource } from "../integrations/rentcast";
import { createAgentTools, type AgentTool } from "./tools";
import type { LlmReply } from "./llm";

const TOOLS = createAgentTools({ propertySource: createDemoPropertySource() });

// 2026-10-01 15:00 UTC is 11:00 on 2026-10-01 in New York.
const now = () => new Date("2026-10-01T15:00:00Z");

function say(text: string): LlmReply {
  return { text, toolCalls: [] };
}

function callTool(name: string, args: Record<string, unknown>, providerCallId = "call-1"): LlmReply {
  return { text: "", toolCalls: [{ name, args, providerCallId }] };
}

describe("goal intake (M3 done-when: a scripted conversation produces a Goal)", () => {
  it("turns a short conversation into a saved Goal", async () => {
    const llm = createScriptedLlm([
      say("Happy to help. How much cash do you need, and by when?"),
      callTool("record_goal", {
        cashNeededUsd: 30_000,
        neededBy: "2026-10-09",
        keepAssetNotes: ["my steel sport watch"],
      }),
      say("Saved: $30,000 by October 9, keeping your steel sport watch. Next, tell me about your assets."),
    ]);
    const deps = { llm, tools: TOOLS, now };

    const first = await sendUserMessage(createCaseFile("case-1", now()), "Hi, I need some cash.", deps);
    expect(first.reply).toContain("How much cash");
    expect(first.caseFile.goal).toBeUndefined();

    const second = await sendUserMessage(
      first.caseFile,
      "$30,000 by October 9. I want to keep my steel sport watch.",
      deps,
    );
    expect(second.caseFile.goal).toEqual({
      cashNeededUsd: 30_000,
      neededBy: "2026-10-09",
      keepAssetIds: [],
      keepAssetNotes: ["my steel sport watch"],
    });
    expect(second.caseFile.stage).toBe("capture");
    expect(second.reply).toContain("Next");

    // The model saw the tool result (with its own call id) before writing the summary.
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      role: "tool",
      results: [{ name: "record_goal", providerCallId: "call-1", output: { saved: true } }],
    });
  });

  it("gives the model today's date and the tool list", async () => {
    const llm = createScriptedLlm([say("Hello")]);
    await sendUserMessage(createCaseFile("case-2", now()), "Hi", { llm, tools: TOOLS, now });
    expect(llm.requests[0].system).toContain("Today is 2026-10-01");
    expect(llm.requests[0].tools.map((tool) => tool.name)).toEqual(["record_goal"]);
  });

  it("does not save an invalid goal and lets the model ask again", async () => {
    const llm = createScriptedLlm([
      callTool("record_goal", { cashNeededUsd: 30_000, neededBy: "2026-09-01" }),
      say("That date has already passed. When do you need the cash?"),
    ]);
    const turn = await sendUserMessage(createCaseFile("case-3", now()), "$30,000 by September 1", {
      llm,
      tools: TOOLS,
      now,
    });
    expect(turn.caseFile.goal).toBeUndefined();
    expect(turn.caseFile.stage).toBe("goal");
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      role: "tool",
      results: [{ output: { saved: false } }],
    });
  });
});

describe("approval gates", () => {
  // Test-only stand-in for an irreversible tool such as writing a receipt on-chain.
  function gatedTool(ran: unknown[]): AgentTool {
    return {
      declaration: { name: "record_receipt", description: "test tool", parameters: { type: "object", properties: {} } },
      stages: ["goal"],
      requiresApproval: true,
      describeForApproval: () => "Write the recommendation receipt to Solana devnet",
      run: (args, { caseFile }) => {
        ran.push(args);
        return { output: { txId: "test-tx" }, caseFile };
      },
    };
  }

  it("never runs a gated tool before the user approves, then runs it once", async () => {
    const ran: unknown[] = [];
    const llm = createScriptedLlm([callTool("record_receipt", { hash: "abc" }), say("Done: transaction test-tx.")]);
    const deps = { llm, tools: [gatedTool(ran)], now };

    const asked = await sendUserMessage(createCaseFile("case-4", now()), "Record the receipt", deps);
    expect(asked.awaitingApproval?.summary).toBe("Write the recommendation receipt to Solana devnet");
    expect(ran).toEqual([]);
    await expect(sendUserMessage(asked.caseFile, "Hello?", deps)).rejects.toThrow(/pending action/);

    const done = await resolveApproval(asked.caseFile, asked.awaitingApproval!.id, true, deps);
    expect(ran).toEqual([{ hash: "abc" }]);
    expect(done.caseFile.pendingApproval).toBeNull();
    expect(done.reply).toContain("test-tx");
    expect(done.caseFile.events.map((event) => event.type)).toEqual(["approval_requested", "approval_granted"]);
  });

  it("does not run the tool when the user says no, and tells the model", async () => {
    const ran: unknown[] = [];
    const llm = createScriptedLlm([callTool("record_receipt", {}), say("Okay, I did not record it.")]);
    const deps = { llm, tools: [gatedTool(ran)], now };

    const asked = await sendUserMessage(createCaseFile("case-5", now()), "Record it", deps);
    await resolveApproval(asked.caseFile, asked.awaitingApproval!.id, false, deps);
    expect(ran).toEqual([]);
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      role: "tool",
      results: [{ output: { status: "rejected_by_user" } }],
    });
  });
});

describe("safety limits", () => {
  it("answers an unknown tool with an error instead of crashing", async () => {
    const llm = createScriptedLlm([callTool("transfer_funds", {}), say("I cannot do that.")]);
    const turn = await sendUserMessage(createCaseFile("case-6", now()), "Send money", { llm, tools: TOOLS, now });
    expect(turn.reply).toBe("I cannot do that.");
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      results: [{ output: { error: "Unknown tool: transfer_funds" } }],
    });
  });

  it("stops a model that keeps calling tools without answering", async () => {
    const loop = Array.from({ length: MAX_MODEL_CALLS_PER_TURN }, () =>
      callTool("record_goal", { cashNeededUsd: -1, neededBy: "2026-10-09" }),
    );
    const llm = createScriptedLlm(loop);
    await expect(
      sendUserMessage(createCaseFile("case-7", now()), "Hi", { llm, tools: TOOLS, now }),
    ).rejects.toThrow(/without answering/);
  });
});
