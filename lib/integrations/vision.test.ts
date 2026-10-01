import { describe, expect, it } from "vitest";
import { categoryFromReading, parseWatchReading, WATCH_READING_SCHEMA, type WatchReading } from "./vision";

const reading: WatchReading = {
  maker: "Demo Watch Co.",
  model: "Demo Diver 300",
  reference: "DEMO-300",
  serial: "DW7731842",
  caseMaterial: "steel",
  style: "sport",
  boxVisible: false,
  papersVisible: true,
  notes: null,
};

describe("parseWatchReading", () => {
  it("accepts an answer in the schema's shape and trims text", () => {
    expect(parseWatchReading({ ...reading, model: "  Demo Diver 300 " })).toEqual(reading);
  });

  it("turns empty text into null (not visible)", () => {
    expect(parseWatchReading({ ...reading, serial: "" }).serial).toBeNull();
  });

  const bad: [string, Record<string, unknown>][] = [
    ["a missing yes/no field", { ...reading, boxVisible: undefined }],
    ["a material outside the list", { ...reading, caseMaterial: "wood" }],
    ["a number where text belongs", { ...reading, reference: 300 }],
    ["text far too long to be printed on a watch", { ...reading, model: "x".repeat(200) }],
  ];
  it.each(bad)("rejects %s", (_case, data) => {
    expect(() => parseWatchReading(data)).toThrow(/Vision answer/);
  });

  it("asks the model for every field (all are required, unknown = null)", () => {
    expect([...WATCH_READING_SCHEMA.required].sort()).toEqual(Object.keys(reading).sort());
  });
});

describe("categoryFromReading", () => {
  it("decides only clear cases", () => {
    expect(categoryFromReading(reading)).toBe("sport_steel");
    expect(categoryFromReading({ ...reading, caseMaterial: "gold", style: "dress" })).toBe("dress_gold");
    expect(categoryFromReading({ ...reading, caseMaterial: "steel", style: "dress" })).toBeNull();
    expect(categoryFromReading({ ...reading, caseMaterial: "two_tone" })).toBeNull();
    expect(categoryFromReading({ ...reading, caseMaterial: null })).toBeNull();
  });
});
