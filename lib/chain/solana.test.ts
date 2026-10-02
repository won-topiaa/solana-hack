import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  identifyToken2022Instruction,
  parseUpdateTokenMetadataFieldInstruction,
  Token2022Instruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { describe, expect, it } from "vitest";
import { heiTokenInfo, watchTokenInfo } from "./devnet";
import { createMintInstructions } from "./solana";

// Real hashes are 64 hex characters; these have the same length.
const hashes = { passportHash: "a".repeat(64), recommendationHash: "b".repeat(64) };
const cases = [
  { label: "HEI shares", info: heiTokenInfo({ assetId: "home-1", tokenSupply: 234_131, ...hashes }), options: { frozenByDefault: true, freezeAuthority: true } },
  { label: "watch token", info: watchTokenInfo({ assetId: "watch-1", ...hashes }), options: { frozenByDefault: false, freezeAuthority: false } },
];

function messageFor(feePayer: KeyPairSigner, instructions: Instruction[]) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    // Any well-formed blockhash: the size does not depend on its value.
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: BigInt(0) }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

describe("createMintInstructions (offline)", () => {
  for (const { label, info, options } of cases) {
    it(`${label}: writes every metadata field, so the hashes end up on the token`, async () => {
      const [issuer, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
      const instructions = createMintInstructions(issuer, mint, info, { ...options, rent: lamports(BigInt(0)) });
      const written = instructions
        .filter((ix) => ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS)
        .filter((ix) => identifyToken2022Instruction(ix as Instruction & { data: Uint8Array }) === Token2022Instruction.UpdateTokenMetadataField)
        .map((ix) => parseUpdateTokenMetadataFieldInstruction(ix as Parameters<typeof parseUpdateTokenMetadataFieldInstruction>[0]).data)
        .map(({ field, value }) => [field.__kind === "Key" ? field.fields[0] : field.__kind, value]);
      expect(written).toEqual(info.fields);
    });

    it(`${label}: fits in one transaction`, async () => {
      const [issuer, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
      const message = messageFor(issuer, createMintInstructions(issuer, mint, info, { ...options, rent: lamports(BigInt(0)) }));
      expect(getTransactionMessageSize(message)).toBeLessThanOrEqual(getTransactionMessageSizeLimit(message));
    });
  }
});
