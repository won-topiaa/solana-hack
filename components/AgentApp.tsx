"use client";

// The agent page: a start screen (new case or a made-up demo persona), then the chat
// on the left and the case panel on the right. Each action posts the sealed case to
// an API route and stores the case that comes back.

import { ArrowRightLeft, ChevronRight, Flame, House, Lock, Receipt, RotateCcw, Scale, ShieldCheck, Sparkles, Watch } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CaseView } from "@/lib/web/view";
import { callApi, caseSnapshot, parseCase, postJson, serverCaseSnapshot, storeCase, subscribeCase } from "./caseStore";
import { CasePanel } from "./CasePanel";
import { ChatPanel } from "./ChatPanel";
import type { PhotoForUpload } from "./photoUpload";
import { Avatar, Badge, ErrorNote, Frame, IconBox, PrimaryButton, SecondaryButton } from "./ui";
import { connectedTo, signWithWallet } from "./wallet";
import { WalletBar } from "./WalletBar";

type Persona = { id: string; title: string };

/** One-click messages for the next likely step, so a demo can move without typing. */
function suggestionsFor(view: CaseView): string[] {
  if (view.approval) return [];
  if (!view.goal) {
    return [
      "I need $150,000 from my home by the end of next month. I can't make monthly payments and plan to repay in about 10 years.",
      "I need $30,000 by tomorrow. I own two watches and want to keep my sport watch.",
    ];
  }
  if (!view.comparison) return ["Compare my options."];
  if (!view.documents) return ["Prepare the documents for the recommended path."];
  const onchain = view.onchain.map((link) => link.label);
  if (!onchain.includes("Recommendation receipt (memo)")) return ["Record the receipt on Solana."];
  if (view.documents.termSheet.length > 0 && !onchain.includes("HEI share token")) return ["Issue the HEI share tokens."];
  if (view.documents.selected.startsWith("Vault") && !onchain.includes("Watch 1-of-1 token")) return ["Issue the watch token."];
  return [];
}

const PERSONA_ICONS: Record<string, ReactNode> = {
  A: <Watch size={20} strokeWidth={1.75} />,
  B: <House size={20} strokeWidth={1.75} />,
  B2: <House size={20} strokeWidth={1.75} />,
  C: <Scale size={20} strokeWidth={1.75} />,
  D: <Scale size={20} strokeWidth={1.75} />,
};

const WHY_SOLANA = [
  { icon: <Receipt size={20} strokeWidth={1.75} />, title: "A receipt you can check", text: "The recommendation's hash and the values behind it are written on-chain when you approve. No personal data." },
  {
    icon: <ShieldCheck size={20} strokeWidth={1.75} />,
    title: "Compliance in the token",
    text: "Share accounts start frozen. The issuer opens one only after reading the wallet's KYC attestation from Solana and checking it; the token refuses everyone else.",
  },
  { icon: <ArrowRightLeft size={20} strokeWidth={1.75} />, title: "Delivery against payment", text: "Each purchase is one transaction: the buyer's dollars and the shares move together, or nothing moves." },
  { icon: <Flame size={20} strokeWidth={1.75} />, title: "Pay and burn together", text: "At settlement each holder is paid its share and its tokens are burned in the same transaction." },
  { icon: <Lock size={20} strokeWidth={1.75} />, title: "Fixed supply, locked facts", text: "After minting, the supply can never grow and the hashes written into the token can never change." },
  { icon: <Scale size={20} strokeWidth={1.75} />, title: "Numbers from code", text: "The AI talks and reads photos. Every figure comes from tested code and dated sources, never from the model." },
];

/** A start-screen card. The whole card is the button; the pill at its bottom shows that it can be clicked. */
function StartCard({ icon, title, text, action, disabled, onClick }: { icon: ReactNode; title: string; text: string; action: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group flex flex-col items-start gap-4 bg-black p-6 text-left transition hover:bg-neutral-950 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-neutral-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <IconBox>{icon}</IconBox>
      <div className="space-y-1.5">
        <p className="text-[17px] font-medium text-neutral-100">{title}</p>
        <p className="text-sm leading-relaxed text-neutral-400">{text}</p>
      </div>
      <span className="mt-auto inline-flex items-center gap-1.5 rounded-full border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-medium text-neutral-100 transition group-hover:border-white group-hover:bg-white group-hover:text-black">
        {action}
        <ChevronRight size={15} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function StartScreen({ personas, busy, error, onStart }: { personas: Persona[]; busy: string | null; error: string | null; onStart: (persona?: string) => void }) {
  return (
    <>
      <div className="flex justify-center px-6 pb-8 pt-6">
        <Badge>
          Live on Solana devnet
          <ChevronRight size={15} className="text-neutral-500" />
        </Badge>
      </div>
      <Frame className="border-t">
        {/* Hero */}
        <div className="grid items-center gap-12 border-b border-neutral-800 px-6 py-20 sm:px-10 lg:grid-cols-2 lg:py-36">
          <div className="space-y-6">
            <h1 className="text-[40px] font-semibold leading-[1.15] tracking-[-2px] text-neutral-100 sm:text-[48px]">The cheapest way to turn what you own into cash</h1>
            <p className="max-w-[480px] text-lg leading-relaxed text-neutral-400">
              A neutral AI agent compares every way to raise cash from your home or watches, including a HELOC or a plain sale, and tokenizes on Solana only when
              that is your choice.
            </p>
            {error && <ErrorNote>{error}</ErrorNote>}
            <div className="flex flex-wrap gap-2.5">
              <PrimaryButton arrow disabled={Boolean(busy)} onClick={() => onStart()}>
                Start a new case
              </PrimaryButton>
              <SecondaryButton disabled={Boolean(busy)} onClick={() => onStart("B")}>
                Try persona B
              </SecondaryButton>
            </div>
            {busy && <p className="text-sm text-neutral-500">{busy}</p>}
          </div>
          <div className="space-y-6" aria-hidden="true">
            <div className="flex items-center justify-end gap-3">
              <span className="rounded-full bg-white px-4 py-2.5 text-[15px] font-medium text-black">I need $150,000 by December, no monthly payments</span>
              <Avatar who="user" />
            </div>
            <div className="flex items-center gap-3">
              <Avatar who="agent" />
              <span className="text-[15px] text-neutral-400">Comparing every path..</span>
            </div>
          </div>
        </div>

        {/* Personas */}
        <div className="border-b border-neutral-800 px-6 py-16 text-center">
          <h2 className="text-[32px] font-semibold tracking-[-1px] text-neutral-200">Every path, compared</h2>
          <p className="mx-auto mt-3 max-w-[620px] text-neutral-400">
            Load a made-up persona with its goal and assets filled in, then follow the suggested steps: compare, prepare the documents, approve the on-chain steps.
          </p>
        </div>
        {/* Lines between cells are the 1px gaps over a grey background. */}
        <div className="grid gap-px border-b border-neutral-800 bg-neutral-800 sm:grid-cols-2 lg:grid-cols-3">
          {personas.map((persona) => (
            <StartCard
              key={persona.id}
              icon={PERSONA_ICONS[persona.id] ?? <Sparkles size={20} strokeWidth={1.75} />}
              title={`Persona ${persona.id}`}
              text={persona.title}
              action="Load persona"
              disabled={Boolean(busy)}
              onClick={() => onStart(persona.id)}
            />
          ))}
          <StartCard
            icon={<Sparkles size={20} strokeWidth={1.75} />}
            title="Your own case"
            text="Start empty and tell the agent your goal. Add a watch photo, or a made-up home address."
            action="Start a new case"
            disabled={Boolean(busy)}
            onClick={() => onStart()}
          />
        </div>

        {/* Why Solana */}
        <div className="border-b border-neutral-800 px-6 py-16 text-center">
          <h2 className="text-[32px] font-semibold tracking-[-1px] text-neutral-200">Why it runs on Solana</h2>
          <p className="mx-auto mt-3 max-w-[620px] text-neutral-400">Tokenizing alone does not create cash. These are the parts the chain makes trustworthy.</p>
        </div>
        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2 lg:grid-cols-3">
          {WHY_SOLANA.map((item) => (
            <div key={item.title} className="space-y-3 bg-black p-6">
              <span className="mb-5 block text-neutral-200">{item.icon}</span>
              <p className="text-[17px] font-medium text-neutral-100">{item.title}</p>
              <p className="text-sm leading-relaxed text-neutral-400">{item.text}</p>
            </div>
          ))}
        </div>
      </Frame>
    </>
  );
}

export function AgentApp({ personas }: { personas: Persona[] }) {
  const raw = useSyncExternalStore(subscribeCase, caseSnapshot, serverCaseSnapshot);
  const current = useMemo(() => parseCase(raw), [raw]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<void>): Promise<boolean> {
    setBusy(label);
    setError(null);
    try {
      await action();
      return true;
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Something went wrong");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const start = (persona?: string) =>
    void run("Starting the case…", async () => {
      storeCase(await callApi("/api/case", persona ? { persona } : {}));
    });

  const send = (text: string, photo?: PhotoForUpload) =>
    run(photo ? "Reading the photo.." : "Working..", async () => {
      if (!current) return;
      const body: Record<string, unknown> = { token: current.token, text };
      if (photo) body.photo = { mimeType: photo.mimeType, dataBase64: photo.dataBase64 };
      storeCase(await callApi("/api/case/message", body));
    });

  const answer = (approved: boolean) =>
    void run(approved ? "Running the approved step on Solana devnet.." : "Telling the agent..", async () => {
      const approval = current?.view.approval;
      if (!current || !approval) return;
      let signed: unknown;
      if (approved && approval.needsWallet && current.view.wallet) {
        // The server builds the transaction; the user's wallet signs it; the approval carries it back.
        connectedTo(current.view.wallet.address); // before the server does any work
        setBusy("Preparing the transaction for your wallet..");
        const prepared = await postJson<{ transaction: string }>("/api/case/sign", { token: current.token, approvalId: approval.id });
        setBusy("Sign in your wallet..");
        signed = await signWithWallet(prepared.transaction, current.view.wallet.address);
        setBusy("Recording on Solana devnet..");
      }
      storeCase(await callApi("/api/case/approval", { token: current.token, approvalId: approval.id, approved, signed }));
    });

  if (!current) return <StartScreen personas={personas} busy={busy} error={error} onStart={start} />;

  return (
    <Frame className="border-t">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-6 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <p className="truncate font-mono text-xs text-neutral-500">Case {current.view.caseId}</p>
          <WalletBar token={current.token} view={current.view} busy={busy} setBusy={setBusy} onError={setError} />
        </div>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            if (window.confirm("Close this case and start over? It cannot be reopened.")) storeCase(null);
          }}
          className="inline-flex items-center gap-1.5 text-xs text-neutral-400 transition hover:text-white disabled:opacity-50"
        >
          <RotateCcw size={13} />
          Start over
        </button>
      </div>
      {error && (
        <div className="border-b border-neutral-800 p-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="border-b border-neutral-800 lg:sticky lg:top-0 lg:h-[calc(100vh-1rem)] lg:border-b-0">
          <ChatPanel view={current.view} busy={busy} suggestions={suggestionsFor(current.view)} onSend={send} onAnswer={answer} />
        </div>
        {/* The divider belongs to the panel, which is the taller column, so it runs to the bottom. */}
        <div className="lg:border-l lg:border-neutral-800">
          <CasePanel view={current.view} />
        </div>
      </div>
    </Frame>
  );
}
