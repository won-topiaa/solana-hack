"use client";

// The agent page: a start screen (new case or a made-up demo persona), then the chat
// on the left and the case panel on the right. Each action posts the sealed case to
// an API route and stores the case that comes back.

import { useMemo, useState, useSyncExternalStore } from "react";
import type { CaseView } from "@/lib/web/view";
import { callApi, caseSnapshot, parseCase, serverCaseSnapshot, storeCase, subscribeCase } from "./caseStore";
import { CasePanel } from "./CasePanel";
import { ChatPanel } from "./ChatPanel";
import type { PhotoForUpload } from "./photoUpload";

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
    run("Starting the case…", async () => {
      storeCase(await callApi("/api/case", persona ? { persona } : {}));
    });

  const send = (text: string, photo?: PhotoForUpload) =>
    run(photo ? "Reading the photo and thinking…" : "The agent is working…", async () => {
      if (!current) return;
      const body: Record<string, unknown> = { token: current.token, text };
      if (photo) body.photo = { mimeType: photo.mimeType, dataBase64: photo.dataBase64 };
      storeCase(await callApi("/api/case/message", body));
    });

  const answer = (approved: boolean) =>
    void run(approved ? "Running the approved step (on-chain steps wait for Solana devnet, up to a minute)…" : "Telling the agent…", async () => {
      if (!current?.view.approval) return;
      storeCase(await callApi("/api/case/approval", { token: current.token, approvalId: current.view.approval.id, approved }));
    });

  if (!current) {
    return (
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold leading-tight">Find the cheapest way to turn your home or watch into cash.</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            A neutral AI agent compares every cash-out path, including a HELOC or a plain sale, recommends one by fixed rules, and connects you to the next step.
            Tokenizing on Solana is one of the paths, never the default, and nothing happens on-chain without your approval.
          </p>
        </div>
        {error && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
        <div className="space-y-3">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => void start()}
            className="rounded-md bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            Start a new case
          </button>
          <p className="text-sm text-zinc-500">Or load a made-up demo persona (goal and assets already filled in):</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {personas.map((persona) => (
              <button
                key={persona.id}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void start(persona.id)}
                className="rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm hover:border-violet-400 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="font-semibold">Persona {persona.id}</span>
                <span className="mt-1 block text-zinc-600 dark:text-zinc-400">{persona.title}</span>
              </button>
            ))}
          </div>
          {busy && <p className="text-sm text-zinc-500">{busy}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">Case {current.view.caseId}</p>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            if (window.confirm("Close this case and start over? It cannot be reopened.")) storeCase(null);
          }}
          className="text-xs text-zinc-600 underline disabled:opacity-50 dark:text-zinc-400"
        >
          Start over
        </button>
      </div>
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]">
          <ChatPanel view={current.view} busy={busy} suggestions={suggestionsFor(current.view)} onSend={send} onAnswer={answer} />
        </div>
        <CasePanel view={current.view} />
      </div>
    </div>
  );
}
