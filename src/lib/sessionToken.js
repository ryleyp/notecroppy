import crypto from "node:crypto";

export function getSessionToken() {
  if (!globalThis.__notetakerSessionToken) {
    globalThis.__notetakerSessionToken = crypto.randomBytes(32).toString("hex");
  }

  return globalThis.__notetakerSessionToken;
}
