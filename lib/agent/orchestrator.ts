// Runs the conversation: sends it to the model, runs the tools the model asks
// for, and pauses at any tool that needs the user's approval.
// The orchestrator never computes money itself; tools (plain code) do.

import { todayInNewYork } from "../params/dates";
import type { LlmClient } from "./llm";
import { systemPrompt, type Channel } from "./prompts";
import type { SignedByWallet } from "../chain/userWallet";
import type { AgentTool } from "./tools";
import type { AgentMessage, CaseFile, PendingApproval, ToolCall, ToolResult } from "./types";

/** Safety stop: a model that keeps calling tools cannot loop forever. */
export const MAX_MODEL_CALLS_PER_TURN = 6;

const EMPTY_REPLY = "Sorry, I could not produce an answer. Please try again.";
const AFTER_STEP_REPLY = "The approved step ran and its result is saved in the case, but I could not write an answer. Ask me to continue.";

export type AgentDeps = { llm: LlmClient; tools: AgentTool[]; now?: () => Date; channel?: Channel };

export type TurnResult = { caseFile: CaseFile; reply: string; awaitingApproval: PendingApproval | null };

export function createCaseFile(id: string, now: Date = new Date()): CaseFile {
  return {
    id,
    createdAt: now.toISOString(),
    stage: "goal",
    assets: [],
    pii: {},
    photos: {},
    messages: [],
    pendingApproval: null,
    events: [],
  };
}

function currentTime(deps: AgentDeps): Date {
  return deps.now ? deps.now() : new Date();
}

function withMessage(file: CaseFile, message: AgentMessage): CaseFile {
  return { ...file, messages: [...file.messages, message] };
}

function withEvent(file: CaseFile, deps: AgentDeps, type: string, detail: string): CaseFile {
  return { ...file, events: [...file.events, { at: currentTime(deps).toISOString(), type, detail }] };
}

function resultFor(call: ToolCall, output: Record<string, unknown>): ToolResult {
  return { callId: call.id, providerCallId: call.providerCallId, name: call.name, output };
}

/** The user says something; the agent answers, possibly after running tools. */
export async function sendUserMessage(caseFile: CaseFile, text: string, deps: AgentDeps): Promise<TurnResult> {
  if (caseFile.pendingApproval) {
    throw new Error("Approve or reject the pending action before sending a new message");
  }
  return runModelLoop(withMessage(caseFile, { role: "user", text }), deps);
}

/**
 * The user answers an approval request. Only a "yes" lets the tool run. `signed` is the
 * user's wallet signature for the step, when the step needs one.
 */
export async function resolveApproval(
  caseFile: CaseFile,
  approvalId: string,
  approved: boolean,
  deps: AgentDeps,
  signed?: SignedByWallet,
): Promise<TurnResult> {
  const pending = caseFile.pendingApproval;
  if (!pending || pending.id !== approvalId) throw new Error(`No pending approval with id ${approvalId}`);

  let file: CaseFile = { ...caseFile, pendingApproval: null };
  let output: Record<string, unknown> = { status: "rejected_by_user" };
  if (approved) {
    const tool = deps.tools.find((candidate) => candidate.declaration.name === pending.call.name);
    if (!tool) throw new Error(`Tool ${pending.call.name} is no longer available`);
    const time = currentTime(deps);
    const outcome = await tool.run(pending.call.args, { caseFile: file, today: todayInNewYork(time), now: time, signed });
    file = outcome.caseFile;
    output = outcome.output;
  }
  file = withEvent(file, deps, approved ? "approval_granted" : "approval_rejected", pending.summary);

  // Answer every call of that model reply at once, in the order it asked for them.
  const results = [...pending.heldResults];
  results.splice(pending.insertAt, 0, resultFor(pending.call, output));
  const answered = withMessage(file, { role: "tool", results });
  if (!approved) return runModelLoop(answered, deps);
  try {
    return await runModelLoop(answered, deps);
  } catch {
    // The approved step has already run (perhaps on-chain). Keep its result even when the
    // model fails now; otherwise the case would still ask for approval and run it twice.
    const failed = withEvent(answered, deps, "model_failed_after_approval", pending.call.name);
    return { caseFile: withMessage(failed, { role: "model", text: AFTER_STEP_REPLY, toolCalls: [] }), reply: AFTER_STEP_REPLY, awaitingApproval: null };
  }
}

async function runModelLoop(start: CaseFile, deps: AgentDeps): Promise<TurnResult> {
  let file = start;
  for (let round = 0; round < MAX_MODEL_CALLS_PER_TURN; round += 1) {
    const today = todayInNewYork(currentTime(deps));
    // Each step offers only its own tools, so the model cannot skip ahead.
    const offered = deps.tools.filter((tool) => tool.stages.includes(file.stage)).map((tool) => tool.declaration);
    const reply = await deps.llm.generate({
      system: systemPrompt(file.stage, today, offered.map((tool) => tool.name), deps.channel),
      messages: file.messages,
      tools: offered,
    });
    const toolCalls: ToolCall[] = reply.toolCalls.map((call, index) => ({
      id: `m${file.messages.length}-c${index}`,
      ...call,
    }));
    file = withMessage(file, { role: "model", text: reply.text, toolCalls, raw: reply.raw });
    if (toolCalls.length === 0) {
      return { caseFile: file, reply: reply.text || EMPTY_REPLY, awaitingApproval: null };
    }

    const step = await runToolCalls(file, toolCalls, deps, today);
    file = step.caseFile;
    if (step.pending) {
      file = withEvent({ ...file, pendingApproval: step.pending }, deps, "approval_requested", step.pending.summary);
      const approvalReply = reply.text || `Approval needed: ${step.pending.summary}`;
      return { caseFile: file, reply: approvalReply, awaitingApproval: step.pending };
    }
    file = withMessage(file, { role: "tool", results: step.results });
  }
  throw new Error(`The model asked for tools ${MAX_MODEL_CALLS_PER_TURN} times in a row without answering`);
}

async function runToolCalls(
  start: CaseFile,
  calls: ToolCall[],
  deps: AgentDeps,
  today: string,
): Promise<{ caseFile: CaseFile; results: ToolResult[]; pending: PendingApproval | null }> {
  let file = start;
  const results: ToolResult[] = [];
  let pending: PendingApproval | null = null;

  for (const call of calls) {
    const tool = deps.tools.find((candidate) => candidate.declaration.name === call.name);
    if (!tool) {
      results.push(resultFor(call, { error: `Unknown tool: ${call.name}` }));
    } else if (!tool.stages.includes(file.stage)) {
      results.push(resultFor(call, { error: `${call.name} is not available at this step` }));
    } else if (tool.requiresApproval && pending) {
      // Keep it simple for the user: one decision at a time.
      results.push(resultFor(call, { error: "Only one action can wait for approval at a time. Ask again later." }));
    } else if (tool.requiresApproval) {
      pending = {
        id: `approval-${call.id}`,
        call,
        summary: tool.describeForApproval?.(call.args, file) ?? `Run ${call.name}`,
        heldResults: [],
        insertAt: results.length,
        requestedAt: currentTime(deps).toISOString(),
      };
    } else {
      const outcome = await tool.run(call.args, { caseFile: file, today, now: currentTime(deps) });
      file = withEvent(outcome.caseFile, deps, "tool_run", call.name);
      results.push(resultFor(call, outcome.output));
    }
  }
  return { caseFile: file, results, pending: pending ? { ...pending, heldResults: results } : null };
}
