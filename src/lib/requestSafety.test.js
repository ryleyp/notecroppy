import { describe, expect, it } from "vitest";
import { assertSessionToken, assertTrustedOrigin, assertTrustedRequest } from "@/lib/requestSafety";
import { getSessionToken } from "@/lib/sessionToken";

describe("assertTrustedOrigin", () => {
  it("allows localhost browser requests and requests without an origin", () => {
    expect(() => assertTrustedOrigin(new Request("http://localhost/api"))).not.toThrow();
    expect(() => assertTrustedOrigin(new Request("http://localhost/api", {
      headers: { origin: "http://localhost:3000" },
    }))).not.toThrow();
  });

  it("rejects browser requests from unrelated origins", () => {
    expect(() => assertTrustedOrigin(new Request("http://localhost/api", {
      headers: { origin: "https://example.com" },
    }))).toThrow("Untrusted");
  });
});

describe("assertSessionToken", () => {
  it("accepts the current local session token", () => {
    expect(() => assertSessionToken(new Request("http://localhost/api", {
      headers: { "x-notetaker-session": getSessionToken() },
    }))).not.toThrow();
  });

  it("rejects missing or wrong tokens", () => {
    expect(() => assertSessionToken(new Request("http://localhost/api"))).toThrow("Invalid");
    expect(() => assertTrustedRequest(new Request("http://localhost/api", {
      headers: {
        origin: "http://localhost:3000",
        "x-notetaker-session": "wrong",
      },
    }))).toThrow("Invalid");
  });
});
