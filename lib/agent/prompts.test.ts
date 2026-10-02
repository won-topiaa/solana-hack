import { describe, expect, it } from "vitest";
import { systemPrompt } from "./prompts";

describe("how results reach the user", () => {
  it("in the terminal, the agent quotes the code-made text", () => {
    const prompt = systemPrompt("compare", "2026-10-02", ["compare_paths"]);
    expect(prompt).toContain("quoting its display text exactly");
    expect(prompt).not.toContain("panel");
  });

  it("in the web app, the panel shows results, so the agent writes no figures and repeats nothing", () => {
    const prompt = systemPrompt("compare", "2026-10-02", ["compare_paths"], "web");
    expect(prompt).toContain("Do not repeat any of that in the chat");
    expect(prompt).toContain("Never write money figures, rates, percentages, hashes, ids or links");
    expect(prompt).not.toContain("quoting its display text exactly");
  });

  it("no step tells the agent to quote, whatever the channel", () => {
    for (const stage of ["goal", "capture", "compare", "prepare", "execute"] as const) {
      expect(systemPrompt(stage, "2026-10-02", ["read_watch_photos", "record_receipt_onchain"], "web")).not.toMatch(/[Qq]uote/);
    }
  });
});
