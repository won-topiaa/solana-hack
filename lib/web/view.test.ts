import { describe, expect, it } from "vitest";
import { withoutFigures } from "./view";

describe("the web chat", () => {
  it("replaces any amount or rate the model wrote, so only code-made figures reach the page", () => {
    expect(withoutFigures("The HEI pays you $150,000 now and costs about 4.6% a year.")).toBe(
      "The HEI pays you [amount: see the panel] now and costs about [rate: see the panel] a year.",
    );
    expect(withoutFigures("Roughly $1.2 million, or 20 percent.")).toBe("Roughly [amount: see the panel], or [rate: see the panel].");
  });

  it("also catches amounts written without a dollar sign, and rates in words", () => {
    const text = "You pay 234,131 dollars, about 150k, or USD 150,000; 1,774 a month; 150000 in total; 7.7 per cent a year.";
    expect(withoutFigures(text)).toBe(
      "You pay [amount: see the panel], about [amount: see the panel], or [amount: see the panel]; [amount: see the panel] a month; [amount: see the panel] in total; [rate: see the panel] a year.",
    );
  });

  it("keeps small counts, ids and registry versions", () => {
    const text = "Rule RE-2 fired for home-1 over 10 years; registry 2026-10-02.1; photo-2.";
    expect(withoutFigures(text)).toBe(text);
  });

  it("leaves plain text, dates and links alone", () => {
    const text = "Recorded on 2026-10-02: https://explorer.solana.com/tx/5abc?cluster=devnet";
    expect(withoutFigures(text)).toBe(text);
  });
});
