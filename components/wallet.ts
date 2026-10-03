"use client";

// The user's own wallet in the browser (Phantom, or any Wallet Standard wallet that
// supports Solana devnet), through @solana/kit-plugin-wallet. The server builds every
// transaction; here the wallet only signs it (or signs and sends it, if that is all it
// can do), and the server checks the result on-chain.
// Docs: https://www.npmjs.com/package/@solana/kit-plugin-wallet , https://solana.com/docs/frontend

import {
  createClient,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  isTransactionModifyingSigner,
  isTransactionSendingSigner,
} from "@solana/kit";
import { walletWithoutSigner } from "@solana/kit-plugin-wallet";

/** One wallet client for the whole tab, so the agent page and the partner page share the connection. */
export const walletClient = createClient().use(walletWithoutSigner({ chain: "solana:devnet" }));

/** What goes back to the server: the signed transaction, or the signature of one the wallet sent itself. */
export type SignedByWallet = { transaction: string } | { signature: string };

export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** The connected wallet's signer, if it is the account tied to the case. Call it before asking the server for anything. */
export function connectedTo(expected: string) {
  const connected = walletClient.wallet.getState().connected;
  if (!connected?.signer) throw new Error("Connect your wallet first: use the wallet button at the top of the case.");
  if (connected.account.address !== expected) {
    throw new Error(`Switch your wallet to ${shortAddress(expected)}: that is the account tied to this case.`);
  }
  return connected.signer;
}

/** Has the wallet sign a transaction the server built (base64). Nothing is sent by the server before this. */
export async function signWithWallet(transactionBase64: string, expected: string): Promise<SignedByWallet> {
  const signer = connectedTo(expected);
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(transactionBase64));
  if (isTransactionModifyingSigner(signer)) {
    const [signed] = await signer.modifyAndSignTransactions([transaction]);
    return { transaction: getBase64EncodedWireTransaction(signed) };
  }
  if (isTransactionSendingSigner(signer)) {
    const [signature] = await signer.signAndSendTransactions([transaction]);
    return { signature: getBase58Decoder().decode(signature) };
  }
  throw new Error("This wallet cannot sign Solana transactions.");
}

/** Signs a text message (it moves no money) and returns the signature as base64. */
export async function signTextWithWallet(message: string): Promise<string> {
  const signature = await walletClient.wallet.signMessage(new TextEncoder().encode(message));
  return getBase64Decoder().decode(signature);
}
