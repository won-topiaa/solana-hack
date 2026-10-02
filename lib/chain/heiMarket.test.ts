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
  parseMintToInstruction,
  parseTransferCheckedInstruction,
  Token2022Instruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { describe, expect, it } from "vitest";
import { allocation, sharesToBuy } from "./heiLifecycle";
import { purchaseInstructions } from "./heiSale";
import {
  homeownerPaymentInstructions,
  homeownerPaymentMemo,
  HOLDERS_PER_TRANSACTION,
  payoutsFor,
  servicerFor,
  settleHeiShares,
  settlementInstructions,
  type ShareHolding,
} from "./heiSettlement";
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
      fundBuyer: true,
    });
    // SIMULATED: the buyer's test dollars are minted in the same transaction, exactly the cost.
    const minted = kinds(steps).filter(({ kind }) => kind === Token2022Instruction.MintTo).map(({ ix }) => parseMintToInstruction(ix));
    expect(minted).toHaveLength(1);
    expect(minted[0].accounts.token.address).toBe(await paymentAccount(buyer.address, token));
    expect(minted[0].data.amount).toBe(BigInt(100_000_050_000));
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

  it("mints nothing for a buyer who brings its own dollars", async () => {
    const [issuer, buyer, heiMint] = await signers(3);
    const token = await testDollar();
    const treasury = await tokenAccount(issuer.address, heiMint.address);
    const steps = await purchaseInstructions({ issuer, buyer, heiMint: heiMint.address, treasury, token, tokens: BigInt(10), priceMicroUsd: BigInt(666_667), fundBuyer: false });
    expect(kinds(steps).some(({ kind }) => kind === Token2022Instruction.MintTo)).toBe(false);
  });
});

describe("a settlement batch (offline)", () => {
  async function batch(size: number) {
    const [servicer, issuer, heiMint, ...owners] = await signers(3 + size);
    const holdings: ShareHolding[] = await Promise.all(
      owners.map(async (owner, index) => ({ account: await tokenAccount(owner.address, heiMint.address), owner: owner.address, tokens: BigInt(1_000 * (index + 1)) })),
    );
    const supply = holdings.reduce((sum, holding) => sum + holding.tokens, BigInt(0));
    const payouts = payoutsFor(BigInt(1_500_000_000), holdings, supply);
    const token = await testDollar();
    const steps = await settlementInstructions({ servicer, issuer, heiMint: heiMint.address, token, payouts, memo: "ownflow settlement v1 test" });
    return { servicer, issuer, payouts, steps, token };
  }

  it("pays each holder from the settlement account and burns exactly that holder's tokens", async () => {
    const { servicer, payouts, steps, token } = await batch(2);
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
      expect(pay.accounts.source.address).toBe(await paymentAccount(servicer.address, token));
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

describe("the homeowner's payment into the settlement account (offline)", () => {
  it("pays exactly the amount, with a memo naming the HEI; the demo homeowner's money is minted first", async () => {
    const [homeowner, issuer, heiMint] = await signers(3);
    const token = await testDollar();
    const servicer = await servicerFor(issuer, heiMint.address);
    const memo = homeownerPaymentMemo(heiMint.address, BigInt(224_765_868_886));
    expect(memo).toBe(`ownflow settlement payment v1 mint=${heiMint.address} amount=224765868886`);
    const steps = await homeownerPaymentInstructions({ homeowner, servicer: servicer.address, token, amountMicroUsd: BigInt(224_765_868_886), memo, fundFrom: issuer });
    const parts = kinds(steps); // token instructions only: opening the account is another program
    expect(parts.map(({ kind }) => kind)).toEqual([Token2022Instruction.MintTo, Token2022Instruction.TransferChecked]);
    const pay = parseTransferCheckedInstruction(parts[1].ix);
    expect(pay.accounts.source.address).toBe(await paymentAccount(homeowner.address, token));
    expect(pay.accounts.destination.address).toBe(await paymentAccount(servicer.address, token));
    expect(pay.data.amount).toBe(BigInt(224_765_868_886));
    expect(fitsInOneTransaction(issuer, steps)).toBe(true);
  });

  it("belongs to a servicer key only the issuer can derive, one per HEI", async () => {
    const [issuer, other, mint1, mint2] = await signers(4);
    expect((await servicerFor(issuer, mint1.address)).address).toBe((await servicerFor(issuer, mint1.address)).address);
    expect((await servicerFor(issuer, mint1.address)).address).not.toBe((await servicerFor(issuer, mint2.address)).address);
    expect((await servicerFor(issuer, mint1.address)).address).not.toBe((await servicerFor(other, mint1.address)).address);
  });
});

describe("settleHeiShares refuses before paying anyone", () => {
  async function setup() {
    const [issuer, heiMint, owner1, owner2] = await signers(4);
    const token = await testDollar();
    const account1 = await tokenAccount(owner1.address, heiMint.address);
    const account2 = await tokenAccount(owner2.address, heiMint.address);
    const servicer = await servicerFor(issuer, heiMint.address);
    const input = { issuer, heiMint: heiMint.address, token, payoutMicroUsd: BigInt(3_000_000), tokenSupply: BigInt(3_000), memo: "test" };
    return { servicer, token, account1, account2, owner1, owner2, input };
  }

  it("when a holder is missing from the register", async () => {
    const { account1, account2, owner1, owner2, input } = await setup();
    const { rpc, attempts } = fakeRpc({ [account1]: { owner: owner1.address, amount: BigInt(1_000) }, [account2]: { owner: owner2.address, amount: BigInt(2_000) } }, BigInt(3_000));
    await expect(settleHeiShares(rpc, { ...input, register: [account1] })).rejects.toThrow(/some holder is missing, so nobody was paid/);
    expect(attempts).toEqual([]);
  });

  it("when every share is already burned, so an old case cannot settle again", async () => {
    const { account1, owner1, input } = await setup();
    const { rpc, attempts } = fakeRpc({ [account1]: { owner: owner1.address, amount: BigInt(0) } }, BigInt(0));
    await expect(settleHeiShares(rpc, { ...input, register: [account1] })).rejects.toThrow(/already settled on-chain/);
    expect(attempts).toEqual([]);
  });

  it("when the homeowner's payment has not fully arrived in the settlement account", async () => {
    const { servicer, token, account1, owner1, input } = await setup();
    const settlementDollars = await paymentAccount(servicer.address, token);
    const { rpc, attempts } = fakeRpc(
      { [account1]: { owner: owner1.address, amount: BigInt(3_000) }, [settlementDollars]: { owner: servicer.address, amount: BigInt(2_999_999) } },
      BigInt(3_000),
    );
    await expect(settleHeiShares(rpc, { ...input, register: [account1] })).rejects.toThrow(/holders are owed 3000000: the homeowner's payment has not arrived/);
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

});
