// The right side of the agent page: what the case holds so far, filled in step by
// step (goal, assets, comparison, documents, on-chain records). Every figure here is
// finished text from lib/web/view.ts.

import Link from "next/link";
import type { CaseView } from "@/lib/web/view";
import { DevnetTag, ExternalLink, Hash, Lines, Section, SimulatedTag } from "./ui";

function Comparison({ comparison }: { comparison: NonNullable<CaseView["comparison"]> }) {
  return (
    <Section title="Every path compared">
      <p className="mb-3 font-medium">{comparison.headline}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="py-2 pr-3 font-medium">Path</th>
              <th className="py-2 pr-3 font-medium">Cash now</th>
              <th className="py-2 pr-3 font-medium">Monthly</th>
              <th className="py-2 pr-3 font-medium">Cost</th>
              <th className="py-2 font-medium">Keeps asset</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-zinc-100 align-top dark:border-zinc-900 ${row.recommended ? "bg-emerald-50 dark:bg-emerald-950/40" : ""} ${row.note && !row.recommended ? "text-zinc-500" : ""}`}
              >
                <td className="py-2 pr-3">
                  <span className="font-medium">{row.label}</span>
                  {row.recommended && <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Recommended</span>}
                  {row.note && <div className="text-xs">{row.note}</div>}
                  <div className="text-[11px] text-zinc-400">id: {row.id}</div>
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{row.cash}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{row.monthly}</td>
                <td className="py-2 pr-3">{row.cost}</td>
                <td className="py-2">{row.keepsAsset ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          <span className="font-medium">Why: </span>
          {comparison.reasons.join(" ")}
        </p>
        {comparison.risks.length > 0 && (
          <p>
            <span className="font-medium">Main risks: </span>
            {comparison.risks.join(" ")}
          </p>
        )}
        <p className="text-xs text-zinc-500">{comparison.rules}</p>
        {comparison.frozenNote && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {comparison.frozenNote}
          </p>
        )}
        {comparison.sources.length > 0 && (
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer">Values and sources behind these numbers</summary>
            <ul className="mt-2 space-y-1">
              {comparison.sources.map((source) => (
                <li key={source.label}>
                  {source.label}: {source.value} ({source.source}; as of {source.asOf})
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{comparison.notice}</p>
      </div>
    </Section>
  );
}

function Documents({ documents }: { documents: NonNullable<CaseView["documents"]> }) {
  return (
    <Section title="Handoff documents (off-chain)">
      <p className="text-sm">
        <span className="font-medium">Prepared for: </span>
        {documents.selected}
        {documents.recommended && documents.recommended !== documents.selected && <span className="text-zinc-500"> (recommended: {documents.recommended})</span>}
      </p>
      {documents.termSheet.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-sm font-medium">HEI term sheet</h3>
          <Lines lines={documents.termSheet} />
        </div>
      )}
      <div className="mt-3 space-y-1 text-sm">
        {documents.passports.map((passport) => (
          <p key={passport.label}>
            Asset passport, {passport.label}: <Hash value={passport.hash} />
          </p>
        ))}
        <p>
          Recommendation receipt: <Hash value={documents.receipt.recommendationHash} /> · passports <Hash value={documents.receipt.passportHash} /> · registry{" "}
          {documents.receipt.registryVersion}
        </p>
      </div>
    </Section>
  );
}

export function CasePanel({ view }: { view: CaseView }) {
  return (
    <div className="space-y-4">
      {view.persona && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <SimulatedTag label="Made-up persona" /> <span className="ml-1 font-medium">Persona {view.persona.id}:</span> {view.persona.title}
        </div>
      )}
      <Section title="Goal">{view.goal ? <Lines lines={view.goal} /> : <p className="text-sm text-zinc-500">Tell the agent how much cash you need and by when.</p>}</Section>
      <Section title="Assets">
        {view.assets.length === 0 ? (
          <p className="text-sm text-zinc-500">No assets yet: give the home address, or add watch photos.</p>
        ) : (
          <div className="space-y-3">
            {view.assets.map((asset) => (
              <div key={asset.id}>
                <p className="text-sm font-medium">{asset.title}</p>
                <Lines lines={asset.lines} />
                {asset.simulated.map((line) => (
                  <p key={line} className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                    <SimulatedTag /> {line}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </Section>
      {view.comparison && <Comparison comparison={view.comparison} />}
      {view.documents && <Documents documents={view.documents} />}
      {view.onchain.length > 0 && (
        <Section title="On-chain records" aside={<DevnetTag />}>
          <ul className="space-y-1 text-sm">
            {view.onchain.map((link) => (
              <li key={link.url}>
                <ExternalLink href={link.url}>{link.label}</ExternalLink>
              </li>
            ))}
          </ul>
          {view.hei && (
            <p className="mt-3 text-sm">
              Next for the HEI: the partner&apos;s closing payment, the sale to investors and the settlement.{" "}
              <Link href="/partner" className="font-medium text-violet-700 underline underline-offset-2 dark:text-violet-300">
                Open the partner &amp; investor page
              </Link>
            </p>
          )}
        </Section>
      )}
    </div>
  );
}
