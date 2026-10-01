// Asset passports and the recommendation receipt (PLAN §4.3). Both are
// off-chain JSON whose hashes can later go on-chain (M7). Personal data never
// enters them: identifiers are keyed hashes with a salt kept in the case file.

import type { CaseFile } from "../agent/types";
import { hashSerial, newSalt } from "../assets/serial";
import type { PiiItem } from "../assets/types";
import { hashOf } from "./canonical";
import type { Recommendation } from "./types";

export type AssetPassport = {
  version: 1;
  assetId: string;
  kind: "real_estate" | "watch";
  identifierHashes: Record<string, string>;
  evidenceHashes: string[];
  valuation: Record<string, unknown>;
  approvals: { signer: string; at: string }[]; // wallet signatures arrive in M7
};

export type Receipt = {
  recommendationHash: string;
  passportHash: string; // hash of the sorted list of passport hashes
  registryVersion: string;
  createdAt: string;
  txId?: string; // set once the receipt is recorded on-chain (M7)
};

/** Builds the passport for one asset. A home's address gets a salt the first time. */
export function buildPassport(caseFile: CaseFile, assetId: string): { caseFile: CaseFile; passport: AssetPassport } {
  const asset = caseFile.assets.find((item) => item.id === assetId);
  if (!asset) throw new Error(`No asset with id ${assetId}`);

  if (asset.kind === "real_estate") {
    const address = caseFile.pii[asset.addressRef];
    if (!address || address.kind !== "address") throw new Error(`Address for ${assetId} is missing`);
    const salt = address.salt ?? newSalt();
    const salted: PiiItem = { ...address, salt };
    const file = { ...caseFile, pii: { ...caseFile.pii, [asset.addressRef]: salted } };
    const evidence = {
      avm: asset.avm,
      ownerMatch: asset.ownerMatch,
      ownerOccupied: asset.ownerOccupied,
      lastSale: asset.lastSale,
      mortgageBalanceUsd: asset.mortgageBalanceUsd,
      mortgageSource: asset.mortgageSource,
    };
    return {
      caseFile: file,
      passport: {
        version: 1,
        assetId,
        kind: "real_estate",
        identifierHashes: { address: hashSerial(address.value, salt) },
        evidenceHashes: [hashOf(evidence)],
        valuation: { avm: asset.avm, mortgageBalanceUsd: asset.mortgageBalanceUsd },
        approvals: [],
      },
    };
  }

  const evidence = {
    maker: asset.maker,
    model: asset.model,
    reference: asset.reference,
    hasBox: asset.hasBox,
    hasPapers: asset.hasPapers,
    theftCheck: asset.theftCheck,
  };
  const photoHashes = asset.photoIds.map((id) => caseFile.photos[id]?.sha256).filter((hash): hash is string => Boolean(hash));
  return {
    caseFile,
    passport: {
      version: 1,
      assetId,
      kind: "watch",
      identifierHashes: asset.serialHash ? { serial: asset.serialHash } : {},
      evidenceHashes: [...photoHashes, hashOf(evidence)],
      valuation: { marketValue: asset.marketValue, category: asset.category },
      approvals: [],
    },
  };
}

export function buildReceipt(recommendation: Recommendation, passports: AssetPassport[], now: Date): Receipt {
  return {
    recommendationHash: hashOf(recommendation),
    passportHash: hashOf(passports.map((passport) => hashOf(passport)).sort()),
    registryVersion: recommendation.registryVersion,
    createdAt: now.toISOString(),
  };
}
