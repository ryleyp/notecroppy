import { describe, expect, it } from "vitest";
import { BATCH_TEMPORAL_RULE, TEMPORAL_ACCURACY_RULE, dateSortValue } from "@/lib/synthesisPolicy";

const goldenScenarios = [
  {
    name: "newer deployment note corrects older blocked pilot note",
    older: {
      date: "2026-04-01",
      fact: "SystemLink pilot is blocked by IT approval.",
    },
    newer: {
      date: "2026-05-12",
      fact: "IT approved SystemLink and the pilot moved into production deployment.",
    },
    expectedCurrent: "pilot moved into production deployment",
    expectedHistorical: "blocked by IT approval",
  },
  {
    name: "newer renewal stance corrects older risk",
    older: {
      date: "2026-04-10",
      fact: "Renewal risk is high because usage is low.",
    },
    newer: {
      date: "2026-06-02",
      fact: "Renewal risk dropped after adoption increased and sponsor confirmed value.",
    },
    expectedCurrent: "Renewal risk dropped",
    expectedHistorical: "usage is low",
  },
];

describe("golden transcript recency policy", () => {
  it("requires newer dated sources to override outdated older sources", () => {
    expect(TEMPORAL_ACCURACY_RULE).toContain("newer source is authoritative");
    expect(TEMPORAL_ACCURACY_RULE).toContain("Do not repeat outdated information");
    expect(TEMPORAL_ACCURACY_RULE).toContain("Information Changes");
  });

  it("requires batch summaries to preserve corrections from newer notes", () => {
    expect(BATCH_TEMPORAL_RULE).toContain("newer note");
    expect(BATCH_TEMPORAL_RULE).toContain("corrects an older note");
    expect(BATCH_TEMPORAL_RULE).toContain("newest current fact first");
  });

  it("orders golden scenarios chronologically so summaries can correct stale facts", () => {
    for (const scenario of goldenScenarios) {
      expect(dateSortValue(scenario.older.date) < dateSortValue(scenario.newer.date)).toBe(true);
      expect(scenario.expectedCurrent).toBeTruthy();
      expect(scenario.expectedHistorical).toBeTruthy();
    }
  });
});
