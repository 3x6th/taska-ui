/**
 * Where a notification row goes when it is pressed.
 *
 * **This whole file is a compensation for TAS-184 and comes out with it.** The
 * contract declares `NotificationResponseDto.link` as a nullable string and says
 * nothing about its format, so the gateway is not breaking an agreement — there
 * is no agreement. Measured against the deployed gateway with a `GLOBAL_ADMIN`
 * token, the eight most recent notifications carried two shapes:
 *
 * - `LABEL_ADDED` / `LABEL_REMOVED` → `"/issues/{uuid}"`
 * - `ISSUE_ASSIGNED` / `ISSUE_TRANSITIONED` → `""`
 *
 * `/issues/{uuid}` is the gateway's own API path, not a route this frontend
 * has: ours is `/projects/:projectId/issues/:issueId`. Handing either shape
 * straight to `navigate()` matched nothing and rendered the not-found screen,
 * which is the defect this resolves.
 *
 * `notificationType` is deliberately not consulted. It is inert everywhere else
 * in the app, the wire already carries values outside `NotificationType`
 * (`LABEL_ADDED`, `LABEL_REMOVED` — TAS-173), and routing on it would make that
 * gap load-bearing. Link shape and body are enough.
 */
export type NotificationTarget =
  /** The link is already one of this app's own routes; use it unchanged. */
  | { kind: "route"; route: string }
  /**
   * An issue id with no project attached. The caller has to read the issue to
   * learn its `projectId` before it can build a route — `TaskaApi.getIssueById`
   * exists for exactly this.
   */
  | { kind: "issue"; issueId: string }
  /** Nothing to open. The row still marks itself read; it must not navigate. */
  | { kind: "none" };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The gateway's own issue path. The optional `/api/v1` covers the day the
 * gateway starts sending the prefix it serves the route under — cheaper than
 * the bug report that would otherwise follow.
 */
const GATEWAY_ISSUE_PATH = new RegExp(`^(?:/api/v\\d+)?/issues/(${UUID})/?$`, "i");

const ANY_UUID = new RegExp(UUID, "i");

export function notificationTarget(notification: { link: string | null; body: string }): NotificationTarget {
  const link = (notification.link ?? "").trim();

  // Anything under `/projects/` is this app's own routing space, so it is taken
  // at its word: that is what the mock seeds for the notification types the
  // gateway does not send a link for, and it is the shape the gateway should
  // converge on when TAS-184 lands.
  if (link.startsWith("/projects/")) {
    return { kind: "route", route: link };
  }

  const fromLink = GATEWAY_ISSUE_PATH.exec(link);
  if (fromLink) {
    return { kind: "issue", issueId: fromLink[1] };
  }

  // The half that rescues `ISSUE_ASSIGNED` and `ISSUE_TRANSITIONED` — the two
  // types people actually open notifications for, and the two the gateway sends
  // with an empty link. Every observed body carries exactly one id
  // ("Вам назначена задача be54f4ca-…"), and a UUID is specific enough to match
  // on without parsing Russian prose.
  const fromBody = ANY_UUID.exec(notification.body);
  if (fromBody) {
    return { kind: "issue", issueId: fromBody[0] };
  }

  return { kind: "none" };
}
