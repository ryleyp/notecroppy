import { describe, it, expect } from "vitest";
import { parseActivityRows, rowsToMarkdown, rowsToNDJSON } from "@/lib/activityRows";

const ROW = { eventDate: "2026-04-12", title: "EA Admin Sync", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "CSM synced with Dana Voss.", sourceTitle: "Q2 Admin Sync", review: false, reviewReason: "", verify: "", verifyReason: "" };

describe("parseActivityRows", () => {
  it("parses one JSON object per line", () => {
    const text = `${JSON.stringify(ROW)}\n${JSON.stringify({ ...ROW, title: "Second" })}`;
    const rows = parseActivityRows(text);
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe("Second");
  });

  it("ignores a partial trailing line while streaming", () => {
    const text = `${JSON.stringify(ROW)}\n{"eventDate":"2026-05-01","title":"Cut off mid`;
    expect(parseActivityRows(text)).toHaveLength(1);
  });

  it("ignores code fences and commentary lines", () => {
    const text = "```json\n" + JSON.stringify(ROW) + "\n```\nHere are your activities:";
    const rows = parseActivityRows(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("EA Admin Sync");
  });

  it("preserves review flags", () => {
    const flagged = { ...ROW, review: true, reviewReason: "Could be Demo Days" };
    const rows = parseActivityRows(JSON.stringify(flagged));
    expect(rows[0].review).toBe(true);
    expect(rows[0].reviewReason).toBe("Could be Demo Days");
  });

  it("handles pipes inside comments without splitting anything", () => {
    const withPipe = { ...ROW, comments: "Region: AMER | Attendees: 22" };
    const rows = parseActivityRows(JSON.stringify(withPipe));
    expect(rows[0].comments).toBe("Region: AMER | Attendees: 22");
  });

  it("returns empty for blank/undefined input", () => {
    expect(parseActivityRows("")).toEqual([]);
    expect(parseActivityRows(undefined)).toEqual([]);
  });
});

describe("rowsToMarkdown", () => {
  it("renders a well-formed table and escapes pipes in cells", () => {
    const md = rowsToMarkdown([{ ...ROW, comments: "A | B" }]);
    const lines = md.split("\n");
    expect(lines[0]).toContain("| Event Date |");
    expect(lines[2]).toContain("A \\| B");
    // Every line has the same number of unescaped column separators
    const cols = (l) => (l.replace(/\\\|/g, "").match(/\|/g) || []).length;
    expect(cols(lines[2])).toBe(cols(lines[0]));
  });

  it("flattens newlines inside comments", () => {
    const md = rowsToMarkdown([{ ...ROW, comments: "line one\nline two" }]);
    expect(md.split("\n")).toHaveLength(3);
  });
});

describe("round trip", () => {
  it("NDJSON serialization reparses to the same rows", () => {
    const rows = [ROW, { ...ROW, title: "Two", review: true, reviewReason: "why" }];
    expect(parseActivityRows(rowsToNDJSON(rows))).toEqual(rows);
  });
});
