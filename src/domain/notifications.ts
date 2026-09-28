import type { Notification, NotificationType } from "./types";

/** Typed against the list, so the one comparison this file makes cannot drift from the name the gateway sends. */
const ISSUE_DELETED: NotificationType = "ISSUE_DELETED";

/**
 * Where a notification row goes when it is pressed: the app route of the issue
 * it is about, or `null` for nothing to open.
 *
 * The gateway states the issue outright (TAS-243): `NotificationResponseDto`
 * carries `issueId`, `issueKey` and `projectId`, and the two ids are all this
 * app's issue route needs. So the route is built from the notification alone —
 * no read, and nothing from the screen the bell happens to be open on, which is
 * what lets `/projects` and `/admin` open a notification exactly as a board
 * does.
 *
 * A notification targets nothing when either id is missing. Three kinds of
 * row arrive that way. Two are ordinary rather than faults: a notification
 * that is not about an issue (`MEMBER_*`, `PROJECT_CREATED`, `USER_*`), and an
 * issue notification written before the gateway stored these columns, which
 * were added without a backfill. The third is a bug, not a design: an
 * attachment notification (`ISSUE_ATTACHMENT_ADDED`, `ISSUE_ATTACHMENT_DELETED`)
 * carries `issueId` but not `issueKey` or `projectId`, because issue-service's
 * `PayloadSerializer` writes the first and never calls `putIssueFields` for the
 * other two — filed as TAS-245, and this route stays closed until it lands.
 * The body is never mined for an id, in any of the three: an old row may well
 * have a uuid in its prose — an attachment row always does, since `issueKey` is
 * null and the body names the issue the only way it can — and a uuid in prose
 * is not a statement of which issue, or even which kind of thing, it names.
 *
 * `ISSUE_DELETED` is the one kind excluded by name. It carries both ids of an
 * issue that no longer exists, so its route would open a panel onto a
 * not-found. Every other kind — the ones not in `NotificationType` included —
 * is taken at its ids: an unrecognised kind that names an issue still names
 * one.
 */
export function notificationRoute(
  notification: Pick<Notification, "notificationType" | "issueId" | "projectId">,
): string | null {
  const { issueId, projectId } = notification;
  if (!issueId || !projectId || notification.notificationType === ISSUE_DELETED) {
    return null;
  }
  return `/projects/${projectId}/issues/${issueId}`;
}
