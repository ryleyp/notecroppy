import { describe, expect, it } from "vitest";
import {
  factsToMarkdown,
  inferNextMappingSection,
  mergeFacts,
  noteFingerprint,
  parseContactFacts,
  stableSourceId,
  verifyStakeholderMapDocument,
} from "./contactMapping";

describe("contactMapping helpers", () => {
  it("fingerprints note content and metadata", () => {
    const a = noteFingerprint({ title: "A", date: "2026-07-10", content: "hello", mtimeMs: 1, size: 5 });
    const b = noteFingerprint({ title: "A", date: "2026-07-10", content: "hello again", mtimeMs: 1, size: 11 });

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("parses and normalizes extracted contact facts", () => {
    const facts = parseContactFacts(JSON.stringify({
      facts: [
        { type: "person", name: "PERSON_1", role: "owner", evidence: "Owns the lab.", sourceId: "S1" },
      ],
    }), {
      S1: { date: "2026-07-10", title: "Planning Sync", sourceLabel: "Acme" },
    });

    expect(facts).toEqual([
      expect.objectContaining({
        type: "person",
        name: "PERSON_1",
        role: "owner",
        sourceDate: "2026-07-10",
        sourceTitle: "Planning Sync",
      }),
    ]);
  });

  it("uses stable source ids without exposing file paths", () => {
    const first = stableSourceId({ source: "obsidian", sourceLabel: "Acme", relativePath: "Accounts/Acme/private.md" });
    const second = stableSourceId({ source: "obsidian", sourceLabel: "Acme", relativePath: "Accounts/Acme/private.md" });

    expect(first).toBe(second);
    expect(first).toMatch(/^S_[0-9A-F]{8}$/);
    expect(first).not.toContain("private");
  });

  it("returns no facts for malformed extraction JSON", () => {
    expect(parseContactFacts("not json")).toEqual([]);
  });

  it("can fail on malformed extraction JSON before caching", () => {
    expect(() => parseContactFacts("not json", {}, { throwOnInvalid: true })).toThrow();
  });

  it("deduplicates facts and renders compact markdown", () => {
    const facts = mergeFacts([
      { type: "site", name: "Dallas Lab", evidence: "Rollout is planned.", sourceId: "S1", sourceDate: "2026-07-10", sourceTitle: "Planning Sync" },
      { type: "site", name: "Dallas Lab", evidence: "Rollout is planned.", sourceId: "S1", sourceDate: "2026-07-10", sourceTitle: "Planning Sync" },
    ]);

    expect(facts).toHaveLength(1);
    expect(factsToMarkdown(facts)).toContain("**site: Dallas Lab**");
  });

  it("infers a useful continuation section", () => {
    const next = inferNextMappingSection("# Map\n\n## Customer Stakeholders\n\n- **PERSON_1** - owner\n  - **Mentioned in:**");

    expect(next).toBe("Customer Stakeholders");
  });

  it("flags missing sections and visible placeholders", () => {
    const findings = verifyStakeholderMapDocument("# Map\n\n## Customer Stakeholders\n\n- **PERSON_1** - owner", [], "Acme", []);

    expect(findings.map((f) => f.message)).toContain("Unrestored anonymization placeholder is still visible.");
    expect(findings.some((f) => f.message.includes("Missing section"))).toBe(true);
  });
});
