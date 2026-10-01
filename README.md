# rwa-liquidity-agent (working name)

A neutral AI agent for US users who need cash. It compares every way to turn a home or a
luxury watch into cash, including non-crypto options such as a HELOC, and connects the user
to the next step (including tokenization on Solana) only after explicit approval.

> Status: in development (milestone M6: in a terminal chat the agent takes the cash goal and the assets, compares every path, recommends one with fixed rules, and prepares the term sheet, asset passports and a hashed recommendation receipt).
>
> Not investment or financial advice.

## Run locally

Requires Node.js 22.12 or later (the test runner, Vitest 5, needs it).

```bash
npm install
cp .env.example .env.local   # fill in keys only when a milestone needs them
npm run dev                  # then open http://localhost:3000
```

## Try the agent (terminal)

Needs `GEMINI_API_KEY` in `.env.local` (paid tier). Use made-up personas in demos. With `RENTCAST_API_KEY` the home lookup uses RentCast; without it, or with `PROPERTY_DATA_SOURCE=demo`, it uses the made-up homes in `data/demo/properties.json` (try "742 Demo Lane, Exampleville, CA 99999", title name "Jordan Sample").

```bash
npm run agent:chat
```

To add a watch photo during the chat, type `/photo path/to/photo.jpg`. Try the made-up warranty card:
`/photo data/demo/watch-photos/demo-warranty-card.png`. The demo price table in
`data/demo/watch-prices.json` knows the made-up references `DEMO-300` and `DEMO-38G`.

## Checks

```bash
npm test        # unit tests (Vitest)
npm run params:check     # how fresh each value in data/params.json is today
npm run lint    # ESLint
npm run build   # production build, includes the TypeScript type check
```

## Data sources

This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
Mortgage rate averages: source Freddie Mac Primary Mortgage Market Survey. SOFR: Federal Reserve Bank
of New York; see [THIRD_PARTY.md](THIRD_PARTY.md) for the full notices and terms of use.

## Third-party code

See [THIRD_PARTY.md](THIRD_PARTY.md).
