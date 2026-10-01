# rwa-liquidity-agent (working name)

A neutral AI agent for US users who need cash. It compares every way to turn a home or a
luxury watch into cash, including non-crypto options such as a HELOC, and connects the user
to the next step (including tokenization on Solana) only after explicit approval.

> Status: in development (milestone M1: money math with unit tests). The agent is not built yet.
>
> Not investment or financial advice.

## Run locally

Requires Node.js 22.12 or later (the test runner, Vitest 5, needs it).

```bash
npm install
cp .env.example .env.local   # fill in keys only when a milestone needs them
npm run dev                  # then open http://localhost:3000
```

## Checks

```bash
npm test        # unit tests for the money math (Vitest)
npm run lint    # ESLint
npm run build   # production build, includes the TypeScript type check
```

## Third-party code

See [THIRD_PARTY.md](THIRD_PARTY.md).
