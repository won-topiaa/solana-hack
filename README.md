# Ownflow

[![CI](https://github.com/won-topiaa/solana-hack/actions/workflows/ci.yml/badge.svg)](https://github.com/won-topiaa/solana-hack/actions/workflows/ci.yml)

**Cash flow from what you own.**

Ownflow is a neutral AI agent for people in the United States who need cash. You say how much you
need and by when. It looks at what you own (a home, luxury watches), compares **every** way to raise
the cash, including plain options such as a HELOC or a sale, and recommends the cheapest suitable
path by fixed, published rules. Only after your explicit approval does it record a verifiable
receipt and issue tokens on Solana.

- **Live demo (Solana devnet):** https://solana-hack.vercel.app
- **Source:** this repository (MIT license); how the code fits together: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Submission materials:** [product description](docs/submission/description.md),
  [go-to-market, demand validation and distribution](docs/submission/go-to-market.md) (with sources),
  [logo](docs/submission/ownflow-logo.png)

> Not investment or financial advice. This is a demo on Solana **devnet**: tokens and test dollars
> have no value. Partners (issuer, vault, appraisal, stolen-watch registry) are simulated and marked
> "Simulated" in the app. Investors' KYC attestations are real Solana Attestation Service records on
> devnet; the identity check behind them uses Plaid's sandbox test identity (on the live demo) or a
> labeled simulated check. Use made-up details.

---

## The problem

- **Options are scattered, and each seller pitches its own.** A homeowner who needs cash can take a
  HELOC, a home equity loan, a home equity investment (HEI), or (at 62+) look at a reverse mortgage.
  A watch owner can sell to a dealer, sell on a marketplace, or borrow against the watch. Nobody
  lines them up side by side for *this* person's amount, deadline and budget.
- **HEI costs are hard to compare.** With an HEI you sell a share of your home's future value. What
  you pay back depends on when you settle and how prices move, so the yearly cost can be low or very
  high, and the offer looks nothing like a loan's APR.
- **Tokenizing an asset does not create cash by itself.** Someone still has to buy the tokens, only
  eligible buyers should be able to hold them, and the payout at the end has to be fair and final.

## What Ownflow does

1. **Goal.** Amount, date, repayment horizon, monthly budget, assets to keep, and which asset you
   want to use: your home, a watch, or "not sure".
2. **Assets.** A home by address (value range and an owner check); the mortgage balance (typed, or
   read from the lender through Plaid's sandbox test data, after you approve). Watches from photos: the model
   reads maker, model, reference, box and papers; the serial number is kept private and only a
   salted hash is used. A stolen-watch check (simulated).
3. **Compare every path** for the goal, with cash now, monthly payment, total cost over the horizon,
   whether you keep the asset, and the main risks:

   | Home | Watches |
   |---|---|
   | HELOC (interest-only) | Dealer sale (about 70–90% of market value, same day) |
   | Home equity loan (equal monthly payments) | Marketplace sale (6.5% seller fee) |
   | **HEI, split into tokens on Solana** | Loan against the watch (65–75% of value by category, 30–180 days) |
   | Reverse mortgage (information only, 62+) | **Vault the watch and issue a 1-of-1 token** |

4. **Recommend by fixed rules**, and say which rules fired:

   | Rule | When | Then |
   |---|---|---|
   | RE-1 | You will repay within 3 years | HELOC or home equity loan first (the cheaper one that fits your budget) |
   | RE-2 | Your monthly budget is below the HELOC's interest-only payment | HEI is the candidate (no monthly payments) |
   | RE-3 | You are 62 or older | Reverse mortgage shown for information |
   | W-1 | Cash needed within about a day, willing to sell | Dealer sale |
   | W-2 | You can wait and want the best price | Marketplace sale |
   | W-3 | You want the watch back within 180 days | Loan against the watch |
   | X-1 | You were not sure which asset to use and neither covers the goal alone | Watches plus a HELOC for the rest |

   Otherwise the lowest total cost wins, with the HEI counted at its costlier price scenario. You may
   still choose another path, including a tokenization path; the receipt records both what was
   recommended and what you chose.
5. **Prepare the handoff documents** (off-chain): the HEI term sheet, an *asset passport* per asset
   (identifiers as salted hashes, evidence hashes, valuation), and a *recommendation receipt* (the
   hash of the recommendation, the hash of the passports, and the version of the parameter registry
   behind every number).
6. **On-chain steps, one at a time, each after your approval:** record the receipt; then issue the
   HEI share tokens, or the watch's 1-of-1 token after a (simulated) vault intake.
7. **Partner steps** (simulated partner): KYC with on-chain attestations, the payment to the homeowner
   at closing, the primary sale to investors, and the settlement that pays every holder and burns
   their tokens.

The case panel shows the comparison as charts (cash now against the goal, the monthly payment
against the budget, the total cost), the HEI's payback by settlement year with its cap, the
ownership split, and where the case stands.

The model (Google Gemini) handles the conversation and reads photos. **It never computes or
invents a number:** in the web app it writes no figures at all, and in the terminal it quotes
code-made text word for word. All money math is in tested, pure functions, and every figure on
screen comes from code and from a parameter registry with sources and dates.

## Try the live demo

1. Open https://solana-hack.vercel.app and load **Persona B** (a made-up homeowner who needs
   $150,000, plans to repay in 10 years and cannot make monthly payments).
2. Click the suggested messages: *Compare my options* → *Prepare the documents* → *Record the receipt
   on Solana* (approve) → *Issue the HEI share tokens* (approve). The panel on the right fills in:
   the comparison table, the term sheet, the hashes, and links to Solana Explorer.
3. Open **Partner & investors**: *Run the closing and the sale*, then *Settle* (buyback after 2
   years, or maturity after 10 years; the home's value follows the real FHFA house price index over
   the same number of past years). The page reads the settlement transactions back from devnet and
   checks that every holder was paid its share and every token was burned.

**Use your own wallet (optional).**

1. In Phantom (or another Wallet Standard wallet): Settings → Developer Settings → **Testnet Mode**
   on, choose **Solana Devnet** ([how](https://docs.phantom.com/developer-powertools/testnet-mode)),
   then reload the page.
2. Start a case and click *Connect* at the top of it, **before** recording the receipt (after that
   the case stays with the wallet that signed). Your wallet signs a short message that ties it to the
   case; no money moves.
3. From then on your wallet signs the receipt itself, receives the closing payment or the watch
   token, and at settlement signs a payment of the test dollars it holds (the simulated rest of the
   payout is added by the partner). The app sends a new wallet 0.002 devnet SOL for fees, once. Open
   the Partner page in the same tab.

Without a wallet, a demo wallet on the server signs for you.

Other personas: A (watches, cash by tomorrow, keeps the sport watch), B2 (same home, repays in
2 years → HELOC), C and D (not sure which asset). You can also start an empty case and add a watch
photo; try the made-up warranty card in `data/demo/watch-photos/demo-warranty-card.png`.

## The HEI math (persona B)

Home value V = $1,000,000, cash needed C = $150,000. Investor discount 33.3%, fee 3.9% (minimum
$2,000), investor return capped at 20% a year.

- Investors pay G = C / (1 − 3.9%) = **$156,087.41** (fee $6,087.41).
- One token = 1/1,000,000 of the home's value at settlement; price today = $1 × (1 − 1/3) =
  **$0.666667**.
- Tokens issued N = round(G / price) = **234,131**, i.e. **23.41%** of the home's future value.
- At settlement after t years the homeowner pays min(N × V_t / 1,000,000, G × 1.2^t).

| Settle after | Home prices | Homeowner pays | Cost per year |
|---|---|---|---|
| 2 years | flat | $224,765.87 (cap applies) | 22.41% |
| 10 years | flat | $234,131 | 4.55% |
| 10 years | +3% a year | $314,652 | 7.69% |

The comparison uses two fixed price scenarios (flat and +3% a year). The settlement demo on the
partner page instead follows the FHFA house price index over the same number of past years
(+3.41% a year over 2 years and +6.81% a year over 10 years, to 2026-04-01): the 2-year buyback is
the same, since the cap applies; a 10-year maturity then pays about $452,648 (11.68% a year).

That is why the rules send a 2-year borrower to a HELOC (RE-1) and a 10-year borrower with no
monthly budget to the HEI (RE-2). On-chain, money moves in micro-dollars: each holder gets
floor(payout × tokens / N), so with two investors holding 150,000 and 84,131 tokens a 2-year
buyback pays exactly $144,000.069760 and $80,765.799126.

## Why a blockchain

- **A recommendation you can check later.** The receipt (hashes and the registry version, no
  personal data) is written on-chain when you approve, so anyone holding the documents can prove what
  was recommended, on which numbers, and what you chose.
- **Compliance enforced by the token.** HEI share accounts start **frozen**. The issuer opens one only
  after reading the wallet's KYC attestation (Solana Attestation Service) from the chain and checking
  it; a buyer without one is refused by the token program itself.
- **Delivery against payment.** Each purchase is one transaction: the buyer's dollars and the shares
  move together, or nothing moves.
- **A fair, final settlement.** The homeowner pays the payout once into the HEI's own settlement
  account; holders are then paid from it, each in the same transaction as the burn of its tokens (up
  to four holders per transaction). No holder is burned without being paid.
- **Fixed supply and locked metadata.** After minting, the HEI supply can never grow, and the
  passport and recommendation hashes written into the token can never be changed.
- **Liquidity for a watch in a vault.** The 1-of-1 token stands for the vaulted watch; with a real
  vault partner it could be sold or used as collateral, and burning it would release the watch (the
  demo simulates the intake and has no redemption step).

## What goes on-chain (Solana devnet)

| Step | On-chain | Signed by |
|---|---|---|
| Recommendation receipt | Memo: `ownflow receipt v1 rec=<hash> passports=<hash> registry=<version> selected=<path>` | Your own wallet (checked on-chain after it lands), or the demo wallet |
| HEI share token | Token-2022 mint, decimals 0, supply 234,131, extensions: DefaultAccountState (frozen), PermanentDelegate (issuer, for settlement), MetadataPointer + TokenMetadata (passport and recommendation hashes; update authority removed); mint authority removed. The mint address is derived from the issuer's signature over the receipt hashes, so one receipt can only ever make one token | Issuer |
| Watch 1-of-1 token | Token-2022 mint, supply 1, mint authority removed, metadata locked, held by the user; address derived the same way | Issuer |
| KYC | An identity check (Plaid Identity Verification in sandbox, or a simulated check, named as such), then a Solana Attestation Service attestation for the investor's wallet (credential `ownflow-kyc-demo`, schema `investor-kyc`: provider, a hash of the check's id, the time; valid one year). The issuer reads the attestation back from the chain and checks issuer, wallet, schema and expiry by the chain's clock before it thaws the investor's share account; a wallet without one stays frozen | Issuer (demo attestation issuer) |
| Closing | Test-dollar payment to the homeowner, with a memo naming the HEI and a once-only marker account (created "with seed" from the issuer), so a second closing payment for the same HEI fails on-chain | Issuer |
| Primary sale | One transaction: the buyer's test dollars are minted (simulated investor money), paid to the issuer, and the shares go to the buyer | Buyer + issuer |
| Settlement | (1) The homeowner pays into the HEI's own settlement account, owned by a servicer key the issuer derives per HEI (memo names the HEI and the amount). Your own wallet pays the test dollars it holds; the demo wallet pays all of it, minted in the same transaction, with a once-only marker. (2) Holders are paid from the settlement account, each in the same transaction as the burn of its shares (up to four per transaction); the simulated rest of a wallet's payout is added in the first of these. Refused once every share is burned; a lost answer is rebuilt from these transactions | (1) Your own wallet, or the demo wallet; (2) issuer (permanent delegate) and the HEI's servicer key |

**Off-chain:** addresses, names, serial numbers, photos, the case file, the comparison and the term
sheet. Only their hashes go on-chain.

Sample records from one run (devnet, demo wallets):
[receipt](https://explorer.solana.com/tx/3EMoBupSBVgUUJHUS2AiLDkBCmT4BvZVcxPZAai7mUgntbvY3PfBMwyAt6DPv5DVqhPxz9tYRJXyF7PpRMj6iDVD?cluster=devnet) ·
[HEI share token](https://explorer.solana.com/address/8daAAchztT2yvzpWSrPpe1NGZyeA8FSDH2HygUwXWaDP?cluster=devnet) ·
[KYC attestation 1](https://explorer.solana.com/address/2VdQoqGxL7RHjEYfAu6v6fBH63q4nUgtoGFZRkk6MoNg?cluster=devnet) ·
[KYC attestation 2](https://explorer.solana.com/address/8PrSbHFbx2k4RW3ewXjph2ETX62fB8hrPfB8rSjwmjaQ?cluster=devnet) ·
[closing](https://explorer.solana.com/tx/56CHApNrjJZYdxQkqTkUzuoQeUGu5Gk9LjXUTLTmRtkPymLKKtQpZJNVXH27WeYuzMAK5Vr5WMZNxXWjxu3pH3en?cluster=devnet) ·
[purchase 1](https://explorer.solana.com/tx/4qe7azeCY86dWUamWfv2jqDNCGnQDg2XJcJd5xnwaKNi37CuFwgarToUqrfeG8WFJjW6hVyqnfTXypjB68pQ2D7?cluster=devnet) ·
[purchase 2](https://explorer.solana.com/tx/5Du8tGcvFAoZE9znuraKZ7YvwAC1SrEmmk8iH8A82cmsuVqgjeucy6rFZ3F5mqAyyL73LkUrjKFZM3uXHZhjjTKR?cluster=devnet) ·
[account without KYC (frozen)](https://explorer.solana.com/address/4p1JmcBEhSrErZw6xRGnqh9D1TrsNWh7f1LQyvfu9Xoo?cluster=devnet) ·
[homeowner's payment into the settlement account](https://explorer.solana.com/tx/4L8zjsxsgapWqQKopVtDCrZXBpAWi6m8K5AqADkxbLbwJGjMh22zhXVSUCx8MnoU7Q8ax2GYGnhyWWoaJbt22yTp?cluster=devnet) ·
[payout + burn](https://explorer.solana.com/tx/4W2sc6WHeYBhzTwAa3jxKpWKpc7pMxdanP4DsX8pgXEP73j28qnntGAoAwqxsmEPeqBPXFGed29qPxQrSdrjdnru?cluster=devnet) ·
[watch 1-of-1 token](https://explorer.solana.com/address/H9LZ68ws32rG1YSuFR2UdVNyjyqm7MSB3dLzFXFpp1av?cluster=devnet) ·
[test dollar](https://explorer.solana.com/address/EkYSihFm4a6uz6yVDsYUg9nzJdXTFEayyPr9uM1XHfks?cluster=devnet)
(devnet can be reset, which would remove them).

## What is simulated

- **The partners.** Ownflow is a connector, not the issuer or the custodian. A licensed partner
  would hold the HEI contract and issue the shares; a vault partner would hold the watch. In the demo
  one server-held "issuer" wallet plays these roles.
- **KYC's identity check, the appraisal, the vault intake and the stolen-watch registry.** Each is
  labeled where it appears. The KYC attestation itself is a real Solana Attestation Service record
  checked on-chain; the identity check behind it is Plaid's sandbox with Plaid's test identity when
  configured, otherwise simulated. The appraisal at settlement follows real data: the FHFA
  All-Transactions House Price Index (FRED `USSTHPI`), growing at the index's actual yearly rate
  over the same number of past years.
- **Time and money behind the payments.** Devnet does not wait years: the settlement page lets you
  pick when the HEI settles. The homeowner's money beyond what its wallet holds, the partner's money
  at closing and the investors' money are test dollars minted inside the transaction that uses them
  (labeled), so two demo runs at once never mix up the shared wallets' balances.
- **Money.** Payments use "Demo USD (DUSD)", a devnet test token with no value and 6 decimals like
  USDC. Circle's devnet USDC faucet gives 20 USDC per address every 2 hours, far below a $150,000
  sale; the code takes the payment token as data so a real stablecoin could replace it.
- **Homes in the live demo** are made-up records in RentCast's response format
  (`data/demo/properties.json`); watch values come from a made-up price table. Plaid (mortgage and
  identity) runs on its sandbox with test data. Local runs can use RentCast with your own key.
- **Wallets.** The investors and the issuer are demo wallets held by the server. The user can
  connect their own wallet (Phantom in Testnet Mode); otherwise a demo wallet stands in and your
  approval in the app stands for your signature.

## Trust assumptions

- **The issuer is trusted** in this design: it keeps the freeze authority (to run the KYC allowlist)
  and is the permanent delegate (to burn shares at settlement). The token program would let it burn
  without paying; Ownflow's code only burns in the same transaction as the payment. The same demo
  issuer writes the KYC attestations and checks them before it opens an account.
- **The registry is trusted to be accurate.** Every number comes from `data/params.json`, where each
  value has a source, a date and a validity window. A recommendation is refused when a value it uses
  is out of date. For the judging period the deployed demo freezes the values on one date and says so
  under the comparison.
- **The model is not trusted with numbers.** In the web app it is told never to write figures,
  hashes or links, and any amount or rate it writes anyway is replaced before the page shows it; the
  panel shows code-made text. Tools that act (on-chain steps, a bank connection, a
  registry check) never run before you approve them.
- **The server keeps no case.** Your case travels in your browser as a token sealed with AES-256-GCM,
  which the browser cannot read or change; the tab also keeps a readable copy of your chat and panel
  for display.
- **Legal status.** HEIs and HEI-backed tokens raise consumer-credit and securities questions. This
  is a proof of concept; a real launch would go through a licensed partner and legal review.

## Limits on the public demo

40 messages and 6 photos per case, at most four tool calls per model reply, on-chain steps paused
when the demo wallet runs low on devnet SOL, a one-time 0.002 SOL fee top-up per connected wallet, and
a per-IP rate limit on the API. Devnet's public RPC can be busy; calls are retried with a
time limit. Every on-chain step can be run again safely: issuance finds the token it already made,
the closing payment and the demo homeowner's payment happen once, the sale skips what is done, and a
settled HEI cannot settle again (a lost answer is rebuilt from the chain).

## Architecture

```
Browser (Next.js app: chat + case panel, partner page)
   │  sealed case token + one action per request
Next.js route handlers (Vercel functions)
   ├─ Agent orchestrator: Gemini with tool calling; one step's tools at a time; approval gates
   ├─ lib/calc       pure, tested money math (HEI, settlement, loans, watch paths, sale split)
   ├─ lib/params     parameter registry, freshness gate, refresh script
   ├─ lib/recommend  paths, rules, term sheet, passports, receipt
   └─ lib/chain      Solana devnet with @solana/kit + Token-2022 (receipt, mints, sale, settlement)
```

[ARCHITECTURE.md](ARCHITECTURE.md) has the request flow, the agent loop, the on-chain layer, the
invariants with the tests that hold them, and the trust boundaries.

| Folder | What is there |
|---|---|
| `app/`, `components/` | Pages and UI (agent page, partner page), API routes |
| `lib/agent/` | Orchestrator, tools (one file per step in `tools/`), prompts, Gemini client, services from the environment |
| `lib/calc/` | Money math and its tests |
| `lib/recommend/` | Comparison, rules, documents, demo personas |
| `lib/chain/` | Solana: mints, receipt, KYC, sale, settlement, test dollar, wallets |
| `lib/web/` | Sealed case token, the view sent to the browser, chart data, request handlers |
| `lib/params/` | Parameter registry loader, freshness checks, FRED refresh |
| `lib/integrations/` | RentCast, Plaid (mortgage, identity verification), Gemini vision, simulated stolen-watch check |
| `lib/assets/` | Asset types, serial hashing, owner match, watch price table |
| `data/` | `params.json` (registry), demo homes, watches, personas |
| `scripts/` | Terminal chat, devnet scripts, registry tools |

## Run locally

Requires Node.js 22.12 or later.

```bash
npm install
cp .env.example .env.local   # set GEMINI_API_KEY and CASE_SECRET (e.g. openssl rand -base64 48)
npm run chain:wallets        # creates the devnet demo wallets in .wallets/devnet (git-ignored)
                             # fund the printed issuer address at https://faucet.solana.com (devnet)
npm run dev                  # http://localhost:3000
```

Market values in the registry expire after a few days by design, and a recommendation is refused
when a value it uses is out of date. To run with the values as of the submission, set
`REGISTRY_FROZEN_ON=<registry date>` in `.env.local` (the deployed demo does the same), or refresh them
(`npm run params:refresh`; the HELOC averages are entered by hand).

| Command | What it does |
|---|---|
| `npm run dev` | The web app |
| `npm test` | Unit tests (Vitest), including the worked examples above |
| `npm run agent:chat` | The agent in the terminal; `/photo <path>` adds a watch photo |
| `npm run chain:demo` | Receipt + HEI shares + KYC attestation and allowlist, and receipt + watch token, on devnet |
| `npm run chain:hei` | The whole HEI on devnet: issuance, KYC, closing, sale, settlement; `-- --years 10 --growth 0.03` for maturity |
| `npm run params:check` | How fresh each registry value is today |
| `npm run params:refresh` | Refresh market values from FRED (needs `FRED_API_KEY`) |
| `npm run check` | ESLint, the TypeScript check and the unit tests (CI runs this and the build) |
| `npm run lint`, `npm run typecheck`, `npm run build` | Each check alone; production build |

Settings (see `.env.example`): `GEMINI_API_KEY` (required), `GEMINI_MODEL`, `CASE_SECRET` (required
for the web app), `RENTCAST_API_KEY` or `PROPERTY_DATA_SOURCE=demo`, `PLAID_CLIENT_ID` + `PLAID_SECRET`
(sandbox) and `PLAID_IDV_TEMPLATE_ID` (investor KYC), `FRED_API_KEY` (registry refresh),
`SOLANA_RPC_URL`, `REGISTRY_FROZEN_ON` (values as of one date), and on a host without the wallet
files `DEVNET_WALLET_<NAME>` and `DEVNET_TEST_DOLLAR_MINT`.

## Data sources and notices

- HELOC and home equity loan averages: Curinos, as published by Yahoo Finance (entered by hand,
  with dates).
- HEI terms: calibrated from Hometap's and Point's published terms; the investor discount, the
  return cap and the eligibility cap are this project's design values.
- Watch paths: published dealer, marketplace and lender terms (sources in `data/params.json`).
- Home records and values: RentCast API when a key is set; otherwise made-up demo records.
- Home price growth for the settlement demo: FHFA All-Transactions House Price Index for the United
  States (`USSTHPI`), via FRED.
- This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of
  St. Louis. Mortgage rate averages: Source: Freddie Mac Primary Mortgage Market Survey. The SOFR is
  subject to the Terms of Use posted at newyorkfed.org; see [THIRD_PARTY.md](THIRD_PARTY.md) for the
  full notices.

Third-party code, fonts and services are listed in [THIRD_PARTY.md](THIRD_PARTY.md).

## License

MIT. See [LICENSE](LICENSE).
