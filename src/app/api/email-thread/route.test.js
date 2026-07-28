import { describe, expect, it } from "vitest";
import { buildEmailThreadPrompt } from "./route";

describe("buildEmailThreadPrompt", () => {
  it("builds a dated Obsidian email-thread note prompt with decisions and source citations", () => {
    const prompt = buildEmailThreadPrompt({
      emailThread: "Subject: License cleanup\n\nSam agreed to use the shared license portal.",
      threadTitle: "License cleanup",
      threadDate: "2026-07-27",
      context: "CSM note: This relates to the Dallas lab rollout.",
    });

    expect(prompt).toContain("# 2026-07-27 - License cleanup");
    expect(prompt).toContain("[E1] Email thread");
    expect(prompt).toContain("[N1] Raw notes");
    expect(prompt).toContain("## Decisions");
    expect(prompt).toContain("## Source Email Content");
    expect(prompt).toContain("Cite every factual bullet or factual paragraph");
  });
});
