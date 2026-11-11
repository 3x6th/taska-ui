import { describe, expect, it } from "vitest";
import type { CreateIssueInput } from "../api/TaskaApi";
import { MockProblemError } from "../api/mock/MockTenantServer";
import { WorkspaceClosedError } from "../api/errors";
import { isIndefinite, keyFor, type SentIntent } from "./intentKey";
import { ISSUE_CREATE_UNCONFIRMED, createIssueSignature, createLeftOpen, createUnconfirmed, unconfirmedServerWords } from "./issueCreateIntent";

/*
 * One `Idempotency-Key` per New issue draft (TAS-528, api-contract-guard H1):
 * the signature covers every sent field, and the key rule is Members'
 * `keyFor` — the same key only for the same signature after an answer that
 * never came; a new one after any other answer, any change, and a success.
 */

const base: CreateIssueInput = {
  issueType: "TASK",
  priority: "MEDIUM",
  summary: "Plan the migration",
  description: "With dates.",
  storyPoints: 3,
  startDate: "2026-11-12",
};

/** What the form does around one send: the key it sends with, and what the answer leaves. */
function send(previous: SentIntent | null, projectId: string, input: CreateIssueInput, answer: "ok" | unknown): { key: string; next: SentIntent | null } {
  const signature = createIssueSignature(projectId, input);
  const key = keyFor(previous, signature);
  if (answer === "ok") return { key, next: null };
  return { key, next: { signature, key, open: isIndefinite(answer) } };
}

describe("the signature", () => {
  it("is the same for the same body, null and absent alike, whatever order it was built in", () => {
    const reordered: CreateIssueInput = { startDate: "2026-11-12", storyPoints: 3, description: "With dates.", summary: "Plan the migration", priority: "MEDIUM", issueType: "TASK" };
    expect(createIssueSignature("p", reordered)).toBe(createIssueSignature("p", base));
    expect(createIssueSignature("p", { ...base, dueDate: null })).toBe(createIssueSignature("p", base));
  });

  it.each<[string, Partial<CreateIssueInput>]>([
    ["type", { issueType: "BUG" }],
    ["status", { statusKey: "IN_PROGRESS" }],
    ["priority", { priority: "HIGH" }],
    ["summary", { summary: "Plan the migration!" }],
    ["description", { description: "" }],
    ["story points", { storyPoints: 5 }],
    ["original estimate", { originalEstimateMinutes: 60 }],
    ["remaining estimate", { remainingEstimateMinutes: 30 }],
    ["start date", { startDate: "2026-11-13" }],
    ["due date", { dueDate: "2026-11-30" }],
  ])("changes with the %s", (_name, change) => {
    expect(createIssueSignature("p", { ...base, ...change })).not.toBe(createIssueSignature("p", base));
  });

  it("changes with the project", () => {
    expect(createIssueSignature("q", base)).not.toBe(createIssueSignature("p", base));
  });
});

describe("the key", () => {
  it("is reused for the same draft after an answer that never came — the lost-answer retry", () => {
    const first = send(null, "p", base, new TypeError("Failed to fetch"));
    const retry = send(first.next, "p", { ...base }, "ok");
    expect(retry.key).toBe(first.key);
  });

  it("is reused after a 503, a 429 and a 408 — and again after a second", () => {
    let previous: SentIntent | null = null;
    const keys: string[] = [];
    for (const answer of [new MockProblemError(503, "DEPENDENCY_UNAVAILABLE", "x"), new MockProblemError(429, "RATE_LIMITED", "x"), new MockProblemError(408, "TIMEOUT", "x")]) {
      const sent = send(previous, "p", base, answer);
      keys.push(sent.key);
      previous = sent.next;
    }
    expect(new Set(keys).size).toBe(1);
  });

  it("is new after a definite answer — 422, 403, 409, 400, 404", () => {
    for (const [status, code] of [
      [422, "QUOTA_EXCEEDED"],
      [403, "READ_ONLY"],
      [409, "IDEMPOTENCY_CONFLICT"],
      [400, "VALIDATION_FAILED"],
      [404, "RESOURCE_NOT_FOUND"],
    ] as const) {
      const first = send(null, "p", base, new MockProblemError(status, code, "x"));
      expect(send(first.next, "p", base, "ok").key).not.toBe(first.key);
    }
  });

  it("is new when any sent field changed after a lost answer", () => {
    const first = send(null, "p", base, new TypeError("Failed to fetch"));
    expect(send(first.next, "p", { ...base, summary: "Changed" }, "ok").key).not.toBe(first.key);
  });

  it("is new after a success, for the same body too", () => {
    const first = send(null, "p", base, "ok");
    expect(send(first.next, "p", base, "ok").key).not.toBe(first.key);
  });
});

describe("an answer that leaves the create unconfirmed (art-director BLK-1)", () => {
  const mockRefusal = Object.assign(new Error("Project is archived"), { code: "FAILED_PRECONDITION", details: { reason: "PROJECT_ARCHIVED" } });

  it("is the exact sentence", () => {
    expect(ISSUE_CREATE_UNCONFIRMED).toBe(
      "Taska couldn’t confirm the issue was created. Press Create issue again without changing anything — it won’t create a second one.",
    );
  });

  it("no answer, a 408 and a 5xx — not a 429, a refusal, the mocks' code-only refusal, or a closed company", () => {
    for (const error of [new TypeError("Failed to fetch"), new TypeError("Load failed"), new MockProblemError(408, "TIMEOUT", "x"), new MockProblemError(503, "DEPENDENCY_UNAVAILABLE", "x")]) {
      expect(createUnconfirmed(error)).toBe(true);
    }
    for (const error of [
      new MockProblemError(429, "RATE_LIMITED", "x"),
      new MockProblemError(422, "QUOTA_EXCEEDED", "x"),
      new MockProblemError(409, "IDEMPOTENCY_CONFLICT", "x"),
      new MockProblemError(400, "VALIDATION_FAILED", "x"),
      mockRefusal,
      new WorkspaceClosedError(),
    ]) {
      expect(createUnconfirmed(error)).toBe(false);
    }
  });

  it("the key stays open exactly where the sentence may be said, and after a 429 too", () => {
    expect(createLeftOpen(new MockProblemError(429, "RATE_LIMITED", "x"))).toBe(true);
    expect(createLeftOpen(new TypeError("Failed to fetch"))).toBe(true);
    expect(createLeftOpen(mockRefusal)).toBe(false);
    expect(createLeftOpen(new MockProblemError(422, "QUOTA_EXCEEDED", "x"))).toBe(false);
  });

  it("the server's words under it only when there was an HTTP answer", () => {
    expect(unconfirmedServerWords(new MockProblemError(503, "DEPENDENCY_UNAVAILABLE", "issue-service is unavailable"))).toBe("issue-service is unavailable");
    expect(unconfirmedServerWords(new TypeError("Failed to fetch"))).toBeNull();
  });
});
