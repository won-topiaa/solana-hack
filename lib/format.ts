// Display formatting. Numbers shown to the user are formatted here, by code,
// so the model only repeats finished text and never rewrites a figure.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** 1000000 -> "$1,000,000" (whole dollars). */
export function formatUsd(amount: number): string {
  return usd.format(amount);
}

/** 3.99 -> "3.99%", 4.5531 -> "4.55%" (the input is already a percentage, not a fraction). */
export function formatPercent(percentage: number): string {
  return `${Number(percentage.toFixed(2))}%`;
}
