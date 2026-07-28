import { describe, expect, it } from "vitest";
import { buildStakeholderMapFactPrompt, buildStakeholderMapPrompt } from "./route";

describe("buildStakeholderMapPrompt", () => {
  it("requires source-by-source stakeholder and site mapping", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "2026-07-10",
        title: "Planning Sync",
        content: "Jordan discussed the Dallas lab rollout.",
        source: "obsidian",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", []);

    expect(prompt).toContain("# Acme Customer & Site Mapping");
    expect(prompt).toContain("## Customer Stakeholders");
    expect(prompt).toContain("## Site / Lab / Location Map");
    expect(prompt).toContain("Analyze the provided Obsidian meeting notes");
    expect(prompt).toContain("Every mapped person and every mapped site must list every provided source");
    expect(prompt).toContain("2026-07-10 - Planning Sync");
    expect(prompt).not.toContain("notes and transcripts");
    expect(prompt).not.toContain("transcripts, and cross-folder notes");
  });

  it("labels all-history maps without quarterly wording", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "",
        title: "Undated Contact Notes",
        content: "Dana owns the lab.",
        source: "obsidian",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", [], "all");

    expect(prompt).toContain("Analyze the provided Obsidian meeting notes from all available history");
    expect(prompt).toContain("# Acme Customer & Site Mapping - All Available History");
    expect(prompt).toContain("- **Date range:** All Available History");
    expect(prompt).toContain("### undated - Undated Contact Notes");
    expect(prompt).toContain("No stakeholder or site details noted in the provided source set.");
    expect(prompt).not.toContain("this quarter");
  });

  it("includes user-provided mapping context", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "2026-07-10",
        title: "Planning Sync",
        content: "PERSON_1 discussed the Dallas lab rollout.",
        source: "obsidian",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", [], "recent", [
      { label: "PERSON_1", context: "Primary lab owner; treat as customer technical champion." },
    ]);

    expect(prompt).toContain("User-provided context for mapped names and organizations");
    expect(prompt).toContain("**PERSON_1:** Primary lab owner; treat as customer technical champion.");
  });

  it("can ask Claude to continue a partial map", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "2026-07-10",
        title: "Planning Sync",
        content: "Dallas lab rollout.",
        source: "obsidian",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", [], "recent", [], "# Acme Customer & Site Mapping\n\n## Customer Stakeholders\n\n- **Jordan**");

    expect(prompt).toContain("Continuation mode");
    expect(prompt).toContain("Continue the same Markdown document from exactly where the previous output ended");
    expect(prompt).toContain("Previous partial output:");
    expect(prompt).toContain("- **Jordan**");
  });

  it("can generate from extracted facts instead of raw notes", () => {
    const prompt = buildStakeholderMapFactPrompt([
      {
        type: "person",
        name: "PERSON_1",
        role: "lab owner",
        site: "Dallas Lab",
        evidence: "Owns the rollout plan.",
        sourceId: "S1",
        sourceDate: "2026-07-10",
        sourceTitle: "Planning Sync",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", [], "recent");

    expect(prompt).toContain("EXTRACTED FACTS");
    expect(prompt).toContain("**person: PERSON_1**");
    expect(prompt).toContain("Source: 2026-07-10 Planning Sync (Acme)");
    expect(prompt).toContain("Use the extracted facts as the evidence source");
  });
});
