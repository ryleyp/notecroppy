import { describe, it, expect } from "vitest";
import {
  lineContainsKeyword,
  getForbiddenKeywords,
  buildScrubReport,
  scrubWithExceptions,
  findAccountBleed,
  redactForbiddenTerms,
  countTermHits,
  assessNoteDominance,
} from "@/lib/scrub";

const ACCOUNTS = [
  { name: "Acme", aliases: ["acme", "aac"], keywords: ["ORB", "TRX-3"] },
  { name: "Beacon", aliases: ["beacon", "beacon sys"], keywords: ["SKYCAM"] },
  { name: "Cardinal", aliases: ["cardinal", "cad"], keywords: ["X-14"] },
  { name: "Internal", aliases: [], keywords: ["standup"] },
  { name: "Delta", aliases: ["delta"], keywords: [] },
];

function note(filename, content, extra = {}) {
  return { filename, title: filename.replace(".md", ""), date: "2026-06-01", content, ...extra };
}

describe("lineContainsKeyword", () => {
  it("matches whole words case-insensitively", () => {
    expect(lineContainsKeyword("Discussed cad roadmap", ["CAD"])).toBe(true);
    expect(lineContainsKeyword("Discussed CAD roadmap", ["cad"])).toBe(true);
  });

  it("does not match a keyword embedded inside a larger word", () => {
    expect(lineContainsKeyword("the ecadomputer lab", ["cad"])).toBe(false);
    expect(lineContainsKeyword("siorbx module", ["orb"])).toBe(false);
  });

  it("matches keywords adjacent to punctuation", () => {
    expect(lineContainsKeyword("Update (CAD): slipped", ["CAD"])).toBe(true);
    expect(lineContainsKeyword("CAD, LM, and others", ["CAD"])).toBe(true);
    expect(lineContainsKeyword("priorities: X-14.", ["X-14"])).toBe(true);
  });

  it("handles keywords with regex special characters and non-word edges", () => {
    // "X-14" ends with a digit (word char) but contains a dash
    expect(lineContainsKeyword("X-14 program sync", ["X-14"])).toBe(true);
    // keyword ending in non-word char anchors only on the word side
    expect(lineContainsKeyword("uses C++ daily", ["C++"])).toBe(true);
  });

  it("ignores blank or whitespace-only keywords", () => {
    expect(lineContainsKeyword("anything at all", ["", "  "])).toBe(false);
  });
});

describe("getForbiddenKeywords", () => {
  it("collects keywords from all other accounts", () => {
    const kws = getForbiddenKeywords("Beacon", ACCOUNTS);
    expect(kws).toContain("ORB");
    expect(kws).toContain("cad");
    expect(kws).toContain("X-14");
  });

  it("excludes the current account's own keywords", () => {
    const kws = getForbiddenKeywords("Beacon", ACCOUNTS);
    expect(kws).not.toContain("SKYCAM");
  });

  it("excludes Internal keywords so internal terms are never scrubbed", () => {
    const kws = getForbiddenKeywords("Beacon", ACCOUNTS);
    expect(kws).not.toContain("standup");
  });

  it("returns empty for missing account list", () => {
    expect(getForbiddenKeywords("Beacon", undefined)).toEqual([]);
    expect(getForbiddenKeywords("Beacon", [])).toEqual([]);
  });

  it("includes other accounts' names and aliases, not just keywords", () => {
    const kws = getForbiddenKeywords("Cardinal", ACCOUNTS);
    expect(kws).toContain("Beacon");
    expect(kws).toContain("beacon sys");
    expect(kws).toContain("Acme");
    expect(kws).toContain("acme");
  });

  it("scrubs nothing for Internal reports (they legitimately span accounts)", () => {
    expect(getForbiddenKeywords("Internal", ACCOUNTS)).toEqual([]);
    expect(getForbiddenKeywords("", ACCOUNTS)).toEqual([]);
  });

  it("never forbids a term the current account also claims (alias collision)", () => {
    const shared = [
      { name: "Alpha", aliases: ["harris"], keywords: [] },
      { name: "Beta", aliases: ["harris", "beta"], keywords: [] },
    ];
    const kws = getForbiddenKeywords("Alpha", shared);
    expect(kws).not.toContain("harris");
    expect(kws).toContain("beta");
  });
});

describe("account name/alias bleed protection", () => {
  it("flags a line naming another account even with no keyword match", () => {
    const notes = [note("a.md", "CAD quarter update\nBeacon asked about licensing terms\nAll set")];
    const report = buildScrubReport(notes, "Cardinal", ACCOUNTS);
    expect(report).toHaveLength(1);
    expect(report[0].line).toContain("Beacon");
  });

  it("scrubs lines mentioning another account's alias", () => {
    const notes = [note("a.md", "Beacon keep\nacme folks joined the call\nkeep too")];
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("Beacon keep\nkeep too");
  });

  it("does not scrub the current account's own name from its own report", () => {
    const notes = [note("a.md", "Beacon renewal is on track")];
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("Beacon renewal is on track");
  });
});

describe("countTermHits / assessNoteDominance", () => {
  it("counts whole-word hits across terms", () => {
    expect(countTermHits("CAD met CAD about cad things", ["cad"])).toBe(3);
    expect(countTermHits("ecadomputer", ["cad"])).toBe(0);
  });

  it("flags a note dominated by another account for auto-exclusion", () => {
    const n = note("a.md", "cardinal sites reviewed\nCAD coverage plan\nX-14 milestones\nbrief beacon aside");
    const dom = assessNoteDominance(n, "Beacon", ACCOUNTS);
    expect(dom.account).toBe("Cardinal");
    expect(dom.hits).toBeGreaterThan(dom.ownHits);
  });

  it("does not flag a note that is mostly about the current account", () => {
    const n = note("a.md", "beacon renewal\nBeacon SKYCAM demo\none cad mention\nbeacon sys follow-up");
    expect(assessNoteDominance(n, "Beacon", ACCOUNTS)).toBeNull();
  });

  it("never flags for Internal reports", () => {
    const n = note("a.md", "cardinal cardinal cardinal");
    expect(assessNoteDominance(n, "Internal", ACCOUNTS)).toBeNull();
  });
});

describe("transcript scrub radius", () => {
  it("removes surrounding context lines around a mention inside a large anchored block", () => {
    const lines = [
      "beacon kickoff discussion",   // 0 own — kept
      "general agenda review",         // 1 within radius of 3 — removed
      "budget context for the program",// 2 within radius of 3 — removed
      "cardinal asked about licensing",// 3 forbidden — removed
      "they want the site expansion",  // 4 within radius — removed
      "timeline is next quarter",      // 5 within radius — removed
      "back to beacon items",        // 6 own — kept
      "beacon action items assigned",// 7 own — kept
    ].join("\n");
    const [scrubbed] = scrubWithExceptions([note("a.md", lines)], "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe(
      "beacon kickoff discussion\nback to beacon items\nbeacon action items assigned"
    );
  });

  it("does not apply the radius to small anchored paragraphs", () => {
    const content = "Beacon keep\nacme folks joined the call\nkeep too";
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("Beacon keep\nkeep too");
  });
});

describe("context-aware scrubbing (orphaned content)", () => {
  it("removes an entire heading section about another account, including lines with no forbidden term", () => {
    const content = [
      "# Cardinal review",
      "- add Northridge to coverage",
      "- Space Park regional grouping",
      "# Beacon review",
      "- beacon renewal on track",
    ].join("\n");
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("# Beacon review\n- beacon renewal on track");
  });

  it("removes a whole paragraph about another account when the current account is never named", () => {
    const content = [
      "Discussed acme renewal timeline",
      "Follow up on unused training credits at Sunnyvale",
      "Schedule next-gen test system upgrade sync",
      "",
      "Beacon SKYCAM demo went well",
    ].join("\n");
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("\nBeacon SKYCAM demo went well");
  });

  it("keeps the rest of a paragraph that also names the current account", () => {
    const content = "Beacon and acme joint supplier review\nAction item for the Beacon team";
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("Action item for the Beacon team");
  });

  it("scrub report lists every line the scrubber would remove (block agreement)", () => {
    const content = "Discussed acme renewal\nFollow up on Sunnyvale credits\nSchedule sync";
    const notes = [note("a.md", content)];
    const report = buildScrubReport(notes, "Beacon", ACCOUNTS);
    expect(report.map((r) => r.id)).toEqual(["a.md__0", "a.md__1", "a.md__2"]);
    // Restoring everything must round-trip to the original.
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS, report.map((r) => r.id));
    expect(scrubbed.content).toBe(content);
  });
});

describe("redactForbiddenTerms", () => {
  it("replaces other-account names, aliases, and keywords case-insensitively", () => {
    const { text, count } = redactForbiddenTerms(
      "Met with Beacon and ACME about ORB testing",
      "Cardinal",
      ACCOUNTS
    );
    expect(text).toBe("Met with █████ and █████ about █████ testing");
    expect(count).toBe(3);
  });

  it("leaves the current account's own terms intact", () => {
    const { text, count } = redactForbiddenTerms("Cardinal CAD update", "Cardinal", ACCOUNTS);
    expect(text).toBe("Cardinal CAD update");
    expect(count).toBe(0);
  });

  it("does not redact terms embedded inside larger words", () => {
    const { text } = redactForbiddenTerms("the ecadomputer lab", "Beacon", ACCOUNTS);
    expect(text).toBe("the ecadomputer lab");
  });

  it("is a no-op for Internal reports", () => {
    const { text, count } = redactForbiddenTerms("Beacon and acme", "Internal", ACCOUNTS);
    expect(text).toBe("Beacon and acme");
    expect(count).toBe(0);
  });

  it("scrubWithExceptions redacts other-account terms from note titles", () => {
    const notes = [note("2026-04-01 - CAD and Beacon Review.md", "safe content", { title: "CAD and Beacon Review" })];
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS);
    expect(scrubbed.title).toBe("█████ and Beacon Review");
  });
});

describe("findAccountBleed", () => {
  it("reports terms from other accounts found in output text", () => {
    const output = "| 2026-04-01 | Sync | ... | CSM met with Beacon and acme teams |";
    const hits = findAccountBleed(output, "Cardinal", ACCOUNTS);
    expect(hits.map((h) => h.account).sort()).toEqual(["Acme", "Beacon"]);
    expect(hits.find((h) => h.account === "Beacon").terms).toContain("Beacon");
  });

  it("returns empty when output only mentions the current account", () => {
    const output = "Cardinal CAD cardinal all good";
    expect(findAccountBleed(output, "Cardinal", ACCOUNTS)).toEqual([]);
  });

  it("does not false-positive on words containing an alias", () => {
    const output = "the ecadomputer lab expansion";
    expect(findAccountBleed(output, "Beacon", ACCOUNTS)).toEqual([]);
  });

  it("returns empty for Internal or blank inputs", () => {
    expect(findAccountBleed("Beacon stuff", "Internal", ACCOUNTS)).toEqual([]);
    expect(findAccountBleed("", "Cardinal", ACCOUNTS)).toEqual([]);
  });
});

describe("buildScrubReport", () => {
  it("flags lines containing other accounts' keywords", () => {
    const notes = [note("2026-06-01 - Beacon Sync.md", "Beacon renewal on track\nCAD asked about licensing\nAll good")];
    const report = buildScrubReport(notes, "Beacon", ACCOUNTS);
    expect(report).toHaveLength(1);
    expect(report[0].line).toBe("CAD asked about licensing");
    expect(report[0].id).toBe("2026-06-01 - Beacon Sync.md__1");
  });

  it("does not flag the current account's own keywords", () => {
    const notes = [note("a.md", "SKYCAM demo went well")];
    expect(buildScrubReport(notes, "Beacon", ACCOUNTS)).toHaveLength(0);
  });

  it("skips blank lines even if surrounded by flagged content", () => {
    const notes = [note("a.md", "CAD item\n\nCAD item two")];
    const report = buildScrubReport(notes, "Beacon", ACCOUNTS);
    expect(report.map((r) => r.id)).toEqual(["a.md__0", "a.md__2"]);
  });

  it("returns empty when no other account has keywords", () => {
    const notes = [note("a.md", "CAD everywhere")];
    expect(buildScrubReport(notes, "Beacon", [{ name: "Beacon", keywords: ["x"] }])).toEqual([]);
  });

  it("assigns stable per-note line IDs across multiple notes", () => {
    const notes = [note("a.md", "CAD one"), note("b.md", "Beacon safe\nORB two")];
    const report = buildScrubReport(notes, "Beacon", ACCOUNTS);
    expect(report.map((r) => r.id)).toEqual(["a.md__0", "b.md__1"]);
  });
});

describe("scrubWithExceptions", () => {
  it("removes flagged lines from note content", () => {
    const notes = [note("a.md", "Beacon keep this\nCAD secret line\nkeep this too")];
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS);
    expect(scrubbed.content).toBe("Beacon keep this\nkeep this too");
  });

  it("preserves lines whose IDs were restored via checkbox", () => {
    const notes = [note("a.md", "Beacon keep\nCAD restored line\nORB removed line")];
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS, ["a.md__1"]);
    expect(scrubbed.content).toBe("Beacon keep\nCAD restored line");
  });

  it("returns notes untouched when there are no forbidden keywords", () => {
    const notes = [note("a.md", "CAD everywhere")];
    const result = scrubWithExceptions(notes, "Beacon", [{ name: "Beacon", keywords: [] }]);
    expect(result[0].content).toBe("CAD everywhere");
  });

  it("does not let one note's restored ID leak into another note's line", () => {
    const notes = [note("a.md", "CAD line"), note("b.md", "CAD line")];
    const result = scrubWithExceptions(notes, "Beacon", ACCOUNTS, ["a.md__0"]);
    expect(result[0].content).toBe("CAD line");
    expect(result[1].content).toBe("");
  });

  it("scrub report and scrubber agree on which lines are affected", () => {
    const content = "L3 all good\nCAD status: waiting\nBudget for X-14 grew\nplain line";
    const notes = [note("a.md", content)];
    const report = buildScrubReport(notes, "Beacon", ACCOUNTS);
    const restoredAll = report.map((r) => r.id);
    // Restoring everything the report flagged must round-trip to the original.
    const [scrubbed] = scrubWithExceptions(notes, "Beacon", ACCOUNTS, restoredAll);
    expect(scrubbed.content).toBe(content);
  });
});
