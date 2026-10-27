import { describe, expect, it } from "vitest";
import { ApiError } from "../api/rest/RestTaskaApi";
import {
  formatCountdown,
  formatWait,
  oauthReturnTo,
  providerRefusalFromState,
  providerRefusalText,
  refusalFromCallbackError,
  refusalFromExchange,
  refusalLockDeadline,
} from "./authText";

/** A refusal the way `MockApiError` carries one: a code, details, no status. */
const mockRefusal = (code: string, details: Record<string, string> | null = null) =>
  Object.assign(new Error("mock words"), { code, details });

describe("formatWait (§4.31 {wait})", () => {
  it.each([
    [1, "1 second"],
    [2, "2 seconds"],
    [45, "45 seconds"],
    [89, "89 seconds"],
    [90, "2 minutes"],
    [120, "2 minutes"],
    [121, "3 minutes"],
    [2400, "40 minutes"],
    [3600, "60 minutes"],
  ])("%i s is «%s»", (seconds, text) => {
    expect(formatWait(seconds)).toBe(text);
  });

  it("says «a few minutes» without a number", () => {
    expect(formatWait(null)).toBe("a few minutes");
    expect(formatWait(0)).toBe("a few minutes");
    expect(formatWait(Number.NaN)).toBe("a few minutes");
  });
});

describe("formatCountdown", () => {
  it.each([
    [60_000, "1:00"],
    [42_000, "0:42"],
    [41_001, "0:42"],
    [760_000, "12:40"],
    [999, "0:01"],
    [0, "0:00"],
    [-5_000, "0:00"],
  ])("%i ms is %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});

describe("oauthReturnTo (guard §4)", () => {
  it("sends the remembered router path, or /projects explicitly", () => {
    expect(oauthReturnTo("/projects/p-1/board?q=1")).toBe("/projects/p-1/board?q=1");
    expect(oauthReturnTo(undefined)).toBe("/projects");
    expect(oauthReturnTo("")).toBe("/projects");
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "#/projects", "projects", 7])(
    "never an absolute URL, a protocol-relative one or a hash route (%s)",
    (value) => {
      expect(oauthReturnTo(value)).toBe("/projects");
    },
  );

  it.each(["/login", "/login?x=1", "/invite", "/invite?token=x", "/auth/callback", "/auth/callback/"])(
    "never an auth route (%s)",
    (value) => {
      expect(oauthReturnTo(value)).toBe("/projects");
    },
  );
});

describe("the refusal a provider sign-in met (§4.31's table)", () => {
  it("takes the seven ?error= reasons as their rows, and anything else as unknown — without keeping the value", () => {
    for (const reason of [
      "PROVIDER_CANCELLED",
      "STATE_INVALID",
      "EMAIL_NOT_VERIFIED",
      "ACCOUNT_BLOCKED",
      "ACCOUNT_LOCKED",
      "SIGNUP_DISABLED",
      "PROVIDER_UNAVAILABLE",
    ]) {
      expect(refusalFromCallbackError(reason, "GOOGLE", "signin").reason).toBe(reason);
    }
    const typed = refusalFromCallbackError("<script>alert(1)</script>", "GOOGLE", "signin");
    expect(typed).toMatchObject({ reason: "UNKNOWN", message: null });
    expect(JSON.stringify(typed)).not.toContain("script");
  });

  it("keys an exchange's refusal on the (code, reason) pair, never on the status class", () => {
    const pairs: [Error, string][] = [
      [new ApiError("x", "UNAUTHENTICATED", 401, "r", undefined, { reason: "STATE_INVALID" }), "CODE_INVALID"],
      [new ApiError("x", "PERMISSION_DENIED", 403, "r", undefined, { reason: "ACCOUNT_BLOCKED" }), "ACCOUNT_BLOCKED"],
      [new ApiError("x", "PERMISSION_DENIED", 403, "r", undefined, { reason: "ACCOUNT_LOCKED" }), "ACCOUNT_LOCKED"],
      [new ApiError("x", "PERMISSION_DENIED", 403, "r", undefined, { reason: "SIGNUP_DISABLED" }), "SIGNUP_DISABLED"],
      [new ApiError("x", "UNAVAILABLE", 503, "r", undefined, { reason: "PROVIDER_UNAVAILABLE" }), "PROVIDER_UNAVAILABLE"],
      [mockRefusal("UNAUTHENTICATED", { reason: "STATE_INVALID" }), "CODE_INVALID"],
      [mockRefusal("UNAVAILABLE", { reason: "PROVIDER_UNAVAILABLE" }), "PROVIDER_UNAVAILABLE"],
      // A reason on the wrong code is not that refusal.
      [new ApiError("x", "UNAVAILABLE", 503, "r", undefined, { reason: "ACCOUNT_BLOCKED" }), "UNKNOWN"],
      // A 403 without a reason is not a lock: never `isAccountLocked` here.
      [new ApiError("Forbidden", "PERMISSION_DENIED", 403, "r"), "FAILED"],
    ];
    for (const [error, reason] of pairs) expect(refusalFromExchange(error, "GOOGLE", null).reason).toBe(reason);
  });

  it("never reads a reasonless 5xx as the provider: auth-service down keeps the server's words and id", () => {
    const refusal = refusalFromExchange(new ApiError("Auth service unavailable", "UNAVAILABLE", 503, "req-down"), "GITHUB", "signin");
    expect(refusal).toMatchObject({ reason: "FAILED", message: "Auth service unavailable", requestId: "req-down" });
    expect(providerRefusalText(refusal)).toBe("Sign-in with GitHub could not be finished.");
  });

  it("keeps no words for a request that never reached the server", () => {
    expect(refusalFromExchange(new TypeError("Failed to fetch"), "GOOGLE", null)).toMatchObject({
      reason: "FAILED",
      message: null,
      requestId: null,
    });
  });

  it("reads a 429's wait, and prints an unknown reason in the detail line", () => {
    expect(
      refusalFromExchange(
        new ApiError("Too many", "RESOURCE_EXHAUSTED", 429, "r", undefined, { retryAfterSeconds: "45" }),
        null,
        null,
      ),
    ).toMatchObject({ reason: "TOO_MANY", retryAfterSeconds: 45 });
    expect(
      refusalFromExchange(new ApiError("x", "FAILED_PRECONDITION", 400, "r", undefined, { reason: "PROVIDER_ACCOUNT_CONFLICT" }), "APPLE", null),
    ).toMatchObject({ reason: "UNKNOWN", message: "PROVIDER_ACCOUNT_CONFLICT" });
  });

  it("says the callback's stale state and the exchange's used code in different sentences", () => {
    const state = providerRefusalText({ reason: "STATE_INVALID", provider: "GOOGLE", retryAfterSeconds: null });
    const code = providerRefusalText({ reason: "CODE_INVALID", provider: "GOOGLE", retryAfterSeconds: null });
    expect(state).toBe(
      "That sign-in attempt is no longer valid: it expired, a newer one replaced it, or it began in another browser. Try again from this page.",
    );
    expect(code).toBe("That sign-in could not be finished — it took too long or was already used. Try again from this page.");
  });

  it("names the provider where the table does, and says it without one", () => {
    const text = (reason: Parameters<typeof providerRefusalText>[0]["reason"], provider: string | null, retryAfterSeconds: number | null = null) =>
      providerRefusalText({ reason, provider, retryAfterSeconds });
    expect(text("PROVIDER_CANCELLED", "GOOGLE")).toBeNull();
    expect(text("EMAIL_NOT_VERIFIED", "GITHUB")).toBe(
      "Your GitHub account has no verified email address, so Taska can’t use it. Verify an email with GitHub, or sign in another way.",
    );
    expect(text("EMAIL_NOT_VERIFIED", null)).toBe(
      "The account you chose has no verified email address, so Taska can’t use it. Verify an email there, or sign in another way.",
    );
    expect(text("ACCOUNT_BLOCKED", "GOOGLE")).toBe("The Taska account for this email is blocked. Ask a Taska admin to unblock it.");
    expect(text("SIGNUP_DISABLED", "GOOGLE")).toBe(
      "No Taska account uses this email, and new accounts need an invitation. Ask a Taska admin to invite you.",
    );
    expect(text("PROVIDER_UNAVAILABLE", "APPLE")).toBe(
      "Apple sign-in isn’t available right now. Try again in a moment, or sign in another way.",
    );
    expect(text("PROVIDER_UNAVAILABLE", null)).toBe(
      "This sign-in method isn’t available right now. Try again in a moment, or sign in another way.",
    );
    expect(text("TOO_MANY", "GOOGLE", 45)).toBe("Too many attempts. Try again in 45 seconds.");
    expect(text("TOO_MANY", "GOOGLE")).toBe("Too many attempts. Try again in a few minutes.");
    expect(text("UNKNOWN", "GOOGLE")).toBe("Sign-in with Google did not finish. Try again from this page.");
  });

  it("takes a lock's deadline only when one came and is still ahead", () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    expect(refusalLockDeadline({ reason: "ACCOUNT_LOCKED", lockedUntil: null }, now)).toBeNull();
    expect(refusalLockDeadline({ reason: "ACCOUNT_LOCKED", lockedUntil: "2026-10-27T09:00:00Z" }, now)).toBeNull();
    expect(refusalLockDeadline({ reason: "ACCOUNT_LOCKED", lockedUntil: "2026-10-27T10:15:00Z" }, now)?.toISOString()).toBe(
      "2026-10-27T10:15:00.000Z",
    );
  });

  it("reads router state back only when it is a refusal", () => {
    expect(providerRefusalFromState(undefined)).toBeNull();
    expect(providerRefusalFromState({ reason: "SOMETHING" })).toBeNull();
    expect(providerRefusalFromState({ reason: "ACCOUNT_BLOCKED", requestId: "r", provider: 5 })).toMatchObject({
      reason: "ACCOUNT_BLOCKED",
      requestId: "r",
      provider: null,
    });
  });
});
