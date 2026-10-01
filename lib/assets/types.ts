// Assets the user brings (CLAUDE.md §9). Personal data such as the street
// address and owner names stays in the case file's PII store and is referenced
// by key, so it never goes on-chain or into the event log (CLAUDE.md §2).

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

/** Watches join in M5. */
export type Asset = RealEstateAsset;

export type PiiItem = { kind: "address" | "person_name"; value: string };
