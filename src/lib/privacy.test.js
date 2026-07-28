import { describe, expect, it } from "vitest";
import { aliasesFromReplacements, buildSanitizePrompt, parseEntityList } from "@/lib/privacy";

describe("aliasesFromReplacements", () => {
  it("returns only aliases, never original terms", () => {
    const aliases = aliasesFromReplacements([
      { original: "Acme", alias: "ORG_1" },
      { original: "Jane Doe", alias: "PERSON_1" },
    ]);

    expect(aliases).toEqual(["ORG_1", "PERSON_1"]);
  });
});

describe("buildSanitizePrompt", () => {
  it("includes aliases without leaking original known terms", () => {
    const prompt = buildSanitizePrompt("Met with ORG_1", ["ORG_1"]);

    expect(prompt).toContain("ORG_1");
    expect(prompt).not.toContain("Acme");
    expect(prompt).toContain("Placeholder aliases");
  });
});

describe("parseEntityList", () => {
  it("normalizes entities and filters placeholder aliases", () => {
    const entities = parseEntityList(
      JSON.stringify([
        { text: "ORG_1", type: "org" },
        { text: "PERSON_12", type: "person" },
        { text: "Jane Doe", type: "person" },
        { text: "Acme", type: "company" },
      ]),
      ["ORG_1"]
    );

    expect(entities).toEqual([
      { text: "Jane Doe", type: "person" },
      { text: "Acme", type: "org" },
    ]);
  });
});
