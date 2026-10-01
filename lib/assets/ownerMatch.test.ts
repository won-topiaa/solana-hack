import { describe, expect, it } from "vitest";
import { matchOwner, nameWords } from "./ownerMatch";

describe("nameWords", () => {
  it("ignores case, accents, punctuation and middle initials", () => {
    expect(nameWords("José A. Núñez-Smith")).toEqual(["jose", "nunez-smith"]);
  });
});

describe("matchOwner", () => {
  const cases: [string, string, string[], string][] = [
    ["the same name", "Jordan Sample", ["Jordan Sample"], "match"],
    ["records written LAST FIRST with an initial", "Jordan A. Sample", ["SAMPLE JORDAN"], "match"],
    ["the user named among co-owners", "Jordan Sample", ["Casey Sample", "Jordan Sample"], "match"],
    ["only the family name in common", "Jordan Sample", ["Casey Sample"], "partial"],
    ["a company that carries the family name", "Jordan Sample", ["SAMPLE HOLDINGS LLC"], "partial"],
    ["a first name alone", "Jordan", ["Jordan Sample"], "partial"],
    ["a different person", "Pat Other", ["Jordan Sample"], "no_match"],
    ["no owner on record", "Jordan Sample", [], "unknown"],
    ["no name given", "", ["Jordan Sample"], "unknown"],
  ];

  it.each(cases)("%s", (_case, userName, ownerNames, expected) => {
    expect(matchOwner(userName, ownerNames)).toBe(expected);
  });
});
