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
  parseInitializeMetadataPointerInstruction,
  parseUpdateTokenMetadataFieldInstruction,
  parseUpdateTokenMetadataUpdateAuthorityInstruction,
  Token2022Instruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { describe, expect, it } from "vitest";
import { heiTokenInfo, watchTokenInfo } from "./devnet";
import { createMintInstructions, HEI_SHARE_MINT, transactionLogs, WATCH_TOKEN_MINT } from "./solana";

// Real hashes are 64 hex characters; these have the same length.
const hashes = { passportHash: "a".repeat(64), recommendationHash: "b".repeat(64) };
const cases = [
  { label: "HEI shares", info: heiTokenInfo({ assetId: "home-1", tokenSupply: 234_131, ...hashes }), options: HEI_SHARE_MINT },
  { label: "watch token", info: watchTokenInfo({ assetId: "watch-1", ...hashes }), options: WATCH_TOKEN_MINT },
];

type ParsableInstruction = Instruction & { data: Uint8Array; accounts: Parameters<typeof parseUpdateTokenMetadataFieldInstruction>[0]["accounts"] };

/** The Token-2022 instructions, each with its kind. */
function token2022(instructions: Instruction[]) {
  return instructions
    .filter((ix) => ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS)
    .map((ix) => ({ ix: ix as ParsableInstruction, kind: identifyToken2022Instruction(ix as ParsableInstruction) }));
}

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
      const written = token2022(instructions)
        .filter(({ kind }) => kind === Token2022Instruction.UpdateTokenMetadataField)
        .map(({ ix }) => parseUpdateTokenMetadataFieldInstruction(ix).data)
        .map(({ field, value }) => [field.__kind === "Key" ? field.fields[0] : field.__kind, value]);
      expect(written).toEqual(info.fields);
    });

    it(`${label}: nobody can change the metadata afterwards`, async () => {
      const [issuer, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
      const parts = token2022(createMintInstructions(issuer, mint, info, { ...options, rent: lamports(BigInt(0)) }));
      // The last step gives up the update authority, after every field is written.
      const last = parts.at(-1)!;
      expect(last.kind).toBe(Token2022Instruction.UpdateTokenMetadataUpdateAuthority);
      expect(parseUpdateTokenMetadataUpdateAuthorityInstruction(last.ix).data.newUpdateAuthority).toEqual({ __option: "None" });
      // And the pointer to the metadata has no authority either.
      const pointer = parts.find(({ kind }) => kind === Token2022Instruction.InitializeMetadataPointer)!;
      expect(parseInitializeMetadataPointerInstruction(pointer.ix).data.authority).toEqual({ __option: "None" });
    });

    it(`${label}: the issuer is the permanent delegate only for HEI shares`, async () => {
      const [issuer, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
      const kinds = token2022(createMintInstructions(issuer, mint, info, { ...options, rent: lamports(BigInt(0)) })).map(({ kind }) => kind);
      expect(kinds.includes(Token2022Instruction.InitializePermanentDelegate)).toBe(options.permanentDelegate);
    });

    it(`${label}: fits in one transaction`, async () => {
      const [issuer, mint] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
      const message = messageFor(issuer, createMintInstructions(issuer, mint, info, { ...options, rent: lamports(BigInt(0)) }));
      expect(getTransactionMessageSize(message)).toBeLessThanOrEqual(getTransactionMessageSizeLimit(message));
    });
  }
});

describe("transactionLogs", () => {
  it("finds the program logs inside a rejected transaction's error", () => {
    const inner = Object.assign(new Error("Custom program error: #17"), { context: { code: 17 } });
    const outer = Object.assign(new Error("Transaction simulation failed"), {
      context: { logs: ["Program log: Error: Account is frozen", "Program Tokenz... failed: custom program error: 0x11"] },
      cause: inner,
    });
    expect(transactionLogs(outer)).toContain("Program log: Error: Account is frozen");
    expect(transactionLogs(new Error("network down"))).toEqual([]);
  });
});
