// Made-up demo personas (PLAN §11) as case files, for demos and the M6 tests.
// Watch values come from the demo price table, so they are never written twice.

import data from "../../data/demo/personas.json";
import { createCaseFile } from "../agent/orchestrator";
import type { CaseFile } from "../agent/types";
import type { Asset, PiiItem } from "../assets/types";
import { findWatchPrice } from "../assets/watchPrices";

export const DEMO_TODAY = data.today;
export const PERSONA_IDS = data.personas.map((persona) => persona.id);

export function personaCase(id: string, now: Date): CaseFile {
  const persona = data.personas.find((item) => item.id === id);
  if (!persona) throw new Error(`No persona ${id}`);
  const assets: Asset[] = [];
  const pii: Record<string, PiiItem> = {};

  if (persona.home) {
    pii["pii-1"] = { kind: "address", value: data.home.address };
    assets.push({
      id: "home-1",
      kind: "real_estate",
      addressRef: "pii-1",
      avm: data.home.avm,
      ownerMatch: "match",
      ownerOccupied: data.home.ownerOccupied,
      mortgageBalanceUsd: data.home.mortgageBalanceUsd,
      mortgageSource: "user_stated",
    });
  }
  for (const watchId of persona.watches) {
    const watch = data.watches[watchId as keyof typeof data.watches];
    const price = findWatchPrice(watch.reference);
    if (!price) throw new Error(`No demo price for ${watch.reference}`);
    assets.push({
      id: watchId,
      kind: "watch",
      maker: watch.maker,
      model: watch.model,
      reference: watch.reference,
      hasBox: watch.hasBox,
      hasPapers: watch.hasPapers,
      category: price.category,
      marketValue: { usd: price.priceUsd, source: price.source, asOf: price.asOf },
      theftCheck: "not_checked",
      photoIds: [],
    });
  }
  return {
    ...createCaseFile(`persona-${id}`, now),
    stage: "capture",
    goal: { ...persona.goal, keepAssetIds: persona.keep },
    assets,
    pii,
  };
}
