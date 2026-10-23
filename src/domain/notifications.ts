import type { Notification, NotificationType } from "./types";

/** Typed against the list, so the comparisons this file makes cannot drift from the names the gateway sends. */
const ISSUE_DELETED: NotificationType = "ISSUE_DELETED";
const MEMBER_REMOVED: NotificationType = "MEMBER_REMOVED";

/**
 * Where a notification row goes when it is pressed: the app route of the issue
 * it is about, the board of the project it is about, or `null` for nothing to
 * open (DESIGN.md §4.12).
 *
 * The gateway states the issue outright (TAS-243): `NotificationResponseDto`
 * carries `issueId`, `issueKey` and `projectId`, and the two ids are all this
 * app's issue route needs. So the route is built from the notification alone —
 * no read, and nothing from the screen the bell happens to be open on, which is
 * what lets `/projects` and `/admin` open a notification exactly as a board
 * does.
 *
 * **Both ids open the issue.** Any kind, attachments included since backend PR
 * #191 (TAS-245) — except `ISSUE_DELETED`, which carries both ids of an issue
 * that no longer exists, so its route would open a panel onto a not-found.
 *
 * **`projectId` alone opens the project's board** (TAS-149). That is how
 * `PROJECT_ARCHIVED` (backend PR #159) arrives, and an archived project's board
 * still opens, read-only. `MEMBER_REMOVED` is the exception: the reader is no
 * longer on that project, so the board would end on §4.18's not-found.
 *
 * **No `projectId` opens nothing**, whatever else the row carries. Two kinds
 * of row arrive that way: a notification about no project (`USER_*`), or one
 * written before the gateway stored these columns, which were added without a
 * backfill. An attachment notification written before backend PR #191 carries
 * `issueId` but not `projectId` — issue-service's `PayloadSerializer` did not
 * call `putIssueFields` for those two until then — and opens nothing either.
 *
 * The rule is the ids, never the kind, with exactly the two exceptions above
 * by name. The body is never mined for an id: an old row may well have a uuid
 * in its prose, and a uuid in prose is not a statement of which issue, or even
 * which kind of thing, it names. Every other kind — the ones not in
 * `NotificationType` included — is taken at its ids.
 */
export function notificationRoute(
  notification: Pick<Notification, "notificationType" | "issueId" | "projectId">,
): string | null {
  const { issueId, projectId, notificationType } = notification;
  if (!projectId) return null;
  if (issueId) return notificationType === ISSUE_DELETED ? null : `/projects/${projectId}/issues/${issueId}`;
  return notificationType === MEMBER_REMOVED ? null : `/projects/${projectId}/board`;
}
