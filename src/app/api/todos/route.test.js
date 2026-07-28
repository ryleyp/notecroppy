import { describe, expect, it } from "vitest";
import { extractItems, isRelevantItem } from "./route";

describe("isRelevantItem", () => {
  it("matches CSM-owned todo items", () => {
    expect(isRelevantItem("- [ ] Follow up on deployment plan — **Owner:** CSM team | **Due:** TBD")).toBe(true);
    expect(isRelevantItem("- [ ] Send renewal notes — **Owner:** CSM | **Due:** Friday")).toBe(true);
    expect(isRelevantItem("- [ ] Coordinate enablement — **Owner:** Customer Success Manager | **Due:** TBD")).toBe(true);
    expect(isRelevantItem("- [ ] Review usage — **Owner:** CSMs | **Due:** TBD")).toBe(true);
  });

  it("ignores non-CSM customer-owned todo items", () => {
    expect(isRelevantItem("- [ ] Share server list — **Owner:** Customer IT | **Due:** TBD")).toBe(false);
  });
});

describe("extractItems", () => {
  it("extracts CSM-owned action items into todos", () => {
    const items = extractItems(`# Meeting

## Action Items

- [ ] Send training plan — **Owner:** CSM team | **Due:** TBD
- [ ] Share firewall rules — **Owner:** Customer IT | **Due:** TBD

---

## Next Steps

- Schedule enablement with CSMs
`);

    expect(items.actionItems).toEqual([
      "- [ ] Send training plan — **Owner:** CSM team | **Due:** TBD",
    ]);
    expect(items.nextSteps).toEqual([
      "- Schedule enablement with CSMs",
    ]);
  });
});
