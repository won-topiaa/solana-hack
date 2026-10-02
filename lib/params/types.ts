// Shapes of data/params.json, the parameter registry. The rules for each field
// are written in the registry itself under "rules".

export type ParamKind = "market" | "product" | "design" | "reference";

export type ParamEntry = {
  value: unknown; // checked by the typed getters in inputs.ts
  unit: string;
  kind: ParamKind;
  source: string;
  source_url: string | null;
  as_of: string; // YYYY-MM-DD: the date the value refers to
  checked_at: string | null; // YYYY-MM-DD: last confirmed at its source
  valid_days: number | null; // null = never goes stale
};

export type Registry = {
  registry_version: string; // YYYY-MM-DD.N, recorded in every recommendation receipt
  created_at: string;
  status: string;
  changelog: { version: string; note: string }[];
  rules: Record<string, unknown>;
  params: Record<string, ParamEntry>;
  // Not in params.json: set by freezeRegistry for a deployment that must keep working
  // after the values age (the judging period). Freshness is then checked on this date.
  frozenOn?: string;
};
