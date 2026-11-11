import { describe, expect, it } from "vitest";
import { MockProblemError } from "../api/mock/MockTenantServer";
import { TaskQuotaAnswerError, type ProjectTaskQuota } from "../api/tenantMembers";
import { WorkspaceClosedError } from "../api/errors";
import {
  ISSUE_COUNT_NOTE,
  ISSUE_COUNT_READ_FAILED,
  countFailureWords,
  keepsHeldCount,
  newIssueCountText,
  projectIssueCountText,
  projectTaskQuotaKey,
  retryCountRead,
} from "./projectTaskQuota";

/*
 * The project's issue counter as words and as a read (TAS-528): one template
 * at, below and over the limit, digits grouped from the decimal string; which
 * failures keep a value already shown, and which are retried.
 */

const quota = (used: string, limit: string | null): ProjectTaskQuota => ({ projectId: "p", used, limit, unlimited: limit === null });
const refusal = (status: number, code: string) => new MockProblemError(status, code, "the server's words");

describe("the words (art-director's copy table)", () => {
  it.each([
    ["0", "50", "0 issues created · 50 allowed", "0 created · 50 allowed"],
    ["1", "50", "1 issue created · 50 allowed", "1 created · 50 allowed"],
    ["47", "50", "47 issues created · 50 allowed", "47 created · 50 allowed"],
    ["50", "50", "50 issues created · 50 allowed", "50 created · 50 allowed"],
    ["64", "50", "64 issues created · 50 allowed", "64 created · 50 allowed"],
    ["1234", "5000", "1,234 issues created · 5,000 allowed", "1,234 created · 5,000 allowed"],
    ["312", null, "312 issues created · no limit", "312 created · no limit"],
    ["1234567", null, "1,234,567 issues created · no limit", "1,234,567 created · no limit"],
  ])("%s of %s", (used, limit, line, value) => {
    expect(newIssueCountText(quota(used, limit))).toBe(line);
    expect(projectIssueCountText(quota(used, limit))).toBe(value);
  });

  it("a 19-digit count is grouped as text, never through Number", () => {
    expect(projectIssueCountText(quota("9223372036854775807", null))).toBe("9,223,372,036,854,775,807 created · no limit");
  });

  it("no word of state: no «full», «over», «left» or percentage at or past the limit", () => {
    for (const used of ["49", "50", "64"]) {
      expect(`${newIssueCountText(quota(used, "50"))} ${projectIssueCountText(quota(used, "50"))}`).not.toMatch(/full|over|left|%|limit reached/i);
    }
  });

  it("the failure and the note", () => {
    expect(ISSUE_COUNT_READ_FAILED).toBe("The issue count could not be loaded.");
    expect(ISSUE_COUNT_NOTE).toBe("Deleted issues still count.");
  });

  it("one key per project, carrying no company — it lives on the company's own client", () => {
    expect(projectTaskQuotaKey("p")).toEqual(["project-task-quota", "p"]);
  });
});

describe("which failure keeps a value already shown (guard addendum 2)", () => {
  it("an answer that never came, a 408, a 429 and a 5xx keep it", () => {
    for (const error of [new TypeError("Failed to fetch"), refusal(408, "TIMEOUT"), refusal(429, "RATE_LIMITED"), refusal(503, "DEPENDENCY_UNAVAILABLE")]) {
      expect(keepsHeldCount(error)).toBe(true);
    }
  });

  it("a definite answer drops it: the concealed 404, a 403, a 400, another project's answer, a closed company", () => {
    for (const error of [
      refusal(404, "RESOURCE_NOT_FOUND"),
      refusal(403, "SCOPE_DENIED"),
      refusal(400, "VALIDATION_FAILED"),
      new TaskQuotaAnswerError("another-project"),
      new TaskQuotaAnswerError("unreadable"),
      new WorkspaceClosedError(),
    ]) {
      expect(keepsHeldCount(error)).toBe(false);
    }
  });
});

describe("the retry (guard addendum 4)", () => {
  it("once, only for an answer that never came or a 5xx — never a 429, a refusal or an answer about another project", () => {
    expect(retryCountRead(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(retryCountRead(0, refusal(503, "DEPENDENCY_UNAVAILABLE"))).toBe(true);
    expect(retryCountRead(1, refusal(503, "DEPENDENCY_UNAVAILABLE"))).toBe(false);
    expect(retryCountRead(0, refusal(429, "RATE_LIMITED"))).toBe(false);
    expect(retryCountRead(0, refusal(404, "RESOURCE_NOT_FOUND"))).toBe(false);
    expect(retryCountRead(0, new TaskQuotaAnswerError("another-project"))).toBe(false);
  });
});

describe("the server's words on the failure's detail line (§5.6)", () => {
  it("only a server's answer has words; the browser's and the client's own do not", () => {
    expect(countFailureWords(refusal(503, "DEPENDENCY_UNAVAILABLE"))).toBe("the server's words");
    expect(countFailureWords(new TypeError("Failed to fetch"))).toBeNull();
    expect(countFailureWords(new TaskQuotaAnswerError("another-project"))).toBeNull();
  });
});
