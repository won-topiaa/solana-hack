import { generateKeyPairSigner, getBase64Decoder, signBytes } from "@solana/kit";
import { describe, expect, it } from "vitest";
import type { LlmReply } from "../agent/llm";
import { createScriptedLlm } from "../agent/scripted";
import { createAgentTools } from "../agent/tools";
import { createFakeChain, type FakeChain } from "../chain/fake";
import { createDemoPropertySource } from "../integrations/rentcast";
import { testRegistry } from "../params/test-fixtures";
import { openCase, sealCase } from "./caseToken";
import { BadRequest, postApproval, postMessage, prepareApprovalSignature, prepareHeiSettlement, startCase, walletChallenge, walletConnect, walletDisconnect, type WebDeps } from "./handlers";

// The user's own wallet (Phantom in the browser), with a generated keypair standing in for it.
const secret = "web-test-secret-that-is-long-enough-12345";
const now = () => new Date("2026-10-01T15:00:00Z");
const say = (text: string): LlmReply => ({ text, toolCalls: [] });
const callTool = (name: string): LlmReply => ({ text: "", toolCalls: [{ name, args: {}, providerCallId: `call-${name}` }] });

function depsWith(replies: LlmReply[], chain: FakeChain = createFakeChain()): WebDeps {
  const tools = createAgentTools({ registry: testRegistry(), propertySource: createDemoPropertySource(() => "2026-10-01"), chain });
  return { agent: { llm: createScriptedLlm(replies), tools, now }, registry: testRegistry(), secret, now, chain };
}

/** What the browser does: the wallet signs the message's UTF-8 bytes; the signature goes back as base64. */
async function walletSignsText(wallet: CryptoKeyPair, message: string): Promise<string> {
  return getBase64Decoder().decode(await signBytes(wallet.privateKey, new TextEncoder().encode(message)));
}

async function connected(deps: WebDeps, token: string) {
  const wallet = await generateKeyPairSigner();
  const challenge = walletChallenge(deps, { token, address: wallet.address });
  const reply = await walletConnect(deps, { token: challenge.token, signature: await walletSignsText(wallet.keyPair, challenge.message) });
  return { wallet, reply };
}

describe("connecting the user's own wallet", () => {
  it("ties the wallet to the case after it signs a message naming the case and the address", async () => {
    const deps = depsWith([]);
    const started = startCase(deps, { persona: "B" });
    const wallet = await generateKeyPairSigner();
    const challenge = walletChallenge(deps, { token: started.token, address: wallet.address });
    expect(challenge.message).toContain(`Wallet: ${wallet.address}`);
    expect(challenge.message).toContain(`Case: ${openCase(started.token, secret).id}`);
    expect(challenge.message).toContain("moves no money");
    const reply = await walletConnect(deps, { token: challenge.token, signature: await walletSignsText(wallet.keyPair, challenge.message) });
    expect(reply.view.wallet).toEqual({ address: wallet.address, locked: false });
    expect(openCase(reply.token, secret).walletChallenge).toBeUndefined();

    const back = walletDisconnect(deps, { token: reply.token });
    expect(back.view.wallet).toBeNull();
  });

  it("refuses a signature by another key, a bad address, or a stale message", async () => {
    const deps = depsWith([]);
    const started = startCase(deps, { persona: "B" });
    const [wallet, impostor] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const challenge = walletChallenge(deps, { token: started.token, address: wallet.address });
    await expect(walletConnect(deps, { token: challenge.token, signature: await walletSignsText(impostor.keyPair, challenge.message) })).rejects.toThrow(/does not match/);
    expect(() => walletChallenge(deps, { token: started.token, address: "not-an-address" })).toThrow(BadRequest);
    const later = { ...deps, now: () => new Date("2026-10-01T15:11:00Z") };
    await expect(walletConnect(later, { token: challenge.token, signature: await walletSignsText(wallet.keyPair, challenge.message) })).rejects.toThrow(/expired/);
  });

  it("cannot change once the case has on-chain records", async () => {
    const deps = depsWith([]);
    const base = openCase(startCase(deps, { persona: "B" }).token, secret);
    const recorded = sealCase(
      {
        ...base,
        handoff: {
          passports: [],
          receipt: { recommendedOptionId: "re-hei", selectedOptionId: "re-hei", recommendationHash: "a".repeat(64), passportHash: "b".repeat(64), registryVersion: "test", createdAt: "" },
          onchain: { receipt: { network: "devnet", signatures: ["sig"], explorerUrls: ["u"], at: "" } },
        },
      },
      secret,
    );
    const wallet = await generateKeyPairSigner();
    expect(() => walletChallenge(deps, { token: recorded, address: wallet.address })).toThrow(/cannot change/);
  });
});

describe("a receipt signed in the user's own wallet", () => {
  it("asks the wallet to sign, then records the signed receipt", async () => {
    const chain = createFakeChain();
    const deps = depsWith([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok"), callTool("record_receipt_onchain"), say("Recorded.")], chain);
    const started = startCase(deps, { persona: "B" });
    const { wallet, reply } = await connected(deps, started.token);
    let current = await postMessage(deps, { token: reply.token, text: "Compare." });
    current = await postMessage(deps, { token: current.token, text: "Prepare." });
    current = await postMessage(deps, { token: current.token, text: "Record the receipt." });
    expect(current.view.approval).toMatchObject({ needsWallet: true });
    expect(current.view.approval?.summary).toContain("signed in your own wallet");

    const approvalId = current.view.approval!.id;
    // Approving without the wallet's signature is refused, before anything runs.
    await expect(postApproval(deps, { token: current.token, approvalId, approved: true })).rejects.toThrow(/Sign this step in your wallet/);
    const unsigned = await prepareApprovalSignature(deps, { token: current.token, approvalId });
    expect(unsigned.transaction).toBeTruthy();
    expect(chain.calls.at(-1)).toMatchObject({ method: "prepareWalletReceipt", input: { wallet: wallet.address } });

    const done = await postApproval(deps, { token: current.token, approvalId, approved: true, signed: { transaction: "c2lnbmVkLWJ5LXRoZS13YWxsZXQ=" } });
    expect(chain.calls.at(-1)).toMatchObject({ method: "recordWalletReceipt", input: { wallet: wallet.address, signed: { transaction: "c2lnbmVkLWJ5LXRoZS13YWxsZXQ=" } } });
    expect(done.view.onchain[0]).toMatchObject({ label: "Recommendation receipt (memo)", detail: "Signed by your wallet" });
    expect(done.view.wallet?.locked).toBe(true);
  });

  it("refuses a malformed wallet answer", async () => {
    const deps = depsWith([callTool("compare_paths"), say("ok"), callTool("prepare_documents"), say("ok"), callTool("record_receipt_onchain")]);
    const { reply } = await connected(deps, startCase(deps, { persona: "B" }).token);
    let current = await postMessage(deps, { token: reply.token, text: "Compare." });
    current = await postMessage(deps, { token: current.token, text: "Prepare." });
    current = await postMessage(deps, { token: current.token, text: "Record." });
    await expect(postApproval(deps, { token: current.token, approvalId: current.view.approval!.id, approved: true, signed: { signature: "0OIl" } })).rejects.toThrow(BadRequest);
  });
});

describe("the settlement payment with the user's own wallet", () => {
  it("is prepared only for a case that has the user's wallet", async () => {
    const deps = depsWith([]);
    const started = startCase(deps, { persona: "B" });
    await expect(prepareHeiSettlement(deps, { token: started.token, scenario: "buyback-2y" })).rejects.toThrow(/demo wallet/);
  });
});
