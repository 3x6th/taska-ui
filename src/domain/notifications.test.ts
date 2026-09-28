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
    // `notificationType` is a bare string on the wire, and notification-service
    // learns new kinds before this frontend does. The ids are the statement.
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

  it("opens nothing for an issue that has been deleted, though it names one", () => {
    expect(notificationRoute(about("ISSUE_DELETED", ISSUE_ID, PROJECT_ID))).toBeNull();
  });

  it("opens nothing when only one of the two ids is there", () => {
    // The route needs both. Guessing the project from the open board is the
    // thing a notification opened from `/projects` cannot do.
    expect(notificationRoute(about("ISSUE_ASSIGNED", ISSUE_ID, null))).toBeNull();
    expect(notificationRoute(about("ISSUE_ASSIGNED", null, PROJECT_ID))).toBeNull();
    // An empty string is not an id either.
    expect(notificationRoute(about("ISSUE_ASSIGNED", "", PROJECT_ID))).toBeNull();
    expect(notificationRoute(about("ISSUE_ASSIGNED", ISSUE_ID, ""))).toBeNull();
  });
});
