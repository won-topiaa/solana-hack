// Placeholder home page (added in milestone M0).
// The chat-based agent replaces this page in M3.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <p className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        Working name: rwa-liquidity-agent
      </p>
      <h1 className="text-3xl font-semibold leading-tight">
        Find the cheapest way to turn your home or watch into cash.
      </h1>
      <p className="text-lg leading-8 text-zinc-600 dark:text-zinc-400">
        A neutral AI agent that compares every cash-out path, including
        non-crypto options, and tokenizes an asset only when that is actually
        the best option and you approve it.
      </p>
      <p className="rounded-md border border-zinc-200 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        Status: in development. The agent is not built yet.
      </p>
      <p className="text-xs text-zinc-500">Not investment or financial advice.</p>
    </main>
  );
}
