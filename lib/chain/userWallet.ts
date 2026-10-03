// Transactions the user's own wallet (for example Phantom) signs. The server builds
// them, the browser asks the wallet to sign, and the server sends the signed
// transaction (or the wallet sends it itself). Then the server reads the confirmed
// transaction back from the chain and checks that it did what was asked: a wallet may
// add instructions of its own (priority fees, guard checks), so the bytes it signs
// can differ from the ones we built, but the effect we need must be there.
// The connected wallet is tied to the case by a signed message (wallet proof).

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getPublicKeyFromAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getUtf8Encoder,
  isAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signature as toSignature,
  signatureBytes,
  verifySignature,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import { confirmSignature, sendWireTransaction, type DevnetRpc } from "./solana";

/** A transaction for the wallet to sign: base64 wire format, no signatures yet. */
export type UnsignedForWallet = { transaction: string; lastValidBlockHeight: string };

/** What comes back from the browser: the signed transaction, or the signature of one the wallet sent itself. */
export type SignedByWallet = { transaction: string } | { signature: string };

/** A signer that only stands in for the wallet's address while the server builds a transaction. */
export function walletStandIn(wallet: Address): TransactionSigner {
  return createNoopSigner(wallet);
}

/** Builds a transaction that the wallet pays for and signs. */
export async function buildForWallet(rpc: DevnetRpc, wallet: Address, instructions: Instruction[]): Promise<UnsignedForWallet> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(wallet, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return { transaction: getBase64EncodedWireTransaction(compileTransaction(message)), lastValidBlockHeight: String(blockhash.lastValidBlockHeight) };
}

/** Accepts the browser's answer only in one of the two shapes, with the right encodings. */
export function parseSignedByWallet(value: unknown): SignedByWallet {
  const input = value as { transaction?: unknown; signature?: unknown } | null;
  if (typeof input?.transaction === "string" && input.transaction.length > 0 && input.transaction.length < 4_000) {
    return { transaction: input.transaction };
  }
  if (typeof input?.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(input.signature)) return { signature: input.signature };
  throw new Error("The wallet's answer must be a signed transaction or a transaction signature");
}

/**
 * Puts the wallet's transaction on the chain and waits for it: sends a signed
 * transaction, or waits for one the wallet sent. The fee payer must be the wallet.
 */
export async function landWalletTransaction(rpc: DevnetRpc, signed: SignedByWallet, wallet: Address, lastValidBlockHeight?: bigint): Promise<Signature> {
  if ("signature" in signed) {
    const sent = toSignature(signed.signature);
    await confirmSignature(rpc, sent);
    return sent;
  }
  const bytes = getBase64Encoder().encode(signed.transaction);
  const transaction = getTransactionDecoder().decode(bytes);
  const [feePayer] = Object.keys(transaction.signatures);
  if (feePayer !== wallet) throw new Error("The signed transaction is not paid by the connected wallet");
  return sendWireTransaction(rpc, signed.transaction as Base64EncodedWireTransaction, getSignatureFromTransaction(transaction), lastValidBlockHeight);
}

/** The parts of a confirmed transaction we check (from getTransaction, jsonParsed). */
type ParsedTransaction = {
  signers: string[];
  memos: string[];
  /** Change of each token account's balance, with its mint and owner, in base units. */
  tokenChanges: { account: string; mint: string; owner: string; change: bigint }[];
};

export async function readParsedTransaction(rpc: DevnetRpc, signature: Signature): Promise<ParsedTransaction> {
  const transaction = await rpc.getTransaction(signature, { commitment: "confirmed", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }).send();
  if (!transaction?.meta) throw new Error(`Transaction ${signature} could not be read back`);
  if (transaction.meta.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(transaction.meta.err)}`);
  const message = transaction.transaction.message;
  const signers = message.accountKeys.filter((key) => key.signer).map((key) => key.pubkey as string);
  type ParsedInstruction = { program?: string; parsed?: unknown };
  const memos = (message.instructions as readonly ParsedInstruction[])
    .filter((instruction) => instruction.program === "spl-memo" && typeof instruction.parsed === "string")
    .map((instruction) => instruction.parsed as string);
  const before = new Map((transaction.meta.preTokenBalances ?? []).map((item) => [item.accountIndex, BigInt(item.uiTokenAmount.amount)]));
  const tokenChanges = (transaction.meta.postTokenBalances ?? []).flatMap((item) =>
    item.owner
      ? [
          {
            account: message.accountKeys[item.accountIndex]?.pubkey as string,
            mint: item.mint as string,
            owner: item.owner as string,
            change: BigInt(item.uiTokenAmount.amount) - (before.get(item.accountIndex) ?? BigInt(0)),
          },
        ]
      : [],
  );
  return { signers, memos, tokenChanges };
}

/** The change of one owner's balance of one mint in the transaction (0 when untouched). */
export function changeFor(parsed: ParsedTransaction, mint: string, owner: string): bigint {
  return parsed.tokenChanges.filter((item) => item.mint === mint && item.owner === owner).reduce((sum, item) => sum + item.change, BigInt(0));
}

/** The change of one token account in the transaction (0 when untouched). */
export function changeForAccount(parsed: ParsedTransaction, account: string): bigint {
  return parsed.tokenChanges.filter((item) => item.account === account).reduce((sum, item) => sum + item.change, BigInt(0));
}

// ---- Wallet proof: the user signs a message that names the case and the address. ----

/** The message the wallet signs to show the user controls it. It moves no money. */
export function walletProofMessage(input: { caseId: string; wallet: string; nonce: string; issuedAt: string }): string {
  return [
    "Ownflow: use this wallet for my case on Solana devnet.",
    "This signature moves no money and approves no transaction.",
    `Case: ${input.caseId}`,
    `Wallet: ${input.wallet}`,
    `Nonce: ${input.nonce}`,
    `Issued: ${input.issuedAt}`,
  ].join("\n");
}

export function parseWalletAddress(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error("That is not a Solana address");
  return address(value);
}

/** Checks an Ed25519 signature (base58 or base64) over the message by the wallet's key. */
export async function verifyWalletProof(wallet: Address, message: string, signatureText: string): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(/^[1-9A-HJ-NP-Za-km-z]+$/.test(signatureText) ? getBase58Encoder().encode(signatureText) : getBase64Encoder().encode(signatureText));
  } catch {
    return false;
  }
  if (bytes.length !== 64) return false;
  return verifySignature(await getPublicKeyFromAddress(wallet), signatureBytes(bytes), getUtf8Encoder().encode(message));
}
