import { describe, expect, it } from "vitest";
import { isIndefinite, keyFor } from "./intentKey";

/*
 * The key of an intent (TAS-502, api-contract-guard §4) — moved with the code
 * from Settings › Members' rules in TAS-528 (art-director N2).
 */

const refusal = (status: number | undefined, code: string) =>
  Object.assign(new Error(code), { ...(status === undefined ? {} : { status }), code, requestId: "rid", details: null, reasons: [] });

describe("the key of an intent (§4)", () => {
  it("is reused only for the same intent after an answer that never came", () => {
    const first = keyFor(null, "role:MEMBER:3");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyFor({ signature: "role:MEMBER:3", key: first, open: true }, "role:MEMBER:3")).toBe(first);
    expect(keyFor({ signature: "role:MEMBER:3", key: first, open: false }, "role:MEMBER:3")).not.toBe(first);
    expect(keyFor({ signature: "role:MEMBER:3", key: first, open: true }, "role:MEMBER:4")).not.toBe(first);
  });

  it("an answer that never came is no status, 408, 429 or 5xx — never a refusal", () => {
    expect(isIndefinite(new TypeError("Failed to fetch"))).toBe(true);
    expect(isIndefinite(refusal(503, "DEPENDENCY_UNAVAILABLE"))).toBe(true);
    expect(isIndefinite(refusal(429, "RATE_LIMITED"))).toBe(true);
    expect(isIndefinite(refusal(408, "TIMEOUT"))).toBe(true);
    expect(isIndefinite(refusal(412, "VERSION_CONFLICT"))).toBe(false);
    expect(isIndefinite(refusal(409, "LAST_ADMIN"))).toBe(false);
  });
});
