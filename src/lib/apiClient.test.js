import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// Every guarded route requires the x-notetaker-session header, which only
// apiFetch() attaches. A bare fetch("/api/...") therefore compiles, type-checks,
// lints, and then fails at runtime with a 401 the moment the route is guarded.
//
// Adding guards to detect-speakers, suggest-keywords, and verify-rows broke
// exactly three call sites this way — all three in code paths no unit test
// covers. This test is the cheap standing check.

const SRC = path.join(process.cwd(), "src");

// /api/session bootstraps the token, so it cannot itself send one.
const ALLOWED_BARE = ["/api/session"];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(entry.name) && !entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

// Matches fetch("/api/..."), fetch(`/api/...`) — but not apiFetch(...), and not
// a fetch whose argument is a variable (routes are always literals here).
const BARE_FETCH = /(^|[^A-Za-z0-9_$.])fetch\(\s*[`"']\/api\/([^`"'?]+)/g;

describe("API calls go through apiFetch", () => {
  const offenders = [];

  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, "utf-8");
    for (const match of source.matchAll(BARE_FETCH)) {
      const route = `/api/${match[2]}`;
      if (ALLOWED_BARE.includes(route)) continue;
      offenders.push(`${path.relative(process.cwd(), file)} -> ${route}`);
    }
  }

  it("no source file calls a guarded /api route with a bare fetch", () => {
    expect(offenders).toEqual([]);
  });
});
