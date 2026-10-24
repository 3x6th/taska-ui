import { describe, expect, it } from "vitest";
import type { AccessToken } from "../../domain/types";
import {
  SESSION_ONLY_CREATE_TEXT,
  SESSION_ONLY_REVOKE_TEXT,
  TOO_MANY_TOKENS_TEXT,
  accessTokenAccessLabel,
  accessTokenDatesText,
  accessTokenExpired,
  createRefusalText,
  expiryDayFromNow,
  expiryLabel,
  revokeRefusalWords,
  sortAccessTokens,
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

  it("names the four lifetimes and the day one chosen now ends on", () => {
    expect([7, 30, 90, 365].map((days) => expiryLabel(days as 7))).toEqual(["7 days", "30 days", "90 days", "1 year"]);
    expect(expiryDayFromNow(30, now)).toBe("Nov 23");
    expect(expiryDayFromNow(365, now)).toBe("Oct 24, 2027");
  });

  it("says the 429 and the token-scope 403 in plain words, and anything else in the server's", () => {
    const failure = (fields: object) => Object.assign(new Error("Server words"), fields);
    expect(createRefusalText(failure({ status: 429, code: "RESOURCE_EXHAUSTED" }))).toBe(TOO_MANY_TOKENS_TEXT);
    expect(createRefusalText(failure({ code: "RESOURCE_EXHAUSTED" }))).toBe(TOO_MANY_TOKENS_TEXT);
    expect(createRefusalText(failure({ status: 403, code: "insufficient_scope" }))).toBe(SESSION_ONLY_CREATE_TEXT);
    expect(createRefusalText(failure({ status: 400, code: "INVALID_ARGUMENT" }))).toBe("Server words");
    expect(createRefusalText(failure({ status: 403, code: "PERMISSION_DENIED" }))).toBe("Server words");
    expect(revokeRefusalWords(failure({ status: 403, code: "insufficient_scope" }))).toBe(SESSION_ONLY_REVOKE_TEXT);
    expect(revokeRefusalWords(failure({ status: 404, code: "NOT_FOUND" }))).toBe("Server words");
  });

  it("lists the newest first", () => {
    const older = token({ id: "older", createdAt: "2026-10-01T12:00:00Z" });
    const newer = token({ id: "newer", createdAt: "2026-10-20T12:00:00Z" });
    expect(sortAccessTokens([older, newer]).map((item) => item.id)).toEqual(["newer", "older"]);
  });
});
