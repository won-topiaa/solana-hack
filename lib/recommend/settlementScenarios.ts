// The settlement demo's scenarios (partner page). Time does not pass on devnet, so the
// settlement picks how many years have passed; the home's value then follows the real
// FHFA house price index: prices move as they did over the same number of past years
// (registry keys home_price_growth_2y / _10y, from FRED USSTHPI). The appraisal itself
// is still simulated. Defined here, so the browser sends only a scenario id and every
// number comes from code and the registry.

import { formatPercent } from "../format";
import { getNumber } from "../params/inputs";
import type { Registry } from "../params/types";

type SettlementScenario = {
  id: string;
  label: string;
  note: string; // where the growth comes from, with its date
  years: number;
  growth: number; // yearly home price growth
  paramKey: string; // the registry value the growth comes from (its freshness is checked before settling)
};

const SCENARIOS = [
  { id: "buyback-2y", years: 2, key: "home_price_growth_2y" },
  { id: "maturity-10y", years: 10, key: "home_price_growth_10y" },
] as const;

function signed(growth: number): string {
  return `${growth >= 0 ? "+" : ""}${formatPercent(growth * 100)}`;
}

/** The scenarios that fit the HEI's term, with their growth from the registry. */
export function settlementScenarios(registry: Registry, termYears: number): SettlementScenario[] {
  return SCENARIOS.filter((scenario) => scenario.years <= termYears).map((scenario) => {
    const growth = getNumber(registry, scenario.key);
    const asOf = registry.params[scenario.key].as_of;
    // Settling at the end of the term is maturity; any earlier settlement is the owner's buyback.
    const label = `${scenario.years >= termYears ? "Maturity" : "Buyback"} after ${scenario.years} years`;
    return {
      id: scenario.id,
      label,
      paramKey: scenario.key,
      note: `Home prices move as in the ${scenario.years} years to ${asOf}: ${signed(growth)} a year (FHFA house price index, US)`,
      years: scenario.years,
      growth,
    };
  });
}

export function findSettlementScenario(registry: Registry, termYears: number, id: unknown): SettlementScenario | null {
  return settlementScenarios(registry, termYears).find((scenario) => scenario.id === id) ?? null;
}
