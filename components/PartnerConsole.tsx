"use client";

// The partner and investor page: what happens to an issued HEI after the homeowner's
// part. The partner (simulated) pays the homeowner at closing and sells the shares to
// KYC-approved investors; later the HEI settles and each holder is paid and burned.
// It opens the case the agent page stored in this tab.

import { ArrowRightLeft, CircleCheck, Flame, Landmark, ShieldCheck, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { callApi, caseSnapshot, parseCase, postJson, serverCaseSnapshot, storeCase, subscribeCase, type CaseReplyJson } from "./caseStore";
import { ChainRecord, DevnetTag, ErrorNote, Frame, IconBox, Lines, PrimaryButton, SimulatedTag } from "./ui";
import { shortAddress, signWithWallet } from "./wallet";
import { WalletBar } from "./WalletBar";

function linkIcon(label: string): ReactNode {
  if (label.startsWith("Closing")) return <Landmark size={18} strokeWidth={1.75} />;
  if (label.includes("purchase")) return <ArrowRightLeft size={18} strokeWidth={1.75} />;
  if (label.includes("KYC")) return <ShieldCheck size={18} strokeWidth={1.75} />;
  if (label.startsWith("Settlement") || label.startsWith("Payout")) return <Flame size={18} strokeWidth={1.75} />;
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
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hei = current?.view.hei;

  async function attempt(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  function run(label: string, path: string, body: Record<string, unknown>) {
    return attempt(label, async () => {
      if (current) storeCase(await callApi(path, { token: current.token, ...body }));
    });
  }

  /** With the user's own wallet: the server prepares the payment, the wallet signs it, then the settlement runs. */
  function settleWithWallet(scenario: string) {
    return attempt("Preparing your settlement payment on devnet..", async () => {
      const wallet = current?.view.wallet;
      if (!current || !wallet) return;
      type Prepared = CaseReplyJson & { payment: { transaction: string } | null };
      const prepared = await postJson<Prepared>("/api/hei/settlement/prepare", { token: current.token, scenario });
      storeCase({ token: prepared.token, view: prepared.view });
      let signed: unknown;
      if (prepared.payment) {
        setBusy("Sign the payment in your wallet..");
        signed = await signWithWallet(prepared.payment.transaction, wallet.address);
      }
      setBusy("Settling on devnet: your payment, then paying holders and burning shares..");
      storeCase(await callApi("/api/hei/settlement", { token: prepared.token, scenario, signed }));
    });
  }

  const header = (
    <div className="border-b border-neutral-800 px-6 py-14 text-center sm:px-10">
      <h1 className="text-[40px] font-semibold tracking-[-2px] text-neutral-100">Partner &amp; investors</h1>
      <p className="mx-auto mt-3 max-w-[640px] text-neutral-400">
        Ownflow is a connector; a licensed partner would issue the HEI and run these steps. Here the app plays the partner on Solana devnet and pays in test
        dollars (DUSD) with no value. Investors&apos; KYC attestations are real on-chain records; the passing years and the appraisal are simulated, with home
        prices following the real FHFA index.
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

  // The scenarios come from the server: years and the real home price index growth stay in code.
  const chosen = hei.scenarios.find((item) => item.id === picked) ?? hei.scenarios[0];
  return (
    <Frame className="border-t">
      {header}
      <div className="border-b border-neutral-800 px-6 py-3 sm:px-10">
        <WalletBar token={current.token} view={current.view} busy={Boolean(busy)} onError={setError} />
      </div>
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
                { icon: <Landmark size={18} strokeWidth={1.75} />, title: "Closing", text: `The partner pays ${hei.usesWallet ? "your wallet" : "the homeowner"} the net cash, from its own money.`, tag: <SimulatedTag /> },
                {
                  icon: <ShieldCheck size={18} strokeWidth={1.75} />,
                  title: "KYC",
                  text: `${hei.kycCheck.label}, then a KYC attestation on Solana (Solana Attestation Service), checked on-chain before a share account opens. A third buyer has none and stays frozen.`,
                  tag: hei.kycCheck.simulated ? <SimulatedTag label="Simulated identity check" /> : <SimulatedTag label="Sandbox test identity" />,
                },
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
              {hei.usesWallet && current.view.wallet
                ? `Your wallet (${shortAddress(current.view.wallet.address)}) pays the capped payout into this HEI's settlement account; you sign it in your wallet. `
                : "The homeowner (demo wallet) pays the capped payout into this HEI's settlement account. "}
              Then, for each holder, one transaction pays its share and burns its tokens. No time passes on devnet: pick when the HEI settles; the home&apos;s
              value then follows the real FHFA house price index over that many past years.{" "}
              <SimulatedTag label="Simulated time and appraisal" />
            </p>
            <fieldset className="mb-6 grid gap-3 sm:grid-cols-2" disabled={!hei.canSettle || Boolean(busy)}>
              {hei.scenarios.map((item) => (
                <label
                  key={item.id}
                  className={`cursor-pointer rounded-2xl border p-4 transition ${chosen?.id === item.id ? "border-neutral-500 bg-neutral-900" : "border-neutral-800 bg-neutral-950 hover:border-neutral-700"}`}
                >
                  <input type="radio" name="scenario" value={item.id} checked={chosen?.id === item.id} onChange={() => setPicked(item.id)} className="sr-only" />
                  <span className="block text-sm font-medium text-neutral-100">{item.label}</span>
                  <span className="mt-1 block text-xs text-neutral-500">{item.note}</span>
                </label>
              ))}
            </fieldset>
            <PrimaryButton
              arrow
              disabled={Boolean(busy) || !hei.canSettle || !chosen}
              onClick={() => {
                if (!chosen) return;
                if (hei.usesWallet) {
                  const question = `Settle on Solana devnet: ${chosen.label}? Your wallet will ask you to sign the payment (test dollars; any shortfall is minted to it first, simulated).`;
                  if (window.confirm(question)) void settleWithWallet(chosen.id);
                } else if (window.confirm(`Settle on Solana devnet: ${chosen.label}? The homeowner's demo wallet pays and the shares are burned.`)) {
                  void run("Settling on devnet: paying holders and burning shares..", "/api/hei/settlement", { scenario: chosen.id });
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
