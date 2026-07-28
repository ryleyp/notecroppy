import { describe, expect, it } from "vitest";
import { POST as detectSpeakers } from "./detect-speakers/route";
import { POST as emailThread } from "./email-thread/route";
import { POST as sanitize } from "./sanitize/route";
import { POST as verifyReport } from "./verify-report/route";
import { POST as verifyRows } from "./verify-rows/route";
import { GET as suggestKeywords } from "./suggest-keywords/route";
import { getSessionToken } from "@/lib/sessionToken";

// These five routes each spend the user's Anthropic API credits or read the
// filesystem, and all five shipped with no session-token check at all. A page
// the user merely visits can issue a CORS-simple POST to localhost without a
// preflight, so "only listening on 127.0.0.1" was not protecting them.
//
// Every assertion below exercises the rejection path, which returns before any
// Anthropic client is constructed — so these tests make no network calls.

function post(handler, routePath, body, { token, origin = "http://localhost:3000" } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (token) headers["x-notetaker-session"] = token;
  return handler(new Request(`http://localhost${routePath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

function get(handler, url, { token, origin = "http://localhost:3000" } = {}) {
  const headers = {};
  if (origin) headers.origin = origin;
  if (token) headers["x-notetaker-session"] = token;
  return handler(new Request(`http://localhost${url}`, { method: "GET", headers }));
}

const POST_ROUTES = [
  { name: "detect-speakers", handler: detectSpeakers, path: "/api/detect-speakers", body: { transcript: "hello there", apiKey: "sk-ant-test" } },
  { name: "email-thread", handler: emailThread, path: "/api/email-thread", body: { emailThread: "Subject: hello", apiKey: "sk-ant-test" } },
  { name: "sanitize", handler: sanitize, path: "/api/sanitize", body: { text: "hello there", apiKey: "sk-ant-test" } },
  { name: "verify-report", handler: verifyReport, path: "/api/verify-report", body: { report: "r", notes: [{ date: "2026-01-01", title: "t", content: "c" }], accountName: "Acme", apiKey: "sk-ant-test" } },
  { name: "verify-rows", handler: verifyRows, path: "/api/verify-rows", body: { rows: [{ eventDate: "2026-01-01", title: "t", sourceTitle: "t", comments: "c" }], notes: [{ date: "2026-01-01", title: "t", content: "c" }], accountName: "Acme", apiKey: "sk-ant-test" } },
];

describe("AI routes reject unauthenticated callers", () => {
  it.each(POST_ROUTES)("$name rejects a missing session token", async ({ handler, path, body }) => {
    const response = await post(handler, path, body, { token: null });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it.each(POST_ROUTES)("$name rejects a wrong session token", async ({ handler, path, body }) => {
    const response = await post(handler, path, body, { token: "not-the-real-token" });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it.each(POST_ROUTES)("$name rejects an untrusted origin", async ({ handler, path, body }) => {
    const response = await post(handler, path, body, {
      token: getSessionToken(),
      origin: "https://evil.example.com",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("/api/suggest-keywords", () => {
  const accounts = encodeURIComponent(JSON.stringify([{ name: "Acme", aliases: ["acme"] }]));

  // This one is a GET that walks a caller-supplied directory and returns terms
  // harvested from the .md files it finds — an unauthenticated read primitive
  // over any directory on the machine.
  it("rejects a missing session token", async () => {
    const response = await get(suggestKeywords, `/api/suggest-keywords?vaultPath=/etc&accounts=${accounts}`, { token: null });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects an untrusted origin", async () => {
    const response = await get(suggestKeywords, `/api/suggest-keywords?vaultPath=/etc&accounts=${accounts}`, {
      token: getSessionToken(),
      origin: "https://evil.example.com",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects a directory that was never approved for this session", async () => {
    const response = await get(suggestKeywords, `/api/suggest-keywords?vaultPath=/etc&accounts=${accounts}`, {
      token: getSessionToken(),
    });
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBeTruthy();
  });
});
