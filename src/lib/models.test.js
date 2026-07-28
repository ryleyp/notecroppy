import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  budgetChars,
  calcCost,
  contextLimit,
  estimateUsage,
  firstTextBlock,
  maxOutputTokens,
} from "@/lib/models";

describe("firstTextBlock", () => {
  it("returns the text of a plain text response", () => {
    expect(firstTextBlock({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });

  // The regression this function exists for: on the Claude 5 family thinking
  // is on by default, so content[0] is a thinking block. Index-based access
  // yielded undefined and every caller's `|| ""` fallback turned that into
  // silently empty output rather than a visible failure.
  it("skips a leading thinking block", () => {
    const message = {
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "the real answer" },
      ],
    };
    expect(firstTextBlock(message)).toBe("the real answer");
  });

  it("skips tool_use blocks", () => {
    const message = {
      content: [
        { type: "tool_use", id: "t1", name: "x", input: {} },
        { type: "text", text: "after the tool" },
      ],
    };
    expect(firstTextBlock(message)).toBe("after the tool");
  });

  it("returns empty string when there is no text block", () => {
    expect(firstTextBlock({ content: [{ type: "thinking", thinking: "" }] })).toBe("");
    expect(firstTextBlock({ content: [] })).toBe("");
    expect(firstTextBlock({})).toBe("");
    expect(firstTextBlock(null)).toBe("");
  });

  it("ignores a text block whose text is not a string", () => {
    expect(firstTextBlock({ content: [{ type: "text" }, { type: "text", text: "ok" }] })).toBe("ok");
  });
});

describe("model capability lookups", () => {
  it("exposes the current Claude 5 defaults", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
    expect(contextLimit("claude-opus-5")).toBe(1_000_000);
    expect(contextLimit("claude-sonnet-5")).toBe(1_000_000);
    expect(contextLimit("claude-haiku-4-5")).toBe(200_000);
  });

  it("still resolves superseded models so old saved settings keep working", () => {
    expect(contextLimit("claude-sonnet-4-6")).toBe(1_000_000);
    expect(maxOutputTokens("claude-opus-4-8")).toBe(32_000);
  });

  it("falls back conservatively for an unknown model", () => {
    expect(contextLimit("claude-does-not-exist")).toBe(200_000);
    expect(maxOutputTokens("claude-does-not-exist")).toBe(32_000);
  });

  it("offers only current models in the picker", () => {
    expect(MODEL_OPTIONS.map((o) => o.id)).toEqual([
      "claude-haiku-4-5",
      "claude-sonnet-5",
      "claude-opus-5",
    ]);
  });
});

describe("budgetChars", () => {
  it("leaves room for output and template overhead", () => {
    const budget = budgetChars("claude-sonnet-5");
    const ceiling = (contextLimit("claude-sonnet-5") - maxOutputTokens("claude-sonnet-5")) * 4;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(ceiling);
  });

  it("honours a caller-supplied overhead", () => {
    expect(budgetChars("claude-sonnet-5", 10_000)).toBeGreaterThan(budgetChars("claude-sonnet-5", 12_000));
  });

  it("never returns a negative budget", () => {
    expect(budgetChars("claude-haiku-4-5", 10_000_000)).toBe(0);
  });
});

describe("cost helpers", () => {
  it("prices a response from the model table", () => {
    const cost = calcCost({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-opus-5");
    expect(cost.cost).toBeCloseTo(30.0);
    expect(cost.label).toBe("Opus");
  });

  it("scales the estimate with the caller's expected output length", () => {
    const notes = [{ title: "t", content: "x".repeat(4000) }];
    const short = estimateUsage(notes, "claude-sonnet-5");
    const long = estimateUsage(notes, "claude-sonnet-5", 4000);
    expect(long.cost).toBeGreaterThan(short.cost);
    expect(long.inputTokens).toBe(short.inputTokens);
  });
});
