import { describe, expect, it } from "vitest";
import { lockedUntilOf } from "../lib/accountLock";
import { refusalWords } from "../lib/projectArchive";
import {
  B2B_ERROR_CODES,
  PENDING_COMMAND_REASONS,
  TenancyUnavailableError,
  WorkspaceClosedError,
  apiErrorFacts,
  hasRefusalReason,
  isAccountLocked,
  isCommandPending,
  isConflict,
  isDisplayNameInvalid,
  isIssueVersionConflict,
  isLastAdmin,
  isMissingOrForbidden,
  isProjectArchived,
  isSignupDisabled,
  isTenancyUnavailable,
  isTransitionConflict,
  isUndeployedRoute,
  isWorkspaceClosed,
  refusalCode,
  refusalReasons,
  reportable,
  toFieldViolations,
  toReasons,
} from "./errors";
import { UNDEPLOYED_ROUTE_MESSAGE } from "./TaskaApi";

/*
 * The companies build's two client-made errors (TAS-500) must be ones every
 * existing error surface can ignore: no gateway predicate may match them, and
 * nothing a screen prints may come out of them (AGENTS.md: a leg that is not a
 * gateway request carries an error the predicates provably do not match).
 */

describe("WorkspaceClosedError and TenancyUnavailableError are no gateway's refusal", () => {
  const errors = [new WorkspaceClosedError(), new TenancyUnavailableError("createAccessToken")];

  for (const error of errors) {
    it(`${error.name} matches no predicate and states no fact`, () => {
      expect(apiErrorFacts(error)).toEqual({ message: null, requestId: null, status: null, code: null, details: null });
      expect(isMissingOrForbidden(error)).toBe(false);
      expect(isProjectArchived(error)).toBe(false);
      expect(isCommandPending(error)).toBe(false);
      expect(isLastAdmin(error)).toBe(false);
      expect(isDisplayNameInvalid(error)).toBe(false);
      expect(isSignupDisabled(error)).toBe(false);
      expect(isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)).toBe(false);
      expect(isUndeployedRoute(error, "")).toBe(false);
      expect(isConflict(error)).toBe(false);
      expect(isTransitionConflict(error)).toBe(false);
      expect(isAccountLocked(error)).toBe(false);
      expect(isIssueVersionConflict(error)).toBe(false);
      for (const reason of PENDING_COMMAND_REASONS) expect(hasRefusalReason(error, "UNAVAILABLE", reason)).toBe(false);
      expect(refusalCode(error)).toBeNull();
      expect(refusalReasons(error)).toEqual([]);
      // What ApiNotice and the lock reader would print or parse from it: nothing.
      expect(refusalWords(error)).toBeNull();
      expect(lockedUntilOf(error)).toBeNull();
      // And none of the gateway's fields is even there to be read by hand.
      for (const field of ["code", "status", "details", "requestId", "reasons", "body"]) {
        expect(Object.hasOwn(error, field), field).toBe(false);
      }
    });
  }

  it("is never reportable: no screen prints its message", () => {
    expect(reportable(errors[0])).toBeNull();
    expect(reportable(null)).toBeNull();
    expect(reportable(undefined)).toBeNull();
    const refusal = new Error("Project not found");
    expect(reportable(refusal)).toBe(refusal);
  });

  it("each is told apart by its own predicate only", () => {
    expect(isWorkspaceClosed(errors[0])).toBe(true);
    expect(isWorkspaceClosed(errors[1])).toBe(false);
    expect(isTenancyUnavailable(errors[1])).toBe(true);
    expect(isTenancyUnavailable(errors[0])).toBe(false);
    expect(isWorkspaceClosed(new Error("x"))).toBe(false);
  });
});

describe("the B2B refusal classifier (B6)", () => {
  const failure = (fields: Record<string, unknown>) => Object.assign(new Error("refused"), fields);

  it("reads a Problem's code, then the legacy envelope's details.reason, and nothing else", () => {
    expect(refusalCode(failure({ code: "MEMBERSHIP_INACTIVE", status: 403 }))).toBe("MEMBERSHIP_INACTIVE");
    expect(refusalCode(failure({ code: "PERMISSION_DENIED", details: { reason: "MEMBERSHIP_INACTIVE" } }))).toBe(
      "MEMBERSHIP_INACTIVE",
    );
    // A Problem's own code wins over a reason riding beside it.
    expect(refusalCode(failure({ code: "READ_ONLY", details: { reason: "TENANT_NOT_FOUND" } }))).toBe("READ_ONLY");
    // Today's gateway: gRPC names and today's reasons are none of the blueprint's.
    expect(refusalCode(failure({ code: "FAILED_PRECONDITION", details: { reason: "PROJECT_ARCHIVED" } }))).toBeNull();
    // Not inert on the stand: its last-admin refusal carries one of the blueprint's codes as its reason.
    expect(refusalCode(failure({ code: "FAILED_PRECONDITION", status: 400, details: { reason: "LAST_ADMIN" } }))).toBe("LAST_ADMIN");
    expect(refusalCode(failure({ code: "NOT_FOUND", status: 404 }))).toBeNull();
    expect(refusalCode(failure({ code: "SOMETHING_NEW" }))).toBeNull();
    expect(refusalCode("MEMBERSHIP_INACTIVE")).toBeNull();
    // A reason that is not an own property is not read.
    const inherited = Object.create({ reason: "MEMBERSHIP_INACTIVE" }) as Record<string, string>;
    expect(refusalCode(failure({ code: "PERMISSION_DENIED", details: inherited }))).toBeNull();
  });

  it("knows the blueprint's 31 codes and none of the gateway's gRPC names", () => {
    expect(B2B_ERROR_CODES).toHaveLength(31);
    for (const grpc of ["NOT_FOUND", "PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "FAILED_PRECONDITION", "ABORTED", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "UNKNOWN"]) {
      expect(B2B_ERROR_CODES as readonly string[]).not.toContain(grpc);
    }
  });

  it("keeps a Problem's reasons and violations as they came, dropping only what is not one", () => {
    expect(refusalReasons(failure({ reasons: ["PLATFORM_BLOCK", "SOMETHING_NEW", 3, null, ""] }))).toEqual([
      "PLATFORM_BLOCK",
      "SOMETHING_NEW",
    ]);
    expect(refusalReasons(failure({ reasons: "OWNER_PAUSE" }))).toEqual([]);
    expect(toReasons(undefined)).toEqual([]);
    expect(
      toFieldViolations([{ field: "name", code: "SIZE", message: "1–120 characters" }, { field: "x", code: 1 }, null, "y"]),
    ).toEqual([{ field: "name", code: "SIZE", message: "1–120 characters" }]);
  });
});
