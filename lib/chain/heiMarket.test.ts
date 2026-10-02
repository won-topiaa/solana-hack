import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import {
  identifyToken2022Instruction,
  parseBurnCheckedInstruction,
  parseTransferCheckedInstruction,
  Token2022Instruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { describe, expect, it } from "vitest";
import { allocation, sharesToBuy } from "./heiLifecycle";
import { closingMemo, findClosing, purchaseInstructions } from "./heiSale";
import { HOLDERS_PER_TRANSACTION, payoutsFor, settleHeiShares, settlementInstructions, type ShareHolding } from "./heiSettlement";
import { paymentAccount, type PaymentToken } from "./payment";
import { tokenAccount, type DevnetRpc } from "./solana";

// Offline checks of the M8 transactions (no network). The devnet run is scripts/chain-hei.ts.
type Parsable = Parameters<typeof parseTransferCheckedInstruction>[0];

async function signers(count: number): Promise<KeyPairSigner[]> {
  return Promise.all(Array.from({ length: count }, () => generateKeyPairSigner()));
}

async function testDollar(): Promise<PaymentToken> {
  const [mint] = await signers(1);
  return { mint: mint.address, program: TOKEN_2022_PROGRAM_ADDRESS, decimals: 6, symbol: "DUSD" };
}

function kinds(instructions: Instruction[]) {
  return instructions
    .filter((ix) => ix.programAddress === TOKEN_2022_PROGRAM_ADDRESS)
    .map((ix) => ({ ix: ix as Parsable, kind: identifyToken2022Instruction(ix as Parsable) }));
}

function fitsInOneTransaction(feePayer: KeyPairSigner, instructions: Instruction[]): boolean {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: "11111111111111111111111111111111" as Blockhash, lastValidBlockHeight: BigInt(0) }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return getTransactionMessageSize(message) <= getTransactionMessageSizeLimit(message);
}

describe("a primary sale purchase (offline)", () => {
  it("moves the buyer's dollars and the issuer's shares in one transaction", async () => {
    const [issuer, buyer, heiMint] = await signers(3);
    const token = await testDollar();
    const treasury = await tokenAccount(issuer.address, heiMint.address);
    const steps = await purchaseInstructions({
      issuer,
      buyer,
      heiMint: heiMint.address,
      treasury,
      token,
      tokens: BigInt(150_000),
      priceMicroUsd: BigInt(666_667),
    });
    const transfers = kinds(steps).filter(({ kind }) => kind === Token2022Instruction.TransferChecked).map(({ ix }) => parseTransferCheckedInstruction(ix));

    const [pay, shares] = transfers;
    expect(pay.accounts.source.address).toBe(await paymentAccount(buyer.address, token));
    expect(pay.accounts.destination.address).toBe(await paymentAccount(issuer.address, token));
    expect(pay.data.amount).toBe(BigInt(100_000_050_000)); // $100,000.05
    expect(shares.accounts.source.address).toBe(treasury);
    expect(shares.accounts.destination.address).toBe(await tokenAccount(buyer.address, heiMint.address));
    expect(shares.data.amount).toBe(BigInt(150_000));
    expect(fitsInOneTransaction(issuer, steps)).toBe(true);
  });
});

describe("a settlement batch (offline)", () => {
  async function batch(size: number) {
    const [homeowner, issuer, heiMint, ...owners] = await signers(3 + size);
    const holdings: ShareHolding[] = await Promise.all(
      owners.map(async (owner, index) => ({ account: await tokenAccount(owner.address, heiMint.address), owner: owner.address, tokens: BigInt(1_000 * (index + 1)) })),
    );
    const supply = holdings.reduce((sum, holding) => sum + holding.tokens, BigInt(0));
    const payouts = payoutsFor(BigInt(1_500_000_000), holdings, supply);
    const token = await testDollar();
    const steps = await settlementInstructions({ homeowner, issuer, heiMint: heiMint.address, token, payouts, memo: "ownflow settlement v1 test" });
    return { homeowner, issuer, payouts, steps, token };
  }

  it("pays each holder and burns exactly that holder's tokens", async () => {
    const { homeowner, payouts, steps, token } = await batch(2);
    const parts = kinds(steps);
    expect(parts.map(({ kind }) => kind)).toEqual([
      Token2022Instruction.TransferChecked,
      Token2022Instruction.BurnChecked,
      Token2022Instruction.TransferChecked,
      Token2022Instruction.BurnChecked,
    ]);
    for (const [index, payout] of payouts.entries()) {
      const pay = parseTransferCheckedInstruction(parts[index * 2].ix);
      const burn = parseBurnCheckedInstruction(parts[index * 2 + 1].ix);
      expect(pay.accounts.source.address).toBe(await paymentAccount(homeowner.address, token));
      expect(pay.accounts.destination.address).toBe(await paymentAccount(payout.owner, token));
      expect(pay.data.amount).toBe(payout.payoutMicroUsd);
      expect(burn.accounts.account.address).toBe(payout.account);
      expect(burn.data.amount).toBe(payout.tokens);
    }
    // 1,000 and 2,000 tokens of 3,000 share $1,500 as $500 and $1,000.
    expect(payouts.map((payout) => payout.payoutMicroUsd)).toEqual([BigInt(500_000_000), BigInt(1_000_000_000)]);
  });

  it(`fits ${HOLDERS_PER_TRANSACTION} holders in one transaction`, async () => {
    const { issuer, steps } = await batch(HOLDERS_PER_TRANSACTION);
    expect(fitsInOneTransaction(issuer, steps)).toBe(true);
  });
});

/**
 * A stand-in RPC: token accounts and the supply as given, and no transaction can be
 * sent (asking for a blockhash, the first step of sending, records an attempt).
 */
function fakeRpc(accounts: Record<string, { owner: string; amount: bigint }>, supply: bigint) {
  const attempts: string[] = [];
  const reply = <T>(value: T) => ({ send: async () => value });
  const rpc = {
    getAccountInfo: (account: string) =>
      reply({
        value: accounts[account]
          ? { data: { parsed: { info: { owner: accounts[account].owner, state: "initialized", tokenAmount: { amount: String(accounts[account].amount) } } } } }
          : null,
      }),
    getTokenSupply: () => reply({ value: { amount: String(supply) } }),
    getLatestBlockhash: () => {
      attempts.push("send");
      return { send: async () => Promise.reject(new Error("no sending in tests")) };
    },
  };
  return { rpc: rpc as unknown as DevnetRpc, attempts };
}

describe("settleHeiShares refuses before paying anyone", () => {
  async function setup() {
    const [homeowner, issuer, heiMint, owner1, owner2] = await signers(5);
    const token = await testDollar();
    const account1 = await tokenAccount(owner1.address, heiMint.address);
    const account2 = await tokenAccount(owner2.address, heiMint.address);
    const input = { homeowner, issuer, heiMint: heiMint.address, token, payoutMicroUsd: BigInt(3_000_000), tokenSupply: BigInt(3_000), memo: "test" };
    return { homeowner, token, account1, account2, owner1, owner2, input };
  }

  it("when a holder is missing from the register", async () => {
    const { account1, account2, owner1, owner2, input } = await setup();
    const { rpc, attempts } = fakeRpc({ [account1]: { owner: owner1.address, amount: BigInt(1_000) }, [account2]: { owner: owner2.address, amount: BigInt(2_000) } }, BigInt(3_000));
    await expect(settleHeiShares(rpc, { ...input, register: [account1] })).rejects.toThrow(/some holder is missing, so nobody was paid/);
    expect(attempts).toEqual([]);
  });

  it("when the homeowner cannot pay the whole amount", async () => {
    const { homeowner, token, account1, owner1, input } = await setup();
    const homeownerDollars = await paymentAccount(homeowner.address, token);
    const { rpc, attempts } = fakeRpc(
      { [account1]: { owner: owner1.address, amount: BigInt(3_000) }, [homeownerDollars]: { owner: homeowner.address, amount: BigInt(2_999_999) } },
      BigInt(3_000),
    );
    await expect(settleHeiShares(rpc, { ...input, register: [account1] })).rejects.toThrow(/needs 3000000/);
    expect(attempts).toEqual([]);
  });
});

describe("allocation of the primary sale", () => {
  it("gives the first investor 150,000 shares and the second the rest", () => {
    expect(allocation(BigInt(234_131), 2)).toEqual([BigInt(150_000), BigInt(84_131)]);
  });

  it("gives everything to one investor, or to the first when the supply is small", () => {
    expect(allocation(BigInt(234_131), 1)).toEqual([BigInt(234_131)]);
    expect(allocation(BigInt(90_000), 2)).toEqual([BigInt(90_000), BigInt(0)]);
    expect(() => allocation(BigInt(1), 0)).toThrow(RangeError);
  });
});

describe("a sale that is run again after an interruption", () => {
  it("buys only the shares an investor does not hold yet", () => {
    expect(sharesToBuy(BigInt(150_000), BigInt(0))).toBe(BigInt(150_000));
    expect(sharesToBuy(BigInt(150_000), BigInt(150_000))).toBe(BigInt(0));
    expect(sharesToBuy(BigInt(150_000), BigInt(40_000))).toBe(BigInt(110_000));
  });

  it("finds the earlier closing payment of this HEI by its memo, and only a successful one", async () => {
    const [mint, other] = await signers(2);
    const entries = [
      { signature: "failed", memo: `[57] ${closingMemo(mint.address)}`, err: { InstructionError: [0, "Custom"] } },
      { signature: "other-hei", memo: `[57] ${closingMemo(other.address)}`, err: null },
      { signature: "paid", memo: `[57] ${closingMemo(mint.address)}`, err: null },
    ];
    expect(findClosing(entries, mint.address)).toBe("paid");
    expect(findClosing(entries.slice(0, 2), mint.address)).toBeNull();
  });
});
