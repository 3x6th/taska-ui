import { describe, expect, it } from "vitest";
import { isAccountLocked, isMissingOrForbidden, isUndeployedRoute } from "./errors";
import { ACCOUNT_LOCKED_MESSAGE } from "../lib/accountLock";
import { UNDEPLOYED_ROUTE_MESSAGE } from "./TaskaApi";
import { ApiError } from "./rest/RestTaskaApi";

// MockTaskaApi keeps its error class private, so the shape it throws is
// restated here: an Error with a `code` and no `status`. If the mock ever
// grows a status, this local stand-in is what has to change first.
class MockLikeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

describe("isMissingOrForbidden", () => {
  it("accepts a REST 404", () => {
    expect(isMissingOrForbidden(new ApiError("Project not found", "NOT_FOUND", 404))).toBe(true);
  });

  it("accepts a REST 403", () => {
    expect(isMissingOrForbidden(new ApiError("Forbidden", "PERMISSION_DENIED", 403))).toBe(true);
  });

  // The gateway is not the only source of truth about the code: a 403 body may
  // carry something else entirely, and the mock has no status at all.
  it("accepts a status-less error by its code", () => {
    expect(isMissingOrForbidden(new MockLikeError("NOT_FOUND", "Project not found"))).toBe(true);
    expect(isMissingOrForbidden(new MockLikeError("PERMISSION_DENIED", "Not a member"))).toBe(true);
  });

  it("rejects failures that are neither missing nor forbidden", () => {
    expect(isMissingOrForbidden(new ApiError("Boom", "INTERNAL", 500))).toBe(false);
    expect(isMissingOrForbidden(new MockLikeError("INVALID_ARGUMENT", "Bad input"))).toBe(false);
    expect(isMissingOrForbidden(new Error("Failed to fetch"))).toBe(false);
  });

  it("rejects values that are not errors", () => {
    expect(isMissingOrForbidden("NOT_FOUND")).toBe(false);
    expect(isMissingOrForbidden({ code: "NOT_FOUND" })).toBe(false);
    expect(isMissingOrForbidden(undefined)).toBe(false);
    expect(isMissingOrForbidden(null)).toBe(false);
  });
});

describe("isUndeployedRoute", () => {
  // Spring's static-resource fallback, as measured on 2026-09-06 against a
  // route the gateway had not mapped. The tail is the request path, which is
  // why the predicate matches a substring.
  const staticResource = "No static resource api/v1/projects/p-1/issues/i-1/attachments for request '…'.";

  // All three arms in one test on purpose: the predicate is an `and`, and each
  // half is load-bearing for a different reason, so they are only meaningful
  // read together.
  //
  // The message arm is the obvious one — a deployed route's own 404 says
  // "Issue not found", and matching the status alone would read a missing
  // issue as a missing deployment.
  //
  // **The status arm is the one a future simplification will delete**, because
  // the message looks specific enough to stand by itself. It is not, and the
  // reason is a rule rather than an anecdote: a predicate may match the
  // signature that was measured and must not be widened past it. What was
  // measured is the pair — Spring's static-resource fallback raises
  // `NoResourceFoundException`, a 404 by construction, so this string has only
  // ever been seen with that status. Dropping the status arm does not simplify
  // the measurement, it generalises beyond it: the predicate would then fire on
  // any future response that happens to carry the string, and a 5xx is the
  // example that would hurt, because the profile menu answers "broken" and
  // "incomplete" differently — on "undeployed" it says this gateway does not
  // serve profile photos yet, takes the photo controls away and does not ask
  // again until the page reloads. Relax this to a message-only match and every
  // other test in this repository still passes.
  // Compensating for behaviour nobody has observed is the thing
  // docs/ai/API-DIVERGENCE.md exists to refuse; matching only what was observed
  // is the same rule read forwards.
  it("wants the 404 and the message together, and refuses either one alone", () => {
    expect(isUndeployedRoute(new ApiError(staticResource, "NOT_FOUND", 404), UNDEPLOYED_ROUTE_MESSAGE)).toBe(true);
    expect(isUndeployedRoute(new ApiError("Issue not found", "NOT_FOUND", 404), UNDEPLOYED_ROUTE_MESSAGE)).toBe(false);
    expect(isUndeployedRoute(new ApiError(staticResource, "INTERNAL", 500), UNDEPLOYED_ROUTE_MESSAGE)).toBe(false);
  });

  // The second signature (TAS-148): a path Spring maps for other methods, as
  // measured against the members route before backend PR #152 deployed, and
  // met again by PR #155's `PATCH /projects/{id}`. The message plays no part
  // here — the `undeployedMessage` argument passed in is the 404 arm's string
  // and this arm must not need it — so the whole test is about the status and
  // the code.
  it("also accepts a 405 for a path mapped to other methods, by its code alone", () => {
    expect(
      isUndeployedRoute(
        new ApiError("Request method 'PATCH' is not supported.", "METHOD_NOT_ALLOWED", 405),
        UNDEPLOYED_ROUTE_MESSAGE,
      ),
    ).toBe(true);
  });

  // What the code conjunct is actually for, since this gateway cannot emit a
  // 405 carrying anything else (see `isUndeployedRoute`): a 405 that did not
  // come from our gateway at all. Something in front of it answering with a
  // non-JSON body leaves `RestTaskaApi.request` with no code to read and
  // falling back to `UNKNOWN` — both shapes below are that, one where the body
  // would not parse and one where it parsed but named no code — and neither
  // says anything about what the gateway has shipped.
  it("refuses a 405 that did not come from this gateway", () => {
    expect(isUndeployedRoute(new ApiError("Request failed with 405", "UNKNOWN", 405), UNDEPLOYED_ROUTE_MESSAGE)).toBe(
      false,
    );
    expect(
      isUndeployedRoute(new ApiError("Method Not Allowed", "UNKNOWN", 405), UNDEPLOYED_ROUTE_MESSAGE),
    ).toBe(false);
  });
});

describe("isAccountLocked", () => {
  it("accepts the gateway's locked-account refusal", () => {
    expect(isAccountLocked(new ApiError(ACCOUNT_LOCKED_MESSAGE, "PERMISSION_DENIED", 403))).toBe(true);
  });

  // The accommodation `isConflict` already documents, and the reason it is not
  // optional here: MockApiError carries no HTTP status, so without this arm
  // mock mode could not reproduce the refusal and the login screen's lock
  // branch would ship with nothing having run it.
  it("accepts the mock's status-less version of it", () => {
    expect(isAccountLocked(new MockLikeError("PERMISSION_DENIED", ACCOUNT_LOCKED_MESSAGE))).toBe(true);
  });

  // The two refusals this route actually mixes with. Every other failure
  // `AuthServiceImpl.login` can raise is one of these, which is what makes the
  // code alone enough to decide the branch on a PUBLIC route.
  it("refuses the other ways a sign-in fails", () => {
    expect(isAccountLocked(new ApiError("Invalid credentials", "UNAUTHENTICATED", 401))).toBe(false);
    expect(isAccountLocked(new ApiError("Email must not be blank", "FAILED_PRECONDITION", 400))).toBe(false);
    expect(isAccountLocked(new MockLikeError("UNAUTHENTICATED", "Invalid credentials"))).toBe(false);
  });

  // The wording is never consulted: a sentence the backend has reworded once
  // already cannot be what decides whether the account is locked.
  it("ignores the message entirely", () => {
    expect(isAccountLocked(new ApiError("Заблокировано", "PERMISSION_DENIED", 403))).toBe(true);
    expect(isAccountLocked(new ApiError(ACCOUNT_LOCKED_MESSAGE, "UNAUTHENTICATED", 401))).toBe(false);
  });

  // A 403 whose body named some other code, or none that parsed. Both hands
  // are needed: this is the half `isMissingOrForbidden` would have got wrong,
  // since it accepts a bare 403.
  it("refuses a 403 that does not name PERMISSION_DENIED", () => {
    expect(isAccountLocked(new ApiError("Forbidden", "UNKNOWN", 403))).toBe(false);
    expect(isMissingOrForbidden(new ApiError("Forbidden", "UNKNOWN", 403))).toBe(true);
  });

  it("refuses values that are not errors", () => {
    expect(isAccountLocked("PERMISSION_DENIED")).toBe(false);
    expect(isAccountLocked({ code: "PERMISSION_DENIED" })).toBe(false);
    expect(isAccountLocked(null)).toBe(false);
  });
});
