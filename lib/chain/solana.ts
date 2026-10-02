// Solana devnet through the official clients (@solana/kit, @solana-program/system,
// @solana-program/token-2022, @solana-program/memo). Transactions are confirmed by
// polling over HTTP, because the docs we checked give no public devnet WebSocket URL.
// Docs: https://solana.com/docs/references/clusters , https://github.com/anza-xyz/kit

import {
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  devnet,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  none,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  some,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Lamports,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getCreateAccountInstruction, getTransferSolInstruction } from "@solana-program/system";
import {
  AccountState,
  AuthorityType,
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  getPostInitializeInstructionsForMintExtensions,
  getPreInitializeInstructionsForMintExtensions,
  getSetAuthorityInstruction,
  getThawAccountInstruction,
  getUpdateTokenMetadataFieldInstruction,
  getUpdateTokenMetadataUpdateAuthorityInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
  tokenMetadataField,
} from "@solana-program/token-2022";

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";

export const explorerTxUrl = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
export const explorerAddressUrl = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;

export function createDevnetRpc(url: string = DEVNET_RPC_URL) {
  return createSolanaRpc(devnet(url));
}
export type DevnetRpc = ReturnType<typeof createDevnetRpc>;

const POLL_MS = 1500;

async function waitForConfirmation(rpc: DevnetRpc, signature: Signature, timeoutMs = 90_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Transaction ${signature} was not confirmed within ${timeoutMs / 1000} seconds`);
}

/** Builds, signs, sends and confirms one transaction. Returns its signature (the tx id). */
export async function sendInstructions(rpc: DevnetRpc, feePayer: TransactionSigner, instructions: Instruction[]): Promise<Signature> {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" }).send();
  await waitForConfirmation(rpc, signature);
  return signature;
}

/** The program logs of a rejected transaction (from the RPC's simulation), to tell why it failed. */
export function transactionLogs(error: unknown): string[] {
  const logs: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const context = (current as { context?: { logs?: unknown } }).context;
    if (Array.isArray(context?.logs)) logs.push(...context.logs.map(String));
    current = (current as { cause?: unknown }).cause;
  }
  return logs;
}

export async function getSolBalance(rpc: DevnetRpc, owner: Address): Promise<number> {
  const { value } = await rpc.getBalance(owner).send();
  return Number(value) / 1e9;
}

/** Free devnet SOL for fees (devnet faucet; it may refuse when busy). */
export async function requestDevnetSol(rpc: DevnetRpc, to: Address, sol: number): Promise<Signature> {
  const signature = await rpc.requestAirdrop(to, lamports(BigInt(Math.round(sol * 1e9)))).send();
  await waitForConfirmation(rpc, signature);
  return signature;
}

/** Moves devnet SOL from the issuer to another demo wallet, so it can pay its own fees. */
export async function sendDevnetSol(rpc: DevnetRpc, from: KeyPairSigner, to: Address, sol: number): Promise<Signature> {
  return sendInstructions(rpc, from, [
    getTransferSolInstruction({ source: from, destination: to, amount: lamports(BigInt(Math.round(sol * 1e9))) }),
  ]);
}

/** The receipt as a memo: hashes, versions and the chosen path only. No personal data. */
export function receiptMemo(receipt: {
  recommendationHash: string;
  passportHash: string;
  registryVersion: string;
  selectedOptionId: string;
}): string {
  return (
    `rwa-liquidity-agent receipt v1 rec=${receipt.recommendationHash} passports=${receipt.passportHash} ` +
    `registry=${receipt.registryVersion} selected=${receipt.selectedOptionId}`
  );
}

export async function recordReceiptMemo(rpc: DevnetRpc, signer: KeyPairSigner, memo: string): Promise<Signature> {
  return sendInstructions(rpc, signer, [getAddMemoInstruction({ memo, signers: [signer] })]);
}

export type TokenInfo = { name: string; symbol: string; fields: [string, string][] };
export type MintOptions = {
  decimals: number;
  frozenByDefault: boolean; // new token accounts start frozen (KYC allowlist)
  freezeAuthority: boolean; // the issuer can freeze and thaw accounts
  permanentDelegate: boolean; // the issuer can move or burn tokens from any account (HEI settlement)
};

function mintExtensions(issuer: Address, mint: Address, info: TokenInfo, options: MintOptions) {
  const fixed = [
    ...(options.frozenByDefault ? [extension("DefaultAccountState", { state: AccountState.Frozen })] : []),
    ...(options.permanentDelegate ? [extension("PermanentDelegate", { delegate: issuer })] : []),
    // No pointer authority: nobody can point the token at other metadata later.
    extension("MetadataPointer", { authority: none(), metadataAddress: some(mint) }),
  ];
  const metadata = extension("TokenMetadata", {
    updateAuthority: some(issuer),
    mint,
    name: info.name,
    symbol: info.symbol,
    uri: "",
    additionalMetadata: new Map(info.fields),
  });
  return { fixed, metadata };
}

/**
 * The instructions that create a Token-2022 mint with on-mint metadata that nobody
 * can change afterwards (the passport and recommendation hashes stay as written).
 * No network calls (the rent is passed in), so tests can check them.
 */
export function createMintInstructions(
  issuer: KeyPairSigner,
  mint: KeyPairSigner,
  info: TokenInfo,
  options: MintOptions & { rent: Lamports },
): Instruction[] {
  const { fixed, metadata } = mintExtensions(issuer.address, mint.address, info, options);
  return [
    // Space for the fixed extensions only: the metadata instructions grow the account themselves.
    getCreateAccountInstruction({
      payer: issuer,
      newAccount: mint,
      lamports: options.rent,
      space: getMintSize(fixed),
      programAddress: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    ...getPreInitializeInstructionsForMintExtensions(mint.address, fixed),
    getInitializeMint2Instruction({
      mint: mint.address,
      decimals: options.decimals,
      mintAuthority: issuer.address,
      freezeAuthority: options.freezeAuthority ? issuer.address : null,
    }),
    ...getPostInitializeInstructionsForMintExtensions(mint.address, issuer, [metadata]),
    // The helper above writes only name, symbol and uri, so each extra field
    // (passport hash, recommendation hash, ...) needs its own instruction.
    ...info.fields.map(([key, value]) =>
      getUpdateTokenMetadataFieldInstruction({ metadata: mint.address, updateAuthority: issuer, field: tokenMetadataField("Key", [key]), value }),
    ),
    // Then give up the right to edit the metadata.
    getUpdateTokenMetadataUpdateAuthorityInstruction({ metadata: mint.address, updateAuthority: issuer, newUpdateAuthority: none() }),
  ];
}

export async function createMint(rpc: DevnetRpc, issuer: KeyPairSigner, mint: KeyPairSigner, info: TokenInfo, options: MintOptions) {
  const { fixed, metadata } = mintExtensions(issuer.address, mint.address, info, options);
  // Rent for the full size, extra fields included, since the metadata grows the account.
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(getMintSize([...fixed, metadata]))).send();
  const signature = await sendInstructions(rpc, issuer, createMintInstructions(issuer, mint, info, { ...options, rent }));
  return { mint: mint.address, signature };
}

/**
 * A failure after the mint address exists. A confirmation timeout does not prove the
 * transaction failed, so name the mint: retrying blindly could issue a second token.
 */
function failedAfterMint(mint: Address, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message}. Token ${mint} may already exist (${explorerAddressUrl(mint)}); check it before trying again`);
}

export async function tokenAccount(owner: Address, mint: Address): Promise<Address> {
  const [account] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return account;
}

/**
 * HEI shares: whole tokens; accounts frozen until KYC; the issuer (the simulated partner)
 * pays holders and burns their tokens at settlement, so it is the permanent delegate.
 */
export const HEI_SHARE_MINT: MintOptions = { decimals: 0, frozenByDefault: true, freezeAuthority: true, permanentDelegate: true };
/** The watch's 1-of-1 token belongs to its holder: no freezing, no delegate. */
export const WATCH_TOKEN_MINT: MintOptions = { decimals: 0, frozenByDefault: false, freezeAuthority: false, permanentDelegate: false };

/**
 * HEI shares: whole tokens (decimals 0), every new account frozen by default so
 * only allow-listed (KYC) wallets can hold them. The issuer's treasury is thawed
 * and receives the full supply for the primary sale; then minting is closed.
 */
export async function createHeiShareMint(rpc: DevnetRpc, issuer: KeyPairSigner, tokenSupply: number, info: TokenInfo) {
  const mint = await generateKeyPairSigner();
  try {
    const created = await createMint(rpc, issuer, mint, info, HEI_SHARE_MINT);
    const treasury = await tokenAccount(issuer.address, created.mint);
    const minted = await sendInstructions(rpc, issuer, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner: issuer.address, mint: created.mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
      getThawAccountInstruction({ account: treasury, mint: created.mint, owner: issuer }),
      getMintToInstruction({ mint: created.mint, token: treasury, mintAuthority: issuer, amount: BigInt(tokenSupply) }),
      // The supply is the term sheet's N for good: no more shares can ever be minted.
      getSetAuthorityInstruction({ owned: created.mint, owner: issuer, authorityType: AuthorityType.MintTokens, newAuthority: none() }),
    ]);
    return { mint: created.mint, treasury, signatures: [created.signature, minted] };
  } catch (error) {
    throw failedAfterMint(mint.address, error);
  }
}

/** KYC allowlist: open the investor's (frozen) token account. Without this it stays frozen. */
export async function allowlistInvestor(rpc: DevnetRpc, issuer: KeyPairSigner, mint: Address, investor: Address) {
  const account = await tokenAccount(investor, mint);
  const signature = await sendInstructions(rpc, issuer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner: investor, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
    getThawAccountInstruction({ account, mint, owner: issuer }),
  ]);
  return { account, signature };
}

/** Opens a token account without thawing it: for a wallet that has not passed KYC. */
export async function openFrozenAccount(rpc: DevnetRpc, issuer: KeyPairSigner, mint: Address, wallet: Address) {
  const account = await tokenAccount(wallet, mint);
  const signature = await sendInstructions(rpc, issuer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner: wallet, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
  ]);
  return { account, signature };
}

/** The watch's 1-of-1 token: supply 1, no decimals, minting closed for good after the one token. */
export async function createWatchToken(rpc: DevnetRpc, issuer: KeyPairSigner, owner: Address, info: TokenInfo) {
  const mint = await generateKeyPairSigner();
  try {
    const created = await createMint(rpc, issuer, mint, info, WATCH_TOKEN_MINT);
    const account = await tokenAccount(owner, created.mint);
    const minted = await sendInstructions(rpc, issuer, [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner, mint: created.mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
      getMintToInstruction({ mint: created.mint, token: account, mintAuthority: issuer, amount: BigInt(1) }),
      getSetAuthorityInstruction({ owned: created.mint, owner: issuer, authorityType: AuthorityType.MintTokens, newAuthority: none() }),
    ]);
    return { mint: created.mint, account, signatures: [created.signature, minted] };
  } catch (error) {
    throw failedAfterMint(mint.address, error);
  }
}

export type TokenAccountState = { owner: Address; state: string; amount: string };

/** Reads a token account's owner, state ("frozen" or "initialized") and balance. null when it does not exist. */
export async function readTokenAccount(rpc: DevnetRpc, account: Address): Promise<TokenAccountState | null> {
  const { value } = await rpc.getAccountInfo(account, { encoding: "jsonParsed" }).send();
  type Parsed = { parsed?: { info?: { owner?: Address; state?: string; tokenAmount?: { amount?: string } } } };
  const parsed = (value?.data as Parsed | undefined)?.parsed?.info;
  if (!parsed?.owner) return null;
  return { owner: parsed.owner, state: parsed.state ?? "unknown", amount: parsed.tokenAmount?.amount ?? "0" };
}

/** The mint's current supply in base units. */
export async function readSupply(rpc: DevnetRpc, mint: Address): Promise<bigint> {
  const { value } = await rpc.getTokenSupply(mint).send();
  return BigInt(value.amount);
}
