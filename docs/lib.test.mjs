import { describe, expect, it } from "vitest";

import {
  activeReplacements,
  addTerm,
  anonymize,
  applyCorrections,
  buildFilename,
  buildPrompt,
  createStreamParser,
  detectTerms,
  nextAlias,
  parseCorrections,
  restore,
  textFromMessage,
} from "./lib.js";

function terms(...entries) {
  const list = [];
  for (const [original, type, overrides = {}] of entries) {
    Object.assign(addTerm(list, original, type), overrides);
  }
  return list;
}

describe("parseCorrections", () => {
  it("parses one rule per line and ignores blanks", () => {
    expect(parseCorrections("  Jon Doe => John Doe \n\n bad => good ")).toEqual([
      { find: "Jon Doe", replace: "John Doe" },
      { find: "bad", replace: "good" },
    ]);
  });

  it("keeps later arrows in the replacement", () => {
    expect(parseCorrections("a => b => c")).toEqual([{ find: "a", replace: "b => c" }]);
  });

  it("drops lines without an arrow", () => {
    expect(parseCorrections("no arrow here\n=> missing find")).toEqual([]);
  });
});

describe("applyCorrections", () => {
  it("replaces whole words case-insensitively", () => {
    const rules = parseCorrections("acme => Acme Corp");
    expect(applyCorrections("ACME shipped it", rules)).toBe("Acme Corp shipped it");
  });

  it("does not match inside longer words", () => {
    const rules = parseCorrections("cat => dog");
    expect(applyCorrections("category cat", rules)).toBe("category dog");
  });

  it("treats $ sequences in the replacement as literal text", () => {
    const rules = parseCorrections("PRICE => $&100");
    expect(applyCorrections("PRICE agreed", rules)).toBe("$&100 agreed");
  });
});

describe("alias assignment", () => {
  it("numbers people and organizations independently", () => {
    const list = terms(["Dana Fields", "person"], ["Acme Systems", "org"], ["Rae Lin", "person"]);
    expect(list.map((term) => term.alias)).toEqual(["PERSON_1", "ORG_1", "PERSON_2"]);
  });

  it("skips duplicates regardless of case or spacing", () => {
    const list = terms(["Dana Fields", "person"]);
    expect(addTerm(list, "  dana   fields ", "person")).toBeNull();
    expect(list).toHaveLength(1);
  });

  it("ignores empty input", () => {
    const list = [];
    expect(addTerm(list, "   ", "person")).toBeNull();
    expect(list).toHaveLength(0);
  });

  it("continues numbering past the highest alias in use", () => {
    const list = terms(["Dana Fields", "person", { alias: "PERSON_7" }]);
    expect(nextAlias(list, "person")).toBe("PERSON_8");
    expect(nextAlias(list, "org")).toBe("ORG_1");
  });
});

describe("anonymize and restore", () => {
  it("round-trips text through aliases", () => {
    const list = terms(["Dana Fields", "person"], ["Acme Systems", "org"]);
    const hidden = anonymize("Dana Fields from Acme Systems joined.", list);
    expect(hidden).toBe("PERSON_1 from ORG_1 joined.");
    expect(restore(hidden, list)).toBe("Dana Fields from Acme Systems joined.");
  });

  it("replaces longer terms before shorter overlapping ones", () => {
    const list = terms(["Acme", "org"], ["Acme Systems", "org"]);
    expect(anonymize("Acme Systems and Acme", list)).toBe("ORG_2 and ORG_1");
  });

  it("does not let ORG_1 corrupt ORG_12 on the way back", () => {
    const list = terms(
      ["Acme", "org", { alias: "ORG_1", restored: "Acme" }],
      ["Globex", "org", { alias: "ORG_12", restored: "Globex" }],
    );
    expect(restore("ORG_12 acquired ORG_1", list)).toBe("Globex acquired Acme");
  });

  it("restores to the edited restored value when provided", () => {
    const list = terms(["Dana Fields", "person", { restored: "Dana F." }]);
    expect(restore("PERSON_1 spoke", list)).toBe("Dana F. spoke");
  });

  it("leaves disabled terms untouched", () => {
    const list = terms(["Dana Fields", "person", { enabled: false }], ["Acme Systems", "org"]);
    expect(activeReplacements(list)).toHaveLength(1);
    expect(anonymize("Dana Fields at Acme Systems", list)).toBe("Dana Fields at ORG_1");
  });
});

describe("detectTerms", () => {
  it("finds people, companies, emails and phone numbers", () => {
    const list = [];
    detectTerms(list, "Dana Fields at Acme Systems emailed dana@acme.com or call 512-555-0134.");
    const found = list.map((term) => term.original);
    expect(found).toContain("Dana Fields");
    expect(found).toContain("Acme Systems");
    expect(found).toContain("dana@acme.com");
    expect(found).toContain("512-555-0134");
  });

  it("stops a company name at the first lowercase word", () => {
    const list = [];
    detectTerms(list, "Dana Fields from Acme Systems asked about pricing.");
    const found = list.map((term) => term.original);
    expect(found).toContain("Acme Systems");
    expect(found).not.toContain("Dana Fields from Acme Systems");
  });

  it("keeps multi-word company names together", () => {
    const list = [];
    detectTerms(list, "Signed with Northwind Data Technologies today.");
    expect(list.map((term) => term.original)).toContain("Northwind Data Technologies");
  });

  it("skips note headings, months and common acronyms", () => {
    const list = [];
    detectTerms(list, "Executive Summary\nAction Items\nJanuary Review\nThe API and CSV export.");
    expect(list.map((term) => term.original)).not.toContain("Executive Summary");
    expect(list.map((term) => term.original)).not.toContain("Action Items");
    expect(list.map((term) => term.original)).not.toContain("API");
    expect(list.map((term) => term.original)).not.toContain("CSV");
  });

  it("only reports newly added terms on a rescan", () => {
    const list = [];
    const text = "Dana Fields met Rae Lin.";
    expect(detectTerms(list, text)).toBeGreaterThan(0);
    expect(detectTerms(list, text)).toBe(0);
  });
});

describe("buildPrompt", () => {
  it("includes metadata, structure and the sanitized source", () => {
    const prompt = buildPrompt({
      mode: "meeting",
      title: "Quarterly sync",
      date: "2026-02-03",
      context: "Renewal risk",
      source: "PERSON_1 asked about pricing.",
    });

    expect(prompt).toContain("Title: Quarterly sync");
    expect(prompt).toContain("Date: 2026-02-03");
    expect(prompt).toContain("Type: Meeting");
    expect(prompt).toContain("Renewal risk");
    expect(prompt).toContain("## Action Items");
    expect(prompt).toContain("PERSON_1 asked about pricing.");
  });

  it("switches wording for email threads", () => {
    const prompt = buildPrompt({ mode: "email", date: "2026-02-03", source: "..." });
    expect(prompt).toContain("email thread below");
    expect(prompt).toContain("Type: Email Thread");
    expect(prompt).toContain("# Email Thread");
  });

  it("falls back to Not stated when no context is given", () => {
    expect(buildPrompt({ date: "2026-02-03", source: "..." })).toContain("User context:\nNot stated.");
  });
});

describe("buildFilename", () => {
  it("slugifies the title and prefixes the date", () => {
    expect(buildFilename({ title: "Acme / Q1 Sync!", date: "2026-02-03" })).toBe("2026-02-03-Acme-Q1-Sync.md");
  });

  it("uses the mode default when the title is blank", () => {
    expect(buildFilename({ title: "   ", date: "2026-02-03", mode: "email" })).toBe("2026-02-03-Email-Thread.md");
  });

  it("falls back to note when the title has no usable characters", () => {
    expect(buildFilename({ title: "///", date: "2026-02-03" })).toBe("2026-02-03-note.md");
  });
});

describe("textFromMessage", () => {
  it("joins text blocks and ignores other block types", () => {
    expect(textFromMessage({ content: [{ type: "text", text: "# Note" }, { type: "thinking" }] })).toBe("# Note");
  });

  it("handles an empty response", () => {
    expect(textFromMessage({})).toBe("");
  });
});

describe("createStreamParser", () => {
  const event = (data) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`;
  const delta = (text) => event({ type: "content_block_delta", delta: { type: "text_delta", text } });

  it("returns text deltas in order", () => {
    const push = createStreamParser();
    expect(push(delta("# Note"))).toBe("# Note");
    expect(push(delta("\n\nSummary"))).toBe("\n\nSummary");
  });

  it("buffers events split across chunks", () => {
    const push = createStreamParser();
    const raw = delta("hello world");
    expect(push(raw.slice(0, 30))).toBe("");
    expect(push(raw.slice(30))).toBe("hello world");
  });

  it("ignores non-text events and keepalives", () => {
    const push = createStreamParser();
    expect(push(event({ type: "message_start" }) + ": ping\n\n" + delta("x"))).toBe("x");
  });

  it("throws when the stream reports an error", () => {
    const push = createStreamParser();
    expect(() => push(event({ type: "error", error: { message: "overloaded" } }))).toThrow("overloaded");
  });

  it("skips malformed data lines instead of failing", () => {
    const push = createStreamParser();
    expect(push("data: {not json}\n\n" + delta("ok"))).toBe("ok");
  });
});
