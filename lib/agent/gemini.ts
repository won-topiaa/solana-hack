// Gemini API adapter (SDK: @google/genai).
// Docs: https://ai.google.dev/gemini-api/docs/function-calling
// Gemini 3 models attach thought signatures to their replies and need every
// reply sent back unchanged, so each reply is stored as-is (`raw`) and resent.

import { GoogleGenAI, type Content, type Part } from "@google/genai";
import type { LlmClient, LlmReply, LlmRequest, LlmToolCall } from "./llm";
import type { AgentMessage } from "./types";

/** Checked 2026-10-01: stable, supports function calling and image input. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Our conversation -> Gemini `contents`. Tool results go back with role "user". */
export function toGeminiContents(messages: AgentMessage[]): Content[] {
  return messages.map((message): Content => {
    switch (message.role) {
      case "user":
        return { role: "user", parts: [{ text: message.text }] };
      case "model": {
        if (message.raw) return message.raw as Content;
        // No original reply (e.g. a scripted one): rebuild it from text and calls.
        const textParts: Part[] = message.text ? [{ text: message.text }] : [];
        const callParts: Part[] = message.toolCalls.map((call) => ({
          functionCall: { id: call.providerCallId, name: call.name, args: call.args },
        }));
        return { role: "model", parts: [...textParts, ...callParts] };
      }
      case "tool":
        return {
          role: "user",
          parts: message.results.map((result) => ({
            functionResponse: { id: result.providerCallId, name: result.name, response: result.output },
          })),
        };
    }
  });
}

/** Gemini reply -> our reply. Thought parts are not shown to the user. */
export function fromGeminiContent(content: Content | undefined): LlmReply {
  const parts: Part[] = content?.parts ?? [];
  const text = parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("");
  const toolCalls: LlmToolCall[] = parts
    .filter((part) => part.functionCall)
    .map((part) => ({
      name: part.functionCall?.name ?? "",
      args: part.functionCall?.args ?? {},
      providerCallId: part.functionCall?.id,
    }));
  return { text, toolCalls, raw: content };
}

export function createGeminiClient(options: { apiKey: string; model?: string }): LlmClient {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_GEMINI_MODEL;
  return {
    async generate(request: LlmRequest): Promise<LlmReply> {
      const functionDeclarations = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      }));
      const response = await ai.models.generateContent({
        model,
        contents: toGeminiContents(request.messages),
        config: {
          systemInstruction: request.system,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
        },
      });
      return fromGeminiContent(response.candidates?.[0]?.content);
    },
  };
}
