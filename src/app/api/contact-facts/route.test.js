import { describe, expect, it } from "vitest";
import { buildExtractionPrompt, chunkNotes, notesForExtraction } from "./route";

describe("contact-facts route helpers", () => {
  it("builds extraction prompts with source ids and user context", () => {
    const prompt = buildExtractionPrompt([
      { id: "S1", date: "2026-07-10", title: "Planning Sync", sourceLabel: "Acme", content: "PERSON_1 owns Dallas Lab." },
    ], "Acme", [{ name: "Other", aliases: ["other"] }], [
      { label: "PERSON_1", context: "Technical champion." },
    ]);

    expect(prompt).toContain("sourceId");
    expect(prompt).toContain("### S1");
    expect(prompt).toContain("PERSON_1: Technical champion.");
    expect(prompt).toContain("Other: other");
  });

  it("chunks extraction notes by character budget", () => {
    const batches = chunkNotes([
      { title: "A", content: "x".repeat(40_000) },
      { title: "B", content: "x".repeat(40_000) },
    ]);

    expect(batches).toHaveLength(2);
  });

  it("skips unchanged cached notes when changed-only and already mapped", () => {
    const note = { key: "obsidian::Acme::a.md", fingerprint: "abc" };
    const index = {
      accounts: { "acme|acme": { lastMappedAt: "2026-07-20T00:00:00.000Z" } },
      sources: {
        "obsidian::Acme::a.md": {
          fingerprint: "abc",
          extractedAt: "2026-07-10T00:00:00.000Z",
          facts: [{ type: "person", name: "PERSON_1", evidence: "Met.", sourceId: "S1" }],
        },
      },
    };

    const result = notesForExtraction([note], index, "acme|acme", { changedOnly: true });

    expect(result.skipped).toHaveLength(1);
    expect(result.reusable).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
  });
});
