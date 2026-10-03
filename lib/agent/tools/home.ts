// The home (steps 2-4): property records and value, owner check, and the mortgage (typed, or read through Plaid's sandbox).

import { matchOwner } from "../../assets/ownerMatch";
import type { OwnerMatch, RealEstateAsset } from "../../assets/types";
import { formatPercent, formatUsd } from "../../format";
import type { MortgageDataSource } from "../../integrations/plaid";
import { normalizeAddress, type PropertyDataSource } from "../../integrations/rentcast";
import { type AgentTool, EDITABLE_STAGES, storePii } from "./shared";

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
        "Also checks the name on the title against the owner on record.",
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
        "user typing the balance. The user must approve the connection first.",
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
