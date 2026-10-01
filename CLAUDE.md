# CLAUDE.md — Project instructions for Claude Code

> Codename: **rwa-liquidity-agent** (final name TBD, see `docs/internal/PLAN.md` §15)
> Builder: solo. Hackathon: Colosseum **Crypto World's Fair** (CWF). Target market: **United States**.
> Hard deadline: **Oct 12, 2026 11:59 PM PT = Oct 13, 2026 3:59 PM KST** (Official Rules §5). Internal target: submit by **Oct 12, 2026 11:00 PM KST**.
> Full plan (Korean): `docs/internal/PLAN.md`. Running log: `docs/internal/PROGRESS.md`. Parameter registry: `data/params.json`.
> Next.js rules (maintained by `next dev`; read the version-matched docs in `node_modules/next/dist/docs/` before writing Next.js code): @AGENTS.md

---

## 1. What we are building

A **neutral AI agent** for US users who need cash. The user says how much they need and by when. The agent
collects their assets, verifies and values them, compares **every** way to raise the cash (including
non-crypto options like a HELOC), recommends the cheapest suitable path, and then connects the user to the
next step — including tokenization — **only after explicit approval**.

Two asset lanes, both built end to end:

- **Real estate lane:** the homeowner keeps living in the home and sells a share of its **future value**
  (a home equity investment, "HEI"). The share is split into tokens that verified investors can buy.
- **Watch lane:** luxury watches. Cash paths are dealer sale, marketplace sale, a collateral loan, or vaulting
  plus a 1-of-1 token.

The agent is a **connector**, not the issuer or the custodian. Partners (an issuer entity holding the HEI
contract, a vault partner for watches) own legal issuance and custody. In the demo, the app plays these
partner roles on devnet and **labels every simulated partner step as "Simulated" in the UI**.

---

## 2. Hard constraints (Official Rules and product rules; do not violate)

- **English only** for all content: UI copy, README, code comments, commit messages, on-screen demo data (Rules §12(a)(i)).
- **No secrets in the repo.** Keys only in `.env*` (gitignored). Submissions are not confidential and are shared with judges and sponsors (§7, §11).
- **No unlicensed third-party assets**: no stock images, brand logos or fonts we have no right to use (§12(b)(ii)); no Colosseum trademarks without written consent (§17). Use generic watch names in demo data, not brand logos.
- **Track third-party code** in `THIRD_PARTY.md` with licenses (§9).
- **Not investment or financial advice.** Show this notice wherever a recommendation appears.
- **LLM data.** The Gemini key is on the paid tier (owner, 2026-10-01): under the Gemini API terms Google does not use paid-tier prompts to improve its products and keeps them only for a limited time to detect abuse. Still send the model only what a step needs, and use made-up personas in demos and videos.
- **Data notices.** Wherever FRED, Freddie Mac PMMS or SOFR values are shown, show the notices listed in `THIRD_PARTY.md` (FRED, Freddie Mac and New York Fed terms).
- **PII stays off-chain.** Addresses, owner names, serial numbers and documents are stored off-chain; only hashes go on-chain. Never log raw PII.
- **No custody or lien claims.** The app never claims it holds a watch or records a lien; those are partner steps (simulated in the demo).

---

## 3. How to work with the owner (mandatory)

1. **One milestone at a time** (§10). At the end of each milestone: stop, summarize in plain language, list exactly how to verify (commands, URLs, clicks), and **wait for an explicit OK**. After the OK, commit the milestone (English message). Do not push to GitHub until the owner says so.
2. **Never guess** package names, SDK methods, program IDs, addresses, API endpoints or numeric parameters. Check official docs first and record the URL in `docs/internal/PROGRESS.md`. If something cannot be verified, stop and ask.
3. **Numbers come from code, never from the LLM.** The LLM handles conversation, reading photos/documents and explanations. All money math lives in pure functions in `/lib/calc` with unit tests (§8). Every number shown to the user must come from those functions and `data/params.json`.
4. **TBD means undecided.** Do not choose for the owner; ask, or build behind an interface.
5. After every step, append to `docs/internal/PROGRESS.md` (date, step, changes, decisions, sources, how to verify, next).
6. The owner is learning to read code: small functions, clear names, short English comments explaining *why*. After each milestone, point to the 2–3 most important files and explain them.
7. Start each session by reading this file, `docs/internal/PLAN.md`, the latest `PROGRESS.md` entries and `data/params.json`; state the current milestone and ask before coding.

---

## 4. Decision status

| Item | Status |
|---|---|
| Market | United States (decided) |
| Lanes | Real estate (HEI tokens) + watches, both end to end (decided) |
| Agent role | Neutral comparison + connector; partners are issuer/custodian (decided) |
| HEI pricing | discount 33.3%, fee 3.9% (min $2,000), investor return cap 20%/yr, term 5–30 yrs (default 10), max investment 24.99% of home value (our design cap, calibrated from Hometap) (decided) |
| HELOC-first rule | If repayment planned within 3 years, show HELOC / home equity loan first (decided) |
| Chain / track | **Solana** (decided 2026-10-01): devnet for the demo, Solana track (Rules §14(e)); Token-2022 + Solana Agent Kit |
| Arena category | Tentative: Real World Assets (RWA); alternative: AI Platforms / Agents |
| Project name | **TBD** (repo and package use the working name `rwa-liquidity-agent` until decided) |
| LLM provider | **Google Gemini API** (decided 2026-10-01), SDK `@google/genai`, default model `gemini-3.8-flash` (function calling + image input), key `GEMINI_API_KEY` in `.env.local` |
| Watch price data source | **TBD** (no API verified yet; MVP uses a manual price table with source + date) |
| Hosting / OSS license | **TBD** |

---

## 5. Agent functions (state machine)

| Step | What the agent does | Tools / data | Output |
|---|---|---|---|
| 1 Goal | Ask: cash needed, deadline, planned repayment horizon, assets to keep, monthly payment capacity, age 62+? | chat | `Goal` |
| 2 Capture | Address, camera (home interior; watch reference/serial/box/papers), documents, Plaid (mortgage data), wallet; or "recommend for me" mode | multimodal LLM, Plaid Liabilities | `Asset[]` |
| 3 Verify | Owner/tax/sale history; watch theft check (simulated in MVP); schedule partner appraisal/authentication | RentCast, The Watch Register (simulated) | verification log |
| 4 Value | Home: AVM range + error band. Watch: price table + box/papers note | RentCast, `data/params.json` | `Valuation` |
| 5 Compare | Build every `PathOption` per lane + cross-lane combos; apply rules (§8.4) | `/lib/calc`, params | `Recommendation` |
| 6 Prepare | Term sheet, **Asset Passport**, **Recommendation Receipt** | hashing | handoff bundle |
| 7 Execute (approval gate) | Token design → mint → primary sale, or route to buyer/lender/marketplace | Solana Agent Kit (Token-2022, Metaplex) | tx ids |
| 8 Monitor & settle | Due-date alerts; settlement value; capped payout; distribute; burn; redemption | settlement script | settlement record |

Approval gates (UI confirmation + wallet signature): minting, any token/USDC transfer, sending a receipt on-chain, and any action that would contact a partner in production.

---

## 6. Architecture

```
[Next.js UI]  chat + camera + comparison table + approvals + token/settlement views
     |
[Agent orchestrator]  LLM with tool calling; state = CaseFile (JSON); never computes money itself
     |-- tools: rentcast.getProperty/getValue, plaid.getLiabilities (sandbox), vision.readWatch/readInterior,
     |          watchRegister.check (simulated), params.get, calc.*, passport.build, receipt.hash
     |-- /lib/calc      pure, tested money math (HEI, settlement, HELOC compare, watch paths, cross-lane)
     |-- /lib/params    loads data/params.json, checks staleness, exposes registry_version
     '-- /lib/chain     ChainAdapter (Solana devnet): mintHeiShares, mintWatchNft, recordReceipt, settle
```

---

## 7. Folder structure (proposed)

```
/app                      Next.js App Router (landing chat, /case/[id], /token/[mint], /settle/[id])
/components               Chat, CameraCapture, PathTable, TermSheet, PassportView, ReceiptBadge, SimulatedTag
/lib/agent                orchestrator.ts, tools.ts, prompts.ts (English), goal.ts, llm.ts (provider interface), gemini.ts, scripted.ts (test model), types.ts
/lib/calc                 hei.ts, settlement.ts, compare.ts, watch.ts, cross.ts, guards.ts  (+ *.test.ts, test-fixtures.ts)
/lib/params               load.ts, staleness.ts, inputs.ts, refresh.ts, dates.ts, types.ts  (+ *.test.ts)
/lib/chain                adapter.ts, solana.ts, mock.ts
/lib/integrations         rentcast.ts, plaid.ts, vision.ts, watchRegister.mock.ts
/data/params.json         parameter registry (source of truth for every number)
/data/demo                demo personas and watch price table (with source + date)
/scripts                  refresh-params.ts (FRED: SOFR, Freddie Mac PMMS), check-params.ts, check-product-terms.ts (propose only)
/docs/internal            PLAN.md, PROGRESS.md (Korean, gitignored)
THIRD_PARTY.md, .env.example
```

---

## 8. Money math (implement exactly; tests must pass)

### 8.1 HEI terms (real estate)
Inputs: home value `V`, net cash `C`, discount `d`, fee rate `phi`, cap `cap`.
- Gross investment `G = C / (1 - phi)`; fee `= G - C` (apply `hei_fee_min_usd` if larger).
- Unit = 1/1,000,000 of home value; unit value today `u = V / 1e6`; token price `p = u * (1 - d)`.
- Token supply `N = round(G / p)`; share of future value `s = N / 1e6`.
- Eligibility: `G <= hei_max_investment_pct_of_value * V`.

### 8.2 Settlement (years `t`, home value at settlement `Vt`)
- Uncapped payout `P0 = N * Vt / 1e6`; capped payout `P = min(P0, G * (1 + cap)^t)`.
- Homeowner effective annual cost `(P / C)^(1/t) - 1`; investor return `(P / G)^(1/t) - 1`.
- Settlement value: sale price, unless it is far below a recent appraisal (threshold TBD with owner) — then use the appraisal. For buyback/refinance/maturity: appraisal (simulated in demo).
- Triggers: owner buyback any time, sale, maturity, covenant breach (unpaid property tax/insurance).

### 8.3 Watch paths
- Dealer instant: `cash = value * [0.70, 0.90]`. Marketplace: `cash = value * (1 - 0.065)`. Loan: `cash = value * LTV(category)`, term 30–180 days.

### 8.4 Recommendation rules (deterministic; record which rules fired)
- RE-1: repayment horizon <= 3 years -> HELOC / home equity loan first.
- RE-2: monthly payment capacity below the HELOC interest-only payment, or loan denied -> HEI is a candidate.
- RE-3: age 62+ -> include reverse mortgage.
- W-1: cash needed within ~1 day and willing to sell -> dealer instant offer.
- W-2: can wait, wants the highest price -> marketplace.
- W-3: wants the watch back and horizon <= 180 days -> watch loan.
- X-1: if keep-constraints prevent one lane from reaching the goal -> propose combinations across lanes.

### 8.5 Test vectors (must match)
Real estate (`V=1,000,000`, `C=150,000`, `d=1/3`, `phi=0.039`, `cap=0.20`):

| Check | Expected |
|---|---|
| `G` | 156,087.41 |
| fee | 6,087.41 |
| `p` | 0.666667 |
| `N` | 234,131 |
| `s` | 23.41% |
| payout t=0.5, flat | 170,985 (capped); owner cost 29.9%/yr |
| payout t=1, flat | 187,305 (capped); owner cost 24.9%/yr |
| payout t=2, flat | 224,766 (capped); owner cost 22.4%/yr |
| payout t=3, flat | 234,131; owner cost 16.0%/yr; investor 14.5%/yr |
| payout t=3, +3%/yr (`Vt=1,092,727`) | 255,841; owner cost 19.5%/yr |
| payout t=10, flat | 234,131; owner cost 4.6%/yr |
| payout t=10, +3%/yr | 314,652; owner cost 7.7%/yr |
| cap binds until | 2.22 yrs (flat), 2.65 yrs (+3%/yr) |
| HELOC interest-only monthly at 7.09% on 150,000 | 886 |

Watches (need 30,000; A sport steel 25,000; B dress gold 15,000):

| Check | Expected |
|---|---|
| dealer, both | 28,000 – 36,000 |
| marketplace, both | 37,400 |
| loan, both (75% / 70%) | 29,250 (short 750) |
| keep A: loan on A + sell B to dealer | B must fetch >= 75.0% of value; at 80% total is 30,750 |

---

## 9. Data contracts (draft)

```ts
type Goal = { cashNeededUsd: number; neededBy: string; repayHorizonYears?: number;
  keepAssetIds: string[]; keepAssetNotes?: string[]; // notes = user's words until assets have IDs
  monthlyCapacityUsd?: number; age62Plus?: boolean };
// CaseFile (lib/agent/types.ts): { id, createdAt, stage, goal?, messages, pendingApproval, events }
type RealEstateAsset = { id: string; kind: 'real_estate'; addressRef: string; // PII stored off-chain
  avm?: { low: number; mid: number; high: number; source: string; asOf: string };
  mortgageBalanceUsd?: number; interiorNotes?: string };
type WatchAsset = { id: string; kind: 'watch'; model?: string; reference?: string; serialHash?: string;
  hasBox?: boolean; hasPapers?: boolean; category: 'sport_steel' | 'dress_gold' | 'specialty_vintage';
  marketValue?: { usd: number; source: string; asOf: string }; theftCheck: 'not_checked' | 'clear' | 'flagged' | 'simulated_clear' };
type PathOption = { id: string; lane: 'real_estate' | 'watch' | 'cross'; label: string; cashNowUsd: number;
  totalCostUsd?: number; effectiveAnnualCost?: number; monthlyPaymentUsd?: number; keepsAsset: boolean;
  timeToCash: string; risks: string[] };
type Recommendation = { chosenId: string; options: PathOption[]; rulesFired: string[];
  registryVersion: string; createdAt: string };
type AssetPassport = { assetId: string; kind: string; identifierHashes: Record<string, string>;
  evidenceHashes: string[]; valuation: unknown; approvals: { signer: string; at: string }[] };
type Receipt = { recommendationHash: string; passportHash: string; registryVersion: string; txId?: string };
```

---

## 10. Milestones (one at a time; wait for OK after each)

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold (Next.js, TypeScript, Tailwind), lint, `.env.example`, `.gitignore` (`.env*` except example, `node_modules/`, `.next/`, `docs/internal/`), `THIRD_PARTY.md` | `npm run dev` shows a page; `docs/internal/` not tracked |
| M1 | `/lib/calc` + unit tests | all §8.5 test vectors pass |
| M2 | `/lib/params` + staleness check + `scripts/refresh-params.ts` (FRED SOFR, Freddie Mac PMMS) | stale value blocks a recommendation in a test |
| M3 | Agent skeleton: Goal intake, CaseFile state, tool calling, approval gates (no chain yet) | a scripted conversation produces a `Goal` |
| M4 | Real estate inputs: RentCast (cache responses; free tier is 50 requests/month), Plaid sandbox or manual mortgage | address -> AVM range + owner match on demo data |
| M5 | Watch inputs: camera -> model/reference/box/papers; price table; simulated theft check | photo of a demo watch fills `WatchAsset` |
| M6 | Comparison + recommendation + term sheet + Asset Passport + receipt hash (off-chain) | demo persona gets the expected recommendation and rules |
| M7 | Solana devnet: receipt on-chain; HEI share mint (Token-2022: frozen-by-default accounts, KYC allowlist); watch 1-of-1 token after simulated vault intake | tx ids visible and verifiable in an explorer |
| M8 | Primary sale (devnet USDC or test token) + settlement script (capped payout, distribute, burn) | settlement of a demo case pays holders correctly |
| M9 | Polish: 3 demo personas, English README, demo + pitch videos, submission checklist | checklist complete |

---

## 11. Commands
Run from the repo root (`rwa-liquidity-agent/`). Requires Node.js 22.12+ for Vitest 5 (Next.js alone needs 20.9+); tested with Node 24, npm 11.

| Command | What it does |
|---|---|
| `npm install` | Install dependencies from `package-lock.json` |
| `npm run dev` | Dev server at http://localhost:3000 (Turbopack) |
| `npm test` | Unit tests once (Vitest); §8.5 test vectors live in `lib/calc/*.test.ts` |
| `npm run test:watch` | Unit tests in watch mode |
| `npm run params:check` | Freshness of every registry value today (or `-- YYYY-MM-DD`) |
| `npm run params:refresh` | Update market values from FRED (needs `FRED_API_KEY` in `.env.local`; `-- --dry-run` to preview) |
| `npm run agent:chat` | Chat with the agent in the terminal (Gemini; `-- "msg1" "msg2"` replays messages). Made-up personas for demos |
| `npm run lint` | ESLint (Next.js 16 `next build` no longer runs the linter) |
| `npm run build` | Production build, including the TypeScript type check |
| `npm start` | Serve the production build |

Stack: Next.js 16.3.8 (App Router, Turbopack), React 19.2, TypeScript 5.9, Tailwind CSS 4, ESLint 9, Vitest 5 (config `vitest.config.mts`), tsx 4 (runs `scripts/*.ts`), @google/genai 2 (Gemini API).

## 12. Definition of done
Public repo with OSS license; deployed demo; English README (problem, how it works, why blockchain, what is simulated, trust assumptions, how to run); demo and pitch videos per the Arena form; all members registered on colosseum.com; team leader submits in the Arena before the deadline.
