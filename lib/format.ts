// Display formatting. Numbers shown to the user are formatted here, by code,
// so the model only repeats finished text and never rewrites a figure.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1000000 -> "$1,000,000" (whole dollars). */
export function formatUsd(amount: number): string {
  return usd.format(amount);
}

/** A length of time, the same everywhere: 10 -> "10 years", 1 -> "1 year", 4/3 -> "1.33 years", 0.25 -> "3 months". */
export function formatYears(years: number): string {
  if (years < 1) {
    const months = Math.max(1, Math.round(years * 12));
    return months === 1 ? "1 month" : `${months} months`;
  }
  const rounded = Number(years.toFixed(2));
  return rounded === 1 ? "1 year" : `${rounded} years`;
}

/** A price scenario in words: 0 -> "stay flat", 0.03 -> "rise 3% a year", -0.02 -> "fall 2% a year". */
export function pricesText(growth: number): string {
  if (growth === 0) return "stay flat";
  return `${growth > 0 ? "rise" : "fall"} ${formatPercent(Math.abs(growth) * 100)} a year`;
}

/** For chart axes: 150000 -> "$150k", 1200000 -> "$1.2M", 900 -> "$900". */
export function formatUsdCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${Number((amount / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `$${Number((amount / 1_000).toFixed(abs >= 10_000 ? 0 : 1))}k`;
  return formatUsd(amount);
}

/** Micro-dollars (on-chain amounts, 6 decimals) in dollars: 144000069760 -> "$144,000.07". */
export function formatMicroUsd(micro: bigint): string {
  return cents.format(Number(micro) / 1_000_000);
}

/** Micro-dollars exactly, for checks: 144000069760 -> "144,000.069760". */
export function formatMicroUsdExact(micro: bigint): string {
  const sign = micro < BigInt(0) ? "-" : "";
  const abs = micro < BigInt(0) ? -micro : micro;
  const whole = abs / BigInt(1_000_000);
  const fraction = (abs % BigInt(1_000_000)).toString().padStart(6, "0");
  return `${sign}${whole.toLocaleString("en-US")}.${fraction}`;
}

/** 3.99 -> "3.99%", 4.5531 -> "4.55%" (the input is already a percentage, not a fraction). */
export function formatPercent(percentage: number): string {
  return `${Number(percentage.toFixed(2))}%`;
}
