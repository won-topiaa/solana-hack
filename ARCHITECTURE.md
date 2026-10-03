# Architecture

How Ownflow is put together, which rules the code keeps, and where each rule is enforced and
tested. For what the product does and how to run it, see the [README](README.md).

## The shape in one picture

```
Browser ──────────────────────────────────────────────────────────────────────────────
  components/AgentApp, ChatPanel, CasePanel, PartnerConsole, WalletBar
  keeps: the sealed case token + a readable view (sessionStorage); signs with the user's wallet
        │  one action per request: { token, message | approval | signature | scenario }
        ▼
app/api/*/route.ts ── lib/web/server.ts (server-only: services once per process, JSON errors)
        │
lib/web/handlers.ts   open the token → one step → seal the new case → view for the browser
        │
        ├── lib/agent/orchestrator.ts   model loop: offers only the current stage's tools,
        │        │                     stops at any tool that needs approval
        │        ├── lib/agent/llm.ts + gemini.ts     the model: talks, calls tools, reads photos
        │        └── lib/agent/tools/                 plain-code tools, one file per step
        │                 ├── lib/recommend/  paths, rules, term sheet, passports, receipt
        │                 │      └── lib/calc/      pure money math (no I/O)
        │                 │      └── lib/params/    registry + freshness gate
        │                 ├── lib/integrations/  RentCast, Plaid, Gemini vision, simulated checks
        │                 └── lib/chain/adapter.ts  ChainService (devnet, or a fake in tests)
        │
        └── lib/chain/heiLifecycle.ts   partner steps: KYC, closing, primary sale, settlement
                 └── lib/chain/*         @solana/kit + Token-2022, Memo, System, SAS
```

Dependencies point down. `lib/calc` imports nothing from the rest of the app; `lib/recommend`
does not know about the agent or the web; `lib/agent` does not know about HTTP; only
`lib/web/server.ts` and `app/api` touch requests.

## A request, end to end

1. The browser posts the sealed case token with one action (`app/api/case/message`, `.../approval`,
   `.../sign`, `.../wallet`, `app/api/hei/sale`, `app/api/hei/settlement`).
2. `lib/web/server.ts` builds the services once per process (`lib/agent/services.ts`) and wraps
   the handler: bad input becomes a 400, a missing setting a 503 that names the setting (never its
   value), and any other error a 500 with a plain sentence (the devnet routes pass on the chain
   error, which carries only transaction ids and addresses).
3. `lib/web/handlers.ts` opens the token (`lib/web/caseToken.ts`), checks the case limits (40
   messages, 6 photos), runs exactly one step, and seals the new case.
4. The answer is `{ token, view }`. The view (`lib/web/view.ts`) is everything the page shows,
   already formatted by code, with no personal data. Chart numbers come from `lib/web/charts.ts`.

The server keeps no case between requests. The token is AES-256-GCM over gzipped JSON with a key
derived from `CASE_SECRET`, so the browser can neither read the personal data in it nor change a
recommendation, an approval or an on-chain record.

## The agent loop

`lib/agent/orchestrator.ts` sends the conversation to the model with the tools of the current
stage only (`goal → capture → compare → prepare → execute`), runs the tools the model asks for,
and returns. Tools are in `lib/agent/tools/`:

| File | Tools | Stage it moves the case to |
|---|---|---|
| `goal.ts` | `record_goal`, `set_keep_assets` | `capture` |
| `home.ts` | `lookup_home`, `record_mortgage`, `connect_mortgage_account` (approval) | |
| `watch.ts` | `read_watch_photos`, `record_watch`, `check_watch_registry` (approval) | |
| `documents.ts` | `compare_paths`, `prepare_documents` | `compare`, `prepare` |
| `onchain.ts` | `record_receipt_onchain`, `issue_hei_shares`, `issue_watch_token` (all approval) | `execute` |
| `shared.ts` | the tool shape, editable stages, the PII store, "documents changed" checks | |

A tool with `requiresApproval` is never run by the loop. The loop saves it as `pendingApproval`
with a code-written sentence and stops; it runs only from `resolveApproval` after the user's yes
(and, with the user's own wallet, the user's signature). Safety limits: 6 model calls per turn and
4 tool calls per model reply.

The model never produces a number the user sees. Tools return finished text built by
`lib/format.ts`; the system prompt carries a code-made summary of the case; in the web chat,
`withoutFigures` masks any amount or rate the model writes anyway.

## Where the numbers come from

```
data/params.json ──► lib/params (load, freshness gate) ──► lib/calc (pure math)
                                                             │
                     lib/recommend (paths, rules RE-1..X-1, term sheet) ◄┘
                                     │
                     lib/agent/tools (finished text) + lib/web/view, charts (panel)
```

- Every value in the registry has a kind (`market`, `product`, `design`, `reference`), a source and
  a date. `checkParamsFresh` blocks a recommendation when a value it used is stale; on Vercel the
  check runs on one frozen date (`REGISTRY_FROZEN_ON`) and the page says so.
- `lib/calc` holds the money math of CLAUDE.md §8 as small pure functions; the worked examples
  there are the unit tests (`lib/calc/*.test.ts`).
- The recommendation, the passports and the receipt are hashed as canonical JSON
  (`lib/recommend/canonical.ts`); identifiers in passports are keyed hashes whose key stays in
  the sealed case.

## On-chain layer

`ChainService` (`lib/chain/adapter.ts`) is the only way the agent touches a chain;
`lib/chain/devnet.ts` implements it on Solana devnet and `lib/chain/fake.ts` in tests. The partner
steps (`lib/chain/heiLifecycle.ts`) are used by both the web handlers and `scripts/chain-hei.ts`.

| File | What it does |
|---|---|
| `solana.ts` | RPC with retries, send and confirm, mints (Token-2022 extensions), once-only helpers |
| `kyc.ts` | Solana Attestation Service: credential, schema, attestation, and the on-chain check |
| `heiSale.ts` | closing payment and delivery-against-payment purchases |
| `heiSettlement.ts` | the HEI's settlement account and pay-and-burn batches |
| `payment.ts` | the devnet test dollar (DUSD) |
| `userWallet.ts` | transactions the user's wallet signs, the wallet proof, reading a payment back |

Every step can run again without doing anything twice:

- **One token per receipt.** Mint addresses are derived from the issuer's signature over the
  receipt hashes (`issuerDerivedSigner`), so a retry finds the mint it already made.
- **Once-only payments.** The closing payment and the demo homeowner's payment create a marker
  account "with seed" (`onceMarker`); a second attempt fails on-chain.
- **Settlement is final.** Holders are paid from the HEI's settlement account and burned in the
  same transaction; it refuses unless the holders hold the whole supply, and refuses once the
  supply is 0. A lost answer is rebuilt from the payout transactions' memos.

With the user's own wallet the server builds the transaction, the wallet signs it in the browser
(`components/wallet.ts`), the server sends it and then reads the confirmed transaction back
(memo, signers, token changes per account) before it records anything.

## Invariants and the tests that hold them

| Invariant | Enforced in | Tested in |
|---|---|---|
| Money math matches the worked examples (CLAUDE.md §8.5, §8.7) | `lib/calc` | `lib/calc/*.test.ts`, `lib/recommend/receipt.test.ts` |
| Each demo persona gets the expected path and rules | `lib/recommend` | `lib/recommend/personas.test.ts` |
| A stale registry value blocks the recommendation that used it | `lib/params/staleness.ts` | `lib/params/staleness.test.ts` |
| A gated tool never runs before approval, and runs once | `lib/agent/orchestrator.ts` | `lib/agent/orchestrator.test.ts` |
| Only the current stage's tools are offered | `lib/agent/orchestrator.ts`, tool `stages` | `lib/agent/orchestrator.test.ts` |
| Changed inputs never put old documents on-chain | `documentsChanged` in `lib/agent/tools/shared.ts` | `lib/agent/chain.test.ts` |
| No personal data on-chain or in the receipt | `lib/recommend/passport.ts`, `lib/chain/devnet.ts` | `lib/agent/chain.test.ts`, `lib/recommend/receipt.test.ts` |
| The browser cannot read or change the case | `lib/web/caseToken.ts` | `lib/web/caseToken.test.ts` |
| No model-written figure reaches the page | `withoutFigures` in `lib/web/view.ts` | `lib/web/view.test.ts` |
| The wallet is proven by a signature and fixed once anything is on-chain | `lib/web/handlers.ts`, `lib/chain/userWallet.ts` | `lib/web/wallet.test.ts`, `lib/chain/userWallet.test.ts` |
| Purchases are delivery against payment; settlement pays before it burns | `lib/chain/heiSale.ts`, `lib/chain/heiSettlement.ts` | `lib/chain/heiMarket.test.ts` |
| Once-only addresses are deterministic per issuer and label | `lib/chain/solana.ts` | `lib/chain/solana.test.ts` |

## Trust boundaries

| Party | Trusted with | Not trusted with |
|---|---|---|
| Browser | carrying the sealed token, signing with the user's wallet | the case contents, any number, any approval it did not sign |
| Model (Gemini) | conversation, choosing tools, reading photos | numbers, hashes, links, running a gated tool |
| Server | building transactions, the issuer and demo wallets, `CASE_SECRET` | a signed transaction it has not read back from the chain |
| Issuer (simulated partner) | freeze authority (KYC), permanent delegate (settlement burns), KYC attestations | the code only burns in the same transaction as the payment |
| Registry (`data/params.json`) | every market, product and design value | values past their validity window (blocked) |

Personal data (addresses, names, serial numbers, photos) stays in the sealed case and never goes
to logs, to the chain or to the model in tool output.

## Quality gates

`npm run check` runs ESLint, the TypeScript check (`strict`, plus no unused locals or parameters,
no implicit returns, no switch fallthrough) and the unit tests. GitHub Actions
(`.github/workflows/ci.yml`) runs the same and a production build on every push and pull request.
The tests run offline: the chain, the model and the data sources are replaced by fakes, and the
devnet scripts (`npm run chain:demo`, `npm run chain:hei`) cover the real network.
