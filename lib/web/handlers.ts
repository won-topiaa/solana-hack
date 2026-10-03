// The web app's actions on a case. The API routes only parse the request and call
// these: each opens the sealed case, does one step, and returns the case sealed
// again with what the browser shows. Plain functions with their services passed in,
// so tests run them with a scripted model and a stand-in chain.

import { randomBytes, randomUUID } from "node:crypto";
import { createCaseFile, resolveApproval, sendUserMessage, type AgentDeps } from "../agent/orchestrator";
import { addPhoto, dropReadPhotoBytes, MAX_PHOTO_BYTES } from "../agent/photos";
import type { CaseFile } from "../agent/types";
import type { ChainService } from "../chain/adapter";
import type { IdentityVerifier } from "../integrations/identity";
import { prepareWalletSettlementPayment, runPrimarySale, runSettlement, type HeiWallets, type WalletPaymentRequest } from "../chain/heiLifecycle";
import { receiptMemo, type DevnetRpc } from "../chain/solana";
import { parseSignedByWallet, parseWalletAddress, verifyWalletProof, walletProofMessage, type SignedByWallet, type UnsignedForWallet } from "../chain/userWallet";
import { todayInNewYork } from "../params/dates";
import type { Registry } from "../params/types";
import { PERSONA_IDS, personaCaseOn } from "../recommend/personas";
import { checkParamsFresh } from "../params/staleness";
import { findSettlementScenario } from "../recommend/settlementScenarios";
import { openCase, sealCase } from "./caseToken";
import { approvalNeedsWallet, buildView, walletLocked, type CaseView } from "./view";

export type WebDeps = {
  agent: AgentDeps;
  registry: Registry;
  secret: string; // CASE_SECRET
  hei?: { rpc: DevnetRpc; wallets: HeiWallets; identity?: IdentityVerifier }; // devnet partner steps; absent = not offered
  chain?: ChainService; // for steps the user's own wallet signs
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
  const identity = deps.hei?.identity;
  const kycCheck = identity ? { label: identity.label, simulated: identity.provider === "simulated" } : undefined;
  return { token: sealCase(compact, deps.secret), view: buildView(compact, deps.registry, kycCheck) };
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

function signedFrom(value: unknown): SignedByWallet | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return parseSignedByWallet(value);
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Bad wallet signature");
  }
}

/** The user's yes or no to the action waiting for approval; a yes to a wallet step carries the wallet's signature. */
export async function postApproval(deps: WebDeps, input: { token: unknown; approvalId: unknown; approved: unknown; signed?: unknown }): Promise<CaseReply> {
  const caseFile = openToken(deps, input.token);
  if (typeof input.approved !== "boolean") throw new BadRequest("approved must be true or false");
  if (!caseFile.pendingApproval || caseFile.pendingApproval.id !== input.approvalId) throw new BadRequest("No such approval request");
  const signed = signedFrom(input.signed);
  if (input.approved && approvalNeedsWallet(caseFile) && !signed) throw new BadRequest("Sign this step in your wallet to approve it");
  const turn = await resolveApproval(caseFile, caseFile.pendingApproval.id, input.approved, deps.agent, signed);
  return reply(deps, turn.caseFile);
}

/** The transaction the user's wallet signs to approve the pending step (it is not sent yet). */
export async function prepareApprovalSignature(deps: WebDeps, input: { token: unknown; approvalId: unknown }): Promise<UnsignedForWallet> {
  const caseFile = openToken(deps, input.token);
  const pending = caseFile.pendingApproval;
  if (!pending || pending.id !== input.approvalId) throw new BadRequest("No such approval request");
  if (!approvalNeedsWallet(caseFile) || !caseFile.wallet) throw new BadRequest("This step is not signed in your wallet");
  if (!deps.chain) throw new BadRequest("Solana devnet is not set up on this server");
  if (!caseFile.handoff) throw new BadRequest("Prepare the documents first");
  return deps.chain.prepareWalletReceipt(receiptMemo(caseFile.handoff.receipt), caseFile.wallet.address);
}

// ---- The user's own wallet --------------------------------------------------

/** Step 1 of connecting a wallet: the message it must sign (it names the case and the address). */
/** Changing the wallet while an approval waits would make the approved sentence untrue. */
function walletChangeAllowed(caseFile: CaseFile): void {
  if (walletLocked(caseFile)) throw new BadRequest("This case already has on-chain records, so its wallet cannot change");
  if (caseFile.pendingApproval) throw new BadRequest("Answer the approval request first, then change the wallet");
}

export function walletChallenge(deps: WebDeps, input: { token: unknown; address: unknown }): CaseReply & { message: string } {
  const caseFile = openToken(deps, input.token);
  walletChangeAllowed(caseFile);
  let wallet: string;
  try {
    wallet = parseWalletAddress(input.address);
  } catch (error) {
    throw new BadRequest(error instanceof Error ? error.message : "Bad wallet address");
  }
  const issuedAt = currentTime(deps).toISOString();
  const message = walletProofMessage({ caseId: caseFile.id, wallet, nonce: randomBytes(16).toString("hex"), issuedAt });
  const next = { ...caseFile, walletChallenge: { address: wallet, message, issuedAt } };
  return { ...reply(deps, next), message };
}

/** A challenge older than this must be asked for again. */
const CHALLENGE_MINUTES = 10;

/** Step 2: the wallet's signature over that message ties the wallet to the case. */
export async function walletConnect(deps: WebDeps, input: { token: unknown; signature: unknown }): Promise<CaseReply> {
  const caseFile = openToken(deps, input.token);
  const challenge = caseFile.walletChallenge;
  if (!challenge) throw new BadRequest("Ask for the message to sign first");
  walletChangeAllowed(caseFile);
  const now = currentTime(deps);
  if (now.getTime() - Date.parse(challenge.issuedAt) > CHALLENGE_MINUTES * 60_000) throw new BadRequest("The message to sign expired; connect the wallet again");
  if (typeof input.signature !== "string" || !(await verifyWalletProof(parseWalletAddress(challenge.address), challenge.message, input.signature))) {
    throw new BadRequest("The wallet's signature does not match the message");
  }
  const connected: CaseFile = { ...caseFile, walletChallenge: undefined, wallet: { address: challenge.address, connectedAt: now.toISOString() } };
  return reply(deps, { ...connected, events: [...connected.events, { at: now.toISOString(), type: "wallet_connected", detail: challenge.address }] });
}

/** Back to the demo wallet (only before anything is on-chain). */
export function walletDisconnect(deps: WebDeps, input: { token: unknown }): CaseReply {
  const caseFile = openToken(deps, input.token);
  walletChangeAllowed(caseFile);
  return reply(deps, { ...caseFile, wallet: undefined, walletChallenge: undefined });
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
  const sale = await runPrimarySale(
    hei.rpc,
    hei.wallets,
    { heiMint: shares.mint, treasury: shares.treasury, deal, homeowner: caseFile.wallet?.address },
    () => currentTime(deps),
    hei.identity,
  );
  return reply(deps, withOnchain(caseFile, { heiSale: sale }));
}

/** The settlement's years and home price growth come from a scenario id: the numbers stay on the server. */
function settlementParts(deps: WebDeps, caseFile: CaseFile, input: { scenario: unknown }) {
  const parts = heiParts(deps, caseFile);
  const sale = parts.handoff.onchain?.heiSale;
  if (!sale) throw new BadRequest("Run the primary sale first");
  if (parts.handoff.onchain?.heiSettlement) throw new BadRequest("This HEI is already settled");
  const scenario = findSettlementScenario(deps.registry, parts.deal.termYears, input.scenario);
  if (!scenario) throw new BadRequest("Unknown settlement scenario for this HEI's term");
  // The home price growth is registry data like any other: stale, it may not set an appraisal.
  const freshness = checkParamsFresh(deps.registry, [scenario.paramKey], deps.registry.frozenOn ?? todayInNewYork(currentTime(deps)));
  if (!freshness.ok) throw new BadRequest(`The home price index value is out of date (${freshness.stale.map((item) => item.reason).join("; ")}); refresh the registry first`);
  return { ...parts, sale, scenario, years: scenario.years, growth: scenario.growth };
}

/**
 * With the user's own wallet as the homeowner: mints the simulated money it is missing
 * and builds the payment into the settlement account for the wallet to sign. `payment`
 * is null when the homeowner already paid (an earlier, interrupted run).
 */
export async function prepareHeiSettlement(deps: WebDeps, input: { token: unknown; scenario: unknown }): Promise<CaseReply & { payment: WalletPaymentRequest | null }> {
  const caseFile = openToken(deps, input.token);
  if (!caseFile.wallet) throw new BadRequest("This case uses the demo wallet: settle without signing");
  const { hei, deal, shares, sale, years, growth } = settlementParts(deps, caseFile, input);
  const payment = await prepareWalletSettlementPayment(hei.rpc, hei.wallets, { heiMint: shares.mint, deal, sale, years, growth, wallet: caseFile.wallet.address });
  const pending = {
    years,
    growth,
    amountMicroUsd: payment?.amountMicroUsd ?? "0",
    lastValidBlockHeight: payment?.lastValidBlockHeight,
    preparedAt: currentTime(deps).toISOString(),
  };
  return { ...reply(deps, withOnchain(caseFile, { heiSettlementPending: pending })), payment };
}

/**
 * Settlement after `years` with a simulated appraisal at `growth` a year: the homeowner
 * pays into the settlement account (the user's signed payment, or the demo wallet), then
 * each holder is paid and its shares are burned.
 */
export async function runHeiSettlement(deps: WebDeps, input: { token: unknown; scenario: unknown; signed?: unknown }): Promise<CaseReply> {
  const caseFile = openToken(deps, input.token);
  const { hei, deal, shares, sale, scenario, years, growth } = settlementParts(deps, caseFile, input);
  let homeowner: Parameters<typeof runSettlement>[2]["homeowner"] = { kind: "demo" };
  if (caseFile.wallet) {
    const pending = caseFile.handoff?.onchain?.heiSettlementPending;
    if (!pending || pending.years !== years || pending.growth !== growth) throw new BadRequest("Prepare the settlement payment for your wallet first");
    const signed = signedFrom(input.signed);
    if (!signed && pending.amountMicroUsd !== "0") throw new BadRequest("Sign the settlement payment in your wallet first");
    homeowner = { kind: "wallet", wallet: caseFile.wallet.address, signed, amountMicroUsd: pending.amountMicroUsd, lastValidBlockHeight: pending.lastValidBlockHeight };
  }
  const settled = await runSettlement(hei.rpc, hei.wallets, { heiMint: shares.mint, deal, sale, years, growth, scenario: scenario.note, homeowner }, () =>
    currentTime(deps),
  );
  return reply(deps, withOnchain(caseFile, { heiSettlement: settled, heiSettlementPending: undefined }));
}
