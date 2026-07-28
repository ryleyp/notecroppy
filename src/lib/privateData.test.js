import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// This repository is public. Real customer names, real individuals' names, and
// personal filesystem paths were removed from source in favour of fictional
// placeholders plus an imported private config (see docs/private-config.md).
// This test keeps them out.
//
// The needles are base64-encoded so that this file does not itself reintroduce
// the strings it is guarding against.
const FORBIDDEN_B64 = [
  "bG9ja2hlZWQ=",
  "bm9ydGhyb3A=",
  "bDNoYXJyaXM=",
  "bDMgaGFycmlz",
  "ZnJvbnRncmFkZQ==",
  "bG1jbw==",
  "d2VzY2Ft",
  "cnlsZXlwcmlkZHk=",
  "cGV2b3RhdXg=",
  "cmlkZ2Vs",
  "Z29rdWw=",
  "bG0gbWZj",
  "bmljb2xl",
  "YW5nZWxpY2E=",
];

const FORBIDDEN = FORBIDDEN_B64.map((b) => Buffer.from(b, "base64").toString("utf-8"));

const SCAN_ROOTS = ["src", "tests", "docs", "scripts", ".github"];
// Every tracked text file at the repository root, not a hand-maintained list —
// the first version of this test missed HANDOFF.md and the EA_*.txt reference
// docs precisely because they were not enumerated.
function rootTextFiles() {
  return fs
    .readdirSync(process.cwd(), { withFileTypes: true })
    .filter((e) => e.isFile() && TEXT_EXT.has(path.extname(e.name)))
    .map((e) => e.name);
}
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "private", "coverage"]);
const TEXT_EXT = new Set([".js", ".jsx", ".mjs", ".json", ".md", ".txt", ".yml", ".yaml", ".css", ".sh", ".command", ".example"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(path.extname(entry.name)) || !path.extname(entry.name)) out.push(full);
  }
  return out;
}

function filesToScan() {
  const files = SCAN_ROOTS.flatMap((r) => walk(path.join(process.cwd(), r)));
  for (const f of rootTextFiles()) {
    files.push(path.join(process.cwd(), f));
  }
  // Exclude this file: it holds the (encoded) needles by design.
  return files.filter((f) => !f.endsWith("privateData.test.js"));
}

describe("no customer or personal data in tracked source", () => {
  const files = filesToScan();

  it("actually scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN)("no tracked file contains %s", (needle) => {
    const hits = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8").toLowerCase();
      if (content.includes(needle.toLowerCase())) {
        hits.push(path.relative(process.cwd(), file));
      }
    }
    expect(hits).toEqual([]);
  });
});
