import { describe, expect, it } from "vitest";
import { createCaseFile } from "../agent/orchestrator";
import { personaCase } from "../recommend/personas";
import { openCase, sealCase } from "./caseToken";

const secret = "test-secret-that-is-long-enough-1234567890";

describe("sealed case token", () => {
  it("opens to the same case", () => {
    const caseFile = personaCase("B", new Date("2026-10-01T15:00:00Z"));
    expect(openCase(sealCase(caseFile, secret), secret)).toEqual(caseFile);
  });

  it("hides the personal data inside", () => {
    const caseFile = personaCase("B", new Date("2026-10-01T15:00:00Z"));
    const token = sealCase(caseFile, secret);
    expect(token).not.toContain("Demo Lane");
    expect(Buffer.from(token.slice(3), "base64url").toString("latin1")).not.toContain("Demo Lane");
  });

  it("refuses a changed token, another key, or a foreign token", () => {
    const token = sealCase(createCaseFile("case-1"), secret);
    const changed = token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA");
    expect(() => openCase(changed, secret)).toThrow(/changed or sealed with another key/);
    expect(() => openCase(token, "another-secret-that-is-long-enough-12345")).toThrow(/changed or sealed with another key/);
    expect(() => openCase("v0.abc", secret)).toThrow(/Unknown case token/);
  });

  it("needs a long secret", () => {
    expect(() => sealCase(createCaseFile("case-1"), "short")).toThrow(/at least 32 characters/);
  });
});
