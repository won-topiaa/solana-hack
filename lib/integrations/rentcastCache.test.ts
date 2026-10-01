import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeAddress, type PropertyLookup } from "./rentcast";
import { createFileStore } from "./rentcastCache";

const lookup: PropertyLookup = {
  property: { id: "p1", formattedAddress: "742 Demo Lane, Exampleville, CA 99999", owner: { names: ["Jordan Sample"] } },
  value: { price: 1_000_000, priceRangeLow: 930_000, priceRangeHigh: 1_070_000 },
  source: "RentCast",
  fetchedAt: "2026-10-01",
};

describe("createFileStore", () => {
  it("keeps a lookup between runs under a hashed file name", () => {
    const dir = mkdtempSync(join(tmpdir(), "rentcast-cache-"));
    const key = normalizeAddress("742 Demo Lane, Exampleville, CA 99999");
    createFileStore(dir).set(key, lookup);

    expect(createFileStore(dir).get(key)).toEqual(lookup); // a new store reads the same file
    const [file] = readdirSync(dir);
    expect(file).toMatch(/^[0-9a-f]{64}\.json$/); // the address is not in the file name
    expect(JSON.parse(readFileSync(join(dir, file), "utf8"))).toEqual(lookup);
  });

  it("returns nothing for an address it has not seen", () => {
    const dir = mkdtempSync(join(tmpdir(), "rentcast-cache-"));
    expect(createFileStore(dir).get("1 nowhere rd")).toBeUndefined();
  });
});
