// Tools the model may call. Each tool is plain code. A tool that does something
// irreversible (minting, a transfer, an on-chain receipt, contacting a partner)
// sets requiresApproval, and the orchestrator never runs it before the user says yes.
// Numbers go back to the model as finished `display` text, formatted by code.

import { matchOwner } from "../assets/ownerMatch";
import { hashSerial, newSalt } from "../assets/serial";
import type { OwnerMatch, PiiItem, RealEstateAsset, WatchAsset } from "../assets/types";
import { findWatchPrice } from "../assets/watchPrices";
import type { WatchCategory } from "../calc/watch";
import { formatPercent, formatUsd } from "../format";
import type { MortgageDataSource } from "../integrations/plaid";
import { normalizeAddress, type PropertyDataSource } from "../integrations/rentcast";
import { categoryFromReading, type WatchVision } from "../integrations/vision";
import { SIMULATED_REGISTRY_LABEL, simulatedRegistryCheck } from "../integrations/watchRegister.mock";
import { checkGoal } from "./goal";
import type { ToolDeclaration } from "./llm";
import type { CaseFile, Stage } from "./types";
import type { Registry } from "../params/types";
import { hashOf } from "../recommend/canonical";
import { describeRecommendation } from "../recommend/display";
import { buildPassport, buildReceipt, type AssetPassport } from "../recommend/passport";
import { isSelectable } from "../recommend/watches";
import type { ChainService } from "../chain/adapter";
import { receiptMemo } from "../chain/solana";
import { assetSummaries, realEstateTerms, recommend, watchLabel } from "../recommend/recommend";
import { buildHeiTermSheet, describeTermSheet, type HeiTermSheet } from "../recommend/termSheet";

export type ToolContext = { caseFile: CaseFile; today: string; now: Date };

export type ToolOutcome = { output: Record<string, unknown>; caseFile: CaseFile };

export type AgentTool = {
  declaration: ToolDeclaration;
  stages: Stage[]; // the steps in which the model is offered this tool
  requiresApproval: boolean;
  /** The sentence the user approves or rejects. */
  describeForApproval?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, context: ToolContext) => ToolOutcome | Promise<ToolOutcome>;
};

/**
 * Until something is on-chain the user may still change the goal and the assets, even
 * after the documents are prepared (compare_paths then starts over). Once the receipt is
 * on-chain (stage "execute") the recorded choice is final.
 */
const EDITABLE_STAGES: Stage[] = ["capture", "compare", "prepare"];

export const recordGoal: AgentTool = {
  declaration: {
    name: "record_goal",
    description:
      "Save the user's cash goal. Call it once the user has given at least the amount and the date, " +
      "and again if they change it. If anything is missing or invalid it returns problems to ask about.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["home", "watch", "unsure"],
          description: "Which asset the user wants to use or tokenize: their home, a watch, or not sure yet.",
        },
        cashNeededUsd: { type: "number", description: "Cash the user needs, in US dollars." },
        neededBy: { type: "string", description: "Date the cash is needed by, as YYYY-MM-DD." },
        repayHorizonYears: { type: "number", description: "Years until the user expects to repay, if they said." },
        keepAssetNotes: {
          type: "array",
          items: { type: "string" },
          description: "Assets the user wants to keep, in their own words.",
        },
        monthlyCapacityUsd: { type: "number", description: "What the user could pay each month, in US dollars, if they said." },
        age62Plus: { type: "boolean", description: "True if the user said they are 62 or older." },
      },
      required: ["cashNeededUsd", "neededBy"],
    },
  },
  stages: ["goal", ...EDITABLE_STAGES],
  requiresApproval: false,
  run(args, { caseFile, today }) {
    const check = checkGoal(args, today);
    if (!check.ok) return { output: { saved: false, problems: check.problems }, caseFile };
    return {
      output: { saved: true, goal: check.goal },
      // Keep choices made earlier survive a goal update.
      caseFile: {
        ...caseFile,
        goal: { ...check.goal, keepAssetIds: caseFile.goal?.keepAssetIds ?? [] },
        stage: caseFile.stage === "goal" ? "capture" : caseFile.stage,
      },
    };
  },
};

/** Puts personal data in the case file's PII store and returns its key. */
function storePii(caseFile: CaseFile, item: PiiItem): { caseFile: CaseFile; ref: string } {
  const ref = `pii-${Object.keys(caseFile.pii).length + 1}`;
  return { caseFile: { ...caseFile, pii: { ...caseFile.pii, [ref]: item } }, ref };
}

const OWNER_CHECK_TEXT: Record<OwnerMatch, string> = {
  match: "The name on the title matches the owner on public records.",
  partial: "The name only partly matches the owner on public records. A person will check the title documents.",
  no_match: "The name does not match the owner on public records. A person will check the title documents.",
  unknown: "Public records do not list an owner we could compare. A person will check the title documents.",
};

export function createLookupHome(source: PropertyDataSource): AgentTool {
  return {
    declaration: {
      name: "lookup_home",
      description:
        "Look up the user's home by its full address: public records and an automated value range. " +
        "Also checks the name on the title against the owner on record. Quote the returned display " +
        "and ownerCheck text exactly.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Full address: street, city, state, ZIP." },
          titleName: { type: "string", description: "The name on the property title, as the user gave it." },
        },
        required: ["address", "titleName"],
      },
    },
    stages: EDITABLE_STAGES,
    requiresApproval: false,
    async run(args, { caseFile }) {
      const address = typeof args.address === "string" ? args.address.trim() : "";
      const titleName = typeof args.titleName === "string" ? args.titleName.trim() : "";
      if (!address || !titleName) {
        return { output: { found: false, problem: "Both the address and the name on the title are needed." }, caseFile };
      }
      const { property, value, source: dataSource, fetchedAt } = await source.lookup(address);
      if (!property || !value) {
        return {
          output: { found: false, source: dataSource, problem: "No record for that address. Ask the user to check the street, city, state and ZIP." },
          caseFile,
        };
      }

      // Looking up the same home again updates it instead of adding a second one.
      const existing = caseFile.assets.find(
        (asset): asset is RealEstateAsset =>
          asset.kind === "real_estate" &&
          normalizeAddress(caseFile.pii[asset.addressRef]?.value ?? "") === normalizeAddress(property.formattedAddress),
      );
      let file = caseFile;
      let addressRef = existing?.addressRef;
      if (!addressRef) {
        const stored = storePii(file, { kind: "address", value: property.formattedAddress });
        file = stored.caseFile;
        addressRef = stored.ref;
      }
      file = storePii(file, { kind: "person_name", value: titleName }).caseFile;

      const asset: RealEstateAsset = {
        id: existing?.id ?? `home-${file.assets.filter((item) => item.kind === "real_estate").length + 1}`,
        kind: "real_estate",
        addressRef,
        avm: { low: value.priceRangeLow, mid: value.price, high: value.priceRangeHigh, source: dataSource, asOf: fetchedAt },
        ownerMatch: matchOwner(titleName, property.owner?.names ?? []),
        ownerOccupied: property.ownerOccupied,
        lastSale:
          property.lastSaleDate && property.lastSalePrice
            ? { date: property.lastSaleDate.slice(0, 10), priceUsd: property.lastSalePrice }
            : undefined,
        mortgageBalanceUsd: existing?.mortgageBalanceUsd,
        mortgageSource: existing?.mortgageSource,
      };
      const assets = existing
        ? file.assets.map((item) => (item.id === existing.id ? asset : item))
        : [...file.assets, asset];

      // Only code-made text goes back: no owner names, no full record.
      return {
        output: {
          found: true,
          assetId: asset.id,
          source: dataSource,
          display: `Estimated value: ${formatUsd(value.priceRangeLow)} to ${formatUsd(value.priceRangeHigh)} (middle ${formatUsd(value.price)}). Source: ${dataSource}, ${fetchedAt}.`,
          ownerCheck: OWNER_CHECK_TEXT[asset.ownerMatch ?? "unknown"],
        },
        caseFile: { ...file, assets },
      };
    },
  };
}

export const recordMortgage: AgentTool = {
  declaration: {
    name: "record_mortgage",
    description: "Save the remaining mortgage balance on a home that was looked up, as the user stated it (0 if none).",
    parameters: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "The home's assetId from lookup_home." },
        balanceUsd: { type: "number", description: "Remaining balance in US dollars; 0 if there is no mortgage." },
      },
      required: ["assetId", "balanceUsd"],
    },
  },
  stages: EDITABLE_STAGES,
  requiresApproval: false,
  run(args, { caseFile }) {
    const balance = args.balanceUsd;
    if (typeof balance !== "number" || !Number.isFinite(balance) || balance < 0) {
      return { output: { saved: false, problem: "The balance must be a number of US dollars, 0 or more." }, caseFile };
    }
    const home = caseFile.assets.find((asset) => asset.id === args.assetId && asset.kind === "real_estate");
    if (!home) {
      return { output: { saved: false, problem: `No home with id ${String(args.assetId)}. Look the home up first.` }, caseFile };
    }
    const assets = caseFile.assets.map((asset) =>
      asset.id === home.id && asset.kind === "real_estate"
        ? { ...asset, mortgageBalanceUsd: balance, mortgageSource: "user_stated" as const }
        : asset,
    );
    return {
      output: { saved: true, display: `Mortgage balance (as you stated): ${formatUsd(balance)}.` },
      caseFile: { ...caseFile, assets },
    };
  },
};

/** Reads the mortgage from the user's lender through Plaid. Contacting a partner needs approval (CLAUDE.md §5). */
export function createConnectMortgage(source: MortgageDataSource): AgentTool {
  return {
    declaration: {
      name: "connect_mortgage_account",
      description:
        "Read the remaining mortgage balance and terms from the user's lender through Plaid, instead of the " +
        "user typing the balance. The user must approve the connection first. Quote the display text exactly.",
      parameters: {
        type: "object",
        properties: { assetId: { type: "string", description: "The home's assetId from lookup_home." } },
        required: ["assetId"],
      },
    },
    stages: EDITABLE_STAGES,
    requiresApproval: true,
    describeForApproval: () => "Connect a lender account through Plaid (sandbox test data) to read the mortgage balance",
    async run(args, { caseFile }) {
      const home = caseFile.assets.find((asset) => asset.id === args.assetId && asset.kind === "real_estate");
      if (!home) {
        return { output: { saved: false, problem: `No home with id ${String(args.assetId)}. Look the home up first.` }, caseFile };
      }
      const [mortgage] = await source.readMortgages();
      if (!mortgage) return { output: { saved: false, problem: "The connected account has no mortgage." }, caseFile };

      const details = [`balance ${formatUsd(mortgage.balanceUsd)}`];
      if (mortgage.interestRatePercent !== undefined) {
        details.push(`rate ${formatPercent(mortgage.interestRatePercent)}${mortgage.interestRateType ? ` ${mortgage.interestRateType}` : ""}`);
      }
      if (mortgage.nextMonthlyPaymentUsd !== undefined) details.push(`next payment ${formatUsd(mortgage.nextMonthlyPaymentUsd)}`);
      const assets = caseFile.assets.map((asset) =>
        asset.id === home.id && asset.kind === "real_estate"
          ? { ...asset, mortgageBalanceUsd: mortgage.balanceUsd, mortgageSource: "plaid" as const }
          : asset,
      );
      return {
        output: { saved: true, source: mortgage.source, display: `Mortgage from the lender (${mortgage.source}): ${details.join("; ")}.` },
        caseFile: { ...caseFile, assets },
      };
    },
  };
}

// ---- Watches (M5) -------------------------------------------------------------

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
        "Quote the returned display text exactly; it never contains the serial number. Then ask about anything in needs.",
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
      const notes = reading.notes && reading.serial ? reading.notes.split(reading.serial).join("[serial]") : reading.notes;
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
      "(box, papers, category), or to correct a reading. Omit assetId to add a new watch. Quote the display text exactly.",
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
      "In this demo the check is simulated and contacts no one. Quote the display text exactly.",
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

// ---- Compare and prepare (M6) -----------------------------------------------

/** A name for an asset that carries no personal data (no address, no serial). */
function assetLabel(caseFile: CaseFile, assetId: string): string {
  const asset = caseFile.assets.find((item) => item.id === assetId);
  if (!asset) return assetId;
  return asset.kind === "real_estate" ? `your home (${asset.id})` : `${watchLabel(asset)} (${asset.id})`;
}

export const setKeepAssets: AgentTool = {
  declaration: {
    name: "set_keep_assets",
    description:
      "Record which assets the user wants to keep, by assetId from earlier tool results (an empty list = none). " +
      "Confirm with the user first. Quote the display text exactly.",
    parameters: {
      type: "object",
      properties: { assetIds: { type: "array", items: { type: "string" } } },
      required: ["assetIds"],
    },
  },
  stages: EDITABLE_STAGES,
  requiresApproval: false,
  run(args, { caseFile }) {
    if (!caseFile.goal) return { output: { saved: false, problem: "Save the goal first." }, caseFile };
    const ids = Array.isArray(args.assetIds) ? args.assetIds.filter((id): id is string => typeof id === "string") : [];
    const unknown = ids.filter((id) => !caseFile.assets.some((asset) => asset.id === id));
    if (unknown.length > 0) {
      const known = caseFile.assets.map((asset) => assetLabel(caseFile, asset.id)).join(", ") || "none yet";
      return { output: { saved: false, problem: `Unknown asset ids: ${unknown.join(", ")}. Known assets: ${known}.` }, caseFile };
    }
    const keep = [...new Set(ids)];
    return {
      output: { saved: true, display: `Assets to keep: ${keep.map((id) => assetLabel(caseFile, id)).join(", ") || "none"}.` },
      caseFile: { ...caseFile, goal: { ...caseFile.goal, keepAssetIds: keep } },
    };
  },
};

export function createComparePaths(registry: Registry): AgentTool {
  return {
    declaration: {
      name: "compare_paths",
      description:
        "Compare every way to raise the cash for the saved goal and assets, and recommend one with fixed rules. " +
        "Call it when the goal, the assets and the keep choices are covered, and again after any change. " +
        "Quote the display text exactly; explain only with the reasons it gives.",
      parameters: { type: "object", properties: {} },
    },
    stages: EDITABLE_STAGES,
    requiresApproval: false,
    run(_args, { caseFile, today, now }) {
      const result = recommend(caseFile, registry, today, now);
      if (result.status === "not_ready") return { output: { compared: false, problems: result.problems }, caseFile };
      if (result.status === "needs_fresh_data") {
        const keys = result.stale.map((item) => item.key).join(", ");
        return {
          output: { compared: false, status: "needs_fresh_data", display: `Needs fresh data: these values are out of date, so no recommendation can be finished: ${keys}.` },
          caseFile: { ...caseFile, recommendation: undefined, handoff: undefined },
        };
      }
      const recommendation = result.recommendation;
      return {
        output: {
          compared: true,
          chosenId: recommendation.chosenId,
          rulesFired: recommendation.rulesFired,
          display: describeRecommendation(recommendation).join("\n"),
        },
        caseFile: { ...caseFile, recommendation, handoff: undefined, stage: "compare" },
      };
    },
  };
}

export function createPrepareDocuments(registry: Registry): AgentTool {
  return {
    declaration: {
      name: "prepare_documents",
      description:
        "Prepare the handoff for a path: the HEI term sheet (when the path is an HEI), an asset passport for each " +
        "asset it uses, and the recommendation receipt with their hashes. Use the recommended path, or the optionId " +
        "of the path the user chose. Nothing is signed, sent or recorded on-chain. Quote the display text exactly.",
      parameters: {
        type: "object",
        properties: {
          optionId: { type: "string", description: "The id of the path the user chose; leave out to use the recommended one." },
        },
      },
    },
    stages: ["compare", "prepare"],
    requiresApproval: false,
    run(args, { caseFile, now }) {
      const recommendation = caseFile.recommendation;
      if (!recommendation) return { output: { prepared: false, problem: "Compare the paths first." }, caseFile };
      if (inputsChanged(caseFile)) {
        return { output: { prepared: false, problem: "The goal or assets changed after the comparison. Call compare_paths again." }, caseFile };
      }
      const optionId = typeof args.optionId === "string" ? args.optionId : recommendation.chosenId;
      if (!optionId) {
        return { output: { prepared: false, problem: "There is no single recommended path. Ask the user which path they want and pass its optionId." }, caseFile };
      }
      const chosen = recommendation.options.find((option) => option.id === optionId);
      if (!chosen) return { output: { prepared: false, problem: `No path with id ${optionId} in the comparison.` }, caseFile };
      if (!isSelectable(chosen)) {
        return { output: { prepared: false, problem: `${chosen.label} cannot be prepared: ${chosen.whyNotSuitable ?? "it is shown for information only"}` }, caseFile };
      }
      // A vault takes a watch only after a passing stolen-watch check, so the passport must already include it.
      const tokenizesWatch = chosen.id.startsWith("w-vault-token-");
      const vaultedWatch = tokenizesWatch
        ? caseFile.assets.find((asset) => asset.id === chosen.assetIds[0] && asset.kind === "watch")
        : undefined;
      if (vaultedWatch?.kind === "watch" && vaultedWatch.theftCheck !== "clear" && vaultedWatch.theftCheck !== "simulated_clear") {
        return { output: { prepared: false, problem: "Run the stolen-watch registry check first (check_watch_registry); a vault needs it." }, caseFile };
      }
      const recommended = recommendation.options.find((option) => option.id === recommendation.chosenId);

      let file = caseFile;
      const passports: AssetPassport[] = [];
      for (const assetId of chosen.assetIds) {
        const built = buildPassport(file, assetId);
        file = built.caseFile;
        passports.push(built.passport);
      }
      let termSheet: HeiTermSheet | undefined;
      const home = file.assets.find((asset) => asset.id === chosen.assetIds[0]);
      if (chosen.id === "re-hei" && home?.kind === "real_estate" && home.avm) {
        termSheet = buildHeiTermSheet(
          { assetId: home.id, valueUsd: home.avm.mid, mortgageBalanceUsd: home.mortgageBalanceUsd, valueSource: home.avm.source, valueAsOf: home.avm.asOf },
          recommendation.inputs.goal.cashNeededUsd,
          recommendation.inputs.horizonYears,
          realEstateTerms(registry),
          recommendation.registryVersion,
        );
      }
      const receipt = buildReceipt(recommendation, passports, now, chosen.id);
      const whose =
        chosen.id === recommendation.chosenId
          ? `Prepared for the recommended path: ${chosen.label}.`
          : `Prepared for the path you chose: ${chosen.label}. ${recommended ? `The recommendation was ${recommended.label}; ` : ""}the receipt records both.`;
      const tokenDesign = tokenizesWatch
        ? ["Token design: a 1-of-1 token (supply 1, no decimals) that stands for the vaulted watch; redeeming it releases the watch. Vault intake is simulated in this demo."]
        : [];
      const lines = [
        `${whose} Nothing was signed, sent or recorded on-chain.`,
        ...(termSheet ? describeTermSheet(termSheet) : []),
        ...tokenDesign,
        ...passports.map((passport) => `Asset passport for ${assetLabel(file, passport.assetId)}: hash ${hashOf(passport)}.`),
        `Recommendation receipt: recommendation hash ${receipt.recommendationHash}; passports hash ${receipt.passportHash}; parameter registry ${receipt.registryVersion}.`,
        chosen.id === "re-hei" || tokenizesWatch
          ? "Recording the receipt on Solana and issuing tokens are separate steps, and each needs your approval."
          : "Recording the receipt on Solana is a separate step and needs your approval.",
      ];
      return {
        output: { prepared: true, display: lines.join("\n") },
        caseFile: { ...file, handoff: { termSheet, passports, receipt }, stage: "prepare" },
      };
    },
  };
}

/** True when the goal or the asset values differ from what the latest comparison used. */
function inputsChanged(caseFile: CaseFile): boolean {
  const rec = caseFile.recommendation;
  if (!rec) return true;
  return hashOf(rec.inputs.goal) !== hashOf(caseFile.goal) || hashOf(rec.inputs.assets) !== hashOf(assetSummaries(caseFile));
}

// ---- On-chain on Solana devnet (M7). Every one of these needs the user's approval. ----

/**
 * The goal and assets can still change after the documents are prepared; then the
 * documents no longer describe the case and must not go on-chain.
 */
function staleDocuments(caseFile: CaseFile): ToolOutcome {
  return { output: { done: false, problem: "The goal or assets changed after the documents were prepared. Call compare_paths and prepare_documents again." }, caseFile };
}

function chainFailure(caseFile: CaseFile, error: unknown): ToolOutcome {
  const message = error instanceof Error ? error.message : String(error);
  return { output: { done: false, problem: `The devnet transaction failed: ${message}. Is the issuer wallet funded? (npm run chain:wallets)` }, caseFile };
}

export function createRecordReceipt(chain: ChainService): AgentTool {
  return {
    declaration: {
      name: "record_receipt_onchain",
      description:
        "Write the recommendation receipt (hashes only, no personal data) to Solana devnet, signed by the user's wallet. " +
        "The app asks the user to approve first. Quote the display text exactly.",
      parameters: { type: "object", properties: {} },
    },
    stages: ["prepare", "execute"],
    requiresApproval: true,
    describeForApproval: () => "Write the recommendation receipt (hashes only) to Solana devnet, signed by your wallet",
    async run(_args, { caseFile }) {
      const handoff = caseFile.handoff;
      if (!handoff) return { output: { done: false, problem: "Prepare the documents first." }, caseFile };
      if (inputsChanged(caseFile)) return staleDocuments(caseFile);
      if (handoff.onchain?.receipt) {
        return { output: { done: true, display: `The receipt is already on Solana devnet: ${handoff.onchain.receipt.explorerUrls[0]}` }, caseFile };
      }
      try {
        const record = await chain.recordReceipt(receiptMemo(handoff.receipt));
        const receipt = { ...handoff.receipt, txId: record.signatures[0] };
        return {
          output: {
            done: true,
            display: `Receipt recorded on Solana devnet in transaction ${record.signatures[0]}. Check it: ${record.explorerUrls[0]} . It holds only hashes, the parameter registry version and the chosen path id.`,
          },
          caseFile: { ...caseFile, handoff: { ...handoff, receipt, onchain: { ...handoff.onchain, receipt: record } }, stage: "execute" },
        };
      } catch (error) {
        return chainFailure(caseFile, error);
      }
    },
  };
}

export function createIssueHeiShares(chain: ChainService): AgentTool {
  return {
    declaration: {
      name: "issue_hei_shares",
      description:
        "For an HEI: create the HEI share tokens on Solana devnet, issued by the simulated partner into its treasury for the " +
        "primary sale. Token accounts start frozen; only KYC-approved wallets are opened. Needs the user's approval and the " +
        "receipt on-chain first. Quote the display text exactly.",
      parameters: { type: "object", properties: {} },
    },
    stages: ["prepare", "execute"],
    requiresApproval: true,
    describeForApproval: () => "Create the HEI share tokens on Solana devnet (accounts frozen until KYC; the partner is simulated)",
    async run(_args, { caseFile }) {
      const handoff = caseFile.handoff;
      const sheet = handoff?.termSheet;
      if (!handoff || !sheet || handoff.receipt.selectedOptionId !== "re-hei") {
        return { output: { done: false, problem: "This is only for a prepared HEI path." }, caseFile };
      }
      if (inputsChanged(caseFile)) return staleDocuments(caseFile);
      if (!handoff.onchain?.receipt) return { output: { done: false, problem: "Record the receipt on-chain first (record_receipt_onchain)." }, caseFile };
      if (handoff.onchain.heiShares) return { output: { done: true, display: `The HEI share tokens already exist: ${handoff.onchain.heiShares.explorerUrls.at(-1)}` }, caseFile };
      const passport = handoff.passports.find((item) => item.assetId === sheet.assetId);
      if (!passport) return { output: { done: false, problem: "The home's passport is missing; prepare the documents again." }, caseFile };
      try {
        const record = await chain.issueHeiShares({
          assetId: sheet.assetId,
          tokenSupply: sheet.tokenSupply,
          passportHash: hashOf(passport),
          recommendationHash: handoff.receipt.recommendationHash,
        });
        return {
          output: {
            done: true,
            display:
              `HEI share tokens created on Solana devnet: ${sheet.tokenSupply.toLocaleString("en-US")} tokens in the issuer's treasury ` +
              `for the primary sale (the issuer is a simulated partner). The supply is fixed: no more can ever be minted. ` +
              `New token accounts start frozen; only KYC-approved wallets are opened. ` +
              `Token: ${record.explorerUrls.at(-1)} . Transactions: ${record.explorerUrls.slice(0, -1).join(" , ")} .`,
          },
          caseFile: { ...caseFile, handoff: { ...handoff, onchain: { ...handoff.onchain, heiShares: record } }, stage: "execute" },
        };
      } catch (error) {
        return chainFailure(caseFile, error);
      }
    },
  };
}

export function createIssueWatchToken(chain: ChainService): AgentTool {
  return {
    declaration: {
      name: "issue_watch_token",
      description:
        "For the watch tokenization path: record the simulated vault intake and create the watch's 1-of-1 token in the " +
        "user's wallet on Solana devnet. Needs the user's approval and the receipt on-chain first. Quote the display text exactly.",
      parameters: { type: "object", properties: {} },
    },
    stages: ["prepare", "execute"],
    requiresApproval: true,
    describeForApproval: () =>
      "Record the simulated vault intake and create your watch's 1-of-1 token on Solana devnet",
    async run(_args, { caseFile }) {
      const handoff = caseFile.handoff;
      const selected = handoff?.receipt.selectedOptionId ?? "";
      if (!handoff || !selected.startsWith("w-vault-token-")) {
        return { output: { done: false, problem: "This is only for a prepared watch tokenization path." }, caseFile };
      }
      if (inputsChanged(caseFile)) return staleDocuments(caseFile);
      if (!handoff.onchain?.receipt) return { output: { done: false, problem: "Record the receipt on-chain first (record_receipt_onchain)." }, caseFile };
      if (handoff.onchain.watchToken) return { output: { done: true, display: `The watch token already exists: ${handoff.onchain.watchToken.explorerUrls.at(-1)}` }, caseFile };
      const assetId = selected.replace("w-vault-token-", "");
      const passport = handoff.passports.find((item) => item.assetId === assetId);
      if (!passport) return { output: { done: false, problem: "The watch's passport is missing; prepare the documents again." }, caseFile };
      try {
        const record = await chain.issueWatchToken({ assetId, passportHash: hashOf(passport), recommendationHash: handoff.receipt.recommendationHash });
        return {
          output: {
            done: true,
            display:
              "Vault intake: SIMULATED (no watch was shipped or stored). " +
              `Your watch's 1-of-1 token was created in your wallet on Solana devnet: ${record.explorerUrls.at(-1)} . ` +
              "Minting is closed, so no second token can ever be made. " +
              `Transactions: ${record.explorerUrls.slice(0, -1).join(" , ")} .`,
          },
          caseFile: { ...caseFile, handoff: { ...handoff, onchain: { ...handoff.onchain, watchToken: record } }, stage: "execute" },
        };
      } catch (error) {
        return chainFailure(caseFile, error);
      }
    },
  };
}

/** All tools so far (M7: goal, assets, compare, prepare, on-chain). Optional services add their tools. */
export function createAgentTools(services: {
  registry: Registry;
  propertySource: PropertyDataSource;
  mortgageSource?: MortgageDataSource;
  vision?: WatchVision;
  chain?: ChainService;
}): AgentTool[] {
  return [
    recordGoal,
    createLookupHome(services.propertySource),
    recordMortgage,
    ...(services.mortgageSource ? [createConnectMortgage(services.mortgageSource)] : []),
    ...(services.vision ? [createReadWatchPhotos(services.vision)] : []),
    recordWatch,
    checkWatchRegistry,
    setKeepAssets,
    createComparePaths(services.registry),
    createPrepareDocuments(services.registry),
    ...(services.chain
      ? [createRecordReceipt(services.chain), createIssueHeiShares(services.chain), createIssueWatchToken(services.chain)]
      : []),
  ];
}
