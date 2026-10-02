// Assets the user brings (CLAUDE.md §9). Personal data such as the street
// address and owner names stays in the case file's PII store and is referenced
// by key, so it never goes on-chain or into the event log (CLAUDE.md §2).

import type { WatchCategory } from "../calc/watch";

export type OwnerMatch = "match" | "partial" | "no_match" | "unknown";

export type RealEstateAsset = {
  id: string;
  kind: "real_estate";
  addressRef: string; // key into CaseFile.pii
  avm?: { low: number; mid: number; high: number; source: string; asOf: string };
  ownerMatch?: OwnerMatch; // name the user gave vs. owner names on public records
  ownerOccupied?: boolean;
  lastSale?: { date: string; priceUsd: number };
  mortgageBalanceUsd?: number;
  mortgageSource?: "user_stated" | "plaid";
  interiorNotes?: string;
};

/** CLAUDE.md §9. category stays null until code or the user settles it, because it sets the loan-to-value. */
export type WatchAsset = {
  id: string;
  kind: "watch";
  maker?: string;
  model?: string;
  reference?: string;
  serialRef?: string; // key into CaseFile.pii (raw serial and its salt)
  serialHash?: string; // keyed hash of the serial (lib/assets/serial.ts); safe to publish
  hasBox?: boolean;
  hasPapers?: boolean;
  category: WatchCategory | null;
  marketValue?: { usd: number; source: string; asOf: string };
  theftCheck: "not_checked" | "clear" | "flagged" | "simulated_clear";
  photoIds: string[];
};

export type Asset = RealEstateAsset | WatchAsset;

export type PiiItem =
  | { kind: "address" | "person_name"; value: string; salt?: string } // salt: for the passport's address hash
  // The salt keeps the published serial hash from being reversed by trying every serial.
  | { kind: "serial"; value: string; salt: string };

/** A photo the user uploaded. It may show a serial number, so it stays off-chain with the case. */
/** dataBase64 is dropped once the photo is read, to keep the case small; sha256 stays as evidence. */
export type Photo = { mimeType: string; dataBase64?: string; sha256: string; addedAt: string };
