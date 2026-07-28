const TRUSTED_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TOKEN_HEADER = "x-notetaker-session";

export class RequestSafetyError extends Error {
  constructor(message, status = 403) {
    super(message);
    this.name = "RequestSafetyError";
    this.status = status;
  }
}

export function assertTrustedOrigin(request) {
  const origin = request.headers.get("origin");

  // Native shortcuts, curl, and same-machine scripts often omit Origin. Allow
  // those while rejecting browser requests from unrelated web pages.
  if (!origin) return;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new RequestSafetyError("Untrusted request origin");
  }

  if (!TRUSTED_HOSTS.has(parsed.hostname)) {
    throw new RequestSafetyError("Untrusted request origin");
  }
}

export function assertSessionToken(request) {
  const expected = globalThis.__notetakerSessionToken;
  const provided = request.headers.get(TOKEN_HEADER);

  if (!expected || !provided || provided !== expected) {
    throw new RequestSafetyError("Invalid local session token", 401);
  }
}

export function assertTrustedRequest(request) {
  assertTrustedOrigin(request);
  assertSessionToken(request);
}
