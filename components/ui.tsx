// Small building blocks shared by the pages.

import type { ReactNode } from "react";

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Marks a step that a real partner would do and the demo only pretends to (CLAUDE.md §1). */
export function SimulatedTag({ label = "Simulated" }: { label?: string }) {
  return (
    <span className="inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
      {label}
    </span>
  );
}

export function DevnetTag() {
  return (
    <span className="inline-block rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-300">
      Solana devnet
    </span>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-violet-700 underline underline-offset-2 hover:text-violet-900 dark:text-violet-300">
      {children}
    </a>
  );
}

/** A long hash: shortened on screen, whole in the tooltip and when copied. */
export function Hash({ value }: { value: string }) {
  return (
    <code title={value} className="break-all rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value}
    </code>
  );
}

export function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}
