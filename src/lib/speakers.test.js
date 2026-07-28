import { describe, it, expect } from "vitest";
import { parseSpeakerTurns, buildLabeledTranscript, mergeUp, looksSpeakerLabeled } from "@/lib/speakers";

describe("parseSpeakerTurns", () => {
  it("splits consecutive labeled turns", () => {
    const text = "**Speaker 1:** Hello there.\n\n**Speaker 2:** Hi, thanks for calling.";
    const turns = parseSpeakerTurns(text);
    expect(turns).toEqual([
      { label: "Speaker 1", text: "Hello there." },
      { label: "Speaker 2", text: "Hi, thanks for calling." },
    ]);
  });

  it("keeps a multi-paragraph turn intact until the next marker", () => {
    const text = "**Speaker 1:** Line one.\nLine two.\n\nStill speaker 1.\n\n**Speaker 2:** Reply.";
    const turns = parseSpeakerTurns(text);
    expect(turns[0]).toEqual({ label: "Speaker 1", text: "Line one.\nLine two.\n\nStill speaker 1." });
    expect(turns[1]).toEqual({ label: "Speaker 2", text: "Reply." });
  });

  it("falls back to a single unlabeled turn when no markers are found", () => {
    const turns = parseSpeakerTurns("just plain text with no markers");
    expect(turns).toEqual([{ label: "Speaker 1", text: "just plain text with no markers" }]);
  });

  it("returns empty for blank input", () => {
    expect(parseSpeakerTurns("")).toEqual([]);
    expect(parseSpeakerTurns("   ")).toEqual([]);
  });

  it("uses a real name label when present instead of generic Speaker N", () => {
    const text = "**David:** I'll take that action item.\n\n**Speaker 2:** Sounds good.";
    const turns = parseSpeakerTurns(text);
    expect(turns[0].label).toBe("David");
  });
});

describe("buildLabeledTranscript", () => {
  it("reassembles turns with renamed labels", () => {
    const turns = [
      { label: "Speaker 1", text: "Hello there." },
      { label: "Speaker 2", text: "Hi, thanks." },
    ];
    const out = buildLabeledTranscript(turns, { "Speaker 1": "Ryley", "Speaker 2": "David" });
    expect(out).toBe("**Ryley:** Hello there.\n\n**David:** Hi, thanks.");
  });

  it("falls back to the original label when not renamed", () => {
    const turns = [{ label: "Speaker 1", text: "Hello." }];
    expect(buildLabeledTranscript(turns, {})).toBe("**Speaker 1:** Hello.");
  });

  it("drops empty turns", () => {
    const turns = [{ label: "Speaker 1", text: "Hi" }, { label: "Speaker 2", text: "   " }];
    expect(buildLabeledTranscript(turns, {})).toBe("**Speaker 1:** Hi");
  });
});

describe("mergeUp", () => {
  it("merges a turn into the previous one and removes it", () => {
    const turns = [
      { label: "Speaker 1", text: "Part one." },
      { label: "Speaker 2", text: "Part two." },
      { label: "Speaker 1", text: "Part three." },
    ];
    const merged = mergeUp(turns, 1);
    expect(merged).toEqual([
      { label: "Speaker 1", text: "Part one. Part two." },
      { label: "Speaker 1", text: "Part three." },
    ]);
  });

  it("is a no-op for index 0 or out of range", () => {
    const turns = [{ label: "Speaker 1", text: "Only turn." }];
    expect(mergeUp(turns, 0)).toEqual(turns);
    expect(mergeUp(turns, 5)).toEqual(turns);
  });
});

describe("looksSpeakerLabeled", () => {
  it("requires at least two turn markers", () => {
    expect(looksSpeakerLabeled("**Speaker 1:** hello")).toBe(false);
    expect(looksSpeakerLabeled("**Speaker 1:** hello\n\n**Speaker 2:** hi")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(looksSpeakerLabeled("just a plain transcript with no markers at all")).toBe(false);
  });

  it("returns false for blank/undefined input", () => {
    expect(looksSpeakerLabeled("")).toBe(false);
    expect(looksSpeakerLabeled(undefined)).toBe(false);
  });
});
