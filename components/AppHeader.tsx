// The top bar shared by both pages.

import Link from "next/link";
import { DevnetTag } from "./ui";

export function AppHeader() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-semibold">
            rwa-liquidity-agent
          </Link>
          <span className="text-xs text-zinc-500">working name</span>
          <DevnetTag />
        </div>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="hover:underline">
            Agent
          </Link>
          <Link href="/partner" className="hover:underline">
            Partner &amp; investors
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="mx-auto max-w-7xl px-4 py-6 text-xs text-zinc-500">
      Not investment or financial advice. A hackathon demo on Solana devnet: tokens and test dollars have no value. Partners (issuer, vault, KYC, appraisal,
      stolen-watch registry) are simulated and marked as such.
    </footer>
  );
}
