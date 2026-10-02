// Identity verification for HEI investors (KYC), before the issuer writes their
// on-chain KYC attestation (lib/chain/kyc.ts). Two kinds:
// - Plaid Identity Verification, sandbox, in Plaid's backend-only flow: the server
//   sends Plaid's published sandbox test identity (a made-up person, "Leslie Knope")
//   and reads the result. Needs PLAID_CLIENT_ID, PLAID_SECRET and PLAID_IDV_TEMPLATE_ID
//   (a template with only the data source check, no SMS step).
//   Docs: https://plaid.com/docs/identity-verification/ ,
//         https://plaid.com/docs/api/products/identity-verification/ ,
//         https://plaid.com/docs/identity-verification/testing/
// - Simulated: no one is contacted; labeled as such everywhere.
// Nothing personal is kept: the attestation stores only a hash of the verification id.

import { PLAID_SANDBOX_URL } from "./plaid";

export type IdentityResult = { id: string }; // the provider's id for the passed verification

export interface IdentityVerifier {
  provider: string; // written into the attestation
  label: string; // shown to people
  verify(subject: string): Promise<IdentityResult>; // subject: a stable id for the person (here their wallet)
}

export const simulatedIdentity: IdentityVerifier = {
  provider: "simulated",
  label: "Simulated identity check",
  async verify(subject) {
    return { id: `simulated-${subject}` };
  },
};

/** Plaid's sandbox test identity (https://plaid.com/docs/identity-verification/testing/). Made up, not a real person. */
export const PLAID_SANDBOX_TEST_USER = {
  phone_number: "+12345678909",
  date_of_birth: "1975-01-18",
  name: { given_name: "Leslie", family_name: "Knope" },
  address: { street: "123 Main St.", city: "Pawnee", region: "IN", postal_code: "46001", country: "US" },
  id_number: { value: "123456789", type: "us_ssn" },
};

/** IDV statuses (Plaid docs): active means still running. */
type IdvStatus = "active" | "success" | "failed" | "expired" | "canceled" | "pending_review";

export function createPlaidIdentitySandbox(
  config: { clientId: string; secret: string; templateId: string },
  options: { fetchImpl?: typeof fetch; pollMs?: number; maxPolls?: number } = {},
): IdentityVerifier {
  const { fetchImpl = fetch, pollMs = 2000, maxPolls = 15 } = options;
  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetchImpl(`${PLAID_SANDBOX_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: config.clientId, secret: config.secret, ...body }),
    });
    const json = (await response.json()) as T & { error_code?: string };
    // Plaid errors carry an error_code; the message never includes our secret.
    if (!response.ok) throw new Error(`Plaid ${path}: ${json.error_code ?? `HTTP ${response.status}`}`);
    return json;
  }

  return {
    provider: "plaid-identity-verification-sandbox",
    label: "Plaid Identity Verification (sandbox test identity)",
    async verify(subject) {
      // is_idempotent: the same person (client_user_id) gets the same verification back.
      let session = await post<{ id: string; status: IdvStatus }>("/identity_verification/create", {
        client_user_id: `ownflow-${subject}`,
        template_id: config.templateId,
        is_shareable: false,
        gave_consent: true,
        is_idempotent: true,
        user: PLAID_SANDBOX_TEST_USER,
      });
      for (let poll = 0; session.status === "active" && poll < maxPolls; poll += 1) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        session = await post<{ id: string; status: IdvStatus }>("/identity_verification/get", { identity_verification_id: session.id });
      }
      if (session.status !== "success") throw new Error(`Plaid identity verification ended as "${session.status}", so no KYC attestation was written`);
      return { id: session.id };
    },
  };
}
