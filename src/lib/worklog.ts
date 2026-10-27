import type { AddIssueWorklogInput, UpdateIssueWorklogInput } from "../api/TaskaApi";
import { WORKLOG_COMMENT_MAX_LENGTH } from "../api/TaskaApi";
import { isDateOnly, type DateOnly, type IssueWorklog, type IssueWorklogPage } from "../domain/types";
import { formatDuration, parseDuration } from "./planning";

/**
 * The issue panel's work log (TAS-251, backend PR #178): the rules a draft
 * entry is held to before it is sent, and the few facts the section derives
 * from the list the server returns.
 */

/** What the duration box accepts, said under the box. */
export const WORKLOG_DURATION_HINT = "e.g. 1h 30m, 90m, 1.5h";

/**
 * `spentMinutes` is `int32` on the wire and the server sets no upper bound of
 * its own, so this is the largest value the field can carry at all — not a
 * product limit. A draft past it is refused here rather than sent to fail as an
 * unreadable body.
 */
export const WORKLOG_MAX_MINUTES = 2_147_483_647;

/** A draft entry as the boxes hold it. */
export interface WorklogDraft {
  duration: string;
  workDate: string;
  comment: string;
}

export type WorklogDraftField = keyof WorklogDraft;

/** One sentence per box that is wrong, and nothing for a box that is fine. */
export type WorklogDraftProblems = Partial<Record<WorklogDraftField, string>>;

/**
 * Today as the reader's calendar has it, `yyyy-MM-dd`. Built from the local
 * parts rather than `toISOString()`, which is UTC and is yesterday or tomorrow
 * for anybody far enough from Greenwich at the wrong hour.
 */
export function localDateOnly(date: Date = new Date()): DateOnly {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `day` moved by `days` calendar days. `day` has to be a valid `DateOnly`. */
export function addDays(day: DateOnly, days: number): DateOnly {
  const [year, month, date] = day.split("-").map(Number);
  return localDateOnly(new Date(year, month - 1, date + days));
}

/**
 * The server's order (backend TAS-421): newest day first, within a day the
 * entry logged last first, then the larger id — all descending, so the order is
 * total even for equal timestamps, and a local insert or a re-read never
 * reshuffles the rows. Negative when `a` comes first.
 */
export function compareWorklogs(a: IssueWorklog, b: IssueWorklog): number {
  if (a.workDate !== b.workDate) return a.workDate < b.workDate ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** The list in the order the section draws it — the server's (`compareWorklogs`). */
export function sortWorklogs(worklogs: readonly IssueWorklog[]): IssueWorklog[] {
  return [...worklogs].sort(compareWorklogs);
}

/**
 * The work log as the section draws it from the pages read so far (backend
 * TAS-421, DESIGN.md §4.24): every entry once — a page read after a write may
 * repeat one the page before it already held — in the server's order. While
 * the last page says there may be more (`hasMore` not `false`), an entry that
 * sorts after the last one that page drew is not drawn: its place among the
 * entries not yet read is unknown, and the pill counts it. A local insert goes
 * to the front of the first page, so the last entry of the last page is always
 * one the server sent.
 */
export function drawnWorklogs(pages: readonly IssueWorklogPage[]): IssueWorklog[] {
  const seen = new Set<string>();
  const unique: IssueWorklog[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
    }
  }
  const sorted = sortWorklogs(unique);
  const last = pages.at(-1);
  const cutoff = last?.items.at(-1);
  if (!last || last.hasMore === false || !cutoff) return sorted;
  return sorted.filter((item) => compareWorklogs(item, cutoff) <= 0);
}

/** The pill's number: the first page's `totalCount`, or `null` when the server did not state one. */
export function worklogsTotalCount(pages: readonly IssueWorklogPage[]): number | null {
  return pages[0]?.totalCount ?? null;
}

/** Every page with `totalCount` moved by `by`, where it is a number (an optimistic add or delete). */
function countedBy(pages: readonly IssueWorklogPage[], by: number): IssueWorklogPage[] {
  return pages.map((page) => (page.totalCount === null ? page : { ...page, totalCount: Math.max(0, page.totalCount + by) }));
}

/** An entry added at the front of the first page, counted on every page. */
export function withWorklogAdded(pages: readonly IssueWorklogPage[], worklog: IssueWorklog): IssueWorklogPage[] {
  if (!pages.length) return [...pages];
  const [first, ...rest] = countedBy(pages, 1);
  return [{ ...first, items: [worklog, ...first.items] }, ...rest];
}

/** An entry taken off whichever page holds it, and uncounted on every page — or the pages as they were. */
export function withWorklogRemoved(pages: readonly IssueWorklogPage[], worklogId: string): IssueWorklogPage[] {
  if (!pages.some((page) => page.items.some((item) => item.id === worklogId))) return [...pages];
  return countedBy(pages, -1).map((page) => ({ ...page, items: page.items.filter((item) => item.id !== worklogId) }));
}

/** An entry replaced where it stands; the count does not move. */
export function withWorklogReplaced(
  pages: readonly IssueWorklogPage[],
  worklogId: string,
  replace: (current: IssueWorklog) => IssueWorklog,
): IssueWorklogPage[] {
  return pages.map((page) => ({
    ...page,
    items: page.items.map((item) => (item.id === worklogId ? replace(item) : item)),
  }));
}

/**
 * A write's answer in place of the row it answers for. The answer does not
 * name the author (backend TAS-421 leaves the key out), so the row keeps the
 * author it knew; an answer that does name one wins.
 */
export function withWriteAnswer(current: IssueWorklog, saved: IssueWorklog): IssueWorklog {
  return Object.hasOwn(saved, "author") || !Object.hasOwn(current, "author") ? saved : { ...saved, author: current.author };
}

/**
 * The work log's total, «Xh Ym logged» (DESIGN.md §4.24): the issue's own
 * `timeSpentMinutes` (backend TAS-431), never a sum of the pages read, so it
 * stands however few entries are loaded. `null` — no total drawn — when the
 * issue did not state one, and when it states none logged: an issue with no
 * work says so in the list ("No work logged yet"), not with "0m logged".
 */
export function worklogTotalText(timeSpentMinutes: number | null): string | null {
  return timeSpentMinutes !== null && timeSpentMinutes > 0 ? `${formatDuration(timeSpentMinutes)} logged` : null;
}

/**
 * A work day as the row prints it: `Oct 9`, with the year when it is not this
 * one. Read from the parts of the string, never through `new Date(day)`, which
 * takes `yyyy-MM-dd` as UTC midnight and prints the day before for anybody west
 * of Greenwich.
 */
export function formatWorkDate(day: DateOnly, now: Date = new Date()): string {
  if (!isDateOnly(day)) return day;
  const [year, month, date] = day.split("-").map(Number);
  const local = new Date(year, month - 1, date);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(year !== now.getFullYear() ? { year: "numeric" } : {}),
  }).format(local);
}

/** A draft seeded from a stored entry, for editing it in place. */
export function draftOf(worklog: IssueWorklog): WorklogDraft {
  return {
    duration: formatDuration(worklog.spentMinutes),
    workDate: worklog.workDate,
    comment: worklog.comment ?? "",
  };
}

/**
 * What is wrong with a draft, box by box, judged against the reader's `today`.
 *
 * The future is refused from tomorrow on, though the server takes one day
 * past *its* today (`issue.max-future-days: 1`): work that has not been done
 * yet is not work to log, and the day of grace exists for clocks and zones that
 * disagree with the server's, not as a feature to offer. There is no lower
 * bound, on the server or here.
 *
 * `storedWorkDate` is the day of the entry being edited. A day left as it was
 * is not checked against the future: the server may have accepted it for its
 * own today plus one, and a comment-only edit of that entry must stay possible.
 */
export function worklogDraftProblems(
  draft: WorklogDraft,
  today: DateOnly,
  storedWorkDate?: DateOnly,
): WorklogDraftProblems {
  const problems: WorklogDraftProblems = {};

  const minutes = parseDuration(draft.duration);
  if (minutes === null) problems.duration = "Enter the time spent, e.g. 1h 30m.";
  else if (Number.isNaN(minutes)) problems.duration = "Write the time in hours and minutes, e.g. 1h 30m, 90m or 1.5h.";
  else if (minutes < 1) problems.duration = "The time spent has to be at least 1 minute.";
  else if (!Number.isInteger(minutes)) problems.duration = "The time spent has to come to whole minutes.";
  else if (minutes > WORKLOG_MAX_MINUTES) problems.duration = "That is more time than one entry can hold.";

  if (!isDateOnly(draft.workDate)) problems.workDate = "Pick the day the work was done.";
  else if (draft.workDate > today && draft.workDate !== storedWorkDate) problems.workDate = "Work cannot be logged for a day that has not come yet.";

  if (draft.comment.trim().length > WORKLOG_COMMENT_MAX_LENGTH) {
    problems.comment = `A comment can be at most ${WORKLOG_COMMENT_MAX_LENGTH} characters.`;
  }

  return problems;
}

export function hasProblems(problems: WorklogDraftProblems): boolean {
  return Object.keys(problems).length > 0;
}

/**
 * The add request for a draft `worklogDraftProblems` passed. A blank comment is
 * left out rather than sent as `""`: the server would store `null` either way,
 * and absent says so without relying on it.
 */
export function addInputOf(draft: WorklogDraft): AddIssueWorklogInput {
  const comment = draft.comment.trim();
  return {
    spentMinutes: parseDuration(draft.duration) as number,
    workDate: draft.workDate,
    ...(comment ? { comment } : {}),
  };
}

/**
 * The update request for a draft `worklogDraftProblems` passed: only the fields
 * that differ from the stored entry, and `{}` when none does — which the caller
 * must not send, because the server refuses an empty body with `400`.
 *
 * Only what changed, and not the whole entry, because the route has no version:
 * a field sent unchanged would still overwrite whatever somebody else saved to
 * it since this panel read the list. A comment emptied by the reader is sent as
 * `""`, which is how this route clears one.
 */
export function updateInputOf(worklog: IssueWorklog, draft: WorklogDraft): UpdateIssueWorklogInput {
  const input: UpdateIssueWorklogInput = {};
  const minutes = parseDuration(draft.duration);
  if (minutes !== null && minutes !== worklog.spentMinutes) input.spentMinutes = minutes;
  if (draft.workDate !== worklog.workDate) input.workDate = draft.workDate;
  const comment = draft.comment.trim();
  if (comment !== (worklog.comment ?? "")) input.comment = comment;
  return input;
}

/** An entry with an update laid over it, as the server will store it — the optimistic row. */
export function applyWorklogUpdate(worklog: IssueWorklog, input: UpdateIssueWorklogInput): IssueWorklog {
  return {
    ...worklog,
    ...(input.spentMinutes !== undefined ? { spentMinutes: input.spentMinutes } : {}),
    ...(input.workDate !== undefined ? { workDate: input.workDate } : {}),
    ...(input.comment !== undefined ? { comment: input.comment.trim() ? input.comment : null } : {}),
  };
}
