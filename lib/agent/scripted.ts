// A stand-in language model for tests: it returns pre-written replies in order
// and keeps every request it received, so a conversation can be replayed
// exactly, without the network.

import type { LlmClient, LlmReply, LlmRequest } from "./llm";

type ScriptedLlm = LlmClient & { requests: LlmRequest[] };

export function createScriptedLlm(replies: LlmReply[]): ScriptedLlm {
  const queue = [...replies];
  const requests: LlmRequest[] = [];
  return {
    requests,
    async generate(request: LlmRequest): Promise<LlmReply> {
      requests.push(structuredClone(request));
      const next = queue.shift();
      if (!next) throw new Error("The scripted model has no reply left");
      return next;
    },
  };
}
