import { describe, it, expect } from "vitest";
import {
  applyCorrections,
  applyReplacements,
  reverseReplacements,
  assignAliases,
  correctionFromRestoredItem,
  mergeCorrections,
} from "@/lib/sanitize";

describe("applyCorrections", () => {
  it("returns text unchanged when no corrections", () => {
    expect(applyCorrections("hello in there", [])).toBe("hello in there");
    expect(applyCorrections("hello", undefined)).toBe("hello");
  });

  it("applies find/replace pairs", () => {
    const out = applyCorrections("we use in tools", [{ find: "in tools", replace: "NI tools" }]);
    expect(out).toBe("we use NI tools");
  });

  it("treats empty replace as deletion", () => {
    expect(applyCorrections("a um b um c", [{ find: " um", replace: "" }])).toBe("a b c");
  });

  it("skips entries with a blank find", () => {
    expect(applyCorrections("abc", [{ find: "  ", replace: "x" }])).toBe("abc");
  });
});

describe("privacy review corrections", () => {
  it("creates a correction when a restored spelling differs from the detected text", () => {
    expect(correctionFromRestoredItem({ text: "Riley", alias: "PERSON_1", restored: "Ryley" })).toEqual({
      find: "Riley",
      replace: "Ryley",
    });
  });

  it("does not create a correction when the restored spelling is unchanged", () => {
    expect(correctionFromRestoredItem({ text: "Riley", alias: "PERSON_1", restored: "Riley" })).toBeNull();
  });

  it("updates an existing correction instead of appending a conflicting duplicate", () => {
    const merged = mergeCorrections(
      [{ find: "Riley", replace: "Rylee" }, { find: "in tools", replace: "NI tools" }],
      [{ find: "Riley", replace: "Ryley" }]
    );

    expect(merged).toEqual([
      { find: "Riley", replace: "Ryley" },
      { find: "in tools", replace: "NI tools" },
    ]);
  });
});

describe("applyReplacements", () => {
  it("replaces whole words case-insensitively", () => {
    const out = applyReplacements("Met with Acme and acme again", [
      { original: "Acme", alias: "ORG_1" },
    ]);
    expect(out).toBe("Met with ORG_1 and ORG_1 again");
  });

  it("does not replace inside a larger word", () => {
    const out = applyReplacements("the airframe", [{ original: "air", alias: "X" }]);
    expect(out).toBe("the airframe");
  });

  it("honors the skip flag", () => {
    const out = applyReplacements("Acme", [{ original: "Acme", alias: "ORG_1", skip: true }]);
    expect(out).toBe("Acme");
  });
});

describe("reverseReplacements", () => {
  it("restores aliases to their real names", () => {
    const out = reverseReplacements("ORG_1 shipped it", [
      { original: "Acme", alias: "ORG_1" },
    ]);
    expect(out).toBe("Acme shipped it");
  });

  it("prefers an explicit restored value", () => {
    const out = reverseReplacements("PERSON_1 called", [
      { original: "Bob", alias: "PERSON_1", restored: "Bob Smith" },
    ]);
    expect(out).toBe("Bob Smith called");
  });

  it("does not let ORG_1 corrupt ORG_12 (alias collision)", () => {
    const replacements = [
      { original: "Acme", alias: "ORG_1" },
      { original: "Globex", alias: "ORG_12" },
    ];
    const out = reverseReplacements("ORG_1 partnered with ORG_12", replacements);
    expect(out).toBe("Acme partnered with Globex");
  });
});

describe("round-trip", () => {
  it("forward then reverse returns the original text", () => {
    const replacements = [
      { original: "Acme", alias: "ORG_1" },
      { original: "Jane Doe", alias: "PERSON_1" },
    ];
    const original = "Jane Doe from Acme met the Acme team.";
    const sanitized = applyReplacements(original, replacements);
    expect(sanitized).not.toContain("Acme");
    expect(sanitized).not.toContain("Jane Doe");
    expect(reverseReplacements(sanitized, replacements)).toBe(original);
  });
});

describe("assignAliases", () => {
  it("assigns unique, type-prefixed aliases avoiding existing ones", () => {
    const result = assignAliases(
      [{ text: "Bob", type: "person" }, { text: "Acme", type: "org" }],
      [{ original: "Old", alias: "PERSON_1" }]
    );
    expect(result[0].alias).toBe("PERSON_2");
    expect(result[1].alias).toBe("ORG_1");
  });
});
