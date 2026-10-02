import { describe, expect, it } from "vitest";
import { hashSerial, newSalt, normalizeSerial, redactSerial } from "./serial";

describe("serial numbers", () => {
  it("treat spacing, dashes and case as the same serial", () => {
    expect(normalizeSerial("dw 773-1842")).toBe("DW7731842");
    expect(hashSerial("dw 773-1842", "salt-1")).toBe(hashSerial("DW7731842", "salt-1"));
  });

  it("hash differently with a different salt, so the published hash cannot be matched by trying serials", () => {
    expect(hashSerial("DW7731842", "salt-1")).not.toBe(hashSerial("DW7731842", "salt-2"));
  });

  it("give a 64-character hex hash that does not contain the serial", () => {
    const hash = hashSerial("DW7731842", newSalt());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("7731842");
  });

  it("are blanked out of a text however they are written", () => {
    const text = "Serial DW7731842 on the case back; papers say dw 773-1842 and Dw-7731842.";
    const redacted = redactSerial(text, "DW 773-1842");
    expect(redacted).toBe("Serial [serial] on the case back; papers say [serial] and [serial].");
    expect(redactSerial("No serial here.", "")).toBe("No serial here.");
  });

  it("make a new random salt each time", () => {
    expect(newSalt()).toMatch(/^[0-9a-f]{32}$/);
    expect(newSalt()).not.toBe(newSalt());
  });
});
