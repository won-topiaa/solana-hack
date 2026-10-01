// Plaid Liabilities, sandbox only: reads a mortgage's balance and terms.
// Docs: https://plaid.com/docs/api/products/liabilities/
//       https://plaid.com/docs/api/sandbox/  https://plaid.com/docs/api/items/
// In production the user connects their lender through Plaid Link in the
// browser. In the sandbox a test connection can be created directly
// (/sandbox/public_token/create), so the terminal demo works without a browser.
// The access token is used once and never stored.

export const PLAID_SANDBOX_URL = "https://sandbox.plaid.com";

/** First Platypus Bank, a non-OAuth sandbox institution. Checked 2026-10-02: supports Liabilities and returns one test mortgage. */
export const SANDBOX_INSTITUTION_ID = "ins_109508";

export const PLAID_SANDBOX_LABEL = "Plaid sandbox (test data)";

export type MortgageSummary = {
  balanceUsd: number; // accounts[].balances.current
  interestRatePercent?: number;
  interestRateType?: string; // "fixed" or "variable"
  nextMonthlyPaymentUsd?: number;
  maturityDate?: string;
  source: string;
};

/** The fields we use from /liabilities/get. */
export type LiabilitiesResponse = {
  accounts: { account_id: string; balances?: { current?: number | null } }[];
  liabilities?: {
    mortgage?:
      | {
          account_id: string;
          interest_rate?: { percentage?: number | null; type?: string | null };
          next_monthly_payment?: number | null;
          maturity_date?: string | null;
        }[]
      | null;
  };
};

export interface MortgageDataSource {
  readMortgages(): Promise<MortgageSummary[]>;
}

/** Turns a /liabilities/get response into one summary per mortgage. */
export function toMortgageSummaries(data: LiabilitiesResponse): MortgageSummary[] {
  return (data.liabilities?.mortgage ?? []).flatMap((mortgage) => {
    const balance = data.accounts.find((account) => account.account_id === mortgage.account_id)?.balances?.current;
    if (typeof balance !== "number") return [];
    return [
      {
        balanceUsd: balance,
        interestRatePercent: mortgage.interest_rate?.percentage ?? undefined,
        interestRateType: mortgage.interest_rate?.type ?? undefined,
        nextMonthlyPaymentUsd: mortgage.next_monthly_payment ?? undefined,
        maturityDate: mortgage.maturity_date ?? undefined,
        source: PLAID_SANDBOX_LABEL,
      },
    ];
  });
}

export function createPlaidSandboxSource(
  credentials: { clientId: string; secret: string },
  fetchImpl: typeof fetch = fetch,
): MortgageDataSource {
  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(`${PLAID_SANDBOX_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: credentials.clientId, secret: credentials.secret, ...body }),
    });
    const json = (await response.json()) as T & { error_code?: string };
    // Plaid errors carry an error_code; the message never includes our secret.
    if (!response.ok) throw new Error(`Plaid ${path}: ${json.error_code ?? `HTTP ${response.status}`}`);
    return json;
  }

  return {
    async readMortgages() {
      const { public_token } = await post<{ public_token: string }>("/sandbox/public_token/create", {
        institution_id: SANDBOX_INSTITUTION_ID,
        initial_products: ["liabilities"],
      });
      const { access_token } = await post<{ access_token: string }>("/item/public_token/exchange", { public_token });
      return toMortgageSummaries(await post<LiabilitiesResponse>("/liabilities/get", { access_token }));
    },
  };
}
