// Solana devnet through the official clients (@solana/kit, @solana-program/system,
// @solana-program/token-2022, @solana-program/memo). Transactions are confirmed by
// polling over HTTP, because the docs we checked give no public devnet WebSocket URL.
// Docs: https://solana.com/docs/references/clusters , https://github.com/anza-xyz/kit

import { createHash } from "node:crypto";
import {
  appendTransactionMessageInstructions,
  createAddressWithSeed,
  createDefaultRpcTransport,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  devnet,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  type RpcTransport,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  none,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransactionMessageWithSigners,
  some,
  type Address,
  type Base64EncodedWireTransaction,
  type Instruction,
  type KeyPairSigner,
  type Lamports,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getCreateAccountInstruction, getCreateAccountWithSeedInstruction, getTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
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

/** An RPC answer worth retrying: rate limited (HTTP 429), a busy node (5xx), no connection, or no answer in time. */
export function isRetriable(error: unknown): boolean {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    const status = error.context.statusCode;
    return status === 429 || status >= 500;
  }
  if (error instanceof Error && error.name === "TimeoutError") return true; // our per-request time limit
  return error instanceof TypeError; // fetch's network failure
}

export function isRateLimited(error: unknown): boolean {
  return isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) && error.context.statusCode === 429;
}

/**
 * Retries a call that failed for a passing reason, waiting longer each time (0.5 s, 1 s,
 * 2 s, ...). Shared hosting shares its outgoing IP address, and the public devnet RPC
 * limits requests per IP, so a busy minute should slow the demo down, not break it.
 * Each request also gets a time limit, so a stalled connection cannot use up the
 * hosting's whole function time. Every call we make is safe to repeat: reads, and
 * sends of an already signed transaction.
 */
export function withRetries<T extends RpcTransport>(
  transport: T,
  options: { attempts?: number; firstDelayMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): T {
  const { attempts = 6, firstDelayMs = 500, timeoutMs = 20_000, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  const retrying = async (config: Parameters<RpcTransport>[0]) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const limit = AbortSignal.timeout(timeoutMs);
        return await transport({ ...config, signal: config.signal ? AbortSignal.any([config.signal, limit]) : limit });
      } catch (error) {
        if (attempt >= attempts || !isRetriable(error)) throw error;
        await sleep(firstDelayMs * 2 ** (attempt - 1));
      }
    }
  };
  return retrying as T;
}

export function createDevnetRpc(url: string = DEVNET_RPC_URL) {
  return createSolanaRpcFromTransport(withRetries(createDefaultRpcTransport({ url: devnet(url) })));
}
export type DevnetRpc = ReturnType<typeof createDevnetRpc>;

/** What to tell a person when a devnet step fails. */
export function describeChainError(error: unknown): string {
  if (isRateLimited(error)) return "Solana devnet's public RPC is busy and limited this server's requests. Please try again in a minute.";
  return error instanceof Error ? error.message : String(error);
}

/** Every 2 s: the public RPC limits requests per IP, so confirmation checks stay light. */
const POLL_MS = 2000;

/**
 * Waits until the transaction is confirmed. With `lastValidBlockHeight` it also stops as
 * soon as the transaction's blockhash has expired: from then on it can never land, so a
 * retry cannot do the step twice.
 */
async function waitForConfirmation(rpc: DevnetRpc, signature: Signature, lastValidBlockHeight?: bigint, timeoutMs = 90_000): Promise<void> {
  const started = Date.now();
  for (let poll = 1; Date.now() - started < timeoutMs; poll += 1) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
    // Every third poll, so the extra request stays light on the public RPC.
    if (!status && lastValidBlockHeight !== undefined && poll % 3 === 0) {
      const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (height > lastValidBlockHeight) throw new Error(`Transaction ${signature} expired before it landed; nothing was done, so it is safe to try again`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`Transaction ${signature} was not confirmed within ${timeoutMs / 1000} seconds`);
}

function alreadyProcessed(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (isSolanaError(current, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
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
  return sendWireTransaction(rpc, getBase64EncodedWireTransaction(signed), getSignatureFromTransaction(signed), blockhash.lastValidBlockHeight);
}

/** Sends a signed transaction (base64 wire format) and waits until it is confirmed. */
export async function sendWireTransaction(rpc: DevnetRpc, wire: Base64EncodedWireTransaction, signature: Signature, lastValidBlockHeight?: bigint): Promise<Signature> {
  try {
    await rpc.sendTransaction(wire, { encoding: "base64" }).send();
  } catch (error) {
    // A retried send of the same signed transaction can find it already processed: that is success.
    if (!alreadyProcessed(error)) throw error;
  }
  await waitForConfirmation(rpc, signature, lastValidBlockHeight);
  return signature;
}

/** Waits for a transaction someone else sent (a wallet that sends its own transactions). */
export async function confirmSignature(rpc: DevnetRpc, signature: Signature): Promise<void> {
  await waitForConfirmation(rpc, signature);
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

/** Below this the demo pauses on-chain steps instead of failing half-way (a full HEI flow uses about 0.03 SOL). */
export const MIN_ISSUER_SOL = 0.2;

/** Stops before an on-chain step when the paying wallet is too low to finish it. */
export async function requireFunds(rpc: DevnetRpc, payer: Address, minSol: number = MIN_ISSUER_SOL): Promise<void> {
  const balance = await getSolBalance(rpc, payer);
  if (balance < minSol) {
    throw new Error(`The demo's devnet wallet is low on test SOL (${balance.toFixed(3)} SOL); on-chain steps are paused until it is refilled`);
  }
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

/**
 * 32 secret bytes that the issuer can make again at any time: the SHA-256 of its
 * signature over `label` (Ed25519 signatures are deterministic). Nobody else can compute
 * them, so the addresses made from them cannot be guessed and taken first.
 */
export async function issuerSecret(issuer: KeyPairSigner, label: string): Promise<Uint8Array> {
  const signature = await signBytes(issuer.keyPair.privateKey, new TextEncoder().encode(label));
  return new Uint8Array(createHash("sha256").update(signature).digest());
}

/**
 * The same keypair for the same label, every time. A token's mint address made this way
 * means that running an issuance again (an interrupted request, a replayed approval)
 * finds the token it already made instead of creating a second one.
 */
export async function issuerDerivedSigner(issuer: KeyPairSigner, label: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromPrivateKeyBytes(await issuerSecret(issuer, label));
}

/**
 * A "done once" marker: an empty account at an address only the issuer can create
 * (system program, "with seed" from the issuer). Put its creation into a transaction and
 * that transaction can succeed only once; a second try fails because the account exists.
 * The seed comes from the issuer's secret, so nobody can fund the address first to block it.
 */
export async function onceMarker(issuer: KeyPairSigner, label: string): Promise<{ address: Address; seed: string }> {
  const seed = Buffer.from(await issuerSecret(issuer, label)).toString("hex").slice(0, 32); // seeds are at most 32 bytes
  return { address: await createAddressWithSeed({ baseAddress: issuer.address, programAddress: SYSTEM_PROGRAM_ADDRESS, seed }), seed };
}

/** Rent-exempt minimum for an account with no data (devnet rent: getMinimumBalanceForRentExemption(0)). */
export async function onceMarkerInstruction(rpc: DevnetRpc, issuer: KeyPairSigner, marker: { address: Address; seed: string }): Promise<Instruction> {
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(0)).send();
  return getCreateAccountWithSeedInstruction({
    payer: issuer,
    newAccount: marker.address,
    base: issuer.address,
    seed: marker.seed,
    amount: rent,
    space: BigInt(0),
    programAddress: SYSTEM_PROGRAM_ADDRESS,
  });
}

/** The oldest successful transactions that touched an account (the one that created it first). */
export async function oldestSignatures(rpc: DevnetRpc, account: Address, count: number): Promise<Signature[]> {
  const entries = await rpc.getSignaturesForAddress(account, { commitment: "confirmed" }).send(); // newest first, up to 1,000
  return [...entries]
    .reverse()
    .filter((entry) => entry.err === null)
    .slice(0, count)
    .map((entry) => entry.signature);
}

export async function accountExists(rpc: DevnetRpc, account: Address): Promise<boolean> {
  const { value } = await rpc.getAccountInfo(account, { encoding: "base64" }).send();
  return value !== null;
}

/** What the demo wallets the server holds get for fees, and the balance below which they get it. */
const DEMO_FEE_SOL = 0.01;

/** Keeps a demo wallet the server holds able to pay its own fees (only the server can spend it). */
export async function fundDemoWallet(rpc: DevnetRpc, issuer: KeyPairSigner, wallet: Address): Promise<Signature | null> {
  if ((await getSolBalance(rpc, wallet)) >= DEMO_FEE_SOL / 2) return null;
  await requireFunds(rpc, issuer.address);
  return sendDevnetSol(rpc, issuer, wallet, DEMO_FEE_SOL);
}

/**
 * A user's own wallet gets devnet SOL for its fees once, ever: enough for a new account's
 * minimum balance (about 0.00089 SOL) and hundreds of 0.000005 SOL fees. Each top-up
 * carries a memo, so the wallet's history shows whether it already had one; without
 * that, replaying a request could drain the issuer.
 */
export const USER_FEE_SOL = 0.002;
const USER_FEE_MIN_SOL = 0.0001;
export const FEE_TOP_UP_MEMO = "ownflow fee top-up v1";

export async function ensureFeeSol(rpc: DevnetRpc, issuer: KeyPairSigner, wallet: Address): Promise<Signature | null> {
  if ((await getSolBalance(rpc, wallet)) >= USER_FEE_MIN_SOL) return null;
  const history = await rpc.getSignaturesForAddress(wallet, { commitment: "confirmed", limit: 100 }).send();
  if (history.some((entry) => entry.err === null && entry.memo?.includes(FEE_TOP_UP_MEMO))) {
    throw new Error(`Your wallet is out of devnet SOL for fees and already had its top-up; get a little from https://faucet.solana.com (network: devnet)`);
  }
  await requireFunds(rpc, issuer.address);
  return sendInstructions(rpc, issuer, [
    getAddMemoInstruction({ memo: FEE_TOP_UP_MEMO }),
    getTransferSolInstruction({ source: issuer, destination: wallet, amount: lamports(BigInt(Math.round(USER_FEE_SOL * 1e9))) }),
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
    `ownflow receipt v1 rec=${receipt.recommendationHash} passports=${receipt.passportHash} ` +
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

/** A failure during issuance. The mint address is fixed, so trying again finishes the same token. */
function failedDuringIssuance(mint: Address, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message}. Token ${mint} may be partly made (${explorerAddressUrl(mint)}); trying again finishes it and never makes a second one`);
}

export type MintState = { mintAuthority: Address | null; supply: bigint };

/** A Token-2022 mint's mint authority (null once minting is closed) and supply. null when no account exists. */
export async function readMintState(rpc: DevnetRpc, mint: Address): Promise<MintState | null> {
  const { value } = await rpc.getAccountInfo(mint, { encoding: "jsonParsed" }).send();
  if (!value) return null;
  type Parsed = { parsed?: { type?: string; info?: { mintAuthority?: Address | null; supply?: string } } };
  const parsed = (value.data as Parsed).parsed;
  if (value.owner !== TOKEN_2022_PROGRAM_ADDRESS || parsed?.type !== "mint") throw new Error(`${mint} exists but is not a Token-2022 mint`);
  return { mintAuthority: parsed.info?.mintAuthority ?? null, supply: BigInt(parsed.info?.supply ?? "0") };
}

/**
 * Issues a token in two transactions: (1) create the mint with its locked metadata,
 * (2) mint the supply and close minting. The mint address comes from `label`, so a
 * second run looks at the chain first and only does what is missing.
 * Returns the two transactions, oldest first (found in the mint's history when an
 * earlier run sent them).
 */
async function issueOnce(
  rpc: DevnetRpc,
  issuer: KeyPairSigner,
  label: string,
  info: TokenInfo,
  options: MintOptions,
  supplyInstructions: (mint: Address) => Promise<Instruction[]>,
): Promise<{ mint: Address; signatures: Signature[] }> {
  const mint = await issuerDerivedSigner(issuer, label);
  const sent: Signature[] = [];
  try {
    let state = await readMintState(rpc, mint.address);
    if (!state) {
      sent.push((await createMint(rpc, issuer, mint, info, options)).signature);
      state = { mintAuthority: issuer.address, supply: BigInt(0) };
    }
    if (state.mintAuthority !== null) {
      if (state.mintAuthority !== issuer.address) throw new Error(`Token ${mint.address} has another mint authority`);
      sent.push(await sendInstructions(rpc, issuer, await supplyInstructions(mint.address)));
    }
    const earlier = sent.length < 2 ? await oldestSignatures(rpc, mint.address, 2 - sent.length) : [];
    return { mint: mint.address, signatures: [...earlier, ...sent] };
  } catch (error) {
    throw failedDuringIssuance(mint.address, error);
  }
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
 * `label` names the deal (its receipt hashes): the same label always means the same token.
 */
export async function createHeiShareMint(rpc: DevnetRpc, issuer: KeyPairSigner, tokenSupply: number, info: TokenInfo, label: string) {
  const issued = await issueOnce(rpc, issuer, `ownflow hei shares v1 ${label}`, info, HEI_SHARE_MINT, async (mint) => {
    const treasury = await tokenAccount(issuer.address, mint);
    return [
      await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner: issuer.address, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
      getThawAccountInstruction({ account: treasury, mint, owner: issuer }),
      getMintToInstruction({ mint, token: treasury, mintAuthority: issuer, amount: BigInt(tokenSupply) }),
      // The supply is the term sheet's N for good: no more shares can ever be minted.
      getSetAuthorityInstruction({ owned: mint, owner: issuer, authorityType: AuthorityType.MintTokens, newAuthority: none() }),
    ];
  });
  return { ...issued, treasury: await tokenAccount(issuer.address, issued.mint) };
}

/**
 * KYC allowlist: open the investor's (frozen) token account. Without this it stays frozen.
 * Already open: nothing is sent (signature null), so a retried sale does not fail here.
 */
export async function allowlistInvestor(rpc: DevnetRpc, issuer: KeyPairSigner, mint: Address, investor: Address) {
  const account = await tokenAccount(investor, mint);
  if ((await readTokenAccount(rpc, account))?.state === "initialized") return { account, signature: null };
  const signature = await sendInstructions(rpc, issuer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner: investor, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
    getThawAccountInstruction({ account, mint, owner: issuer }),
  ]);
  return { account, signature };
}

/** Opens a token account without thawing it: for a wallet that has not passed KYC. Nothing is sent if it exists. */
export async function openFrozenAccount(rpc: DevnetRpc, issuer: KeyPairSigner, mint: Address, wallet: Address) {
  const account = await tokenAccount(wallet, mint);
  if (await readTokenAccount(rpc, account)) return { account, signature: null };
  const signature = await sendInstructions(rpc, issuer, [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner: wallet, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
  ]);
  return { account, signature };
}

/**
 * The watch's 1-of-1 token: supply 1, no decimals, minting closed for good after the one
 * token. `label` names the vaulted watch (its receipt hashes), so there is never a second token.
 */
export async function createWatchToken(rpc: DevnetRpc, issuer: KeyPairSigner, owner: Address, info: TokenInfo, label: string) {
  const issued = await issueOnce(rpc, issuer, `ownflow watch token v1 ${label}`, info, WATCH_TOKEN_MINT, async (mint) => [
    await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: issuer, owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
    getMintToInstruction({ mint, token: await tokenAccount(owner, mint), mintAuthority: issuer, amount: BigInt(1) }),
    getSetAuthorityInstruction({ owned: mint, owner: issuer, authorityType: AuthorityType.MintTokens, newAuthority: none() }),
  ]);
  return { ...issued, account: await tokenAccount(owner, issued.mint) };
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
