// Display formatting. Numbers shown to the user are formatted here, by code,
// so the model only repeats finished text and never rewrites a figure.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1000000 -> "$1,000,000" (whole dollars). */
export function formatUsd(amount: number): string {
  return usd.format(amount);
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
