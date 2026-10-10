import { describe, expect, it } from "vitest";
import type { IssueWorklog } from "../domain/types";
import {
  addDays,
  addInputOf,
  applyWorklogUpdate,
  formatWorkDate,
  localDateOnly,
  sortWorklogs,
  totalSpentMinutes,
  updateInputOf,
  worklogDraftProblems,
} from "./worklog";

const entry = (overrides: Partial<IssueWorklog>): IssueWorklog => ({
  id: "w",
  issueId: "i",
  projectId: "p",
  authorUserId: "u",
  spentMinutes: 60,
  workDate: "2026-10-09",
  comment: null,
  createdAt: "2026-10-09T09:00:00Z",
  updatedAt: null,
  ...overrides,
});

describe("worklog drafts", () => {
  const today = "2026-10-10";
  const draft = (duration: string, workDate = today, comment = "") => ({ duration, workDate, comment });

  it.each([
    ["1h 30m", 90],
    ["90m", 90],
    ["1.5h", 90],
    ["2h", 120],
    ["45", 45],
  ])("accepts %s as %i minutes", (duration, minutes) => {
    expect(worklogDraftProblems(draft(duration), today)).toEqual({});
    expect(addInputOf(draft(duration)).spentMinutes).toBe(minutes);
  });

  it.each([
    ["", "Enter the time spent, e.g. 1h 30m."],
    ["soon", "Write the time in hours and minutes, e.g. 1h 30m, 90m or 1.5h."],
    ["0m", "The time spent has to be at least 1 minute."],
    ["-5", "The time spent has to be at least 1 minute."],
    ["1.51h", "The time spent has to come to whole minutes."],
  ])("refuses %j with a sentence that says why", (duration, message) => {
    expect(worklogDraftProblems(draft(duration), today).duration).toBe(message);
  });

  it("refuses a day after today, and an empty day, but not a day long past", () => {
    expect(worklogDraftProblems(draft("1h", "2026-10-11"), today).workDate).toMatch(/has not come yet/);
    expect(worklogDraftProblems(draft("1h", ""), today).workDate).toBe("Pick the day the work was done.");
    expect(worklogDraftProblems(draft("1h", "2019-01-01"), today)).toEqual({});
  });

  it("refuses a comment past 2000 characters", () => {
    expect(worklogDraftProblems(draft("1h", today, "x".repeat(2001)), today).comment).toMatch(/2000/);
  });

  it("leaves a blank comment out of an add", () => {
    expect(addInputOf(draft("1h", today, "   "))).toEqual({ spentMinutes: 60, workDate: today });
    expect(addInputOf(draft("1h", today, " Pairing "))).toEqual({ spentMinutes: 60, workDate: today, comment: "Pairing" });
  });

  it("sends only the fields an edit changed, an emptied comment as an empty string, and nothing for no change", () => {
    const stored = entry({ comment: "Pairing" });
    expect(updateInputOf(stored, draft("1h", "2026-10-09", "Pairing"))).toEqual({});
    expect(updateInputOf(stored, draft("1h 15m", "2026-10-09", "Pairing"))).toEqual({ spentMinutes: 75 });
    expect(updateInputOf(stored, draft("60m", "2026-10-08", ""))).toEqual({ workDate: "2026-10-08", comment: "" });
  });

  it("lays an update over an entry as the server stores it", () => {
    expect(applyWorklogUpdate(entry({ comment: "x" }), { comment: "" }).comment).toBeNull();
    expect(applyWorklogUpdate(entry({}), { spentMinutes: 5 }).spentMinutes).toBe(5);
  });
});

describe("the work log list", () => {
  it("orders by day, newest first, and within a day by when it was logged", () => {
    const sorted = sortWorklogs([
      entry({ id: "a", workDate: "2026-10-08", createdAt: "2026-10-08T09:00:00Z" }),
      entry({ id: "b", workDate: "2026-10-09", createdAt: "2026-10-09T08:00:00Z" }),
      entry({ id: "c", workDate: "2026-10-09", createdAt: "2026-10-09T10:00:00Z" }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("totals the listed minutes", () => {
    expect(totalSpentMinutes([entry({ spentMinutes: 90 }), entry({ spentMinutes: 120 })])).toBe(210);
    expect(totalSpentMinutes([])).toBe(0);
  });

  it("prints a day without moving it across a zone, and its year only when it is not this one", () => {
    const now = new Date(2026, 9, 10);
    expect(formatWorkDate("2026-10-09", now)).toBe("Oct 9");
    expect(formatWorkDate("2025-12-31", now)).toBe("Dec 31, 2025");
  });

  it("builds today from the local calendar and steps over a month end", () => {
    expect(localDateOnly(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
