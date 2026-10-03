// Checks the goal the model passes to record_goal. The model only relays what
// the user said; code decides whether it is complete and makes sense.

import { daysBetween, isIsoDate } from "../params/dates";
import type { Goal, Intent } from "./types";

const INTENTS: readonly Intent[] = ["home", "watch", "unsure"];

export type GoalCheck = { ok: true; goal: Goal } | { ok: false; problems: string[] };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNoteList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((note) => typeof note === "string" && note.trim() !== "");
}

export function checkGoal(raw: Record<string, unknown>, today: string): GoalCheck {
  // Models sometimes send null for "not given"; treat it as missing.
  const field = (name: string) => raw[name] ?? undefined;
  const cash = field("cashNeededUsd");
  const neededBy = field("neededBy");
  const repayYears = field("repayHorizonYears");
  const monthly = field("monthlyCapacityUsd");
  const age62Plus = field("age62Plus");
  const keepNotes = field("keepAssetNotes");
  const intent = field("intent");

  const problems: string[] = [];
  if (!isFiniteNumber(cash) || cash <= 0) {
    problems.push("cashNeededUsd must be a positive number of US dollars");
  }
  if (typeof neededBy !== "string" || !isIsoDate(neededBy)) {
    problems.push("neededBy must be a date written as YYYY-MM-DD");
  } else if (daysBetween(today, neededBy) < 0) {
    problems.push(`neededBy (${neededBy}) is in the past; today is ${today}`);
  }
  if (repayYears !== undefined && (!isFiniteNumber(repayYears) || repayYears <= 0)) {
    problems.push("repayHorizonYears must be more than zero (leave it out if the user has no plan)");
  }
  if (monthly !== undefined && (!isFiniteNumber(monthly) || monthly < 0)) {
    problems.push("monthlyCapacityUsd must be zero or more");
  }
  if (age62Plus !== undefined && typeof age62Plus !== "boolean") {
    problems.push("age62Plus must be true or false");
  }
  if (keepNotes !== undefined && !isNoteList(keepNotes)) {
    problems.push("keepAssetNotes must be a list of short descriptions");
  }
  if (intent !== undefined && !INTENTS.includes(intent as Intent)) {
    problems.push(`intent must be one of ${INTENTS.join(", ")}`);
  }
  if (problems.length > 0) return { ok: false, problems };

  const goal: Goal = { cashNeededUsd: cash as number, neededBy: neededBy as string, keepAssetIds: [] };
  if (intent !== undefined) goal.intent = intent as Intent;
  if (repayYears !== undefined) goal.repayHorizonYears = repayYears as number;
  if (keepNotes !== undefined) goal.keepAssetNotes = keepNotes as string[];
  if (monthly !== undefined) goal.monthlyCapacityUsd = monthly as number;
  if (age62Plus !== undefined) goal.age62Plus = age62Plus as boolean;
  return { ok: true, goal };
}
