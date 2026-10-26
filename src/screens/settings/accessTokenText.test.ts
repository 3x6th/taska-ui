import { describe, expect, it } from "vitest";
import type { AccessToken } from "../../domain/types";
import {
  SESSION_ONLY_CREATE_TEXT,
  SESSION_ONLY_REVOKE_TEXT,
  accessTokenAccessLabel,
  accessTokenDatesText,
  accessTokenExpired,
  createRefusalText,
  expiryDayFromNow,
  expiryLabel,
  revokeRefusalWords,
} from "./accessTokenText";

const now = new Date("2026-10-24T12:00:00Z");
const token = (overrides: Partial<AccessToken> = {}): AccessToken => ({
  id: "t-1",
  name: "Cursor on laptop",
  tokenPrefix: "tsk_pat_3fA9",
  scopes: ["read"],
  createdAt: "2026-10-01T12:00:00Z",
  expiresAt: "2026-10-31T12:00:00Z",
  lastUsedAt: "2026-10-20T12:00:00Z",
  ...overrides,
});

describe("the words of Settings → Access tokens", () => {
  it("names the two grants it asks for and prints any other as it came", () => {
    expect(accessTokenAccessLabel(["read"])).toBe("Read");
    expect(accessTokenAccessLabel(["write", "read"])).toBe("Read and write");
    expect(accessTokenAccessLabel(["read", "admin"])).toBe("read, admin");
    expect(accessTokenAccessLabel([])).toBe("No access stated");
  });

  it("puts a token's dates on one line, and says when it ran out or was never used", () => {
    expect(accessTokenDatesText(token(), now)).toBe("Created Oct 1 · Expires Oct 31 · Last used Oct 20");
    expect(accessTokenDatesText(token({ expiresAt: "2026-10-24T11:00:00Z", lastUsedAt: null }), now)).toBe(
      "Created Oct 1 · Expired Oct 24 · Never used",
    );
    expect(accessTokenDatesText(token({ expiresAt: "2027-10-24T12:00:00Z" }), now)).toBe(
      "Created Oct 1 · Expires Oct 24, 2027 · Last used Oct 20",
    );
    // A date the answer did not carry is left out, never "Invalid Date" and never a throw.
    expect(accessTokenDatesText(token({ createdAt: "", expiresAt: "soon" }), now)).toBe("Last used Oct 20");
    expect(accessTokenExpired(token({ expiresAt: "" }), now)).toBe(false);
  });

  it("names a lifetime in days — a policy's own maximum too — and the day one chosen now ends on", () => {
    expect([7, 30, 90, 60, 365, 1].map((days) => expiryLabel(days))).toEqual([
      "7 days",
      "30 days",
      "90 days",
      "60 days",
      "365 days",
      "1 day",
    ]);
    expect(expiryDayFromNow(30, now)).toBe("Nov 23");
    expect(expiryDayFromNow(365, now)).toBe("Oct 24, 2027");
  });

  const failure = (fields: object) => Object.assign(new Error("Server words"), fields);

  // Backend TAS-402: up to an hour's wait (five attempts an hour), said in
  // whole minutes rounded up — never "3412 seconds"; without one, no number of
  // our own.
  it("says the 429 in minutes, rounded up", () => {
    const limited = (retryAfterSeconds: string) =>
      createRefusalText(failure({ status: 429, code: "RESOURCE_EXHAUSTED", details: { retryAfterSeconds } }));
    expect(limited("3412")).toBe("Too many tokens were created recently. Try again in 57 minutes.");
    expect(limited("3600")).toBe("Too many tokens were created recently. Try again in 60 minutes.");
    expect(limited("61")).toBe("Too many tokens were created recently. Try again in 2 minutes.");
    expect(limited("60")).toBe("Too many tokens were created recently. Try again in 1 minute.");
    expect(limited("1")).toBe("Too many tokens were created recently. Try again in 1 minute.");
    for (const details of [null, {}, { retryAfterSeconds: "0" }, { retryAfterSeconds: "soon" }]) {
      expect(createRefusalText(failure({ status: 429, code: "RESOURCE_EXHAUSTED", details }))).toBe(
        "Too many tokens were created recently. Try again later.",
      );
    }
  });

  // Backend TAS-402: the cap on active tokens, by its reason, with the server's number.
  it("says the active-token cap with the limit the server stated", () => {
    const cap = (details: Record<string, string> | null) =>
      createRefusalText(failure({ status: 400, code: "FAILED_PRECONDITION", details }));
    expect(cap({ reason: "ACTIVE_TOKEN_LIMIT", limit: "10" })).toBe(
      "You already have 10 active tokens. Revoke one to create another.",
    );
    expect(cap({ reason: "ACTIVE_TOKEN_LIMIT", limit: "1" })).toBe("You already have 1 active token. Revoke one to create another.");
    expect(cap({ reason: "ACTIVE_TOKEN_LIMIT" })).toBe(
      "You already have as many active tokens as you can. Revoke one to create another.",
    );
    // The code without the reason is the server's own words.
    expect(cap({ limit: "10" })).toBe("Server words");
    expect(cap(null)).toBe("Server words");
  });

  // Backend TAS-402: PERMISSION_DENIED with `details.reason` SESSION_REQUIRED;
  // the provisional `insufficient_scope` code never arrives.
  it("says the session-only 403 by its reason, and anything else in the server's words", () => {
    const sessionOnly = failure({ status: 403, code: "PERMISSION_DENIED", details: { reason: "SESSION_REQUIRED" } });
    expect(createRefusalText(sessionOnly)).toBe(SESSION_ONLY_CREATE_TEXT);
    expect(revokeRefusalWords(sessionOnly)).toBe(SESSION_ONLY_REVOKE_TEXT);
    expect(createRefusalText(failure({ status: 403, code: "insufficient_scope" }))).toBe("Server words");
    expect(createRefusalText(failure({ status: 403, code: "PERMISSION_DENIED" }))).toBe("Server words");
    expect(createRefusalText(failure({ status: 400, code: "INVALID_ARGUMENT" }))).toBe("Server words");
    expect(revokeRefusalWords(failure({ status: 403, code: "insufficient_scope" }))).toBe("Server words");
  });
});
