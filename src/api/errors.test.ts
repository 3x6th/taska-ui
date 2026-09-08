import { describe, expect, it } from "vitest";
import { isMissingOrForbidden, isUndeployedRoute } from "./errors";
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
  // the message looks specific enough to stand by itself. It is not. A 500
  // carrying this string is a gateway that is broken, not a gateway that is
  // incomplete, and the attachments panel answers the two differently: on
  // "undeployed" it says this gateway does not serve attachments yet and takes
  // the upload control away. Relax this to a message-only match and every
  // other test in this repository still passes, while a user whose gateway is
  // merely down is told the feature does not exist.
  it("wants the 404 and the message together, and refuses either one alone", () => {
    expect(isUndeployedRoute(new ApiError(staticResource, "NOT_FOUND", 404), UNDEPLOYED_ROUTE_MESSAGE)).toBe(true);
    expect(isUndeployedRoute(new ApiError("Issue not found", "NOT_FOUND", 404), UNDEPLOYED_ROUTE_MESSAGE)).toBe(false);
    expect(isUndeployedRoute(new ApiError(staticResource, "INTERNAL", 500), UNDEPLOYED_ROUTE_MESSAGE)).toBe(false);
  });
});
