import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/rest/RestTaskaApi";
import type { InvitationResult } from "../../domain/types";
import {
  actionAccessibleName,
  actionFor,
  actionLabels,
  globalRoleLabel,
  inviteDeadline,
  inviteFailure,
  invitedStatusText,
  labelIsKey,
  personLabel,
  readUserRow,
  resentStatusText,
  retryAfterSeconds,
  stillInvitedText,
  targetStatus,
  tooSoonText,
  userStatusInSentence,
  userStatusLabel,
  userWriteFailure,
} from "./users";

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
      email: null,
      displayName: null,
      status: null,
      globalRole: null,
    });
    expect(readUserRow({ id: "", display_name: null, email: "  " }).id).toBeNull();
    // Whitespace is a value, not an absence: only empty collapses.
    expect(readUserRow({ display_name: "  " }).displayName).toBe("  ");
  });

  it("does not read a login, even from a table that still has the column", () => {
    // `auth.users` drops it with backend PR #219 (TAS-388); a gateway still on
    // the old schema sends it, and the row must come out the same either way.
    const read = readUserRow({ ...row, login: "nina" });
    expect(read).toEqual(readUserRow(row));
    expect(read).not.toHaveProperty("login");
  });

  it("does not render a value that has no printable form", () => {
    // `[object Object]` in a name column is worse than an em dash: it is a
    // claim that the server sent something, and it is unreadable either way.
    expect(readUserRow({ display_name: { first: "Nina" } }).displayName).toBeNull();
    // A column a service holds as a number still prints.
    expect(readUserRow({ status: 42 }).status).toBe("42");
  });

  it("names a person by whatever it was given, in order: name, email, key, nothing", () => {
    expect(personLabel(readUserRow(row))).toBe("Nina Kowal");
    expect(personLabel(readUserRow({ ...row, display_name: null }))).toBe("nina@example.com");
    expect(personLabel(readUserRow({ id: "u-1" }))).toBe("u-1");
    expect(personLabel(readUserRow({}))).toBe("this account");
    // Never a login, and never the `invited_<uuid>` auth-service used to give
    // an invited account in its place, even when the column is still sent.
    expect(personLabel(readUserRow({ id: "u-2", login: "invited_5b2e8d14-7a03-4c69-b1f5-2e9d0a7c4f38" }))).toBe("u-2");
  });

  it("knows when the name is only the row's key, which is then drawn as a key", () => {
    expect(labelIsKey(readUserRow(row))).toBe(false);
    expect(labelIsKey(readUserRow({ ...row, display_name: null }))).toBe(false);
    expect(labelIsKey(readUserRow({ id: "u-1" }))).toBe(true);
    // No key either: "this account" is words, not a machine value.
    expect(labelIsKey(readUserRow({}))).toBe(false);
  });
});

describe("admin users, statuses and roles", () => {
  it("writes the four statuses out and prints anything else verbatim", () => {
    expect(userStatusLabel("ACTIVE")).toBe("Active");
    expect(userStatusLabel("INVITED")).toBe("Invited");
    expect(userStatusLabel("BLOCKED")).toBe("Blocked");
    // The fourth, added with TAS-188. `auth.users` could hold it before this
    // build could name it — an account lands there by failing to sign in too
    // many times, not by anything an administrator does.
    expect(userStatusLabel("LOCKED")).toBe("Locked");
    // TAS-173's rule, which widening the union must not close: a value this
    // build has never seen is still the message.
    expect(userStatusLabel("QUARANTINED")).toBe("QUARANTINED");
    expect(userStatusLabel(null)).toBe("—");
  });

  it("names an unknown status by an English /meta name only, and lowercases only its own words in a sentence", () => {
    // The one rule every dictionary follows since TAS-173, shared with the
    // profile menu: the build's word, then a served name with no Cyrillic in
    // it, then the value as it came.
    const served = [
      { code: "QUARANTINED", name: "Quarantined", selectable: true },
      { code: "ACTIVE", name: "Активен", selectable: true },
      { code: "ARCHIVED", name: "В архиве", selectable: true },
    ];
    expect(userStatusLabel("QUARANTINED", served)).toBe("Quarantined");
    expect(userStatusLabel("ACTIVE", served)).toBe("Active");
    expect(userStatusLabel("ARCHIVED", served)).toBe("ARCHIVED");
    // "Anna is now blocked." — and "Anna is now QUARANTINED.", never a
    // lowercased code nobody sent.
    expect(userStatusInSentence("BLOCKED")).toBe("blocked");
    expect(userStatusInSentence("QUARANTINED")).toBe("QUARANTINED");
  });

  it("writes the two roles out and prints anything else verbatim", () => {
    expect(globalRoleLabel("GLOBAL_ADMIN")).toBe("Global admin");
    expect(globalRoleLabel("USER")).toBe("User");
    expect(globalRoleLabel("AUDITOR")).toBe("AUDITOR");
    expect(globalRoleLabel(null)).toBe("—");
  });

  it("offers the action the server's own transition rules allow, and no other", () => {
    const at = (status: string | null) => actionFor(readUserRow({ id: "u-1", status }));

    // Block from ACTIVE and from INVITED; unblock only from BLOCKED;
    // reset-lockout only from LOCKED.
    expect(at("ACTIVE")).toBe("block");
    expect(at("INVITED")).toBe("block");
    expect(at("BLOCKED")).toBe("unblock");
    // Not `block`, which the server refuses from LOCKED with `ABORTED`, and no
    // longer `null`, which is what this returned while the route did not exist.
    expect(at("LOCKED")).toBe("reset");
    // An unknown status offers nothing rather than guessing, and neither does a
    // missing one — a button certain to be refused is worse than no button.
    expect(at("QUARANTINED")).toBeNull();
    expect(at(null)).toBeNull();
    // Nor a row with no key: there is nothing to put in the path.
    expect(actionFor(readUserRow({ status: "ACTIVE" }))).toBeNull();
  });

  it("names each action and the status the server would land on", () => {
    expect(actionLabels.block).toBe("Block");
    expect(actionLabels.unblock).toBe("Unblock");
    // "Reset lockout" rather than "Unlock": one letter away from "Unblock" is
    // not a difference a reader can rely on in the column where both appear.
    expect(actionLabels.reset).toBe("Reset lockout");

    // The name a screen reader reads is a phrase per action, not the label with
    // the person after it: "Reset lockout Omar Haddad" is a fragment. Each
    // visible label is still contained in its name (WCAG 2.5.3).
    expect(actionAccessibleName("block", "Nina Kowal")).toBe("Block Nina Kowal");
    expect(actionAccessibleName("unblock", "Nina Kowal")).toBe("Unblock Nina Kowal");
    expect(actionAccessibleName("reset", "Omar Haddad")).toBe("Reset lockout for Omar Haddad");
    for (const action of ["block", "unblock", "reset"] as const) {
      expect(actionAccessibleName(action, "Omar Haddad")).toContain(actionLabels[action]);
    }

    expect(targetStatus("block")).toBe("BLOCKED");
    expect(targetStatus("unblock")).toBe("ACTIVE");
    // Always ACTIVE: auth-service sets the account active while it clears the
    // credential's counters, so the confirmation can state the transition.
    expect(targetStatus("reset")).toBe("ACTIVE");
  });
});

describe("admin users, telling one failure from another", () => {
  const restError = (status: number, code: string, message: string) => new ApiError(message, code, status);

  /**
   * Every 404 these routes answer is now the route's own, and there is no
   * seventh classification hiding behind one. Until TAS-196 the section also
   * read a 404 carrying Spring's static-resource message as "not deployed yet";
   * backend PR #146 mapped all three paths, so the only 404 left is a statement
   * about the resource and all of them are `refused`.
   */
  it("reads every 404 these routes answer as a refusal", () => {
    // Block and unblock have one sentence for it; reset-lockout has two — no
    // such user, and a locked account with no password credential behind it —
    // on one status and one code. Nothing may branch on the wording.
    for (const message of ["User not found", "Credential not found"]) {
      expect(userWriteFailure(restError(404, "NOT_FOUND", message))).toBe("refused");
    }
    // Including the shape that used to mean something else: it is a 404 from
    // these routes and it says the same thing about them as any other.
    expect(
      userWriteFailure(
        restError(
          404,
          "NOT_FOUND",
          "No static resource api/v1/admin/users/1/block for request 'POST /api/v1/admin/users/1/block'.",
        ),
      ),
    ).toBe("refused");
  });

  it("reads the reset-lockout refusal as a conflict, which it reaches only by its code", () => {
    // `FAILED_PRECONDITION` → **400** (`RestErrorMapper.mapGrpcCodeToHttpStatus`),
    // the shape the last-admin guard wears rather than the transition guard's
    // 409 — so this arrives on the same status as a plainly bad request and is
    // told apart from one by nothing but the code. The backend PR's own gateway
    // test asserts 409 here; it mocks the client's error and measures nothing.
    expect(userWriteFailure(restError(400, "FAILED_PRECONDITION", "User is not in LOCKED status"))).toBe("conflict");
    // The mock carries a code and no status and must reach the same sentence.
    const fromMock = Object.assign(new Error("User is not in LOCKED status"), { code: "FAILED_PRECONDITION" });
    expect(userWriteFailure(fromMock)).toBe("conflict");
  });

  /**
   * The two refusals this section exists to word carefully do **not** share a
   * status. Read out of `RestErrorMapper.mapGrpcCodeToHttpStatus`,
   * `GatewayErrorHandler` and `DomainStatus` on the backend at
   * `01a5af4`: the transition guard is `ABORTED` → **409**, and the
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

/**
 * The invitation's words (§5.8): the deadline in UTC, "queued" and never
 * "sent", the 429's wait from `details` — a string on the wire — and the two
 * refusals that are this route's own before the section's taxonomy.
 */
describe("invitation helpers", () => {
  const result = (overrides: Partial<InvitationResult> = {}): InvitationResult => ({
    userId: "u-1",
    status: "INVITED",
    deliveryQueued: true,
    expiresAt: "2026-10-26T23:59:00Z",
    created: true,
    ...overrides,
  });

  it("prints the deadline in UTC whatever the reader's zone, and nothing for a value that is not an instant", () => {
    expect(inviteDeadline("2026-10-26T23:59:00Z")).toBe("Oct 26, 23:59");
    expect(inviteDeadline("2026-10-27T00:05:00+03:00")).toBe("Oct 26, 21:05");
    expect(inviteDeadline("soon")).toBeNull();
  });

  it("says queued for a new account and for a re-issued link, and drops the clause it cannot fill", () => {
    expect(invitedStatusText(result(), "a@b.io")).toBe(
      "a@b.io is invited. The email is queued for sending; the link works until Oct 26, 23:59 UTC.",
    );
    expect(invitedStatusText(result({ created: false }), "a@b.io")).toBe(
      "a@b.io was already invited but did not have a working link, so a new one is queued; it works until Oct 26, 23:59 UTC.",
    );
    expect(invitedStatusText(result({ expiresAt: "" }), "a@b.io")).toBe("a@b.io is invited. The email is queued for sending.");
    expect(resentStatusText(result(), "Leo Fischer")).toBe(
      "A new invitation link for Leo Fischer is queued; it works until Oct 26, 23:59 UTC.",
    );
    expect(stillInvitedText("2026-10-26T23:59:00Z", "a@b.io")).toBe(
      "a@b.io is already invited and their link still works until Oct 26, 23:59 UTC, so no email was sent. If they lost it, send a new link — the old one will stop working.",
    );
  });

  it("reads the 429's wait from details as a whole positive number, and only from there", () => {
    const refusal = (details: Record<string, string> | null) =>
      new ApiError("Invitation was sent recently; try again later", "RESOURCE_EXHAUSTED", 429, "req", undefined, details);

    expect(retryAfterSeconds(refusal({ retryAfterSeconds: "42" }))).toBe(42);
    const unreadable: (Record<string, string> | null)[] = [
      null,
      {},
      { retryAfterSeconds: "0" },
      { retryAfterSeconds: "4.5" },
      { retryAfterSeconds: "soon" },
    ];
    for (const details of unreadable) {
      expect(retryAfterSeconds(refusal(details))).toBeNull();
    }
    expect(tooSoonText(refusal({ retryAfterSeconds: "1" }), "a@b.io")).toBe(
      "An invitation to a@b.io was sent less than a minute ago. Try again in 1 second.",
    );
    expect(tooSoonText(refusal(null), "a@b.io")).toBe(
      "An invitation to a@b.io was sent less than a minute ago. Try again in a minute.",
    );
  });

  it("classifies the route's own refusals before the section's taxonomy, from either implementation", () => {
    const fromMock = (code: string) => Object.assign(new Error("x"), { code });
    expect(inviteFailure(fromMock("RESOURCE_EXHAUSTED"))).toBe("tooSoon");
    expect(inviteFailure(new ApiError("x", "RESOURCE_EXHAUSTED", 429))).toBe("tooSoon");
    expect(inviteFailure(fromMock("ALREADY_EXISTS"))).toBe("exists");
    expect(inviteFailure(new ApiError("x", "ALREADY_EXISTS", 409))).toBe("exists");
    expect(inviteFailure(fromMock("PERMISSION_DENIED"))).toBe("refused");
    expect(inviteFailure(fromMock("INVALID_ARGUMENT"))).toBe("rejected");
    expect(inviteFailure(new ApiError("x", "INTERNAL", 500))).toBe("server");
    expect(inviteFailure(new TypeError("Failed to fetch"))).toBe("unreachable");
  });
});
