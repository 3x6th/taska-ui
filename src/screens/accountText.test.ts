import { describe, expect, it } from "vitest";
import { MalformedAnswerError } from "../api/accountCredentials";
import {
  answered,
  backLabel,
  codeSentText,
  isDeadCode,
  isDeadLink,
  normalizeCode,
  recoveryLead,
  recoverySentText,
  violatedFields,
  violationLines,
} from "./accountText";

/*
 * The words of TAS-527 that depend on a value (art-director's «Copy» table,
 * api-contract-guard's Addendum): which refusal a failure is, the violations'
 * lines, the code step's sentence and the code as it is sent.
 */

const problem = (status: number | null, code: string | null, violations: Array<{ field: string; code: string; message: string }> = []) =>
  Object.assign(new Error("the server's words"), { status, code, requestId: "rid", details: null, violations });

const FIELDS = [
  { name: "currentPassword", label: "Current password" },
  { name: "newPassword", label: "New password" },
];

describe("the dead link and the dead code", () => {
  it("a link is dead on a 401 of any code, a 422 CONFIRMATION_EXPIRED, or a violation named exactly token", () => {
    expect(isDeadLink(problem(401, "AUTHENTICATION_REQUIRED"))).toBe(true);
    expect(isDeadLink(problem(401, "TOKEN_REVOKED"))).toBe(true);
    expect(isDeadLink(problem(422, "CONFIRMATION_EXPIRED"))).toBe(true);
    expect(isDeadLink(problem(400, "VALIDATION_FAILED", [{ field: "token", code: "INVALID", message: "m" }]))).toBe(true);
    // Not: another 422, a violation on another field or one only like `token`, no answer.
    expect(isDeadLink(problem(422, "QUOTA_EXCEEDED"))).toBe(false);
    expect(isDeadLink(problem(422, "CONFIRMATION_REQUIRED"))).toBe(false);
    expect(isDeadLink(problem(400, "VALIDATION_FAILED", [{ field: "newPassword", code: "INVALID", message: "m" }]))).toBe(false);
    expect(isDeadLink(problem(400, "VALIDATION_FAILED", [{ field: "body.token", code: "INVALID", message: "m" }]))).toBe(false);
    expect(isDeadLink(new TypeError("Failed to fetch"))).toBe(false);
  });

  it("a code is dead on 422 CONFIRMATION_EXPIRED and 404 RESOURCE_NOT_FOUND only", () => {
    expect(isDeadCode(problem(422, "CONFIRMATION_EXPIRED"))).toBe(true);
    expect(isDeadCode(problem(404, "RESOURCE_NOT_FOUND"))).toBe(true);
    for (const error of [problem(422, "QUOTA_EXCEEDED"), problem(422, "INVITATION_EXPIRED"), problem(404, "TENANT_NOT_FOUND"), problem(401, "AUTHENTICATION_REQUIRED")]) {
      expect(isDeadCode(error)).toBe(false);
    }
  });
});

describe("the violations' lines (B6)", () => {
  it("one alone: the server's words as they came, and the field it names", () => {
    const error = problem(400, "VALIDATION_FAILED", [{ field: "currentPassword", code: "MISMATCH", message: "The current password is not correct." }]);
    expect(violationLines(error, FIELDS)).toEqual([{ field: "currentPassword", text: "The current password is not correct." }]);
    expect([...violatedFields(error, FIELDS)]).toEqual(["currentPassword"]);
  });

  it("several: in the form's order, each of the form's prefixed with its label; a field it does not have unmarked, last", () => {
    const error = problem(400, "VALIDATION_FAILED", [
      { field: "body", code: "X", message: "Something about the body." },
      { field: "newPassword", code: "INVALID", message: "Too short." },
      { field: "currentPassword", code: "INVALID", message: "Too long." },
    ]);
    expect(violationLines(error, FIELDS)).toEqual([
      { field: "currentPassword", text: "Current password: Too long." },
      { field: "newPassword", text: "New password: Too short." },
      { field: null, text: "Something about the body." },
    ]);
    expect([...violatedFields(error, FIELDS)].sort()).toEqual(["currentPassword", "newPassword"]);
  });

  it("none for anything but a 400 — and never from the server's words", () => {
    expect(violationLines(problem(409, "INVALID_STATE", [{ field: "newEmail", code: "X", message: "m" }]), FIELDS)).toEqual([]);
    expect(violationLines(problem(400, "VALIDATION_FAILED"), FIELDS)).toEqual([]);
  });
});

describe("the code step's sentence and the code as sent", () => {
  const now = new Date(2026, 10, 11, 13, 0);
  const at = (hours: number, minutes: number, day = 11) => new Date(2026, 10, day, hours, minutes).toISOString();

  it("where the code went, by the mask and the channel, then until when — a clock today, a date past it", () => {
    expect(codeSentText({ delivery: "EMAIL", maskedDestination: "a•••@example.com", expiresAt: at(13, 10) }, now)).toBe(
      "We sent a code to a•••@example.com. It works until 13:10.",
    );
    expect(codeSentText({ delivery: "TELEGRAM", maskedDestination: "@an•••", expiresAt: null }, now)).toBe("We sent a code to @an••• in Telegram.");
    expect(codeSentText({ delivery: "EMAIL", maskedDestination: null, expiresAt: null }, now)).toBe("We sent a code by email.");
    expect(codeSentText({ delivery: "TELEGRAM", maskedDestination: null, expiresAt: null }, now)).toBe("We sent a code to your Telegram.");
    expect(codeSentText({ delivery: "PIGEON", maskedDestination: null, expiresAt: null }, now)).toBe("We sent you a code.");
    expect(codeSentText({ delivery: null, maskedDestination: "x", expiresAt: at(0, 5, 12) }, now)).toBe("We sent a code to x. It works until Nov 12, 00:05.");
  });

  it("strips whitespace — the no-break space too — and every dash, and nothing else", () => {
    expect(normalizeCode(" 1234 5678 ")).toBe("12345678");
    expect(normalizeCode("1234-5678")).toBe("12345678");
    expect(normalizeCode("1234 5678–−")).toBe("12345678");
    // No truncation, no other digits converted, nothing refused: the server's 400 decides.
    expect(normalizeCode("123456789")).toBe("123456789");
    expect(normalizeCode("١٢٣٤٥٦٧٨")).toBe("١٢٣٤٥٦٧٨");
    expect(normalizeCode("12ab")).toBe("12ab");
  });
});

describe("the reset's words", () => {
  it("the sent sentence names only the typed address, and «another link» after a resend", () => {
    expect(recoverySentText("x@example.com", false)).toBe(
      "If x@example.com belongs to a Taska account, we’ve sent a link there. Open it to choose a new password.",
    );
    expect(recoverySentText("x@example.com", true)).toContain("we’ve sent another link there");
  });

  it("the lead says this browser is one of them when it holds a session, in Settings' verbs (decision 4, build review B2)", () => {
    expect(recoveryLead(false)).toBe(
      "Setting a new password signs you out of Taska on every device. It also revokes your access tokens and disconnects your connected apps.",
    );
    expect(recoveryLead(true)).toBe(
      "Setting a new password signs you out of Taska on every device, this browser included. It also revokes your access tokens and disconnects your connected apps.",
    );
  });

  it("the ghost says where `/login` goes: into the app with a session, to sign in without (N3)", () => {
    expect(backLabel(true)).toBe("Back to Taska");
    expect(backLabel(false)).toBe("Back to sign in");
  });

  it("an answer this build could not read is answered; nothing answered, or a client-made refusal, is not", () => {
    expect(answered(new MalformedAnswerError())).toBe(true);
    expect(answered(problem(400, "VALIDATION_FAILED"))).toBe(true);
    expect(answered(new TypeError("Failed to fetch"))).toBe(false);
    expect(answered(new Error("The answer held nothing"))).toBe(false);
  });
});
