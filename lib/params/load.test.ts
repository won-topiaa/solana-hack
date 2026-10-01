import { describe, expect, it } from "vitest";
import registryJson from "../../data/params.json";
import { getRegistry, parseRegistry } from "./load";

/** A fresh, editable copy of the real registry file. */
function realRegistryCopy(): { params: Record<string, Record<string, unknown>> } {
  return structuredClone(registryJson) as unknown as { params: Record<string, Record<string, unknown>> };
}

describe("the real data/params.json", () => {
  it("passes every check", () => {
    const registry = getRegistry();
    expect(registry.registry_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(Object.keys(registry.params).length).toBeGreaterThan(0);
  });
});

describe("parseRegistry rejects a broken entry", () => {
  const broken: [string, (entry: Record<string, unknown>) => void][] = [
    ["an unknown kind", (entry) => (entry.kind = "guess")],
    ["a missing value", (entry) => delete entry.value],
    ["an impossible as_of date", (entry) => (entry.as_of = "2026-13-01")],
    ["a checked_at that is not a date", (entry) => (entry.checked_at = "yesterday")],
    ["negative valid_days", (entry) => (entry.valid_days = -1)],
    ["an empty source", (entry) => (entry.source = "")],
  ];

  it.each(broken)("with %s", (_problem, breakIt) => {
    const data = realRegistryCopy();
    breakIt(data.params.hei_fee_rate);
    expect(() => parseRegistry(data)).toThrow(/params\.json: params\.hei_fee_rate/);
  });

  it("rejects a file without a registry_version", () => {
    const data = realRegistryCopy() as Record<string, unknown>;
    delete data.registry_version;
    expect(() => parseRegistry(data)).toThrow(/registry_version/);
  });
});
