// The right side of the agent page: what the case holds so far, filled in step by
// step (goal, assets, comparison, documents, on-chain records). Every figure here is
// finished text from lib/web/view.ts.

import { ChevronRight, CircleCheck, Coins, House, Receipt, Watch } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { CaseView } from "@/lib/web/view";
import { ChainRecord, DevnetTag, Hash, IconBox, Lines, Section, SimulatedTag } from "./ui";

function Comparison({ comparison }: { comparison: NonNullable<CaseView["comparison"]> }) {
  return (
    <Section title="Every path compared">
      <p className="mb-4 text-[17px] font-medium tracking-[-0.3px] text-neutral-100">{comparison.headline}</p>
      <div className="overflow-x-auto rounded-2xl border border-neutral-800">
        <table className="w-full min-w-[540px] text-left text-sm">
          <thead className="bg-neutral-950 text-xs text-neutral-500">
            <tr className="border-b border-neutral-800">
              <th className="px-4 py-3 font-medium">Path</th>
              <th className="px-3 py-3 font-medium">Cash now</th>
              <th className="px-3 py-3 font-medium">Monthly</th>
              <th className="px-3 py-3 font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Keep it?</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.id} className={`border-b border-neutral-900 align-top last:border-b-0 ${row.recommended ? "bg-neutral-900/70" : ""}`}>
                <td className="px-4 py-3">
                  <span className={`font-medium ${row.note && !row.recommended ? "text-neutral-400" : "text-neutral-100"}`}>{row.label}</span>
                  {row.recommended && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                      <CircleCheck size={12} />
                      Recommended
                    </span>
                  )}
                  {row.note && <div className="mt-1 text-xs text-neutral-500">{row.note}</div>}
                  <div className="mt-0.5 font-mono text-[10px] text-neutral-600">{row.id}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-300">{row.cash}</td>
                <td className="whitespace-nowrap px-3 py-3 text-neutral-300">{row.monthly}</td>
                <td className="px-3 py-3 text-neutral-400">{row.cost}</td>
                <td className="px-4 py-3 text-neutral-300">{row.keepsAsset ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 space-y-2.5 text-sm leading-relaxed text-neutral-400">
        <p>
          <span className="font-medium text-neutral-200">Why: </span>
          {comparison.reasons.join(" ")}
        </p>
        {comparison.risks.length > 0 && (
          <p>
            <span className="font-medium text-neutral-200">Main risks: </span>
            {comparison.risks.join(" ")}
          </p>
        )}
        <p className="text-xs text-neutral-500">{comparison.rules}</p>
        {comparison.frozenNote && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{comparison.frozenNote}</p>}
        {comparison.sources.length > 0 && (
          <details className="text-xs text-neutral-500">
            <summary className="cursor-pointer text-neutral-400 hover:text-neutral-200">Values and sources behind these numbers</summary>
            <ul className="mt-2 space-y-1">
              {comparison.sources.map((source) => (
                <li key={source.label}>
                  {source.label}: {source.value} ({source.source}; as of {source.asOf})
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs font-medium text-neutral-400">{comparison.notice}</p>
      </div>
    </Section>
  );
}

function Documents({ documents }: { documents: NonNullable<CaseView["documents"]> }) {
  return (
    <Section title="Handoff documents (off-chain)">
      <p className="text-sm text-neutral-300">
        <span className="text-neutral-500">Prepared for </span>
        <span className="font-medium text-neutral-100">{documents.selected}</span>
        {documents.recommended && documents.recommended !== documents.selected && <span className="text-neutral-500"> · recommended: {documents.recommended}</span>}
      </p>
      {documents.termSheet.length > 0 && (
        <div className="mt-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
          <h3 className="mb-2 text-sm font-medium text-neutral-100">HEI term sheet</h3>
          <Lines lines={documents.termSheet} />
        </div>
      )}
      <div className="mt-4 space-y-2 text-sm text-neutral-400">
        {documents.passports.map((passport) => (
          <p key={passport.label}>
            Asset passport · {passport.label} <Hash value={passport.hash} />
          </p>
        ))}
        <p>
          Recommendation receipt <Hash value={documents.receipt.recommendationHash} /> · passports <Hash value={documents.receipt.passportHash} /> · registry{" "}
          {documents.receipt.registryVersion}
        </p>
      </div>
    </Section>
  );
}

const RECORD_ICONS: Record<string, ReactNode> = {
  "Recommendation receipt (memo)": <Receipt size={18} strokeWidth={1.75} />,
  "HEI share token": <Coins size={18} strokeWidth={1.75} />,
  "Watch 1-of-1 token": <Watch size={18} strokeWidth={1.75} />,
};

export function CasePanel({ view }: { view: CaseView }) {
  return (
    <div>
      {view.persona && (
        <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-6 py-4 text-sm">
          <SimulatedTag label="Made-up persona" />
          <span className="font-medium text-neutral-100">Persona {view.persona.id}</span>
          <span className="text-neutral-400">{view.persona.title}</span>
        </div>
      )}
      <Section title="Goal">{view.goal ? <Lines lines={view.goal} /> : <p className="text-sm text-neutral-500">Tell the agent how much cash you need and by when.</p>}</Section>
      <Section title="Assets">
        {view.assets.length === 0 ? (
          <p className="text-sm text-neutral-500">No assets yet: give the home address, or add watch photos.</p>
        ) : (
          <div className="space-y-4">
            {view.assets.map((asset) => (
              <div key={asset.id} className="flex gap-3">
                <IconBox>{asset.id.startsWith("home") ? <House size={18} strokeWidth={1.75} /> : <Watch size={18} strokeWidth={1.75} />}</IconBox>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium text-neutral-100">{asset.title}</p>
                  <Lines lines={asset.lines} />
                  {asset.simulated.map((line) => (
                    <p key={line} className="flex flex-wrap items-center gap-2 text-sm text-neutral-400">
                      <SimulatedTag /> {line}
                    </p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      {view.comparison && <Comparison comparison={view.comparison} />}
      {view.documents && <Documents documents={view.documents} />}
      {view.onchain.length > 0 && (
        <Section title="On-chain records" aside={<DevnetTag />}>
          <div className="space-y-2.5">
            {view.onchain.map((link) => (
              <ChainRecord key={link.url} icon={RECORD_ICONS[link.label] ?? <Receipt size={18} strokeWidth={1.75} />} label={link.label} url={link.url} />
            ))}
          </div>
          {view.hei && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <p className="text-sm text-neutral-400">Next for the HEI: the partner&apos;s closing payment, the sale to investors and the settlement.</p>
              <Link href="/partner" className="inline-flex items-center gap-1 rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition hover:bg-neutral-200">
                Partner &amp; investors <ChevronRight size={15} />
              </Link>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
