"use client";

// The partner and investor page: what happens to an issued HEI after the homeowner's
// part. The partner (simulated) pays the homeowner at closing and sells the shares to
// KYC-approved investors; later the HEI settles and each holder is paid and burned.
// It opens the case the agent page stored in this tab.

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { callApi, caseSnapshot, parseCase, serverCaseSnapshot, storeCase, subscribeCase } from "./caseStore";
import { DevnetTag, ExternalLink, Lines, Section, SimulatedTag } from "./ui";

/** Ready-made settlement cases; the first shows the yearly cap, the second the share of growth. */
const SCENARIOS = [
  { id: "buyback-2", label: "Buyback after 2 years, prices flat (the yearly cap applies)", years: 2, growth: 0 },
  { id: "maturity-10", label: "Maturity after 10 years, prices up 3% a year", years: 10, growth: 0.03 },
] as const;

export function PartnerConsole() {
  const raw = useSyncExternalStore(subscribeCase, caseSnapshot, serverCaseSnapshot);
  const current = useMemo(() => parseCase(raw), [raw]);
  const [scenario, setScenario] = useState<string>(SCENARIOS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hei = current?.view.hei;

  async function run(label: string, path: string, body: Record<string, unknown>) {
    if (!current) return;
    setBusy(label);
    setError(null);
    try {
      storeCase(await callApi(path, { token: current.token, ...body }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  if (!current || !hei) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 px-4 py-12">
        <h1 className="text-2xl font-semibold">Partner &amp; investors</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          This page continues an HEI after its share tokens are issued. On the{" "}
          <Link href="/" className="text-violet-700 underline dark:text-violet-300">
            agent page
          </Link>
          , load persona B, compare, prepare the documents, record the receipt and issue the HEI share tokens; then come back here in the same tab.
        </p>
      </div>
    );
  }

  const chosen = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0];
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Partner &amp; investors</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The agent is a connector; a licensed partner would issue the HEI and run these steps. Here the app plays the partner on Solana devnet, pays in test dollars
          (DUSD) with no value, and simulates KYC, the appraisal and the passing years.
        </p>
      </div>
      {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {busy && (
        <p className="flex items-center gap-2 text-sm text-zinc-500" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
          {busy}
        </p>
      )}

      <Section title="1. Closing and primary sale" aside={<DevnetTag />}>
        {hei.sale ? (
          <>
            <Lines lines={hei.sale.lines} />
            <ul className="mt-3 space-y-1 text-sm">
              {hei.sale.links.map((link) => (
                <li key={link.url}>
                  <ExternalLink href={link.url}>{link.label}</ExternalLink>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
              <li>
                The partner pays the homeowner the net cash at closing, from its own money. <SimulatedTag />
              </li>
              <li>
                Two investors pass KYC and their share accounts are opened; a third has no KYC and stays frozen. <SimulatedTag label="Simulated KYC" />
              </li>
              <li>Each purchase moves the investor&apos;s dollars and the shares in one transaction. The buyer without KYC is refused by the token itself.</li>
            </ul>
            <button
              type="button"
              disabled={Boolean(busy) || !hei.canSell}
              onClick={() => {
                if (window.confirm("Run the closing payment and the primary sale on Solana devnet? About ten transactions.")) {
                  void run("Running the closing and the sale on devnet (about ten transactions, up to two minutes)…", "/api/hei/sale", {});
                }
              }}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Run the closing and the sale
            </button>
          </>
        )}
      </Section>

      <Section title="2. Settlement" aside={<DevnetTag />}>
        {hei.settlement ? (
          <>
            <p className={`mb-2 text-sm font-medium ${hei.settlement.correct ? "text-emerald-700 dark:text-emerald-400" : "text-red-700"}`}>
              {hei.settlement.correct ? "Checked on-chain: every holder was paid its share and every share is burned." : "The on-chain check failed."}
            </p>
            <Lines lines={hei.settlement.lines} />
            <ul className="mt-3 space-y-1 text-sm">
              {hei.settlement.links.map((link) => (
                <li key={link.url}>
                  <ExternalLink href={link.url}>{link.label}</ExternalLink>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
              The homeowner pays the capped payout; in the same transaction each holder receives its share and the issuer burns that holder&apos;s tokens. No time
              passes on devnet: pick when and at what value the HEI settles. <SimulatedTag label="Simulated time and appraisal" />
            </p>
            <fieldset className="mb-3 space-y-2 text-sm" disabled={!hei.canSettle || Boolean(busy)}>
              {SCENARIOS.filter((item) => item.years <= hei.termYears).map((item) => (
                <label key={item.id} className="flex items-center gap-2">
                  <input type="radio" name="scenario" value={item.id} checked={scenario === item.id} onChange={() => setScenario(item.id)} />
                  {item.label}
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              disabled={Boolean(busy) || !hei.canSettle}
              onClick={() => {
                if (window.confirm(`Settle on Solana devnet: ${chosen.label}? The homeowner's demo wallet pays and the shares are burned.`)) {
                  void run("Settling on devnet: paying holders and burning shares…", "/api/hei/settlement", { years: chosen.years, growth: chosen.growth });
                }
              }}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              Settle
            </button>
            {!hei.canSettle && <p className="mt-2 text-xs text-zinc-500">Run the sale first.</p>}
          </>
        )}
      </Section>
    </div>
  );
}
