import { describe, expect, it } from "vitest";
import { buildPrompt } from "./route";

describe("buildPrompt", () => {
  it("includes user and site callouts before action items", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");

    expect(prompt).toContain("## User-Level Callouts");
    expect(prompt).toContain("## Site-Level Callouts");
    expect(prompt).toContain("specific customer users");
    expect(prompt).toContain("specific customer sites");
    expect(prompt.indexOf("## User-Level Callouts")).toBeLessThan(prompt.indexOf("## Action Items"));
    expect(prompt.indexOf("## Site-Level Callouts")).toBeLessThan(prompt.indexOf("## Action Items"));
  });

  it("keeps the required sections without adding outcomes", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");

    expect(prompt).toContain("## Executive Summary");
    expect(prompt).toContain("## Meeting Notes");
    expect(prompt).not.toContain("## Outcomes");
  });

  it("adds source citation instructions", () => {
    const prompt = buildPrompt(
      "Jordan discussed the Dallas lab rollout.",
      "Planning Sync",
      [],
      "Raw note: Priya owns the next step."
    );

    expect(prompt).toContain("[T1] Transcript");
    expect(prompt).toContain("[N1] Raw notes");
    expect(prompt).toContain("SOURCE CITATION RULES");
  });

  it("carries no note-template or recipe instruction", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");
    expect(prompt).not.toContain("TEMPLATE AND RECIPE");
    expect(prompt).not.toContain("Selected note template");
    expect(prompt).not.toContain("Selected recipe");
  });

  // Meeting Notes is deliberately uncapped so it can serve as the record of
  // the meeting. The SFDC Activity Entry cap is a Salesforce field limit, not
  // a style preference — exceeding it truncates in the CRM — so the two must
  // not be relaxed together.
  it("leaves Meeting Notes uncapped but keeps the Salesforce field limit", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");

    expect(prompt).toContain("must be at most 120 words and 800 characters or fewer");
    expect(prompt).not.toContain("Executive Summary and Meeting Notes sections together must be 120 words");
    expect(prompt).toMatch(/Provide exhaustive bulleted notes/);
  });

  // The SFDC entry is pasted into a Salesforce field that truncates. The
  // "write exhaustively" instruction for Meeting Notes must not bleed into it,
  // so the cap is stated both in the rules block and inline at the section.
  it("caps the SFDC entry inline and exempts it from the exhaustive instruction", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");

    expect(prompt).toContain("must be 120 words or fewer and 800 characters or fewer");
    expect(prompt).toContain("applies to Meeting Notes and NOT to this section");
    expect(prompt).toContain("must be at most 120 words and 800 characters or fewer");
  });
});
