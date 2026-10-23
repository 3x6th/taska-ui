import { describe, expect, it } from "vitest";
import { notificationRoute } from "./notifications";

const PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const ISSUE_ID = "be54f4ca-3b2f-4d81-9f0a-1c7c0a5e11d2";

const about = (notificationType: string, issueId: string | null, projectId: string | null) => ({
  notificationType,
  issueId,
  projectId,
});

describe("where a notification goes when it is pressed", () => {
  it("opens the issue it names, in the project it names", () => {
    expect(notificationRoute(about("ISSUE_ASSIGNED", ISSUE_ID, PROJECT_ID))).toBe(
      `/projects/${PROJECT_ID}/issues/${ISSUE_ID}`,
    );
    // Not only the kinds that are *about* the issue itself: a comment or an
    // attachment is read on the issue's panel too.
    expect(notificationRoute(about("ISSUE_COMMENT_CREATED", ISSUE_ID, PROJECT_ID))).toBe(
      `/projects/${PROJECT_ID}/issues/${ISSUE_ID}`,
    );
  });

  it("takes a kind this build has never heard of at its ids", () => {
    // A gateway newer than this build can list a kind this build has never
    // heard of — `NotificationTypeDto` grows with notification-service. The ids
    // are the statement.
    expect(notificationRoute(about("ISSUE_WORKLOG_ADDED", ISSUE_ID, PROJECT_ID))).toBe(
      `/projects/${PROJECT_ID}/issues/${ISSUE_ID}`,
    );
    expect(notificationRoute(about("UNKNOWN", ISSUE_ID, PROJECT_ID))).toBe(`/projects/${PROJECT_ID}/issues/${ISSUE_ID}`);
  });

  it("opens nothing for a notification that is not about an issue", () => {
    expect(notificationRoute(about("MEMBER_ADDED", null, null))).toBeNull();
    expect(notificationRoute(about("PROJECT_CREATED", null, null))).toBeNull();
    expect(notificationRoute(about("USER_BLOCKED", null, null))).toBeNull();
  });

  it("opens nothing for an issue notification written before the gateway stored the ids", () => {
    // The migration that added the three columns did not backfill them, so an
    // old ISSUE_ASSIGNED arrives with all three null — and with the issue's
    // uuid in its prose, which is exactly what this must not go looking for.
    const legacy = { ...about("ISSUE_ASSIGNED", null, null), body: `Вам назначена задача ${ISSUE_ID}` };
    expect(notificationRoute(legacy)).toBeNull();
  });

  it("opens the issue an attachment notification names, now that it carries both ids", () => {
    // Since backend PR #191 (TAS-245) issue-service puts issueKey and projectId
    // on the attachment payloads too, so these rows route like any other.
    for (const kind of ["ISSUE_ATTACHMENT_ADDED", "ISSUE_ATTACHMENT_DELETED"]) {
      expect(notificationRoute(about(kind, ISSUE_ID, PROJECT_ID))).toBe(`/projects/${PROJECT_ID}/issues/${ISSUE_ID}`);
    }
  });

  it("opens nothing for an issue that has been deleted, though it names one", () => {
    expect(notificationRoute(about("ISSUE_DELETED", ISSUE_ID, PROJECT_ID))).toBeNull();
  });

  it("opens nothing for an issueId without a projectId, whatever the kind", () => {
    // Not a hypothetical: an attachment notification written before backend
    // PR #191 (TAS-245) arrives this way, and the fix did not backfill. The
    // route needs both ids, and guessing the project from the open board is
    // the thing a notification opened from `/projects` cannot do.
    expect(notificationRoute(about("ISSUE_ATTACHMENT_ADDED", ISSUE_ID, null))).toBeNull();
    expect(notificationRoute(about("ISSUE_ATTACHMENT_DELETED", ISSUE_ID, null))).toBeNull();
    expect(notificationRoute(about("ISSUE_ASSIGNED", ISSUE_ID, null))).toBeNull();
    // An empty string is not an id either.
    expect(notificationRoute(about("ISSUE_ASSIGNED", ISSUE_ID, ""))).toBeNull();
  });

  it("opens the board of a project a notification names without an issue", () => {
    // `PROJECT_ARCHIVED` (backend PR #159, TAS-149): the project, no issue. An
    // archived project's board still opens, read-only (DESIGN.md §5.7).
    expect(notificationRoute(about("PROJECT_ARCHIVED", null, PROJECT_ID))).toBe(`/projects/${PROJECT_ID}/board`);
    // By the ids, not the kind: any kind that names only a project goes there.
    expect(notificationRoute(about("MEMBER_ADDED", null, PROJECT_ID))).toBe(`/projects/${PROJECT_ID}/board`);
    expect(notificationRoute(about("ISSUE_ASSIGNED", null, PROJECT_ID))).toBe(`/projects/${PROJECT_ID}/board`);
    // An empty issue id is no issue id.
    expect(notificationRoute(about("ISSUE_ASSIGNED", "", PROJECT_ID))).toBe(`/projects/${PROJECT_ID}/board`);
  });

  it("opens nothing for a removal from the project it names", () => {
    // The reader is no longer on that project, so its board would end on the
    // not-found screen (§4.18).
    expect(notificationRoute(about("MEMBER_REMOVED", null, PROJECT_ID))).toBeNull();
  });
});
