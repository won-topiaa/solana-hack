// KYC on-chain with the Solana Attestation Service (SAS). The issuer, acting as a demo
// attestation issuer, writes an attestation for an investor's wallet once the investor
// passed identity verification (Plaid Identity Verification in sandbox, or a simulated
// check, named in the attestation). Before a share account is thawed, the attestation
// is read back from the chain and checked: owned by the SAS program, issued under our
// credential and schema by the issuer, for this wallet, schema not paused, and not
// expired by the chain's own clock. No personal data goes on-chain: only the kind of
// check and a hash of its reference.
// Program 22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG (devnet and mainnet);
// client: sas-lib 2.0.0-beta.1 (MIT), https://github.com/solana-foundation/solana-attestation-service

import { createHash } from "node:crypto";
import { fetchEncodedAccount, type Address, type KeyPairSigner, type Signature } from "@solana/kit";
import { fetchSysvarClock } from "@solana/sysvars";
import {
  decodeAttestation,
  deserializeAttestationData,
  fetchMaybeCredential,
  fetchMaybeSchema,
  findAttestationPda,
  findCredentialPda,
  findSchemaPda,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  SchemaDataType,
  serializeAttestationData,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";
import { sendInstructions, type DevnetRpc } from "./solana";

export const KYC_CREDENTIAL_NAME = "ownflow-kyc-demo";
export const KYC_SCHEMA_NAME = "investor-kyc";
const SCHEMA_VERSION = 1; // SAS creates every schema at version 1
/** The first byte of an Attestation account (Credential is 0, Schema is 1). */
const ATTESTATION_DISCRIMINATOR = 2;
/** How long a KYC attestation is valid. */
export const KYC_VALID_DAYS = 365;

/** What the attestation says, with no personal data. */
export type KycAttestationData = {
  provider: string; // e.g. "plaid-identity-verification-sandbox", or "simulated"
  reference: string; // SHA-256 of the verification's id at the provider (cannot be reversed)
  verified_at: bigint; // unix seconds
};

const SCHEMA_FIELDS = {
  layout: [SchemaDataType.String, SchemaDataType.String, SchemaDataType.I64],
  fieldNames: ["provider", "reference", "verified_at"],
};

/** Our credential and schema addresses (program-derived from the issuer and the names). */
export async function kycAddresses(issuer: Address) {
  const [credential] = await findCredentialPda({ authority: issuer, name: KYC_CREDENTIAL_NAME });
  const [schema] = await findSchemaPda({ credential, name: KYC_SCHEMA_NAME, version: SCHEMA_VERSION });
  return { credential, schema };
}

export async function kycAttestationAddress(issuer: Address, wallet: Address): Promise<Address> {
  const { credential, schema } = await kycAddresses(issuer);
  const [attestation] = await findAttestationPda({ credential, schema, nonce: wallet });
  return attestation;
}

/** Creates the credential (the issuer as its only signer) and the schema, if they do not exist yet. */
export async function ensureKycSchema(rpc: DevnetRpc, issuer: KeyPairSigner): Promise<Signature[]> {
  const { credential, schema } = await kycAddresses(issuer.address);
  const sent: Signature[] = [];
  if (!(await fetchMaybeCredential(rpc, credential)).exists) {
    sent.push(
      await sendInstructions(rpc, issuer, [
        getCreateCredentialInstruction({ payer: issuer, credential, authority: issuer, name: KYC_CREDENTIAL_NAME, signers: [issuer.address] }),
      ]),
    );
  }
  if (!(await fetchMaybeSchema(rpc, schema)).exists) {
    sent.push(
      await sendInstructions(rpc, issuer, [
        getCreateSchemaInstruction({
          payer: issuer,
          authority: issuer,
          credential,
          schema,
          name: KYC_SCHEMA_NAME,
          description: "Ownflow demo: this wallet's owner passed identity verification. No personal data.",
          ...SCHEMA_FIELDS,
        }),
      ]),
    );
  }
  return sent;
}

/** A provider's verification id as a hash: it names the check without revealing it. */
export function kycReference(verificationId: string): string {
  return createHash("sha256").update(verificationId).digest("hex");
}

/** The check's answer when the wallet has no attestation at all (as opposed to an invalid one). */
export const NO_KYC_ATTESTATION = "no KYC attestation on-chain";

export type KycCheck = { ok: true; attestation: Address; data: KycAttestationData; expiry: bigint } | { ok: false; attestation: Address; reason: string };

/** Reads the wallet's attestation from the chain and checks everything that makes it ours and valid. */
export async function checkKycAttestation(rpc: DevnetRpc, issuer: Address, wallet: Address): Promise<KycCheck> {
  const { credential, schema } = await kycAddresses(issuer);
  const attestation = await kycAttestationAddress(issuer, wallet);
  const account = await fetchEncodedAccount(rpc, attestation, { commitment: "confirmed" });
  if (!account.exists) return { ok: false, attestation, reason: NO_KYC_ATTESTATION };
  if (account.programAddress !== SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS || account.data[0] !== ATTESTATION_DISCRIMINATOR) {
    return { ok: false, attestation, reason: "the account is not a Solana Attestation Service attestation" };
  }
  const decoded = decodeAttestation(account).data;
  if (decoded.credential !== credential || decoded.schema !== schema || decoded.nonce !== wallet || decoded.signer !== issuer) {
    return { ok: false, attestation, reason: "the attestation was not issued by this issuer for this wallet" };
  }
  const schemaAccount = await fetchMaybeSchema(rpc, schema, { commitment: "confirmed" });
  if (!schemaAccount.exists || schemaAccount.data.isPaused) return { ok: false, attestation, reason: "the KYC schema is paused" };
  const clock = await fetchSysvarClock(rpc);
  if (decoded.expiry !== BigInt(0) && decoded.expiry <= BigInt(clock.unixTimestamp)) return { ok: false, attestation, reason: "the KYC attestation has expired" };
  const data = deserializeAttestationData<KycAttestationData>(schemaAccount.data, new Uint8Array(decoded.data));
  return { ok: true, attestation, data, expiry: decoded.expiry };
}

/** Closes the wallet's attestation (its rent goes back to the issuer), so a new check can replace it. */
export async function revokeKyc(rpc: DevnetRpc, issuer: KeyPairSigner, wallet: Address): Promise<Signature> {
  const { credential } = await kycAddresses(issuer.address);
  const attestation = await kycAttestationAddress(issuer.address, wallet);
  return sendInstructions(rpc, issuer, [getCloseAttestationInstruction({ payer: issuer, authority: issuer, credential, attestation })]);
}

/** Writes the wallet's KYC attestation (valid KYC_VALID_DAYS by the chain's clock). */
export async function attestKyc(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  wallet: Address,
  input: { provider: string; reference: string },
): Promise<Signature> {
  await ensureKycSchema(rpc, issuer);
  const { credential, schema } = await kycAddresses(issuer.address);
  const schemaAccount = await fetchMaybeSchema(rpc, schema, { commitment: "confirmed" });
  if (!schemaAccount.exists) throw new Error("The KYC schema could not be read back");
  const now = BigInt((await fetchSysvarClock(rpc)).unixTimestamp);
  const data = serializeAttestationData(schemaAccount.data, { provider: input.provider, reference: input.reference, verified_at: now });
  return sendInstructions(rpc, issuer, [
    getCreateAttestationInstruction({
      payer: issuer,
      authority: issuer,
      credential,
      schema,
      attestation: await kycAttestationAddress(issuer.address, wallet),
      nonce: wallet,
      data,
      expiry: now + BigInt(KYC_VALID_DAYS * 86_400),
    }),
  ]);
}
