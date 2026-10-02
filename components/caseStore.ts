// The browser side of a case: the sealed token and the latest view, kept in this
// tab's sessionStorage so a reload keeps the case and the partner page can open it.
// Read through useSyncExternalStore, so the server render (no storage) and the
// first browser render agree. The token is sealed: the browser cannot read or change it.

import type { CaseView } from "@/lib/web/view";

export type CaseReplyJson = { token: string; view: CaseView };

const KEY = "ownflow.case";
const listeners = new Set<() => void>();
// The current case. It is read from sessionStorage once per page load, then kept here, so
// a failed save (storage blocked or full) can never bring back an older case.
let memory: string | null = null;
let loaded = false;

export function subscribeCase(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function caseSnapshot(): string | null {
  if (!loaded) {
    loaded = true;
    try {
      memory = sessionStorage.getItem(KEY);
    } catch {
      // Blocked storage (some private windows): start with no case.
    }
  }
  return memory;
}

export function serverCaseSnapshot(): string | null {
  return null;
}

export function storeCase(reply: CaseReplyJson | null): void {
  memory = reply ? JSON.stringify(reply) : null;
  loaded = true;
  try {
    if (memory) sessionStorage.setItem(KEY, memory);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Not saved (blocked or full): the case lives in memory until the tab closes, and the
    // older saved case is removed so a reload cannot bring it back.
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      // Storage is blocked altogether.
    }
  }
  listeners.forEach((listener) => listener());
}

export function parseCase(raw: string | null): CaseReplyJson | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CaseReplyJson;
  } catch {
    return null;
  }
}

/** POSTs JSON to one of the app's API routes; a failed request throws with the server's message. */
export async function callApi(path: string, body: Record<string, unknown>): Promise<CaseReplyJson> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  // The hosting's firewall limits requests per IP address (20 a minute on /api/).
  if (response.status === 429) throw new Error("Too many requests from your network. Please wait a minute and try again.");
  const data = (await response.json().catch(() => ({}))) as Partial<CaseReplyJson> & { error?: string };
  if (!response.ok || !data.token || !data.view) throw new Error(data.error ?? `The request failed (${response.status})`);
  return { token: data.token, view: data.view };
}
