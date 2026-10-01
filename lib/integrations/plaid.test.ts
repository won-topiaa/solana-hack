import { describe, expect, it } from "vitest";
import {
  createPlaidSandboxSource,
  PLAID_SANDBOX_LABEL,
  SANDBOX_INSTITUTION_ID,
  toMortgageSummaries,
  type LiabilitiesResponse,
} from "./plaid";

// Field names follow https://plaid.com/docs/api/products/liabilities/. The numbers match the
// test mortgage the real Plaid sandbox returned on 2026-10-02 (sandbox test data, not a person's).
const liabilities: LiabilitiesResponse = {
  accounts: [
    { account_id: "acc-mortgage", balances: { current: 56_302.06 } },
    { account_id: "acc-card", balances: { current: 410 } },
  ],
  liabilities: {
    mortgage: [
      {
        account_id: "acc-mortgage",
        interest_rate: { percentage: 3.99, type: "fixed" },
        next_monthly_payment: 3141.54,
        maturity_date: "2045-07-31",
      },
    ],
  },
};

describe("toMortgageSummaries", () => {
  it("takes the balance from the matching account and the terms from the mortgage", () => {
    expect(toMortgageSummaries(liabilities)).toEqual([
      {
        balanceUsd: 56_302.06,
        interestRatePercent: 3.99,
        interestRateType: "fixed",
        nextMonthlyPaymentUsd: 3141.54,
        maturityDate: "2045-07-31",
        source: PLAID_SANDBOX_LABEL,
      },
    ]);
  });

  it("returns nothing when there is no mortgage", () => {
    expect(toMortgageSummaries({ accounts: [], liabilities: { mortgage: null } })).toEqual([]);
  });
});

describe("createPlaidSandboxSource (tested offline)", () => {
  function fakePlaid(fail?: string) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      calls.push({ path, body: JSON.parse(String(init?.body)) });
      if (path === fail) return new Response(JSON.stringify({ error_code: "INVALID_API_KEYS" }), { status: 400 });
      const answers: Record<string, unknown> = {
        "/sandbox/public_token/create": { public_token: "public-sandbox-1" },
        "/item/public_token/exchange": { access_token: "access-sandbox-1", item_id: "item-1" },
        "/liabilities/get": liabilities,
      };
      return new Response(JSON.stringify(answers[path]), { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("creates a sandbox connection, exchanges the token and reads liabilities, in that order", async () => {
    const { fetchImpl, calls } = fakePlaid();
    const mortgages = await createPlaidSandboxSource({ clientId: "client-1", secret: "secret-1" }, fetchImpl).readMortgages();

    expect(calls.map((call) => call.path)).toEqual([
      "/sandbox/public_token/create",
      "/item/public_token/exchange",
      "/liabilities/get",
    ]);
    expect(calls[0].body).toEqual({
      client_id: "client-1",
      secret: "secret-1",
      institution_id: SANDBOX_INSTITUTION_ID,
      initial_products: ["liabilities"],
    });
    expect(calls[1].body).toMatchObject({ public_token: "public-sandbox-1" });
    expect(calls[2].body).toMatchObject({ access_token: "access-sandbox-1" });
    expect(mortgages[0].balanceUsd).toBe(56_302.06);
  });

  it("reports Plaid's error code without the secret", async () => {
    const { fetchImpl } = fakePlaid("/sandbox/public_token/create");
    const read = createPlaidSandboxSource({ clientId: "client-1", secret: "secret-1" }, fetchImpl).readMortgages();
    await expect(read).rejects.toThrow("Plaid /sandbox/public_token/create: INVALID_API_KEYS");
    await expect(read).rejects.not.toThrow(/secret-1/);
  });
});
