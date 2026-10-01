import { describe, expect, it } from "vitest";
import { fromGeminiContent, toGeminiContents } from "./gemini";

// Shapes seen in a real gemini-3.8-flash reply on 2026-10-01: the function
// call part carries a thoughtSignature that must go back unchanged.
const realReply = {
  role: "model",
  parts: [
    {
      functionCall: { id: "call_199446", name: "record_goal", args: { cashNeededUsd: 30_000, neededBy: "2026-10-09" } },
      thoughtSignature: "opaque-signature",
    },
  ],
};

describe("fromGeminiContent", () => {
  it("reads tool calls with the model's call id and keeps the raw reply", () => {
    const reply = fromGeminiContent(realReply);
    expect(reply.toolCalls).toEqual([
      { name: "record_goal", args: { cashNeededUsd: 30_000, neededBy: "2026-10-09" }, providerCallId: "call_199446" },
    ]);
    expect(reply.raw).toBe(realReply);
  });

  it("shows text but hides the model's thought parts", () => {
    const reply = fromGeminiContent({
      role: "model",
      parts: [{ text: "internal reasoning", thought: true }, { text: "How much do you need?" }],
    });
    expect(reply.text).toBe("How much do you need?");
  });
});

describe("toGeminiContents", () => {
  it("resends a model reply exactly as received (thought signature included)", () => {
    const [content] = toGeminiContents([{ role: "model", text: "", toolCalls: [], raw: realReply }]);
    expect(content).toBe(realReply);
  });

  it("sends tool results as functionResponse parts from the user, with the call id", () => {
    const [content] = toGeminiContents([
      {
        role: "tool",
        results: [{ callId: "m1-c0", providerCallId: "call_199446", name: "record_goal", output: { saved: true } }],
      },
    ]);
    expect(content).toEqual({
      role: "user",
      parts: [{ functionResponse: { id: "call_199446", name: "record_goal", response: { saved: true } } }],
    });
  });

  it("sends user text as a user message", () => {
    expect(toGeminiContents([{ role: "user", text: "Hi" }])).toEqual([{ role: "user", parts: [{ text: "Hi" }] }]);
  });
});
