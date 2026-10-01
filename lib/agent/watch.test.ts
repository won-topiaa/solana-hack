import { describe, expect, it } from "vitest";
import { testRegistry } from "../params/test-fixtures";
import { createDemoPropertySource } from "../integrations/rentcast";
import type { WatchReading, WatchVision } from "../integrations/vision";
import type { LlmReply } from "./llm";
import { createCaseFile, resolveApproval, sendUserMessage } from "./orchestrator";
import { addPhoto } from "./photos";
import { createScriptedLlm } from "./scripted";
import { createAgentTools } from "./tools";
import type { CaseFile } from "./types";

const now = () => new Date("2026-10-02T15:00:00Z");
const SERIAL = "DW7731842";
// A tiny stand-in image (the PNG file signature); the fake vision below does not decode it.
const TINY_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const say = (text: string): LlmReply => ({ text, toolCalls: [] });
const callTool = (name: string, args: Record<string, unknown>): LlmReply => ({
  text: "",
  toolCalls: [{ name, args, providerCallId: `call-${name}` }],
});

/** Fake vision: returns a fixed reading and records how many photos it got. */
function fakeVision(reading: Partial<WatchReading> = {}) {
  const seen: number[] = [];
  const vision: WatchVision = {
    async read(photos) {
      seen.push(photos.length);
      return {
        maker: "Demo Watch Co.",
        model: "Demo Diver 300",
        reference: "DEMO-300",
        serial: SERIAL,
        caseMaterial: "steel",
        style: "sport",
        boxVisible: false,
        papersVisible: true,
        notes: `Serial ${SERIAL} is slightly blurred.`,
        ...reading,
      };
    },
  };
  return { vision, seen };
}

function caseWithPhoto(): { caseFile: CaseFile; photoId: string } {
  const base: CaseFile = {
    ...createCaseFile("case-watch", now()),
    stage: "capture",
    goal: { cashNeededUsd: 30_000, neededBy: "2026-10-09", keepAssetIds: [] },
  };
  return addPhoto(base, { mimeType: "image/png", bytes: TINY_PNG }, now());
}

function toolsWith(vision: WatchVision) {
  return createAgentTools({ registry: testRegistry(), propertySource: createDemoPropertySource(() => "2026-10-02"), vision });
}

describe("watch photos (M5 done-when: a photo of a demo watch fills WatchAsset)", () => {
  it("fills the watch from the photo, prices it from the table and keeps the serial private", async () => {
    const { vision, seen } = fakeVision();
    const { caseFile, photoId } = caseWithPhoto();
    const llm = createScriptedLlm([callTool("read_watch_photos", { photoIds: [photoId] }), say("Do you have the box?")]);
    const turn = await sendUserMessage(caseFile, `I uploaded a photo (${photoId}).`, { llm, tools: toolsWith(vision), now });

    expect(seen).toEqual([1]);
    const watch = turn.caseFile.assets[0];
    expect(watch).toMatchObject({
      id: "watch-1",
      kind: "watch",
      maker: "Demo Watch Co.",
      model: "Demo Diver 300",
      reference: "DEMO-300",
      hasPapers: true,
      hasBox: undefined, // not in the photo: the agent asks
      category: "sport_steel",
      marketValue: { usd: 25_000, source: "Demo price table (made up)", asOf: "2026-10-02" },
      theftCheck: "not_checked",
      photoIds: ["photo-1"],
    });
    expect(watch.kind === "watch" && watch.serialHash).toMatch(/^[0-9a-f]{64}$/);

    // The raw serial lives only in the PII store, with its salt.
    expect(Object.values(turn.caseFile.pii)).toEqual([{ kind: "serial", value: SERIAL, salt: expect.stringMatching(/^[0-9a-f]{32}$/) }]);
    // The model gets code-made text with no serial, and the vision notes are redacted.
    const toolMessage = llm.requests[1].messages.at(-1);
    expect(JSON.stringify(toolMessage)).not.toContain(SERIAL);
    expect(toolMessage).toMatchObject({
      results: [
        {
          output: {
            saved: true,
            display:
              "Watch: Demo Watch Co. Demo Diver 300, reference DEMO-300. Box: not shown. Papers: yes. " +
              "Serial number: read and stored privately. Category: steel sport. " +
              "Price table: $25,000 (Demo price table (made up), 2026-10-02).",
            needs: ["hasBox"],
            notes: "Serial [serial] is slightly blurred.",
          },
        },
      ],
    });
    expect(JSON.stringify(turn.caseFile.events)).not.toContain(SERIAL);
  });

  it("leaves the category open when the photo does not settle it and the reference is unknown", async () => {
    const { vision } = fakeVision({ reference: "REAL-123", caseMaterial: "two_tone", style: null });
    const { caseFile, photoId } = caseWithPhoto();
    const llm = createScriptedLlm([callTool("read_watch_photos", { photoIds: [photoId] }), say("Which category fits?")]);
    const turn = await sendUserMessage(caseFile, "uploaded", { llm, tools: toolsWith(vision), now });
    expect(turn.caseFile.assets[0]).toMatchObject({ category: null, marketValue: undefined });
    expect(llm.requests[1].messages.at(-1)).toMatchObject({ results: [{ output: { needs: ["category", "hasBox"] } }] });
  });

  it("refuses photo ids that were never uploaded", async () => {
    const { vision, seen } = fakeVision();
    const { caseFile } = caseWithPhoto();
    const llm = createScriptedLlm([callTool("read_watch_photos", { photoIds: ["photo-9"] }), say("Please upload it again.")]);
    const turn = await sendUserMessage(caseFile, "uploaded", { llm, tools: toolsWith(vision), now });
    expect(seen).toEqual([]);
    expect(turn.caseFile.assets).toEqual([]);
  });
});

describe("typed watch details (no photos)", () => {
  it("adds a watch from what the user says and answers what photos did not show", async () => {
    const { vision } = fakeVision();
    const base = caseWithPhoto().caseFile;
    const llm = createScriptedLlm([
      callTool("record_watch", { maker: "Demo Watch Co.", model: "Demo Dress 38 Gold", reference: "demo 38g", hasBox: true, hasPapers: false }),
      say("Saved."),
    ]);
    const turn = await sendUserMessage(base, "I have a dress watch, reference DEMO-38G, box but no papers.", { llm, tools: toolsWith(vision), now });
    expect(turn.caseFile.assets[0]).toMatchObject({
      kind: "watch",
      reference: "demo 38g",
      hasBox: true,
      hasPapers: false,
      category: "dress_gold", // from the price table
      marketValue: { usd: 15_000 },
    });
    expect(turn.caseFile.assets[0]).not.toHaveProperty("serialHash"); // no serial was given
  });

  it("rejects a category outside the three choices", async () => {
    const { vision } = fakeVision();
    const llm = createScriptedLlm([callTool("record_watch", { model: "X", category: "luxury" }), say("Which of the three?")]);
    const turn = await sendUserMessage(caseWithPhoto().caseFile, "x", { llm, tools: toolsWith(vision), now });
    expect(turn.caseFile.assets).toEqual([]);
  });
});

describe("stolen-watch registry check (simulated, approval required)", () => {
  it("asks first, then records a simulated clear result", async () => {
    const { vision } = fakeVision();
    const { caseFile, photoId } = caseWithPhoto();
    const llm = createScriptedLlm([
      callTool("read_watch_photos", { photoIds: [photoId] }),
      say("Shall I check the stolen-watch registry?"),
      callTool("check_watch_registry", { assetId: "watch-1" }),
      say("No record found (simulated)."),
    ]);
    const deps = { llm, tools: toolsWith(vision), now };
    const read = await sendUserMessage(caseFile, "uploaded", deps);
    const asked = await sendUserMessage(read.caseFile, "Yes, check it.", deps);
    expect(asked.awaitingApproval?.summary).toContain("simulated in this demo");
    expect(asked.caseFile.assets[0]).toMatchObject({ theftCheck: "not_checked" });

    const done = await resolveApproval(asked.caseFile, asked.awaitingApproval!.id, true, deps);
    expect(done.caseFile.assets[0]).toMatchObject({ theftCheck: "simulated_clear" });
    expect(llm.requests.at(-1)?.messages.at(-1)).toMatchObject({
      results: [{ output: { display: "Stolen-watch registry: no record found (SIMULATED: no registry was contacted)." } }],
    });
  });
});

describe("addPhoto", () => {
  it("rejects types Gemini cannot read and empty files", () => {
    const base = createCaseFile("case-photo", now());
    expect(() => addPhoto(base, { mimeType: "image/gif", bytes: TINY_PNG })).toThrow(/Unsupported photo type/);
    expect(() => addPhoto(base, { mimeType: "image/png", bytes: new Uint8Array() })).toThrow(/between/);
  });

  it("stores the photo with its SHA-256 so it can be referenced by hash later", () => {
    const { caseFile, photoId } = addPhoto(createCaseFile("case-photo", now()), { mimeType: "image/png", bytes: TINY_PNG }, now());
    expect(photoId).toBe("photo-1");
    expect(caseFile.photos["photo-1"]).toMatchObject({ mimeType: "image/png", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });
});
