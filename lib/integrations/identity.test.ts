import { describe, expect, it } from "vitest";
import { createPlaidIdentitySandbox, PLAID_SANDBOX_TEST_USER, simulatedIdentity } from "./identity";

/** A stand-in for Plaid's sandbox: records requests and answers in order. */
function fakePlaid(answers: { status: number; body: Record<string, unknown> }[]) {
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    requests.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
    const answer = answers.shift();
    if (!answer) throw new Error("no answer left");
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body };
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

describe("Plaid Identity Verification (sandbox, backend-only flow)", () => {
  const config = { clientId: "client-id", secret: "secret-value", templateId: "idvtmp_test" };

  it("sends Plaid's sandbox test identity and waits until the verification is no longer active", async () => {
    const plaid = fakePlaid([
      { status: 200, body: { id: "idv_123", status: "active" } },
      { status: 200, body: { id: "idv_123", status: "success" } },
    ]);
    const verifier = createPlaidIdentitySandbox(config, { fetchImpl: plaid.fetchImpl, pollMs: 0 });
    await expect(verifier.verify("WalletAddress111")).resolves.toEqual({ id: "idv_123" });
    expect(plaid.requests.map((request) => request.path)).toEqual(["/identity_verification/create", "/identity_verification/get"]);
    expect(plaid.requests[0].body).toMatchObject({
      client_user_id: "ownflow-WalletAddress111",
      template_id: "idvtmp_test",
      is_shareable: false,
      gave_consent: true,
      user: PLAID_SANDBOX_TEST_USER,
    });
    expect(plaid.requests[1].body).toMatchObject({ identity_verification_id: "idv_123" });
  });

  it("writes no attestation when the verification fails, and keeps the secret out of errors", async () => {
    const failed = fakePlaid([{ status: 200, body: { id: "idv_9", status: "failed" } }]);
    await expect(createPlaidIdentitySandbox(config, { fetchImpl: failed.fetchImpl }).verify("w")).rejects.toThrow(/ended as "failed", so no KYC attestation/);
    const refused = fakePlaid([{ status: 400, body: { error_code: "INVALID_FIELD" } }]);
    const error = await createPlaidIdentitySandbox(config, { fetchImpl: refused.fetchImpl }).verify("w").catch((problem: Error) => problem);
    expect(String(error)).toContain("INVALID_FIELD");
    expect(String(error)).not.toContain("secret-value");
  });
});

describe("the simulated identity check", () => {
  it("is named as simulated in the attestation", async () => {
    expect(simulatedIdentity.provider).toBe("simulated");
    await expect(simulatedIdentity.verify("w")).resolves.toEqual({ id: "simulated-w" });
  });
});
