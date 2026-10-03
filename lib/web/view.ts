// What the browser shows for a case: plain JSON with finished text. Every figure is
// formatted here by code from the case file and the registry (CLAUDE.md §3 rule 3),
// never written by the model. Personal data stays out: the home is "your home",
// a serial number appears only as the start of its hash, and no salt or address is sent.

import type { CaseFile, Stage } from "../agent/types";
import type { RealEstateAsset, WatchAsset } from "../assets/types";
import { explorerAddressUrl, explorerTxUrl } from "../chain/solana";
import { formatMicroUsd, formatPercent, formatUsd, formatYears } from "../format";
import type { Registry } from "../params/types";
import { hashOf } from "../recommend/canonical";
import { cashText, costText, frozenNote } from "../recommend/display";
import { DEMO_PERSONAS } from "../recommend/personas";
import { watchLabel } from "../recommend/recommend";
import { describeTermSheet } from "../recommend/termSheet";
import { settlementScenarios } from "../recommend/settlementScenarios";
import { comparisonChart, heiChart, progressOf, type ComparisonChart, type HeiChart, type ProgressStep } from "./charts";
import { isSelectable } from "../recommend/watches";

export const NOT_ADVICE = "This is not investment or financial advice.";

export type Link = { label: string; url: string; detail?: string };

/** Steps the user's own wallet signs, by the tool that asks for approval. */
const WALLET_SIGNED_TOOLS = ["record_receipt_onchain"];
/** Steps that write to Solana devnet (the others read data or run a simulated check). */
const ON_CHAIN_TOOLS = ["record_receipt_onchain", "issue_hei_shares", "issue_watch_token"];

/** True when approving the pending step means signing in the user's own wallet. */
export function approvalNeedsWallet(caseFile: CaseFile): boolean {
  return Boolean(caseFile.wallet && caseFile.pendingApproval && WALLET_SIGNED_TOOLS.includes(caseFile.pendingApproval.call.name));
}

/** The wallet can change only until something is on-chain; after that the records name it. */
export function walletLocked(caseFile: CaseFile): boolean {
  const onchain = caseFile.handoff?.onchain;
  return Boolean(onchain && Object.keys(onchain).length > 0);
}

export type CaseView = {
  caseId: string;
  persona: { id: string; title: string } | null; // a made-up demo persona, when one was loaded
  stage: Stage;
  progress: ProgressStep[]; // goal -> ... -> on-chain (-> sale -> settlement for an HEI)
  chat: { role: "user" | "agent"; text: string }[];
  approval: { id: string; summary: string; needsWallet: boolean; onChain: boolean } | null;
  /** The user's own wallet, when connected; null: the demo wallet stands in. `locked`: on-chain records name it. */
  wallet: { address: string; locked: boolean } | null;
  goal: string[] | null;
  assets: { id: string; title: string; lines: string[]; simulated: string[] }[];
  comparison: {
    rows: {
      id: string;
      label: string;
      cash: string;
      monthly: string;
      cost: string;
      keepsAsset: boolean;
      recommended: boolean;
      selectable: boolean;
      note: string | null; // why it is not suitable, or that it is for information only
    }[];
    headline: string;
    reasons: string[];
    risks: string[];
    rules: string;
    chart: ComparisonChart; // cash now vs the goal, monthly payment vs the budget, total cost
    frozenNote: string | null; // the registry is frozen for the judging period
    sources: { label: string; value: string; source: string; asOf: string }[];
    notice: string;
  } | null;
  documents: {
    selected: string;
    recommended: string | null;
    termSheet: string[];
    heiChart: HeiChart | null; // the payback over time and the ownership split, for an HEI
    passports: { label: string; hash: string }[];
    receipt: { recommendationHash: string; passportHash: string; registryVersion: string };
  } | null;
  onchain: Link[];
  hei: {
    canSell: boolean;
    canSettle: boolean;
    termYears: number;
    usesWallet: boolean; // the user's own wallet is the homeowner: it signs the settlement payment
    kycCheck: { label: string; simulated: boolean }; // who checks investors' identity before their KYC attestation
    scenarios: { id: string; label: string; note: string }[]; // home prices follow the real FHFA index
    sale: { lines: string[]; links: Link[] } | null;
    settlement: { lines: string[]; links: Link[]; correct: boolean } | null;
  } | null;
};

function personaOf(caseFile: CaseFile): CaseView["persona"] {
  const id = caseFile.id.startsWith("persona-") ? caseFile.id.slice("persona-".length).split("-")[0] : null;
  return DEMO_PERSONAS.find((persona) => persona.id === id) ?? null;
}

const AMOUNT = "[amount: see the panel]";
const RATE = "[rate: see the panel]";

/**
 * Number shapes the model might write: "$150,000", "USD 150", "$1.2 million", "150k",
 * "234,131 dollars", "150000", "4.6%", "7.7 per cent". Dates (2026-10-02), small counts
 * ("10 years", "photo-1") and ids are left alone.
 */
const FIGURES: [RegExp, string][] = [
  [/(?:\$|\bUS\$|\bUSD)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|thousand|million|M|billion|B)\b)?/g, AMOUNT],
  [/\b\d+(?:\.\d+)?\s?(?:%|percent\b|per\s?cent\b)/gi, RATE],
  [/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s?(?:dollars|USD)\b)?/gi, AMOUNT],
  [/\b\d+(?:\.\d+)?\s?(?:k|thousand|million|billion|dollars)\b/gi, AMOUNT],
  [/\b\d{5,}(?:\.\d+)?\b/g, AMOUNT],
];
const LINK = /(https?:\/\/[^\s<>"']+)/;

/**
 * The web agent is told never to write figures (the panel shows the code-made ones). If
 * it writes one anyway, it is replaced here, so no model-made number reaches the page.
 * Links are kept whole.
 */
export function withoutFigures(text: string): string {
  return text
    .split(LINK)
    .map((part, index) => (index % 2 === 1 ? part : FIGURES.reduce((out, [pattern, mask]) => out.replace(pattern, mask), part)))
    .join("");
}

function chatOf(caseFile: CaseFile): CaseView["chat"] {
  return caseFile.messages.flatMap((message): CaseView["chat"] => {
    if (message.role === "user") return [{ role: "user", text: message.text }];
    if (message.role === "model" && message.text.trim()) return [{ role: "agent", text: withoutFigures(message.text) }];
    return [];
  });
}

function goalOf(caseFile: CaseFile, assetTitles: Map<string, string>): string[] | null {
  const goal = caseFile.goal;
  if (!goal) return null;
  const intent = { home: "Use the home", watch: "Use watches", unsure: "Not sure which asset to use" }[goal.intent ?? "unsure"];
  const lines = [`${formatUsd(goal.cashNeededUsd)} needed by ${goal.neededBy}`, intent];
  if (goal.repayHorizonYears !== undefined) lines.push(`Plans to repay in ${formatYears(goal.repayHorizonYears)}`);
  if (goal.monthlyCapacityUsd !== undefined) lines.push(`Can pay ${formatUsd(goal.monthlyCapacityUsd)} a month`);
  if (goal.keepAssetIds.length > 0) lines.push(`Keeps: ${goal.keepAssetIds.map((id) => assetTitles.get(id) ?? id).join(", ")}`);
  else if (goal.keepAssetNotes?.length) lines.push(`Wants to keep: ${goal.keepAssetNotes.join(", ")}`);
  if (goal.age62Plus) lines.push("Age 62 or older");
  return lines;
}

function homeLines(home: RealEstateAsset): { lines: string[]; simulated: string[] } {
  const lines: string[] = [];
  if (home.avm) lines.push(`Value ${formatUsd(home.avm.low)} to ${formatUsd(home.avm.high)} (middle ${formatUsd(home.avm.mid)}); ${home.avm.source}, ${home.avm.asOf}`);
  if (home.ownerMatch) lines.push(`Owner check: ${home.ownerMatch.replace("_", " ")}`);
  if (home.mortgageBalanceUsd !== undefined) lines.push(`Mortgage ${formatUsd(home.mortgageBalanceUsd)} (${home.mortgageSource === "plaid" ? "from the lender, sandbox test data" : "as stated"})`);
  return { lines, simulated: [] };
}

function watchLines(watch: WatchAsset): { lines: string[]; simulated: string[] } {
  const lines: string[] = [];
  const name = [watch.maker, watch.reference].filter(Boolean).join(" ");
  if (name) lines.push(name);
  if (watch.marketValue) lines.push(`Value ${formatUsd(watch.marketValue.usd)}; ${watch.marketValue.source}, ${watch.marketValue.asOf}`);
  lines.push(`Box: ${watch.hasBox === undefined ? "not known" : watch.hasBox ? "yes" : "no"}; papers: ${watch.hasPapers === undefined ? "not known" : watch.hasPapers ? "yes" : "no"}`);
  if (watch.serialHash) lines.push(`Serial stored privately (hash ${watch.serialHash.slice(0, 8)}…)`);
  if (watch.photoIds.length > 0) lines.push(`Read from ${watch.photoIds.length} photo${watch.photoIds.length > 1 ? "s" : ""}`);
  const simulated = watch.theftCheck === "simulated_clear" ? ["Stolen-watch registry: no record found (simulated)"] : [];
  if (watch.theftCheck === "not_checked") lines.push("Stolen-watch check: not run yet");
  return { lines, simulated };
}

function assetsOf(caseFile: CaseFile): CaseView["assets"] {
  return caseFile.assets.map((asset) =>
    asset.kind === "real_estate"
      ? { id: asset.id, title: `Your home (${asset.id})`, ...homeLines(asset) }
      : { id: asset.id, title: `${watchLabel(asset)} (${asset.id})`, ...watchLines(asset) },
  );
}

/** Plain names for the registry values a comparison can use (others fall back to their key). */
const PARAM_LABELS: Record<string, string> = {
  heloc_avg_rate: "Average HELOC rate",
  home_equity_loan_avg_rate: "Average home equity loan rate",
  heloc_avg_rate_cltv_basis: "Those averages assume combined loan-to-value up to",
  hei_fee_rate: "HEI fee",
  hei_fee_min_usd: "HEI minimum fee",
  reverse_mortgage_min_age: "Reverse mortgage minimum age",
  watch_dealer_offer_range: "Dealer offers, share of market value",
  chrono24_private_seller_fee: "Marketplace seller fee",
  watch_loan_ltv: "Watch loan, share of value",
  watch_loan_term_days: "Watch loan term",
  cfpb_hei_early_growth: "CFPB: early yearly growth of the amount owed in many HEI contracts",
};

/** A registry value as text: rates and shares as percentages, dollars as dollars. */
function paramValueText(value: unknown, unit: string): string {
  const asShare = unit.startsWith("rate") || unit.includes("fraction") || unit.includes("loan-to-value") || unit.includes("growth");
  const one = (item: unknown): string => {
    if (typeof item !== "number") return String(item);
    if (asShare) return formatPercent(item * 100);
    return unit === "USD" ? formatUsd(item) : `${item} ${unit}`;
  };
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).map(([key, item]) => `${key.replaceAll("_", " ")} ${one(item)}`).join(", ");
  }
  return one(value);
}

/** The registry values behind the shown paths, with their source and date. */
function sourcesOf(keys: string[], registry: Registry): NonNullable<CaseView["comparison"]>["sources"] {
  return [...new Set(keys)]
    .map((key) => ({ key, entry: registry.params[key] }))
    // Market and product values set the numbers; reference values give context (with their source too).
    .filter(({ entry }) => entry && (entry.kind === "market" || entry.kind === "product" || entry.kind === "reference"))
    .map(({ key, entry }) => ({
      label: PARAM_LABELS[key] ?? key.replaceAll("_", " "),
      value: paramValueText(entry.value, entry.unit),
      source: entry.source,
      asOf: entry.kind === "market" ? entry.as_of : (entry.checked_at ?? entry.as_of),
    }));
}

function comparisonOf(caseFile: CaseFile, registry: Registry): CaseView["comparison"] {
  const rec = caseFile.recommendation;
  if (!rec) return null;
  const years = rec.inputs.horizonYears;
  const chosen = rec.options.find((option) => option.id === rec.chosenId);
  const bothWork = Boolean(rec.laneChoices.real_estate && rec.laneChoices.watch);
  return {
    rows: rec.options.map((option) => ({
      id: option.id,
      label: option.label,
      cash: option.informational && option.cashNowUsd === 0 ? "—" : cashText(option),
      monthly: option.monthlyPaymentUsd === undefined ? "—" : option.monthlyPaymentUsd === 0 ? "None" : formatUsd(option.monthlyPaymentUsd),
      cost: option.informational && option.cashNowUsd === 0 ? option.risks.join(" ") : costText(option, years),
      keepsAsset: option.keepsAsset,
      recommended: option.id === rec.chosenId,
      selectable: isSelectable(option),
      note: option.suitable ? (option.informational ? "For information only" : null) : (option.whyNotSuitable ?? "Not suitable"),
    })),
    headline: chosen ? `Recommended: ${chosen.label}` : bothWork ? "Both assets work: choose which one to use" : "No path reaches the goal yet",
    reasons: rec.reasons,
    risks: chosen?.risks ?? [],
    rules: `Rules applied: ${rec.rulesFired.join(", ") || "none"}. Values from parameter registry ${rec.registryVersion}.`,
    chart: comparisonChart(rec),
    frozenNote: rec.valuesFrozenOn ? frozenNote(rec.valuesFrozenOn) : null,
    sources: sourcesOf(rec.options.flatMap((option) => option.usedParamKeys), registry),
    notice: NOT_ADVICE,
  };
}

function documentsOf(caseFile: CaseFile): CaseView["documents"] {
  const handoff = caseFile.handoff;
  const rec = caseFile.recommendation;
  if (!handoff || !rec) return null;
  const label = (id: string | null) => (id ? (rec.options.find((option) => option.id === id)?.label ?? id) : null);
  const assetName = (assetId: string) => assetsOf(caseFile).find((asset) => asset.id === assetId)?.title ?? assetId;
  return {
    selected: label(handoff.receipt.selectedOptionId) ?? handoff.receipt.selectedOptionId,
    recommended: label(handoff.receipt.recommendedOptionId),
    termSheet: handoff.termSheet ? describeTermSheet(handoff.termSheet) : [],
    heiChart: handoff.termSheet ? heiChart(handoff.termSheet) : null,
    passports: handoff.passports.map((passport) => ({ label: assetName(passport.assetId), hash: hashOf(passport) })),
    receipt: { recommendationHash: handoff.receipt.recommendationHash, passportHash: handoff.receipt.passportHash, registryVersion: handoff.receipt.registryVersion },
  };
}

function onchainOf(caseFile: CaseFile): Link[] {
  const onchain = caseFile.handoff?.onchain;
  if (!onchain) return [];
  const links: Link[] = [];
  const yours = (owner: string | undefined) => (owner && owner === caseFile.wallet?.address ? "your wallet" : "the demo wallet");
  if (onchain.receipt) {
    links.push({ label: "Recommendation receipt (memo)", url: onchain.receipt.explorerUrls[0], detail: `Signed by ${onchain.receipt.signedBy ? "your wallet" : "the demo wallet"}` });
  }
  if (onchain.heiShares?.mint) links.push({ label: "HEI share token", url: explorerAddressUrl(onchain.heiShares.mint), detail: "Issued by a simulated partner" });
  if (onchain.watchToken?.mint) {
    links.push({ label: "Watch 1-of-1 token", url: explorerAddressUrl(onchain.watchToken.mint), detail: `Simulated vault intake; the token is in ${yours(onchain.watchToken.owner)}` });
  }
  return links;
}

/** Who verified the identity, from the provider id written in the attestation. */
function kycLabel(provider: string | undefined): string {
  if (provider === "plaid-identity-verification-sandbox") return "Plaid Identity Verification, sandbox test identity";
  return "simulated check";
}

function heiOf(caseFile: CaseFile, registry: Registry, kycCheck: { label: string; simulated: boolean }): CaseView["hei"] {
  const onchain = caseFile.handoff?.onchain;
  const sheet = caseFile.handoff?.termSheet;
  if (!onchain?.heiShares || !sheet) return null;
  const sale = onchain.heiSale;
  const settled = onchain.heiSettlement;
  const homeowner = caseFile.wallet ? "your wallet" : "the homeowner (demo wallet)";
  const paidIn = settled?.homeownerPayment;
  return {
    canSell: !sale,
    canSettle: Boolean(sale) && !settled,
    termYears: sheet.termYears,
    usesWallet: Boolean(caseFile.wallet),
    kycCheck,
    scenarios: settlementScenarios(registry, sheet.termYears).map(({ id, label, note }) => ({ id, label, note })),
    sale: sale
      ? {
          lines: [
            `Closing: the partner paid ${homeowner} ${formatMicroUsd(BigInt(sale.closing.amountMicroUsd))} (simulated partner; its test dollars are minted in the same transaction).`,
            ...sale.kyc.map((item) =>
              item.attestation
                ? `${item.name}: identity checked (${kycLabel(item.verifiedBy)}); its KYC attestation on Solana was checked before the share account opened.`
                : `${item.name}: KYC approved (simulated); share account opened.`,
            ),
            `A buyer without KYC${sale.noKycCheck ? ` (${sale.noKycCheck})` : ""} was refused on-chain ("${sale.rejected.reason}"); no money moved.`,
            ...sale.purchases.map((purchase) => `${purchase.name} bought ${BigInt(purchase.tokens).toLocaleString("en-US")} shares for ${formatMicroUsd(BigInt(purchase.costMicroUsd))} (simulated investor; test dollars minted in the purchase).`),
            `Raised ${formatMicroUsd(BigInt(sale.raisedMicroUsd))}.`,
          ],
          links: [
            { label: "Closing payment", url: explorerTxUrl(sale.closing.signature) },
            ...sale.kyc.flatMap((item) => (item.attestation ? [{ label: `${item.name} KYC attestation`, url: explorerAddressUrl(item.attestation), detail: "Solana Attestation Service" }] : [])),
            ...sale.purchases.flatMap((purchase) => (purchase.signature ? [{ label: `${purchase.name} purchase`, url: explorerTxUrl(purchase.signature) }] : [])),
            { label: "Account without KYC (frozen)", url: explorerAddressUrl(sale.frozenAccount) },
            { label: "Test dollar (DUSD, no value)", url: explorerAddressUrl(sale.paymentMint) },
          ],
        }
      : null,
    settlement: settled
      ? {
          lines: [
            `${settled.trigger === "maturity" ? "Maturity" : "Buyback"} after ${settled.years} years; home value ${formatUsd(settled.homeValueUsd)} (simulated appraisal${settled.scenario ? " that follows the real index" : ""}).`,
            ...(settled.scenario ? [`${settled.scenario}.`] : []),
            `Payout ${formatMicroUsd(BigInt(settled.payoutMicroUsd))}${settled.capApplied ? ` (the ${formatPercent(sheet.investorReturnCapPerYear * 100)} a year cap applies; uncapped ${formatUsd(settled.uncappedPayoutUsd)})` : ""}; homeowner's cost ${formatPercent(settled.ownerAnnualCost * 100)} a year.`,
            ...(paidIn ? [`${paidIn.by === "user wallet" ? "Your wallet" : "The homeowner (demo wallet)"} paid ${formatMicroUsd(BigInt(paidIn.amountMicroUsd))} into the HEI's settlement account.`] : []),
            ...(BigInt(settled.topUpMicroUsd) > BigInt(0)
              ? [
                  paidIn?.by === "user wallet"
                    ? `Simulated: the other ${formatMicroUsd(BigInt(settled.topUpMicroUsd))} of the homeowner's money (savings, refinancing or a sale), added by the partner with the first payouts.`
                    : `Simulated: the demo homeowner's ${formatMicroUsd(BigInt(settled.topUpMicroUsd))} (savings, refinancing or a sale), minted as test dollars in its payment.`,
                ]
              : []),
            ...(settled.recovered ? ["Recorded from the chain: an earlier request finished the settlement but its answer was lost."] : []),
            ...settled.payouts.map(
              (payout, index) =>
                `${caseFile.handoff?.onchain?.heiSale?.purchases[index]?.name ?? "Holder"}: ${BigInt(payout.tokens).toLocaleString("en-US")} shares burned, paid ${formatMicroUsd(BigInt(payout.receivedMicroUsd))}.`,
            ),
            `Shares left: ${settled.supplyLeft}. ${settled.correct ? "Every holder was paid its share." : "Check failed: see the transactions."}`,
          ],
          links: settled.signatures.map((signature, index) => ({
            label: signature === paidIn?.signature ? "Homeowner's payment" : `Payout and burn ${paidIn?.signature ? index : index + 1}`,
            url: explorerTxUrl(signature),
          })),
          correct: settled.correct,
        }
      : null,
  };
}

/** `kycCheck`: the server's identity check for investors (Plaid's sandbox, or a simulated check). */
export function buildView(caseFile: CaseFile, registry: Registry, kycCheck = { label: "Simulated identity check", simulated: true }): CaseView {
  const assets = assetsOf(caseFile);
  return {
    caseId: caseFile.id,
    persona: personaOf(caseFile),
    stage: caseFile.stage,
    progress: progressOf(caseFile),
    chat: chatOf(caseFile),
    approval: caseFile.pendingApproval
      ? {
          id: caseFile.pendingApproval.id,
          summary: caseFile.pendingApproval.summary,
          needsWallet: approvalNeedsWallet(caseFile),
          onChain: ON_CHAIN_TOOLS.includes(caseFile.pendingApproval.call.name),
        }
      : null,
    wallet: caseFile.wallet ? { address: caseFile.wallet.address, locked: walletLocked(caseFile) } : null,
    goal: goalOf(caseFile, new Map(assets.map((asset) => [asset.id, asset.title]))),
    assets,
    comparison: comparisonOf(caseFile, registry),
    documents: documentsOf(caseFile),
    onchain: onchainOf(caseFile),
    hei: heiOf(caseFile, registry, kycCheck),
  };
}
