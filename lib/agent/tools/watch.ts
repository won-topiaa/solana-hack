// Watches (step 2-4, M5): reading photos, typed details, price table, and the (simulated) stolen-watch check.

import { hashSerial, newSalt, redactSerial } from "../../assets/serial";
import type { WatchAsset } from "../../assets/types";
import { findWatchPrice } from "../../assets/watchPrices";
import type { WatchCategory } from "../../calc/watch";
import { formatUsd } from "../../format";
import { categoryFromReading, type WatchVision } from "../../integrations/vision";
import { SIMULATED_REGISTRY_LABEL, simulatedRegistryCheck } from "../../integrations/watchRegister.mock";
import type { CaseFile } from "../types";
import { type AgentTool, EDITABLE_STAGES, storePii } from "./shared";

const CATEGORY_LABEL: Record<WatchCategory, string> = {
  sport_steel: "steel sport",
  dress_gold: "dress or gold",
  specialty_vintage: "specialty or vintage",
};
const WATCH_CATEGORIES = Object.keys(CATEGORY_LABEL) as WatchCategory[];

function yesNo(value: boolean | undefined, unknown: string): string {
  return value === undefined ? unknown : value ? "yes" : "no";
}

/** One code-made line about a watch. It never contains the serial number. */
function describeWatch(watch: WatchAsset): string {
  const name = [watch.maker, watch.model].filter(Boolean).join(" ") || "Model not known yet";
  const price = watch.marketValue
    ? `${formatUsd(watch.marketValue.usd)} (${watch.marketValue.source}, ${watch.marketValue.asOf})`
    : "no price for this reference in the price table";
  return (
    `Watch: ${name}${watch.reference ? `, reference ${watch.reference}` : ""}. ` +
    `Box: ${yesNo(watch.hasBox, "not shown")}. Papers: ${yesNo(watch.hasPapers, "not shown")}. ` +
    `Serial number: ${watch.serialHash ? "read and stored privately" : "not read yet"}. ` +
    `Category: ${watch.category ? CATEGORY_LABEL[watch.category] : "not settled yet"}. Price table: ${price}.`
  );
}

/** What the agent still has to ask about this watch. */
function stillNeeded(watch: WatchAsset): string[] {
  const needs: string[] = [];
  if (!watch.reference) needs.push("reference");
  if (watch.category === null) needs.push("category");
  if (watch.hasBox === undefined) needs.push("hasBox");
  if (watch.hasPapers === undefined) needs.push("hasPapers");
  return needs;
}

function withSerial(caseFile: CaseFile, serial: string): { caseFile: CaseFile; serialRef: string; serialHash: string } {
  const salt = newSalt();
  const stored = storePii(caseFile, { kind: "serial", value: serial, salt });
  return { caseFile: stored.caseFile, serialRef: stored.ref, serialHash: hashSerial(serial, salt) };
}

function priceFor(reference: string | undefined): WatchAsset["marketValue"] {
  const price = reference ? findWatchPrice(reference) : null;
  return price ? { usd: price.priceUsd, source: price.source, asOf: price.asOf } : undefined;
}

function nextWatchId(caseFile: CaseFile): string {
  return `watch-${caseFile.assets.filter((asset) => asset.kind === "watch").length + 1}`;
}

export function createReadWatchPhotos(vision: WatchVision): AgentTool {
  return {
    declaration: {
      name: "read_watch_photos",
      description:
        "Read the user's uploaded watch photos (dial, case back, box, papers) and add the watch to the case. " +
        "Its result never contains the serial number. Then ask about anything in needs.",
      parameters: {
        type: "object",
        properties: {
          photoIds: { type: "array", items: { type: "string" }, description: "Ids of the uploaded photos, e.g. photo-1." },
        },
        required: ["photoIds"],
      },
    },
    stages: EDITABLE_STAGES,
    requiresApproval: false,
    async run(args, { caseFile }) {
      const ids = Array.isArray(args.photoIds) ? args.photoIds.filter((id): id is string => typeof id === "string") : [];
      if (ids.length === 0 || ids.some((id) => !caseFile.photos[id])) {
        const uploaded = Object.keys(caseFile.photos).join(", ") || "none";
        return { output: { saved: false, problem: `Unknown photo ids. Uploaded photos: ${uploaded}.` }, caseFile };
      }
      // A photo already read into a watch would make a second, duplicate watch.
      const readBefore = caseFile.assets.filter((asset): asset is WatchAsset => asset.kind === "watch" && asset.photoIds.some((id) => ids.includes(id)));
      if (readBefore.length > 0) {
        return { output: { saved: false, problem: `Already read into ${readBefore.map((watch) => watch.id).join(", ")}. Use record_watch to correct it.` }, caseFile };
      }
      const unreadable = ids.filter((id) => caseFile.photos[id].dataBase64 === undefined);
      if (unreadable.length > 0) {
        return { output: { saved: false, problem: `Already read and no longer kept: ${unreadable.join(", ")}. Ask the user to upload the photo again.` }, caseFile };
      }
      const reading = await vision.read(ids.map((id) => ({ mimeType: caseFile.photos[id].mimeType, dataBase64: caseFile.photos[id].dataBase64 ?? "" })));

      let file = caseFile;
      let serialRef: string | undefined;
      let serialHash: string | undefined;
      if (reading.serial) ({ caseFile: file, serialRef, serialHash } = withSerial(file, reading.serial));
      const reference = reading.reference ?? undefined;
      const watch: WatchAsset = {
        id: nextWatchId(file),
        kind: "watch",
        maker: reading.maker ?? undefined,
        model: reading.model ?? undefined,
        reference,
        serialRef,
        serialHash,
        // Not seeing a box in the photos does not mean there is none, so the agent asks.
        hasBox: reading.boxVisible ? true : undefined,
        hasPapers: reading.papersVisible ? true : undefined,
        category: (reference && findWatchPrice(reference)?.category) || categoryFromReading(reading),
        marketValue: priceFor(reference),
        theftCheck: "not_checked",
        photoIds: ids,
      };
      // The model's notes could quote the serial, so it is blanked out before they go back.
      const notes = reading.notes && reading.serial ? redactSerial(reading.notes, reading.serial) : reading.notes;
      return {
        output: { saved: true, assetId: watch.id, display: describeWatch(watch), needs: stillNeeded(watch), notes },
        caseFile: { ...file, assets: [...file.assets, watch] },
      };
    },
  };
}

const TEXT_FIELDS = ["maker", "model", "reference"] as const;

export const recordWatch: AgentTool = {
  declaration: {
    name: "record_watch",
    description:
      "Save watch details the user states: when they have no photos, to answer what the photos did not show " +
      "(box, papers, category), or to correct a reading. Omit assetId to add a new watch.",
    parameters: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "The watch's assetId, to update it." },
        maker: { type: "string" },
        model: { type: "string" },
        reference: { type: "string", description: "Reference number as the user gave it." },
        serial: { type: "string", description: "Serial number, only if the user typed it. It is stored privately." },
        hasBox: { type: "boolean" },
        hasPapers: { type: "boolean" },
        category: { type: "string", enum: WATCH_CATEGORIES, description: "The category the user chose." },
      },
    },
  },
  stages: EDITABLE_STAGES,
  requiresApproval: false,
  run(args, { caseFile }) {
    const problems: string[] = [];
    for (const field of [...TEXT_FIELDS, "serial"] as const) {
      const value = args[field];
      if (value !== undefined && (typeof value !== "string" || value.trim() === "" || value.length > 80)) {
        problems.push(`${field} must be short text`);
      }
    }
    for (const field of ["hasBox", "hasPapers"] as const) {
      if (args[field] !== undefined && typeof args[field] !== "boolean") problems.push(`${field} must be true or false`);
    }
    if (args.category !== undefined && !WATCH_CATEGORIES.includes(args.category as WatchCategory)) {
      problems.push(`category must be one of ${WATCH_CATEGORIES.join(", ")}`);
    }
    const existing = args.assetId === undefined
      ? undefined
      : caseFile.assets.find((asset): asset is WatchAsset => asset.id === args.assetId && asset.kind === "watch");
    if (args.assetId !== undefined && !existing) problems.push(`No watch with id ${String(args.assetId)}`);
    if (problems.length > 0) return { output: { saved: false, problems }, caseFile };

    let file = caseFile;
    let watch: WatchAsset = existing ?? { id: nextWatchId(file), kind: "watch", category: null, theftCheck: "not_checked", photoIds: [] };
    for (const field of TEXT_FIELDS) {
      if (typeof args[field] === "string") watch = { ...watch, [field]: (args[field] as string).trim() };
    }
    if (typeof args.hasBox === "boolean") watch = { ...watch, hasBox: args.hasBox };
    if (typeof args.hasPapers === "boolean") watch = { ...watch, hasPapers: args.hasPapers };
    if (args.category !== undefined) watch = { ...watch, category: args.category as WatchCategory };
    if (typeof args.serial === "string") {
      const stored = withSerial(file, args.serial.trim());
      file = stored.caseFile;
      watch = { ...watch, serialRef: stored.serialRef, serialHash: stored.serialHash, theftCheck: "not_checked" };
    }
    watch = { ...watch, marketValue: priceFor(watch.reference) };
    if (watch.category === null && watch.reference) watch = { ...watch, category: findWatchPrice(watch.reference)?.category ?? null };

    const assets = existing ? file.assets.map((asset) => (asset.id === watch.id ? watch : asset)) : [...file.assets, watch];
    return {
      output: { saved: true, assetId: watch.id, display: describeWatch(watch), needs: stillNeeded(watch) },
      caseFile: { ...file, assets },
    };
  },
};

/** Stolen-watch check. In production it would send the serial to a registry (a partner), so it needs approval. */
export const checkWatchRegistry: AgentTool = {
  declaration: {
    name: "check_watch_registry",
    description:
      "Check a watch's serial number against a stolen-watch registry. The user must approve first. " +
      "In this demo the check is simulated and contacts no one.",
    parameters: { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] },
  },
  stages: EDITABLE_STAGES,
  requiresApproval: true,
  describeForApproval: () =>
    "Check the watch's serial number against a stolen-watch registry (simulated in this demo: nothing is sent)",
  run(args, { caseFile }) {
    const watch = caseFile.assets.find((asset): asset is WatchAsset => asset.id === args.assetId && asset.kind === "watch");
    if (!watch) return { output: { checked: false, problem: `No watch with id ${String(args.assetId)}` }, caseFile };
    if (!watch.serialHash) {
      return { output: { checked: false, problem: "No serial number yet: read it from a photo of the case back or papers, or ask the user to type it." }, caseFile };
    }
    const result = simulatedRegistryCheck(watch.serialHash);
    const assets = caseFile.assets.map((asset) => (asset.id === watch.id ? { ...watch, theftCheck: result } : asset));
    return {
      output: { checked: true, display: `Stolen-watch registry: no record found (${SIMULATED_REGISTRY_LABEL}).` },
      caseFile: { ...caseFile, assets },
    };
  },
};
