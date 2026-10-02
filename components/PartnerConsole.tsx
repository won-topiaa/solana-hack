"use client";

// The partner and investor page: what happens to an issued HEI after the homeowner's
// part. The partner (simulated) pays the homeowner at closing and sells the shares to
// KYC-approved investors; later the HEI settles and each holder is paid and burned.
// It opens the case the agent page stored in this tab.

import { ArrowRightLeft, CircleCheck, Flame, Landmark, ShieldCheck, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { callApi, caseSnapshot, parseCase, serverCaseSnapshot, storeCase, subscribeCase } from "./caseStore";
import { ChainRecord, DevnetTag, ErrorNote, Frame, IconBox, Lines, PrimaryButton, SimulatedTag } from "./ui";

/** Ready-made settlement cases; the first shows the yearly cap, the second the share of growth. */
const SCENARIOS = [
  { id: "buyback-2", label: "Buyback after 2 years, prices flat", note: "The 20% a year cap applies", years: 2, growth: 0 },
  { id: "maturity-10", label: "Maturity after 10 years, prices up 3% a year", note: "Holders get their share of the growth", years: 10, growth: 0.03 },
] as const;

function linkIcon(label: string): ReactNode {
  if (label.startsWith("Closing")) return <Landmark size={18} strokeWidth={1.75} />;
  if (label.includes("purchase")) return <ArrowRightLeft size={18} strokeWidth={1.75} />;
  if (label.includes("without KYC")) return <ShieldCheck size={18} strokeWidth={1.75} />;
  if (label.startsWith("Settlement")) return <Flame size={18} strokeWidth={1.75} />;
  return <Wallet size={18} strokeWidth={1.75} />;
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="border-b border-neutral-800 px-6 py-8 last:border-b-0 sm:px-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 text-xl font-semibold tracking-[-0.5px] text-neutral-100">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-neutral-800 text-sm text-neutral-400">{number}</span>
          {title}
        </h2>
        <DevnetTag />
      </div>
      {children}
    </section>
  );
}

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

  const header = (
    <div className="border-b border-neutral-800 px-6 py-14 text-center sm:px-10">
      <h1 className="text-[40px] font-semibold tracking-[-2px] text-neutral-100">Partner &amp; investors</h1>
      <p className="mx-auto mt-3 max-w-[640px] text-neutral-400">
        Ownflow is a connector; a licensed partner would issue the HEI and run these steps. Here the app plays the partner on Solana devnet, pays in test dollars
        (DUSD) with no value, and simulates KYC, the appraisal and the passing years.
      </p>
    </div>
  );

  if (!current || !hei) {
    return (
      <Frame className="border-t">
        {header}
        <div className="px-6 py-12 text-center text-neutral-400 sm:px-10">
          <p>This page continues an HEI after its share tokens are issued.</p>
          <p className="mt-2">
            On the{" "}
            <Link href="/" className="text-neutral-100 underline decoration-neutral-600 underline-offset-4">
              agent page
            </Link>
            , load persona B, compare, prepare the documents, record the receipt and issue the HEI share tokens; then come back here in the same tab.
          </p>
        </div>
      </Frame>
    );
  }

  const chosen = SCENARIOS.find((item) => item.id === scenario) ?? SCENARIOS[0];
  return (
    <Frame className="border-t">
      {header}
      {(error || busy) && (
        <div className="space-y-3 border-b border-neutral-800 px-6 py-4 sm:px-10">
          {error && <ErrorNote>{error}</ErrorNote>}
          {busy && (
            <p className="animate-pulse text-sm text-neutral-400" role="status">
              {busy}
            </p>
          )}
        </div>
      )}

      <Step number={1} title="Closing and primary sale">
        {hei.sale ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Lines lines={hei.sale.lines} />
            <div className="space-y-2.5">
              {hei.sale.links.map((link) => (
                <ChainRecord key={link.url} icon={linkIcon(link.label)} label={link.label} url={link.url} />
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-px overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-800 sm:grid-cols-3">
              {[
                { icon: <Landmark size={18} strokeWidth={1.75} />, title: "Closing", text: "The partner pays the homeowner the net cash, from its own money.", tag: <SimulatedTag /> },
                { icon: <ShieldCheck size={18} strokeWidth={1.75} />, title: "KYC", text: "Two investors pass and their share accounts open; a third stays frozen.", tag: <SimulatedTag label="Simulated KYC" /> },
                { icon: <ArrowRightLeft size={18} strokeWidth={1.75} />, title: "Purchases", text: "Dollars and shares move in one transaction; the buyer without KYC is refused by the token.", tag: null },
              ].map((item) => (
                <div key={item.title} className="space-y-3 bg-black p-5">
                  <IconBox>{item.icon}</IconBox>
                  <p className="font-medium text-neutral-100">{item.title}</p>
                  <p className="text-sm leading-relaxed text-neutral-400">{item.text}</p>
                  {item.tag}
                </div>
              ))}
            </div>
            <div className="mt-6">
              <PrimaryButton
                arrow
                disabled={Boolean(busy) || !hei.canSell}
                onClick={() => {
                  if (window.confirm("Run the closing payment and the primary sale on Solana devnet? About ten transactions.")) {
                    void run("Running the closing and the sale on devnet (about ten transactions, up to two minutes)..", "/api/hei/sale", {});
                  }
                }}
              >
                Run the closing and the sale
              </PrimaryButton>
            </div>
          </>
        )}
      </Step>

      <Step number={2} title="Settlement">
        {hei.settlement ? (
          <>
            <p
              className={`mb-5 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm ${hei.settlement.correct ? "border-violet-500/30 bg-violet-500/10 text-violet-200" : "border-red-500/30 bg-red-500/10 text-red-300"}`}
            >
              {hei.settlement.correct ? <CircleCheck size={16} /> : <TriangleAlert size={16} />}
              {hei.settlement.correct ? "Checked on-chain: every holder was paid its share and every share is burned." : "The on-chain check failed."}
            </p>
            <div className="grid gap-6 lg:grid-cols-2">
              <Lines lines={hei.settlement.lines} />
              <div className="space-y-2.5">
                {hei.settlement.links.map((link) => (
                  <ChainRecord key={link.url} icon={linkIcon(link.label)} label={link.label} url={link.url} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="mb-5 max-w-[720px] text-sm leading-relaxed text-neutral-400">
              The homeowner pays the capped payout; in the same transaction each holder receives its share and the issuer burns that holder&apos;s tokens. No time
              passes on devnet: pick when and at what value the HEI settles. <SimulatedTag label="Simulated time and appraisal" />
            </p>
            <fieldset className="mb-6 grid gap-3 sm:grid-cols-2" disabled={!hei.canSettle || Boolean(busy)}>
              {SCENARIOS.filter((item) => item.years <= hei.termYears).map((item) => (
                <label
                  key={item.id}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${scenario === item.id ? "border-neutral-500 bg-neutral-900" : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"}`}
                >
                  <input type="radio" name="scenario" value={item.id} checked={scenario === item.id} onChange={() => setScenario(item.id)} className="sr-only" />
                  <span className="block text-sm font-medium text-neutral-100">{item.label}</span>
                  <span className="mt-1 block text-xs text-neutral-500">{item.note}</span>
                </label>
              ))}
            </fieldset>
            <PrimaryButton
              arrow
              disabled={Boolean(busy) || !hei.canSettle}
              onClick={() => {
                if (window.confirm(`Settle on Solana devnet: ${chosen.label}? The homeowner's demo wallet pays and the shares are burned.`)) {
                  void run("Settling on devnet: paying holders and burning shares..", "/api/hei/settlement", { years: chosen.years, growth: chosen.growth });
                }
              }}
            >
              Settle
            </PrimaryButton>
            {!hei.canSettle && <p className="mt-3 text-xs text-neutral-500">Run the sale first.</p>}
          </>
        )}
      </Step>
    </Frame>
  );
}
