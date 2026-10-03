// Small building blocks shared by the pages: a framed page column, bordered blocks,
// pill buttons and badges, avatars and icon boxes. Dark theme: black page, neutral
// greys, white primary actions. Icons: lucide-react (ISC).

import { Bot, ChevronRight, ExternalLink as ExternalIcon, User } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** The page column framed by thin vertical lines; blocks inside are split by horizontal lines. */
export function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1136px] border-x border-neutral-800 ${className}`}>{children}</div>;
}

/** A titled block inside a column, with a line under it. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="border-b border-neutral-800 px-6 py-6 last:border-b-0">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.2px] text-neutral-100">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { arrow?: boolean };

/** White pill: the main action. */
export function PrimaryButton({ arrow, children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
      {arrow && <ChevronRight size={16} strokeWidth={2} />}
    </button>
  );
}

/** Dark pill with a thin border: a secondary action. */
export function SecondaryButton({ arrow, children, className = "", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-5 py-2.5 text-sm font-medium text-neutral-200 transition hover:border-neutral-700 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
      {arrow && <ChevronRight size={16} strokeWidth={2} />}
    </button>
  );
}

/** A small bordered pill, e.g. "Live on Solana devnet". */
export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-950 px-3.5 py-1.5 text-sm text-neutral-200 ${className}`}>
      {children}
    </span>
  );
}

/** Marks a step that a real partner would do and the demo only pretends to (CLAUDE.md §1). */
export function SimulatedTag({ label = "Simulated" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-300">
      {label}
    </span>
  );
}

export function DevnetTag() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-violet-300">
      <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
      Solana devnet
    </span>
  );
}

/** A long hash: shortened on screen, whole in the tooltip. */
export function Hash({ value }: { value: string }) {
  return (
    <code title={value} className="break-all rounded-md border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 font-mono text-xs text-neutral-300">
      {value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value}
    </code>
  );
}

export function Lines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1.5 text-sm leading-relaxed text-neutral-400">
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );
}

/** A rounded square with a line icon, as in a feature list. */
export function IconBox({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-neutral-200">{children}</span>;
}

/** The round avatar next to a chat message. */
export function Avatar({ who }: { who: "user" | "agent" }) {
  return (
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-300">
      {who === "user" ? <User size={17} strokeWidth={1.75} /> : <Bot size={17} strokeWidth={1.75} />}
    </span>
  );
}

/** A record on Solana: icon, label, and a "View on Explorer" button, like a transaction card. */
export function ChainRecord({ icon, label, detail, url }: { icon: ReactNode; label: string; detail?: string; url: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
      <IconBox>{icon}</IconBox>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-neutral-100">{label}</p>
        {detail && <p className="truncate text-xs text-neutral-500">{detail}</p>}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-700 hover:bg-neutral-900"
      >
        View on Explorer
        <ExternalIcon size={12} />
      </a>
    </div>
  );
}

/** A red notice for a failed request. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{children}</p>;
}
