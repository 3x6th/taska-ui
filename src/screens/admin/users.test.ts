import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/rest/RestTaskaApi";
import { actionFor, globalRoleLabel, isUndeployedRoute, personLabel, readUserRow, userStatusLabel, userWriteFailure } from "./users";

/**
 * The Users section reads raw table rows, so every value it draws arrives as
 * `unknown` and every enum it branches on is an open string. These pin the two
 * rules that follow from that — an unrecognised value renders as itself and
 * offers no action, and an absent one is not the same as an empty one — plus
 * the failure classification the confirmation dialog words its sentences from.
 */
describe("admin users, reading a row", () => {
  const row = {
    id: "1cf0dc4e-0000-4000-8000-000000000001",
    login: "nina",
    email: "nina@example.com",
    display_name: "Nina Kowal",
    status: "BLOCKED",
    global_role: "USER",
    // A column the section does not name. Its presence must change nothing.
    created_at: "2026-06-01T09:00:00Z",
  };

  it("reads the named columns and ignores the rest", () => {
    expect(readUserRow(row)).toEqual({
      id: "1cf0dc4e-0000-4000-8000-000000000001",
      login: "nina",
      email: "nina@example.com",
      displayName: "Nina Kowal",
      status: "BLOCKED",
      globalRole: "USER",
    });
  });

  it("treats an absent, null or empty cell as nothing to show", () => {
    // The mock's `auth.users` has no `updated_at` and the gateway's has no
    // `password_hash`: a column that is simply not there is not an error.
    expect(readUserRow({ id: "x" })).toEqual({
      id: "x",
      login: null,
      email: null,
      displayName: null,
      status: null,
      globalRole: null,
    });
    expect(readUserRow({ id: "", display_name: null, login: "  " }).id).toBeNull();
    expect(readUserRow({ login: "  " }).login).toBe("  ");
  });

  it("does not render a value that has no printable form", () => {
    // `[object Object]` in a name column is worse than an em dash: it is a
    // claim that the server sent something, and it is unreadable either way.
    expect(readUserRow({ display_name: { first: "Nina" } }).displayName).toBeNull();
    // A column a service holds as a number still prints.
    expect(readUserRow({ login: 42 }).login).toBe("42");
  });

  it("names a person by whatever it was given, in order", () => {
    expect(personLabel(readUserRow(row))).toBe("Nina Kowal");
    expect(personLabel(readUserRow({ ...row, display_name: null }))).toBe("nina");
    expect(personLabel(readUserRow({ id: "u-1" }))).toBe("u-1");
    expect(personLabel(readUserRow({}))).toBe("this account");
  });
});

describe("admin users, statuses and roles", () => {
  it("writes the three statuses out and prints anything else verbatim", () => {
    expect(userStatusLabel("ACTIVE")).toBe("Active");
    expect(userStatusLabel("INVITED")).toBe("Invited");
    expect(userStatusLabel("BLOCKED")).toBe("Blocked");
    // TAS-173's rule: a value this build has never seen is the message.
    expect(userStatusLabel("QUARANTINED")).toBe("QUARANTINED");
    expect(userStatusLabel(null)).toBe("—");
  });

  it("writes the two roles out and prints anything else verbatim", () => {
    expect(globalRoleLabel("GLOBAL_ADMIN")).toBe("Global admin");
    expect(globalRoleLabel("USER")).toBe("User");
    expect(globalRoleLabel("AUDITOR")).toBe("AUDITOR");
    expect(globalRoleLabel(null)).toBe("—");
  });

  it("offers the action the server's own transition rules allow, and no other", () => {
    const at = (status: string | null) => actionFor(readUserRow({ id: "u-1", status }));

    // Block from ACTIVE and from INVITED; unblock only from BLOCKED.
    expect(at("ACTIVE")).toBe("block");
    expect(at("INVITED")).toBe("block");
    expect(at("BLOCKED")).toBe("unblock");
    // An unknown status offers nothing rather than guessing, and neither does a
    // missing one — a button certain to be refused is worse than no button.
    expect(at("QUARANTINED")).toBeNull();
    expect(at(null)).toBeNull();
    // Nor a row with no key: there is nothing to put in the path.
    expect(actionFor(readUserRow({ status: "ACTIVE" }))).toBeNull();
  });
});

describe("admin users, telling one failure from another", () => {
  const restError = (status: number, code: string, message: string) => new ApiError(message, code, status);

  it("reads the undeployed route from the 404 and the message together", () => {
    const undeployed = restError(
      404,
      "NOT_FOUND",
      "No static resource api/v1/admin/users/1/block for request 'POST /api/v1/admin/users/1/block'.",
    );
    expect(isUndeployedRoute(undeployed)).toBe(true);
    expect(userWriteFailure(undeployed)).toBe("undeployed");

    // A deployed route's own 404 is a missing account, and must not be read as
    // a missing deployment — that is the whole reason both halves are matched.
    const missing = restError(404, "NOT_FOUND", "User not found");
    expect(isUndeployedRoute(missing)).toBe(false);
    expect(userWriteFailure(missing)).toBe("refused");

    // And the message alone, on any other status, is not the signature either.
    expect(isUndeployedRoute(restError(500, "INTERNAL", "No static resource"))).toBe(false);
  });

  /**
   * The two refusals this section exists to word carefully do **not** share a
   * status. Read out of `RestErrorMapper.mapGrpcCodeToHttpStatus`,
   * `GatewayErrorHandler` and `DomainStatus` on the backend's
   * `feature/TAS-107`: the transition guard is `ABORTED` → **409**, and the
   * last-active-admin guard is `FAILED_PRECONDITION` → **400**, with the gRPC
   * code's own name in the response body.
   *
   * So on the wire the more important of the two arrives as a 400, and only
   * its `code` tells it apart from a plainly bad request. This test is what
   * stands between that fact and a cleanup that trims `isConflict` to the
   * status alone.
   */
  it("reads the last-admin refusal as a conflict although it is a 400, and the transition guard from its 409", () => {
    expect(userWriteFailure(restError(400, "FAILED_PRECONDITION", "Cannot block the last active global admin"))).toBe(
      "conflict",
    );
    expect(userWriteFailure(restError(409, "ABORTED", "Cannot block user with current status: BLOCKED"))).toBe(
      "conflict",
    );
    // And a 400 that really is a bad request stays one: the two must not
    // collapse, or the reader is told to fix something they did not get wrong.
    expect(userWriteFailure(restError(400, "INVALID_ARGUMENT", "reason must not be blank"))).toBe("rejected");
  });

  it("sorts the rest of the taxonomy the way §5.8 words it", () => {
    expect(userWriteFailure(restError(403, "PERMISSION_DENIED", "Forbidden"))).toBe("refused");
    expect(userWriteFailure(restError(500, "INTERNAL", "Internal error"))).toBe("server");
    // A transport failure carries neither a status nor a code, and is the one
    // case that may be called "could not be reached".
    expect(userWriteFailure(new TypeError("Failed to fetch"))).toBe("unreachable");
  });

  it("reads the mock's conflict, which has a code and no status", () => {
    // The two implementations carry different evidence for the same refusal,
    // and the section has to reach the same sentence from either — otherwise
    // mock mode and rest mode stop being interchangeable on screen.
    // Both of the mock's, which are the same two codes the gateway sends — one
    // predicate, two implementations.
    const mockTransition = Object.assign(new Error("Cannot unblock user with current status: ACTIVE"), {
      code: "ABORTED",
    });
    expect(userWriteFailure(mockTransition)).toBe("conflict");

    const mockLastAdmin = Object.assign(new Error("Cannot block the last active global admin"), {
      code: "FAILED_PRECONDITION",
    });
    expect(userWriteFailure(mockLastAdmin)).toBe("conflict");

    const mockNotFound = Object.assign(new Error("User not found"), { code: "NOT_FOUND" });
    expect(userWriteFailure(mockNotFound)).toBe("refused");

    const mockRejected = Object.assign(new Error("A reason is required"), { code: "INVALID_ARGUMENT" });
    expect(userWriteFailure(mockRejected)).toBe("rejected");
  });
});
