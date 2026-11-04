import { describe, expect, it } from "vitest";
import { MockProblemError } from "../api/mock/MockTenantServer";
import { ApiError } from "../api/rest/RestTaskaApi";
import { WorkspaceClosedError } from "../api/errors";
import { creationRefusal } from "./createCompanyText";

/*
 * DESIGN.md §4.36 «Отказы» (TAS-501): which refusal closes the attempt — the
 * next press mints a new key — and which keeps it open with the same key and
 * the same body. Both implementations' errors read the same.
 */

const rest = (status: number, code: string, message = "server words", retryAfterSeconds: number | null = null) =>
  new ApiError(message, code, status, `rid-${code}`, undefined, null, [], [], retryAfterSeconds);
const mock = (status: number, code: string, retryAfterSeconds: number | null = null) =>
  new MockProblemError(status, code, "server words", [], retryAfterSeconds);

describe("a refused creation", () => {
  it("closes the attempt on a definitive answer, with the form's own sentence and the request id — never the server's words", () => {
    for (const make of [rest, mock]) {
      expect(creationRefusal(make(409, "FREE_ELIGIBILITY_USED"))).toMatchObject({
        kind: "free-used",
        closesAttempt: true,
        text: "This company was not created.",
        serverWords: null,
      });
      expect(creationRefusal(make(400, "VALIDATION_FAILED"))).toMatchObject({
        kind: "name-or-plan",
        closesAttempt: true,
        text: "Taska didn’t accept this name or plan. Check the name, or choose the plan again.",
      });
      expect(creationRefusal(make(404, "TENANT_NOT_FOUND"))).toMatchObject({ kind: "gone", text: "That company no longer exists." });
      for (const [status, code] of [
        [403, "SCOPE_DENIED"],
        [409, "IDEMPOTENCY_CONFLICT"],
        [422, "QUOTA_EXCEEDED"],
        [409, "SOMETHING_NEW"],
      ] as const) {
        expect(creationRefusal(make(status, code)), code).toMatchObject({ kind: "refused", closesAttempt: true, text: "This company was not created." });
      }
    }
    expect(creationRefusal(rest(409, "FREE_ELIGIBILITY_USED")).requestId).toBe("rid-FREE_ELIGIBILITY_USED");
  });

  it("keeps the attempt open — the same key later — on a wait, an unavailable dependency, a failure or no answer", () => {
    expect(creationRefusal(rest(429, "RATE_LIMITED", "slow down", 45))).toMatchObject({
      kind: "too-many",
      closesAttempt: false,
      text: "Too many attempts. Try again in 45 seconds.",
    });
    expect(creationRefusal(mock(429, "RATE_LIMITED", 300)).text).toBe("Too many attempts. Try again in 5 minutes.");
    expect(creationRefusal(mock(429, "RATE_LIMITED")).text).toBe("Too many attempts. Try again in a few minutes.");
    for (const code of ["DEPENDENCY_UNAVAILABLE", "POLICY_NOT_CONFIGURED"]) {
      expect(creationRefusal(rest(503, code))).toMatchObject({
        kind: "unavailable",
        closesAttempt: false,
        text: "Taska can’t create a company right now. Try again later.",
        serverWords: null,
      });
    }
    expect(creationRefusal(rest(500, "INTERNAL", "boom"))).toMatchObject({
      kind: "unknown",
      closesAttempt: false,
      text: "Taska couldn’t confirm the company was created. Try again — it won’t create a second one.",
      serverWords: "boom",
    });
    expect(creationRefusal(rest(408, "TIMEOUT")).kind).toBe("unknown");
    expect(creationRefusal(new TypeError("Failed to fetch"))).toMatchObject({ kind: "unknown", closesAttempt: false, serverWords: null });
    expect(creationRefusal(new WorkspaceClosedError()).closesAttempt).toBe(false);
  });
});
