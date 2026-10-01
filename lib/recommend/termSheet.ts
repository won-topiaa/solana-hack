// The HEI term sheet (PLAN §5): every figure comes from lib/calc with registry
// inputs, so the same case always gives the same sheet.

import { heiTerms } from "../calc/hei";
import { capBindsUntilYears, homeValueAfterYears, settle } from "../calc/settlement";
import { formatUsd } from "../format";
import { pct, type HomeInput, type RealEstateTerms } from "./realEstate";

export type HeiTermSheet = {
  assetId: string;
  homeValueUsd: number;
  valueSource: string;
  valueAsOf: string;
  netCashUsd: number;
  grossInvestmentUsd: number;
  feeUsd: number;
  tokenPriceUsd: number;
  tokenSupply: number;
  shareOfFutureValue: number;
  investorReturnCapPerYear: number;
  termYears: number;
  plannedSettlementYears: number;
  settlementExamples: { growth: number; years: number; payoutUsd: number; ownerAnnualCost: number }[];
  capBindsUntilYears: { growth: number; years: number }[];
  settlementTriggers: string[];
  settlementValue: string;
  registryVersion: string;
};

export function buildHeiTermSheet(
  home: HomeInput & { valueSource: string; valueAsOf: string },
  netCashUsd: number,
  plannedYears: number,
  terms: RealEstateTerms,
  registryVersion: string,
): HeiTermSheet {
  const hei = heiTerms({ homeValueUsd: home.valueUsd, netCashUsd, ...terms.hei });
  if (!hei.eligible) throw new Error("This home is not eligible for an HEI of that size");
  // The term is the planned horizon rounded up, kept within the allowed range.
  const termYears = Math.min(terms.heiTermYears.max, Math.max(terms.heiTermYears.min, Math.ceil(plannedYears)));
  const settlementYears = Math.min(plannedYears, termYears);
  const capInput = {
    grossInvestmentUsd: hei.grossInvestmentUsd,
    tokenSupply: hei.tokenSupply,
    homeValueTodayUsd: home.valueUsd,
    investorReturnCap: terms.hei.investorReturnCap,
  };
  return {
    assetId: home.assetId,
    homeValueUsd: home.valueUsd,
    valueSource: home.valueSource,
    valueAsOf: home.valueAsOf,
    netCashUsd,
    grossInvestmentUsd: hei.grossInvestmentUsd,
    feeUsd: hei.feeUsd,
    tokenPriceUsd: hei.tokenPriceUsd,
    tokenSupply: hei.tokenSupply,
    shareOfFutureValue: hei.shareOfFutureValue,
    investorReturnCapPerYear: terms.hei.investorReturnCap,
    termYears,
    plannedSettlementYears: settlementYears,
    settlementExamples: terms.heiGrowthScenarios.map((growth) => {
      const result = settle({
        grossInvestmentUsd: hei.grossInvestmentUsd,
        tokenSupply: hei.tokenSupply,
        netCashUsd,
        investorReturnCap: terms.hei.investorReturnCap,
        years: settlementYears,
        homeValueAtSettlementUsd: homeValueAfterYears(home.valueUsd, growth, settlementYears),
      });
      return { growth, years: settlementYears, payoutUsd: result.payoutUsd, ownerAnnualCost: result.ownerAnnualCost };
    }),
    capBindsUntilYears: terms.heiGrowthScenarios.map((growth) => ({
      growth,
      years: capBindsUntilYears({ ...capInput, annualGrowth: growth }),
    })),
    settlementTriggers: [
      "You choose to settle (buy back) at any time.",
      "The home is sold.",
      "The term ends.",
      "Property tax or insurance goes unpaid.",
    ],
    settlementValue:
      "The sale price when the home is sold; otherwise an independent appraisal (simulated in this demo). " +
      "The rule for a sale far below a recent appraisal is still to be decided.",
    registryVersion,
  };
}

export function describeTermSheet(sheet: HeiTermSheet): string[] {
  return [
    `HEI term sheet (home value ${formatUsd(sheet.homeValueUsd)}, ${sheet.valueSource}, ${sheet.valueAsOf}):`,
    `You receive ${formatUsd(sheet.netCashUsd)}. Investors pay ${formatUsd(sheet.grossInvestmentUsd)}, including a ${formatUsd(sheet.feeUsd)} fee.`,
    `${sheet.tokenSupply.toLocaleString("en-US")} tokens at $${sheet.tokenPriceUsd.toFixed(6)} each: ${pct(sheet.shareOfFutureValue)} of the home's future value.`,
    `Investor return capped at ${pct(sheet.investorReturnCapPerYear)} a year. Term ${sheet.termYears} years; planned settlement after ${sheet.plannedSettlementYears} years.`,
    ...sheet.settlementExamples.map(
      (example) =>
        `If prices ${example.growth === 0 ? "stay flat" : `rise ${pct(example.growth)} a year`}: you pay ${formatUsd(example.payoutUsd)} after ${example.years} years (${pct(example.ownerAnnualCost)} a year).`,
    ),
    `Settlement happens when: ${sheet.settlementTriggers.join(" ")}`,
    `Settlement value: ${sheet.settlementValue}`,
  ];
}
