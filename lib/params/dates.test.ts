import { describe, expect, it } from "vitest";
import { addDays, daysBetween, isIsoDate, todayInNewYork } from "./dates";

describe("isIsoDate", () => {
  it("accepts real calendar dates", () => {
    expect(isIsoDate("2026-10-01")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects impossible or badly written dates", () => {
    for (const text of ["2026-02-30", "2026-13-01", "2026-1-01", "20261001", "yesterday"]) {
      expect(isIsoDate(text)).toBe(false);
    }
  });
});

describe("daysBetween", () => {
  it("counts calendar days", () => {
    expect(daysBetween("2026-09-24", "2026-10-01")).toBe(7);
  });

  it("is not thrown off by the end of US daylight saving time (Nov 1, 2026)", () => {
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("is negative when the second date is earlier", () => {
    expect(daysBetween("2026-10-01", "2026-09-30")).toBe(-1);
  });
});

describe("todayInNewYork", () => {
  it("uses the Eastern date, not the UTC date", () => {
    // 03:00 UTC on Oct 2 is 23:00 on Oct 1 in New York (UTC-4 in October).
    expect(todayInNewYork(new Date("2026-10-02T03:00:00Z"))).toBe("2026-10-01");
  });

  it("moves to the next day at midnight Eastern", () => {
    expect(todayInNewYork(new Date("2026-10-02T04:00:00Z"))).toBe("2026-10-02");
  });
});

describe("addDays", () => {
  it("moves across month and year ends, and back", () => {
    expect(addDays("2026-10-01", 1)).toBe("2026-10-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-01", addDays("2026-10-01", 45))).toBe(45);
  });
});
