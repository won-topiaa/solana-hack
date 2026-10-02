import { describe, expect, it } from "vitest";
import { testRegistry } from "../params/test-fixtures";
import { personaCase } from "../recommend/personas";
import { recommend, realEstateTerms } from "../recommend/recommend";
import { buildHeiTermSheet } from "../recommend/termSheet";
import { comparisonChart, heiChart, progressOf } from "./charts";

const now = new Date("2026-10-01T15:00:00Z");

function recommendationFor(id: string) {
  const result = recommend(personaCase(id, now), testRegistry(), "2026-10-01", now);
  if (result.status !== "ok") throw new Error(result.status);
  return result.recommendation;
}

describe("the comparison chart (persona B)", () => {
  const chart = comparisonChart(recommendationFor("B"));
  const panel = (title: string) => chart.panels.find((item) => item.title.startsWith(title));

  it("shows the cash against the goal", () => {
    expect(panel("Cash now")?.line).toEqual({ value: 150_000, text: "Goal $150,000" });
    expect(panel("Cash now")?.bars.map((item) => item.id)).toEqual(["re-heloc", "re-home-equity-loan", "re-hei"]);
  });

  it("shows why the HEI wins: the loans' monthly payments are over the $0 budget", () => {
    const monthly = panel("Monthly payment");
    expect(monthly?.line).toEqual({ value: 0, text: "Your budget $0" });
    expect(monthly?.bars.map((item) => [item.id, item.text])).toEqual([
      ["re-heloc", "$886"],
      ["re-home-equity-loan", "$1,774"],
      ["re-hei", "None"],
    ]);
  });

  it("shows the HEI's cost as the range of its price scenarios (§8.5: 84,131 flat, 164,652 at +3%)", () => {
    const costs = panel("Total cost over 10 years");
    const hei = costs?.bars.find((item) => item.id === "re-hei");
    expect(Math.round(hei?.low ?? 0)).toBe(84_131);
    expect(Math.round(hei?.high ?? 0)).toBe(164_652);
    expect(hei).toMatchObject({ recommended: true, text: "$84,131 to $164,652" });
    expect(costs?.note).toBe("HEI: from prices flat to +3% a year.");
  });
});

describe("the comparison chart (persona A, watches)", () => {
  it("shows a dealer's cash as a range and has no monthly panel", () => {
    const chart = comparisonChart(recommendationFor("A"));
    expect(chart.panels.map((item) => item.title)).toEqual(["Cash now", "Total cost over 3 months"]);
    const plan = chart.panels[0].bars.find((item) => item.id === "watch-plan");
    expect(plan).toMatchObject({ low: 29_250, high: 32_250, recommended: true });
    expect(chart.panels[0].bars.some((item) => item.id.startsWith("w-vault-token-"))).toBe(false); // information only
    expect(chart.panels[1].note).toContain("Watch loans: rates are not published");
  });
});

describe("the HEI chart (persona B's term sheet)", () => {
  const rec = recommendationFor("B");
  const home = personaCase("B", now).assets.find((asset) => asset.kind === "real_estate");
  if (home?.kind !== "real_estate" || !home.avm) throw new Error("persona B has a valued home");
  const sheet = buildHeiTermSheet(
    { assetId: home.id, valueUsd: home.avm.mid, mortgageBalanceUsd: home.mortgageBalanceUsd, valueSource: home.avm.source, valueAsOf: home.avm.asOf },
    150_000,
    rec.inputs.horizonYears,
    realEstateTerms(testRegistry()),
    rec.registryVersion,
  );
  const chart = heiChart(sheet);
  const at = (name: string, years: number) => chart.series.find((item) => item.name === name)?.points.find((point) => point.years === years)?.usd ?? NaN;

  it("follows §8.5: capped early, then the share of the home's value", () => {
    expect(Math.round(at("Prices flat", 0))).toBe(156_087); // the investment itself
    expect(Math.round(at("Prices flat", 2))).toBe(224_766); // capped
    expect(Math.round(at("Prices flat", 3))).toBe(234_131);
    expect(Math.round(at("Prices flat", 10))).toBe(234_131);
    expect(Math.round(at("Prices +3% a year", 10))).toBe(314_652);
  });

  it("marks where the cap ends (2.22 years flat, 2.65 at +3%) and shows the ownership split", () => {
    expect(chart.capEnds.map((item) => item.text)).toEqual(["Cap ends after 2.22 years", "Cap ends after 2.65 years"]);
    expect(chart.share.investorsText).toBe("Investors: 23.41% of the home's value at settlement");
    expect(chart.share.ownerText).toBe("You keep 76.59%");
    expect(chart.maxUsd).toBeCloseTo(314_652, 0);
  });
});

describe("the progress steps", () => {
  it("start at the comparison for a loaded persona, and include the sale and settlement for an HEI", () => {
    const file = personaCase("B", now);
    expect(progressOf(file).map((step) => `${step.label}:${step.state}`)).toEqual(["Goal:done", "Assets:done", "Compare:current", "Documents:todo", "On-chain:todo"]);
  });
});
