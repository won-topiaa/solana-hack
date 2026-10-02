// The top bar and the footer shared by both pages.

import Link from "next/link";
import { DevnetTag } from "./ui";

/** Ownflow's mark: a ring with a dot flowing out of it (drawn for this project). */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="12" r="7.5" stroke="white" strokeWidth="2.5" />
      <circle cx="19.5" cy="12" r="2.5" fill="white" />
    </svg>
  );
}

export function AppHeader() {
  return (
    <header className="w-full">
      <div className="mx-auto flex h-16 max-w-[1392px] items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-[-0.4px] text-white">
            <Mark />
            Ownflow
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-neutral-400 sm:flex">
            <Link href="/" className="transition hover:text-white">
              Agent
            </Link>
            <Link href="/partner" className="transition hover:text-white">
              Partner &amp; investors
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex">
            <DevnetTag />
          </span>
          <Link href="/" className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition hover:bg-neutral-200">
            Open the agent
          </Link>
        </div>
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1136px] px-6 py-12 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="max-w-md space-y-2">
          <p className="flex items-center gap-2 font-semibold text-white">
            <Mark />
            Ownflow
          </p>
          <p className="text-neutral-500">Cash flow from what you own. A neutral agent that compares every way to raise cash, and tokenizes only when you approve.</p>
        </div>
        <div className="grid grid-cols-2 gap-12">
          <div className="space-y-3">
            <p className="font-medium text-neutral-200">Product</p>
            <Link href="/" className="block text-neutral-400 hover:text-white">
              Agent
            </Link>
            <Link href="/partner" className="block text-neutral-400 hover:text-white">
              Partner &amp; investors
            </Link>
            <Link href="/privacy" className="block text-neutral-400 hover:text-white">
              Privacy
            </Link>
          </div>
          <div className="space-y-3">
            <p className="font-medium text-neutral-200">Network</p>
            <p className="text-neutral-400">Solana devnet</p>
            <p className="text-neutral-400">Token-2022</p>
          </div>
        </div>
      </div>
      <p className="mt-10 border-t border-neutral-900 pt-6 text-xs leading-relaxed text-neutral-500">
        Not investment or financial advice. A demo on Solana devnet: tokens and test dollars have no value. Partners (issuer, vault, KYC, appraisal, stolen-watch
        registry) are simulated and marked as such. Use made-up details.
      </p>
    </footer>
  );
}
