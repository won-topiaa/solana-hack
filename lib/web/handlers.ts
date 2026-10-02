// The web app's actions on a case. The API routes only parse the request and call
// these: each opens the sealed case, does one step, and returns the case sealed
// again with what the browser shows. Plain functions with their services passed in,
// so tests run them with a scripted model and a stand-in chain.

import { randomUUID } from "node:crypto";
import { createCaseFile, resolveApproval, sendUserMessage, type AgentDeps } from "../agent/orchestrator";
import { addPhoto, dropReadPhotoBytes, MAX_PHOTO_BYTES } from "../agent/photos";
import type { CaseFile } from "../agent/types";
import { runPrimarySale, runSettlement, type HeiWallets } from "../chain/heiLifecycle";
import type { DevnetRpc } from "../chain/solana";
import { todayInNewYork } from "../params/dates";
import type { Registry } from "../params/types";
import { PERSONA_IDS, personaCaseOn } from "../recommend/personas";
import { openCase, sealCase } from "./caseToken";
import { buildView, type CaseView } from "./view";

export type WebDeps = {
  agent: AgentDeps;
  registry: Registry;
  secret: string; // CASE_SECRET
  hei?: { rpc: DevnetRpc; wallets: HeiWallets }; // devnet partner steps; absent = not offered
  now?: () => Date;
};

export type CaseReply = { token: string; view: CaseView };

/** A request the browser should not have sent (shown to the user, status 400). */
export class BadRequest extends Error {}

const MAX_TEXT_CHARS = 2_000;

/**
 * Demo limits per case (owner, 2026-10-02): counted from the sealed case itself, so they
 * need no server storage. A new case starts again at zero; the hosting's per-IP rate
 * limit bounds how fast cases can be started.
 */
export const CASE_LIMITS = { messages: 40, photos: 6 };

/**
 * Every request carries the case, and Vercel accepts request bodies up to 4.5 MB
 * (https://vercel.com/docs/functions/limitations). Photos the agent has not read yet stay
 * in the case with their bytes, so a new photo plus those still unread must fit in this.
 * The browser sends 1600-pixel JPEGs, usually well under 1 MB.
 */
export const WEB_PHOTO_BYTES = Math.min(MAX_PHOTO_BYTES, 2.5 * 1024 * 1024);
/** Base64 is 4 characters per 3 bytes. */
const MAX_PHOTO_BASE64_CHARS = Math.ceil(WEB_PHOTO_BYTES / 3) * 4;

/** Bytes of the photos still kept whole in the case (not read yet). */
function unreadPhotoBytes(caseFile: CaseFile): number {
  return Object.values(caseFile.photos).reduce((sum, photo) => sum + (photo.dataBase64 ? Math.floor((photo.dataBase64.length * 3) / 4) : 0), 0);
}

function currentTime(deps: WebDeps): Date {
  return deps.now?.() ?? new Date();
}

function reply(deps: WebDeps, caseFile: CaseFile): CaseReply {
  const compact = dropReadPhotoBytes(caseFile);
  return { token: sealCase(compact, deps.secret), view: buildView(compact, deps.registry) };
}

function openToken(deps: WebDeps, token: unknown): CaseFile {
  if (typeof token !== "string" || token.length === 0) throw new BadRequest("Missing case token");
  try {
    return openCase(token, deps.secret);
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Bad case token");
  }
}

/** A new empty case, or one of the made-up demo personas with its goal and assets loaded. */
export function startCase(deps: WebDeps, input: { persona?: unknown }): CaseReply {
  const now = currentTime(deps);
  if (input.persona === undefined || input.persona === null) return reply(deps, createCaseFile(`web-${randomUUID()}`, now));
  if (typeof input.persona !== "string" || !PERSONA_IDS.includes(input.persona)) throw new BadRequest("Unknown demo persona");
  const caseFile = personaCaseOn(input.persona, now, todayInNewYork(now));
  return reply(deps, { ...caseFile, id: `persona-${input.persona}-${randomUUID()}` });
}

function photoFrom(value: unknown): { mimeType: string; bytes: Uint8Array } | undefined {
  if (value === undefined || value === null) return undefined;
  const photo = value as { mimeType?: unknown; dataBase64?: unknown };
  if (typeof photo.mimeType !== "string" || typeof photo.dataBase64 !== "string") throw new BadRequest("A photo needs mimeType and dataBase64");
  if (photo.dataBase64.length > MAX_PHOTO_BASE64_CHARS) throw new BadRequest(`A photo must be at most ${WEB_PHOTO_BYTES / (1024 * 1024)} MB`);
  return { mimeType: photo.mimeType, bytes: Buffer.from(photo.dataBase64, "base64") };
}

/** The user's message, with an optional photo (the model is told only the photo's id). */
export async function postMessage(deps: WebDeps, input: { token: unknown; text: unknown; photo?: unknown }): Promise<CaseReply> {
  let caseFile = openToken(deps, input.token);
  if (caseFile.pendingApproval) throw new BadRequest("Answer the approval request first");
  if (caseFile.messages.filter((message) => message.role === "user").length >= CASE_LIMITS.messages) {
    throw new BadRequest(`This demo case has reached its limit of ${CASE_LIMITS.messages} messages. Start a new case to continue.`);
  }
  let text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > MAX_TEXT_CHARS) throw new BadRequest(`A message must be at most ${MAX_TEXT_CHARS} characters`);
  const photo = photoFrom(input.photo);
  if (photo && Object.keys(caseFile.photos).length >= CASE_LIMITS.photos) {
    throw new BadRequest(`This demo case has reached its limit of ${CASE_LIMITS.photos} photos. Start a new case to add more.`);
  }
  if (photo && unreadPhotoBytes(caseFile) + photo.bytes.length > WEB_PHOTO_BYTES) {
    throw new BadRequest("Ask the agent to read the photos you already sent before adding more.");
  }
  if (photo) {
    try {
      const added = addPhoto(caseFile, photo, currentTime(deps));
      caseFile = added.caseFile;
      text = `${text ? `${text} ` : ""}I uploaded a photo (${added.photoId}).`;
    } catch (error) {
      throw new BadRequest(error instanceof Error ? error.message : "The photo was not added");
    }
  }
  if (!text) throw new BadRequest("Type a message or add a photo");
  const turn = await sendUserMessage(caseFile, text, deps.agent);
  return reply(deps, turn.caseFile);
}

/** The user's yes or no to the action waiting for approval. */
export async function postApproval(deps: WebDeps, input: { token: unknown; approvalId: unknown; approved: unknown }): Promise<CaseReply> {
  const caseFile = openToken(deps, input.token);
  if (typeof input.approved !== "boolean") throw new BadRequest("approved must be true or false");
  if (!caseFile.pendingApproval || caseFile.pendingApproval.id !== input.approvalId) throw new BadRequest("No such approval request");
  const turn = await resolveApproval(caseFile, caseFile.pendingApproval.id, input.approved, deps.agent);
  return reply(deps, turn.caseFile);
}

function heiParts(deps: WebDeps, caseFile: CaseFile) {
  if (!deps.hei) throw new BadRequest("Solana devnet is not set up on this server");
  const handoff = caseFile.handoff;
  const shares = handoff?.onchain?.heiShares;
  if (!handoff?.termSheet || !shares?.mint) throw new BadRequest("Issue the HEI share tokens first");
  return { hei: deps.hei, handoff, deal: handoff.termSheet, shares: { mint: shares.mint, treasury: shares.treasury } };
}

function withOnchain(caseFile: CaseFile, added: Partial<NonNullable<NonNullable<CaseFile["handoff"]>["onchain"]>>): CaseFile {
  const handoff = caseFile.handoff;
  if (!handoff) return caseFile;
  return { ...caseFile, handoff: { ...handoff, onchain: { ...handoff.onchain, ...added } } };
}

/** Partner steps (simulated partner, devnet): KYC, closing payment, primary sale. */
export async function runHeiSale(deps: WebDeps, input: { token: unknown }): Promise<CaseReply> {
  const caseFile = openToken(deps, input.token);
  const { hei, handoff, deal, shares } = heiParts(deps, caseFile);
  if (handoff.onchain?.heiSale) throw new BadRequest("The primary sale already ran");
  const sale = await runPrimarySale(hei.rpc, hei.wallets, { heiMint: shares.mint, treasury: shares.treasury, deal }, () => currentTime(deps));
  return reply(deps, withOnchain(caseFile, { heiSale: sale }));
}

/** Settlement after `years` with a simulated appraisal at `growth` a year: pays holders and burns their shares. */
export async function runHeiSettlement(deps: WebDeps, input: { token: unknown; years: unknown; growth: unknown }): Promise<CaseReply> {
  const caseFile = openToken(deps, input.token);
  const { hei, handoff, deal, shares } = heiParts(deps, caseFile);
  const sale = handoff.onchain?.heiSale;
  if (!sale) throw new BadRequest("Run the primary sale first");
  if (handoff.onchain?.heiSettlement) throw new BadRequest("This HEI is already settled");
  const { years, growth } = input;
  if (typeof years !== "number" || !(years > 0 && years <= deal.termYears)) throw new BadRequest(`Settle after more than 0 and at most ${deal.termYears} years`);
  if (typeof growth !== "number" || !(growth > -0.5 && growth < 0.5)) throw new BadRequest("Yearly growth must be between -50% and +50%");
  const settled = await runSettlement(hei.rpc, hei.wallets, { heiMint: shares.mint, deal, sale, years, growth }, () => currentTime(deps));
  return reply(deps, withOnchain(caseFile, { heiSettlement: settled }));
}
