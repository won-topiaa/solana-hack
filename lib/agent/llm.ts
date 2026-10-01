// The one interface the orchestrator uses to talk to a language model.
// gemini.ts implements it for the Gemini API and scripted.ts replays fixed
// replies in tests, so the rest of the agent does not depend on a provider.

import type { AgentMessage } from "./types";

/** A JSON Schema object that describes a tool's arguments. */
export type JsonSchema = Record<string, unknown>;

export type ToolDeclaration = { name: string; description: string; parameters: JsonSchema };

export type LlmRequest = { system: string; messages: AgentMessage[]; tools: ToolDeclaration[] };

export type LlmToolCall = { name: string; args: Record<string, unknown>; providerCallId?: string };

export type LlmReply = { text: string; toolCalls: LlmToolCall[]; raw?: unknown };

export interface LlmClient {
  generate(request: LlmRequest): Promise<LlmReply>;
}
