// Charts for the case panel, drawn with plain HTML and SVG (no chart library). They only
// place what lib/web/charts.ts computed: positions come from the numbers, and every
// printed value is the finished text that came with them.

import { Check } from "lucide-react";
import { formatUsdCompact } from "@/lib/format";
import type { BarPanel, ComparisonChart, HeiChart, ProgressStep } from "@/lib/web/charts";

// ---- Where the case stands ---------------------------------------------------

export function Progress({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2" aria-label="Case progress">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
              step.state === "done"
                ? "border-violet-500/30 bg-violet-500/10 text-violet-200"
                : step.state === "current"
                  ? "border-neutral-300 text-white"
                  : "border-neutral-800 text-neutral-500"
            }`}
            aria-current={step.state === "current" ? "step" : undefined}
          >
            {step.state === "done" ? <Check size={12} /> : <span className="text-[10px] tabular-nums">{index + 1}</span>}
            {step.label}
          </span>
          {index < steps.length - 1 && <span className={`h-px w-3 ${step.state === "done" ? "bg-violet-500/40" : "bg-neutral-800"}`} />}
        </li>
      ))}
    </ol>
  );
}

// ---- Paths side by side ------------------------------------------------------

function Bars({ panel }: { panel: BarPanel }) {
  const max = Math.max(...panel.bars.map((bar) => bar.high), panel.line?.value ?? 0) * 1.08 || 1;
  const at = (value: number) => `${(value / max) * 100}%`;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-neutral-100">{panel.title}</h3>
        {panel.line && <span className="text-xs text-amber-300">{panel.line.text}</span>}
      </div>
      <div className="space-y-2">
        {panel.bars.map((bar) => (
          // Fixed columns, so every bar has the same width and the reference line lines up.
          <div key={bar.id} className="grid grid-cols-[minmax(0,1fr)_8.75rem] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_8.75rem]">
            <span
              title={bar.fullLabel}
              className={`col-span-2 truncate text-xs sm:col-span-1 ${bar.recommended ? "font-medium text-violet-200" : bar.suitable ? "text-neutral-300" : "text-neutral-500"}`}
            >
              {bar.label}
            </span>
            <div className="relative h-2.5 min-w-0 rounded-full bg-neutral-900">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${bar.recommended ? "bg-violet-400" : bar.suitable ? "bg-neutral-400" : "bg-neutral-700"}`}
                style={{ width: at(bar.low) }}
              />
              {bar.high > bar.low && (
                <div
                  className={`absolute inset-y-0 rounded-r-full ${bar.recommended ? "bg-violet-400/35" : "bg-neutral-500/35"}`}
                  style={{ left: at(bar.low), width: `calc(${at(bar.high)} - ${at(bar.low)})` }}
                />
              )}
              {panel.line && <div className="absolute -inset-y-1 w-px bg-amber-300/80" style={{ left: at(panel.line.value) }} aria-hidden="true" />}
            </div>
            <span className={`text-right text-xs tabular-nums ${bar.recommended ? "text-violet-200" : "text-neutral-400"}`}>{bar.text}</span>
          </div>
        ))}
      </div>
      {panel.note && <p className="mt-2 text-[11px] text-neutral-500">{panel.note}</p>}
    </div>
  );
}

export function ComparisonCharts({ chart }: { chart: ComparisonChart }) {
  return (
    <div className="space-y-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
      {chart.panels.map((panel) => (
        <Bars key={panel.title} panel={panel} />
      ))}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-violet-400" /> Recommended
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-neutral-400" /> Suitable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-neutral-700" /> Not suitable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-neutral-500/35" /> Range
        </span>
      </p>
    </div>
  );
}

// ---- The HEI over time ------------------------------------------------------------

const WIDTH = 640;
const HEIGHT = 250;
const PAD = { left: 52, right: 16, top: 14, bottom: 30 };

/** About four round steps from 0 to the top. */
function ticks(max: number): number[] {
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough) ?? rough;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, index) => index * step);
}

const PAYOUT_COLORS = ["#c4b5fd", "#8b5cf6", "#6d28d9"]; // violet-300, -500, -700

export function HeiPaybackChart({ chart }: { chart: HeiChart }) {
  const top = chart.maxUsd * 1.12;
  const x = (years: number) => PAD.left + (years / chart.termYears) * (WIDTH - PAD.left - PAD.right);
  const y = (usd: number) => HEIGHT - PAD.bottom - (usd / top) * (HEIGHT - PAD.top - PAD.bottom);
  const yTicks = ticks(top);
  const xStep = chart.termYears > 12 ? 5 : chart.termYears > 6 ? 2 : 1;
  const xTicks = Array.from({ length: Math.floor(chart.termYears / xStep) + 1 }, (_, index) => index * xStep);
  const payouts = chart.series.filter((series) => series.kind === "payout");
  const path = (points: { years: number; usd: number }[]) => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.years).toFixed(1)},${y(point.usd).toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="What you pay back if the HEI settles after a given number of years">
        <defs>
          <clipPath id="hei-plot">
            <rect x={PAD.left} y={PAD.top} width={WIDTH - PAD.left - PAD.right} height={HEIGHT - PAD.top - PAD.bottom} />
          </clipPath>
        </defs>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#262626" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="#737373">
              {formatUsdCompact(tick)}
            </text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={tick} x={x(tick)} y={HEIGHT - 10} textAnchor="middle" fontSize={11} fill="#737373">
            {tick === 0 ? "Now" : `${tick}y`}
          </text>
        ))}
        <g clipPath="url(#hei-plot)">
          {chart.series
            .filter((series) => series.kind === "cash")
            .map((series) => (
              <path key={series.name} d={path(series.points)} stroke="#525252" strokeWidth={1.5} strokeDasharray="2 4" fill="none" />
            ))}
          {chart.series
            .filter((series) => series.kind === "cap")
            .map((series) => (
              <path key={series.name} d={path(series.points)} stroke="#fcd34d" strokeOpacity={0.7} strokeWidth={1.5} strokeDasharray="6 5" fill="none" />
            ))}
          {payouts.map((series, index) => (
            <path key={series.name} d={path(series.points)} stroke={PAYOUT_COLORS[index % PAYOUT_COLORS.length]} strokeWidth={2.25} fill="none" />
          ))}
        </g>
        {chart.plannedYears <= chart.termYears && (
          <g>
            <line x1={x(chart.plannedYears)} x2={x(chart.plannedYears)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="#a3a3a3" strokeOpacity={0.4} strokeDasharray="3 4" />
            {/* Near the left edge the label goes to the right of the line, so it never covers the axis. */}
            <text
              x={x(chart.plannedYears) + (x(chart.plannedYears) < 170 ? 6 : -6)}
              y={PAD.top + 10}
              textAnchor={x(chart.plannedYears) < 170 ? "start" : "end"}
              fontSize={11}
              fill="#a3a3a3"
            >
              Planned settlement
            </text>
          </g>
        )}
        {chart.capEnds.map((end) => (
          <circle key={end.growth} cx={x(end.years)} cy={y(end.usd)} r={3.5} fill="#fcd34d">
            <title>{end.text}</title>
          </circle>
        ))}
        {chart.examples.map((example) => {
          const index = payouts.findIndex((series) => series.growth === example.growth);
          return (
            <circle key={`${example.growth}-${example.years}`} cx={x(example.years)} cy={y(example.usd)} r={4} fill={PAYOUT_COLORS[Math.max(0, index) % PAYOUT_COLORS.length]} stroke="#000" strokeWidth={1.5}>
              <title>{example.text}</title>
            </circle>
          );
        })}
      </svg>
      <ul className="mt-2 space-y-1 text-xs text-neutral-400">
        {payouts.map((series, index) => {
          const example = chart.examples.find((item) => item.growth === series.growth);
          return (
            <li key={series.name} className="flex items-center gap-2">
              <span className="h-0.5 w-4 shrink-0 rounded" style={{ background: PAYOUT_COLORS[index % PAYOUT_COLORS.length] }} />
              <span>
                {series.name}
                {example ? `: you pay ${example.text}` : ""}
              </span>
            </li>
          );
        })}
        {chart.series
          .filter((series) => series.kind === "cap")
          .map((series) => (
            <li key={series.name} className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t-2 border-dashed border-amber-300/70" />
              <span>
                {series.name}, the most investors can get{chart.capEnds.length > 0 ? `; ${chart.capEnds.map((end) => end.text.toLowerCase()).join(", ")}` : ""}
              </span>
            </li>
          ))}
        {chart.series
          .filter((series) => series.kind === "cash")
          .map((series) => (
            <li key={series.name} className="flex items-center gap-2">
              <span className="h-0 w-4 shrink-0 border-t-2 border-dotted border-neutral-500" />
              <span>{series.name}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

// ---- Who owns what -------------------------------------------------------------

export function OwnershipDonut({ share }: { share: HeiChart["share"] }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 110 110" className="h-24 w-24 shrink-0" role="img" aria-label={`${share.investorsText}. ${share.ownerText}.`}>
        <circle cx={55} cy={55} r={radius} fill="none" stroke="#404040" strokeWidth={14} />
        <circle
          cx={55}
          cy={55}
          r={radius}
          fill="none"
          stroke="#8b5cf6"
          strokeWidth={14}
          strokeDasharray={`${share.investors * circumference} ${circumference}`}
          transform="rotate(-90 55 55)"
        />
      </svg>
      <ul className="space-y-1.5 text-xs text-neutral-300">
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-violet-500" />
          {share.investorsText}
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-neutral-600" />
          {share.ownerText}
        </li>
      </ul>
    </div>
  );
}
