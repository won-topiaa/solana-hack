import { describe, expect, it } from "vitest";
import data from "../../data/demo/personas.json";
import type { LlmReply } from "../agent/llm";
import { createScriptedLlm } from "../agent/scripted";
import { createAgentTools } from "../agent/tools";
import type { CaseFile } from "../agent/types";
import type { SaleRecord, SettlementRecord } from "../chain/heiLifecycle";
import { createFakeChain } from "../chain/fake";
import { createDemoPropertySource } from "../integrations/rentcast";
import type { WatchVision } from "../integrations/vision";
import { testRegistry } from "../params/test-fixtures";
import { openCase, sealCase } from "./caseToken";
import { BadRequest, CASE_LIMITS, postApproval, postMessage, runHeiSale, runHeiSettlement, startCase, WEB_PHOTO_BYTES, type WebDeps } from "./handlers";

const secret = "web-test-secret-that-is-long-enough-12345";
const now = () => new Date("2026-10-01T15:00:00Z");
const say = (text: string): LlmReply => ({ text, toolCalls: [] });
const callTool = (name: string, args: Record<string, unknown> = {}): LlmReply => ({ text: "", toolCalls: [{ name, args, providerCallId: `call-${name}` }] });

const vision: WatchVision = {
  async read() {
    return { maker: "Demo Watch Co.", model: "Demo Diver 300", reference: "DEMO-300", serial: "DW7731842", caseMaterial: "steel", style: "sport", boxVisible: false, papersVisible: true, notes: "" };
  },
};

function depsWith(replies: LlmReply[], extra: Partial<WebDeps> = {}): WebDeps {
  const tools = createAgentTools({ registry: testRegistry(), propertySource: createDemoPropertySource(() => "2026-10-01"), vision, chain: createFakeChain() });
  return { agent: { llm: createScriptedLlm(replies), tools, now }, registry: testRegistry(), secret, now, ...extra };
}

describe("starting a case", () => {
  it("starts empty, or with a demo persona whose personal data stays out of the view", () => {
    const empty = startCase(depsWith([]), {});
    expect(empty.view).toMatchObject({ stage: "goal", chat: [], goal: null, persona: null });

    const persona = startCase(depsWith([]), { persona: "B" });
    expect(persona.view.persona?.id).toBe("B");
    expect(persona.view.goal?.[0]).toBe("$150,000 needed by 2026-11-30");
    expect(persona.view.assets[0].title).toBe("Your home (home-1)");
    expect(JSON.stringify(persona.view)).not.toContain(data.home.address.split(",")[0]);
    expect(openCase(persona.token, secret).goal?.cashNeededUsd).toBe(150_000);
  });

  it("refuses an unknown persona", () => {
    expect(() => startCase(depsWith([]), { persona: "Z" })).toThrow(BadRequest);
  });
});

describe("talking to the agent", () => {
  it("shows the comparison with the sources of the values behind it", async () => {
    const deps = depsWith([callTool("compare_paths"), say("Here is the comparison.")]);
    const started = startCase(deps, { persona: "B" });
    const compared = await postMessage(deps, { token: started.token, text: "Compare my options." });
    const comparison = compared.view.comparison!;
    expect(comparison.headline).toBe("Recommended: Home equity investment (HEI) of $150,000, tokenized");
    expect(comparison.rows.find((row) => row.recommended)?.id).toBe("re-hei");
    expect(comparison.notice).toBe("This is not investment or financial advice.");
    const heloc = comparison.sources.find((source) => source.label === "Average HELOC rate");
    expect(heloc?.value).toMatch(/^\d+(\.\d+)?%$/);
    expect(comparison.sources.find((source) => source.label === "HEI minimum fee")?.value).toMatch(/^\$[\d,]+$/);
    expect(compared.view.chat).toEqual([
      { role: "user", text: "Compare my options." },
      { role: "agent", text: "Here is the comparison." },
    ]);
  });

  it("waits for the user's approval, refuses other messages meanwhile, then shows the on-chain link", async () => {
    const deps = depsWith([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok"), callTool("record_receipt_onchain"), say("Recorded.")]);
    let reply = startCase(deps, { persona: "B" });
    reply = await postMessage(deps, { token: reply.token, text: "Compare." });
    reply = await postMessage(deps, { token: reply.token, text: "Prepare." });
    expect(reply.view.documents?.selected).toBe("Home equity investment (HEI) of $150,000, tokenized");
    reply = await postMessage(deps, { token: reply.token, text: "Record the receipt." });
    expect(reply.view.approval?.summary).toContain("receipt");
    await expect(postMessage(deps, { token: reply.token, text: "Hello?" })).rejects.toThrow(/Answer the approval request first/);
    await expect(postApproval(deps, { token: reply.token, approvalId: "other", approved: true })).rejects.toThrow(/No such approval/);

    const approved = await postApproval(deps, { token: reply.token, approvalId: reply.view.approval!.id, approved: true });
    expect(approved.view.approval).toBeNull();
    expect(approved.view.onchain.map((link) => link.label)).toEqual(["Recommendation receipt (memo)"]);
  });

  it("asks the model for short replies when the deps say web", async () => {
    const deps = depsWith([callTool("compare_paths"), say("Done: see the comparison in the panel.")]);
    const webDeps = { ...deps, agent: { ...deps.agent, channel: "web" as const } };
    const started = startCase(webDeps, { persona: "B" });
    await postMessage(webDeps, { token: started.token, text: "Compare." });
    const llm = webDeps.agent.llm as ReturnType<typeof createScriptedLlm>;
    expect(llm.requests.every((request) => request.system.includes("Do not repeat any of that in the chat"))).toBe(true);
  });

  it("refuses a token the browser changed", async () => {
    const reply = startCase(depsWith([]), {});
    await expect(postMessage(depsWith([]), { token: `${reply.token.slice(0, -4)}AAAA`, text: "hi" })).rejects.toThrow(BadRequest);
  });

  it("reads an uploaded photo, then keeps only its hash", async () => {
    const deps = depsWith([callTool("read_watch_photos", { photoIds: ["photo-1"] }), say("I read your watch.")]);
    const started = startCase(deps, { persona: "A" });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    const reply = await postMessage(deps, { token: started.token, text: "", photo: { mimeType: "image/png", dataBase64: png } });
    expect(reply.view.chat[0].text).toBe("I uploaded a photo (photo-1).");
    expect(reply.view.assets.some((asset) => asset.lines.some((line) => line.startsWith("Read from 1 photo")))).toBe(true);
    const photo = openCase(reply.token, secret).photos["photo-1"];
    expect(photo.dataBase64).toBeUndefined();
    expect(photo.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(reply.view)).not.toContain("DW7731842");
  });
});

describe("partner steps", () => {
  function issuedCase(onchain: Record<string, unknown> = {}): string {
    const deps = depsWith([]);
    const base = openCase(startCase(deps, { persona: "B" }).token, secret);
    const caseFile: CaseFile = {
      ...base,
      handoff: {
        passports: [],
        receipt: { recommendedOptionId: "re-hei", selectedOptionId: "re-hei", recommendationHash: "a".repeat(64), passportHash: "b".repeat(64), registryVersion: "test", createdAt: now().toISOString() },
        termSheet: { termYears: 10 } as never,
        onchain: { heiShares: { network: "devnet", signatures: [], explorerUrls: [], mint: "11111111111111111111111111111111", treasury: "11111111111111111111111111111111", at: "" }, ...onchain },
      },
    };
    return sealCase(caseFile, secret);
  }

  it("are refused when devnet is not set up, or before the shares exist", async () => {
    const plain = startCase(depsWith([]), { persona: "B" });
    await expect(runHeiSale(depsWith([]), { token: plain.token })).rejects.toThrow(/devnet is not set up/);
    const withDevnet = depsWith([], { hei: {} as never });
    await expect(runHeiSale(withDevnet, { token: plain.token })).rejects.toThrow(/Issue the HEI share tokens first/);
  });

  it("check the settlement inputs before touching the chain", async () => {
    const deps = depsWith([], { hei: {} as never });
    await expect(runHeiSettlement(deps, { token: issuedCase(), scenario: "buyback-2y" })).rejects.toThrow(/Run the primary sale first/);
    const sold = issuedCase({ heiSale: { purchases: [] } as unknown as SaleRecord });
    // The browser names a scenario; years and growth stay on the server.
    await expect(runHeiSettlement(deps, { token: sold, scenario: "years-11" })).rejects.toThrow(/Unknown settlement scenario/);
    const settled = issuedCase({ heiSale: { purchases: [] } as unknown as SaleRecord, heiSettlement: {} as SettlementRecord });
    await expect(runHeiSettlement(deps, { token: settled, scenario: "buyback-2y" })).rejects.toThrow(/already settled/);
    await expect(runHeiSale(deps, { token: sold })).rejects.toThrow(/already ran/);
  });
});

describe("demo limits per case", () => {
  it("stop a case after its message and photo limits, without calling the model", async () => {
    const deps = depsWith([]); // any model call would fail: no scripted replies left
    const base = openCase(startCase(deps, { persona: "A" }).token, secret);
    const busy: CaseFile = { ...base, messages: Array.from({ length: CASE_LIMITS.messages }, () => ({ role: "user" as const, text: "hi" })) };
    await expect(postMessage(deps, { token: sealCase(busy, secret), text: "one more" })).rejects.toThrow(/limit of 40 messages/);

    const photo = { mimeType: "image/png", dataBase64: "", sha256: "a".repeat(64), addedAt: now().toISOString() };
    const full: CaseFile = { ...base, photos: Object.fromEntries(Array.from({ length: CASE_LIMITS.photos }, (_, i) => [`photo-${i + 1}`, photo])) };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    await expect(postMessage(deps, { token: sealCase(full, secret), text: "", photo: { mimeType: "image/png", dataBase64: png } })).rejects.toThrow(/limit of 6 photos/);
  });

  it("refuse a new photo while unread photos would make the case too heavy to send", async () => {
    const deps = depsWith([]);
    const base = openCase(startCase(deps, { persona: "A" }).token, secret);
    const unread = { mimeType: "image/png", dataBase64: "A".repeat(Math.ceil((WEB_PHOTO_BYTES * 4) / 3)), sha256: "a".repeat(64), addedAt: now().toISOString() };
    const heavy: CaseFile = { ...base, photos: { "photo-1": unread } };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64");
    await expect(postMessage(deps, { token: sealCase(heavy, secret), text: "", photo: { mimeType: "image/png", dataBase64: png } })).rejects.toThrow(/read the photos you already sent/);
  });
});
