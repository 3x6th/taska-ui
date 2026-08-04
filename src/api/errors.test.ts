import { describe, expect, it } from "vitest";
import { isMissingOrForbidden } from "./errors";
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
