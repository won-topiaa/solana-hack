// Calendar-date helpers for the registry. Dates are plain YYYY-MM-DD strings.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(text: string): boolean {
  const match = ISO_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toUtcMidnight(isoDate: string): number {
  if (!isIsoDate(isoDate)) throw new RangeError(`Not a YYYY-MM-DD date: ${isoDate}`);
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Whole calendar days from `fromDate` to `toDate` (negative if `toDate` is earlier). */
export function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((toUtcMidnight(toDate) - toUtcMidnight(fromDate)) / MS_PER_DAY);
}

/** The date `days` calendar days after `isoDate` (before it when negative). */
export function addDays(isoDate: string, days: number): string {
  return new Date(toUtcMidnight(isoDate) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Today's date in US Eastern time. The market sources (Freddie Mac, FRED)
 * publish on Eastern-time schedules, so "today" is counted the same way.
 */
export function todayInNewYork(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
