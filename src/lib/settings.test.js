import { describe, expect, it } from "vitest";
import { mergeFileConfigIntoSettings, mergeReplacements } from "@/lib/settings";

describe("mergeReplacements", () => {
  it("keeps local replacements when the config file has none", () => {
    expect(mergeReplacements([{ original: "Riley", alias: "PERSON_1" }], [])).toEqual([
      { original: "Riley", alias: "PERSON_1" },
    ]);
  });

  it("updates matching replacements from the config file", () => {
    expect(mergeReplacements(
      [{ original: "Riley", alias: "PERSON_1", restored: "Riley" }],
      [{ original: "Riley", alias: "PERSON_2", restored: "Ryley" }]
    )).toEqual([
      { original: "Riley", alias: "PERSON_2", restored: "Ryley" },
    ]);
  });
});

describe("mergeFileConfigIntoSettings", () => {
  it("does not erase browser-saved common corrections when file config is empty", () => {
    const settings = {
      replacements: [],
      corrections: [{ find: "Riley", replace: "Ryley" }],
      accounts: [{ name: "Acme", aliases: ["acme"] }],
    };

    expect(mergeFileConfigIntoSettings(settings, { corrections: [], replacements: [] })).toEqual(settings);
  });

  it("imports config corrections while preserving existing browser corrections", () => {
    const settings = {
      replacements: [],
      corrections: [{ find: "in tools", replace: "NI tools" }],
      accounts: [],
    };

    expect(mergeFileConfigIntoSettings(settings, {
      corrections: [{ find: "Riley", replace: "Ryley" }],
    }).corrections).toEqual([
      { find: "in tools", replace: "NI tools" },
      { find: "Riley", replace: "Ryley" },
    ]);
  });
});
