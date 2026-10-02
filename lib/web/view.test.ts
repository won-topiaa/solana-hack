import { describe, expect, it } from "vitest";
import { withoutFigures } from "./view";

describe("the web chat", () => {
  it("replaces any amount or rate the model wrote, so only code-made figures reach the page", () => {
    expect(withoutFigures("The HEI pays you $150,000 now and costs about 4.6% a year.")).toBe(
      "The HEI pays you [amount: see the panel] now and costs about [rate: see the panel] a year.",
    );
    expect(withoutFigures("Roughly $1.2 million, or 20 percent.")).toBe("Roughly [amount: see the panel], or [rate: see the panel].");
  });

  it("leaves plain text, dates and links alone", () => {
    const text = "Recorded on 2026-10-02: https://explorer.solana.com/tx/5abc?cluster=devnet";
    expect(withoutFigures(text)).toBe(text);
  });
});
