import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Every API route runs on a server bound to localhost, but "localhost only" is
// not an access control: any other process on the machine can reach it, and a
// web page can issue a CORS-simple POST to it without the browser blocking the
// request. So each route must enforce the local session token, and each route
// that touches the filesystem must also confine itself to approved roots.
//
// This is a meta-test rather than a per-route test because the failure mode is
// a route that forgets a guard entirely — exactly what a per-route test suite
// cannot catch, since a missing test and a missing guard look identical.
// /api/sfdc-report shipped for months with none of the three guards its own
// header comment claimed it mirrored.

const API_DIR = path.join(process.cwd(), "src/app/api");

// The one deliberate exception. /api/session issues the token, so it cannot
// require the token it hands out; it is origin-checked instead.
const TOKEN_EXEMPT = new Set(["session"]);

// Routes that legitimately accept requests without an Origin header so the
// macOS dictation shortcut can deposit a transcript. Documented in the route.
const ORIGIN_ONLY = new Set(["receive-transcript"]);

function routeFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.js") out.push(full);
    }
  };
  walk(API_DIR);
  return out;
}

function routeName(file) {
  return path.relative(API_DIR, path.dirname(file));
}

const routes = routeFiles().map((file) => ({
  name: routeName(file),
  file,
  source: fs.readFileSync(file, "utf-8"),
}));

describe("API route guards", () => {
  it("finds every route (guard against a broken glob silently passing)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(21);
  });

  it.each(routes.filter((r) => !TOKEN_EXEMPT.has(r.name) && !ORIGIN_ONLY.has(r.name)))(
    "$name enforces the local session token",
    ({ source }) => {
      expect(source).toMatch(/assertTrustedRequest\s*\(/);
    }
  );

  it.each(routes.filter((r) => TOKEN_EXEMPT.has(r.name) || ORIGIN_ONLY.has(r.name)))(
    "$name at least enforces a trusted origin",
    ({ source }) => {
      expect(source).toMatch(/assertTrusted(Origin|Request)\s*\(/);
    }
  );

  // A route that reads or writes files must resolve paths through the
  // allowlist, never straight from the request body.
  const filesystemRoutes = routes.filter(
    ({ source }) => /\bfrom "fs"|\brequire\("fs"\)/.test(source) && /fs\.(read|write|mkdir|stat|exists|readdir)/.test(source)
  );

  it("finds filesystem-touching routes", () => {
    expect(filesystemRoutes.length).toBeGreaterThan(0);
  });

  it.each(filesystemRoutes)("$name confines filesystem access to approved roots", ({ source }) => {
    expect(source).toMatch(/assertAllowedRoot\s*\(/);
  });

  // path.resolve on a request-supplied path is the specific bug that let
  // /api/sfdc-report write outside the vault. assertAllowedRoot already calls
  // path.resolve internally, so routes have no reason to call it directly.
  it.each(filesystemRoutes)("$name does not path.resolve request input directly", ({ source }) => {
    expect(source).not.toMatch(/path\.resolve\(\s*(vaultPath|transcriptsPath|dir|folderPath)\b/);
  });
});
