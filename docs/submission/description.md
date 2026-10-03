# Ownflow: product description (Colosseum Crypto World's Fair, Solana track)

Text for the Arena submission form. Every claim below matches the code in this repository and the
live demo on Solana devnet.

## Name

Ownflow

## Tagline

Cash flow from what you own.

## One-line description

A neutral AI agent that finds the cheapest way to turn your home or watch into cash, and, when
tokenizing wins, lets an individual supply that asset to the tokenization market on Solana.

## Short description (about 300 characters)

Ownflow compares every way a US homeowner or watch owner can raise cash (HELOC, home equity loan,
home equity investment, sale, watch loan) by fixed rules. When tokenizing wins, it is the bridge that
lets an individual supply a home or watch to the tokenization market: KYC-gated tokens on Solana.

## Full description

### The problem we set out to solve

- **Nobody compares the options for you.** A homeowner who needs cash can take a HELOC, a home
  equity loan or a home equity investment (HEI); a watch owner can sell to a dealer, sell on a
  marketplace or borrow. Each seller pitches its own product. About half of US mortgages carry a rate
  below 4% while a new 30-year loan averages over 7% (FHFA, Freddie Mac, 2026), so owners borrow
  behind their mortgage instead of refinancing, and the choice between these products is the decision
  that matters.
- **HEI costs are hard to see.** What you pay back depends on when you settle and how prices move,
  so the yearly cost can be low or very high, and it looks nothing like a loan's APR. The CFPB found
  that under many contracts the amount owed "grows at a rate of 19.5-22% per year in the early years",
  while companies often call them "not a loan".
- **Individuals cannot reach the tokenization market as suppliers.** Tokenization is growing fast,
  but it is built by and for institutions (BlackRock's tokenized fund BUIDL has a $5 million
  minimum), and issuing a token takes legal structuring, KYC, a buyer base and settlement that an
  individual cannot set up. A homeowner or watch owner has no way to offer their asset to that market directly.
- **A token alone does not create cash.** Someone must buy it, only eligible buyers should hold it,
  and the payout at the end must be fair and final.

### What Ownflow does

Ownflow is a neutral agent, not a lender or issuer. The user states an amount, a date and a monthly
budget. Ownflow values the home (property data) or reads watch photos, then compares every path side
by side: cash now, monthly payment, total cost over the horizon, and whether the asset is kept.
The recommendation follows fixed rules (for example: repaying within three years means a HELOC
first; no monthly budget means an HEI). The model (Google Gemini) only talks and reads photos; every
number comes from tested code and a dated parameter registry, and the web chat never shows a
model-written figure.

When tokenizing is the best path, Ownflow is the **bridge between an individual's asset and the
tokenization market**. The owner does not need to know anything about tokens: the agent prepares the
documents (a term sheet, an asset passport with hashed identifiers, a recommendation receipt), a
licensed partner issues and services the token, and the rails below make it safe for investors to
buy. An individual becomes a supplier of tokenized real-world assets, and investors get fractional
access (one HEI share is one millionth of a home's value, about $0.67 for a $1M home) instead of
institutional minimums.

On Solana, each step runs only after the user approves:

- **A verifiable receipt.** A memo with the hashes of the recommendation and asset passports and the
  registry version, signed by the user's own Phantom wallet (or a demo wallet).
- **Compliance in the token.** HEI shares are a Token-2022 mint whose accounts start frozen. An
  investor's account opens only after its KYC attestation (Solana Attestation Service, behind
  Plaid's identity verification sandbox) is read from the chain and checked. A buyer without one is
  refused by the token program.
- **Delivery against payment.** Each purchase moves dollars and shares in one transaction.
- **Pay and burn.** At settlement the homeowner pays into the HEI's settlement account; each holder
  is paid its share and its tokens are burned in the same transaction. Supply is fixed and the
  metadata (hashes) is locked.
- **Watches.** After a (simulated) vault intake, a 1-of-1 token goes to the owner's wallet.

The case panel turns the comparison into charts: cash against the goal, monthly payment against the
budget, total cost, and the HEI's payback by settlement year with its 20% yearly cap. The settlement
demo values the home with the real FHFA house price index.

Simulated and labeled in the app: the partners (HEI issuer, vault), the appraisal and the passing
years, the stolen-watch registry, and the money behind payments (a devnet test dollar). Every on-chain
step is real on devnet and can be checked on Solana Explorer.

## Chains and tools

- Solana devnet: Token-2022 (DefaultAccountState, PermanentDelegate, MetadataPointer and
  TokenMetadata), Memo, System; Solana Attestation Service (KYC attestations)
- @solana/kit 8, @solana-program clients, @solana/kit-plugin-wallet (Phantom and other Wallet
  Standard wallets), sas-lib
- Google Gemini API (conversation, tool calling, reading photos)
- Plaid sandbox (mortgage data, identity verification), RentCast (property data), FRED (rates and the
  FHFA house price index)
- Next.js 16, React 19, TypeScript, Tailwind CSS, Vitest (300+ unit tests), Vercel

## Links

- Live demo (Solana devnet): https://solana-hack.vercel.app
- Source (MIT): https://github.com/won-topiaa/solana-hack
- Logo: `docs/submission/ownflow-logo.png` (square), `docs/submission/ownflow-logo-wide.png`

Not investment or financial advice. A demo on Solana devnet; tokens and test dollars have no value.
