// Compares the name the user gives with the owner names on public records.
// Records often write names as "LAST FIRST M" and list co-owners, so names are
// compared as sets of words, ignoring case, accents, punctuation and initials.

import type { OwnerMatch } from "./types";

export function nameWords(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z'\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1); // drops middle initials such as "a"
}

/**
 * "match": every word of the shorter name appears in the other, and at least
 * two words are shared (a first name alone is not enough).
 * "partial": some words are shared, e.g. the same family name. A person checks it.
 * "unknown": no name given, or no owner names on record.
 */
export function matchOwner(userName: string, ownerNames: string[]): OwnerMatch {
  const userWords = new Set(nameWords(userName));
  if (userWords.size === 0 || ownerNames.length === 0) return "unknown";

  let result: OwnerMatch = "no_match";
  for (const ownerName of ownerNames) {
    const ownerWords = new Set(nameWords(ownerName));
    const shared = [...userWords].filter((word) => ownerWords.has(word)).length;
    if (shared >= 2 && shared === Math.min(userWords.size, ownerWords.size)) return "match";
    if (shared >= 1) result = "partial";
  }
  return result;
}
