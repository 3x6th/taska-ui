import { describe, expect, it } from "vitest";
import { notificationTarget } from "./notifications";

/**
 * The link shapes are the ones measured on the deployed gateway with a
 * GLOBAL_ADMIN token (TAS-183) rather than the ones the contract describes —
 * it describes none. Fixed UUIDs rather than generated ones: the resolver's
 * whole job is recognising that shape, so a test that fed it whatever
 * `crypto.randomUUID` returned would be checking the platform.
 */
const ISSUE_ID = "be54f4ca-3b2f-4d81-9f0a-1c7c0a5e11d2";

describe("where a notification goes when it is pressed", () => {
  it("takes the issue id out of the gateway's own /issues path", () => {
    expect(notificationTarget({ link: `/issues/${ISSUE_ID}`, body: "TAS-107 was assigned to you" })).toEqual({
      kind: "issue",
      issueId: ISSUE_ID,
    });
  });

  it("takes it out of the body when the gateway sends no link at all", () => {
    // ISSUE_ASSIGNED and ISSUE_TRANSITIONED both arrive with link: "".
    expect(notificationTarget({ link: "", body: `Вам назначена задача ${ISSUE_ID}` })).toEqual({
      kind: "issue",
      issueId: ISSUE_ID,
    });
    expect(notificationTarget({ link: null, body: `Задача ${ISSUE_ID} переведена в статус DONE` })).toEqual({
      kind: "issue",
      issueId: ISSUE_ID,
    });
  });

  it("resolves nothing when there is no link and no id to find", () => {
    // MEMBER_ADDED, USER_INVITED, PROJECT_CREATED: real notifications with no
    // issue behind them. The row marks read and must not navigate.
    expect(notificationTarget({ link: "", body: "Sofia added you to Taska Platform" })).toEqual({ kind: "none" });
    expect(notificationTarget({ link: null, body: "" })).toEqual({ kind: "none" });
  });

  it("leaves a link that is already one of this app's routes alone", () => {
    const route = "/projects/2e74e49f-0f29-4e03-b4ec-adc4dbf2382e/issues/6f1c2b40-a1e2-4d55-8f31-2b9e4c7a0f13";
    expect(notificationTarget({ link: route, body: "" })).toEqual({ kind: "route", route });
    // Not every route this app has is an issue route, and the resolver does not
    // need to know which is which — the router answers that.
    expect(notificationTarget({ link: "/projects/p1/board", body: "" })).toEqual({
      kind: "route",
      route: "/projects/p1/board",
    });
  });

  it("prefers the link's id over anything in the body", () => {
    const other = "7a1d9e30-55cc-4f0e-b2d3-8c6f41ab0e77";
    expect(notificationTarget({ link: `/issues/${ISSUE_ID}`, body: `see also ${other}` })).toEqual({
      kind: "issue",
      issueId: ISSUE_ID,
    });
  });

  it("reads a path the gateway serves under its api prefix, and one with a trailing slash", () => {
    expect(notificationTarget({ link: `/api/v1/issues/${ISSUE_ID}`, body: "" })).toEqual({
      kind: "issue",
      issueId: ISSUE_ID,
    });
    expect(notificationTarget({ link: `/issues/${ISSUE_ID}/`, body: "" })).toEqual({
      kind: "issue",
      issueId: ISSUE_ID,
    });
  });

  it("does not mistake a longer gateway path for an issue read", () => {
    // `/issues/{id}/links` names a collection, not the issue, and resolving it
    // to the issue would be a guess. The body is the fallback, as everywhere.
    expect(notificationTarget({ link: `/issues/${ISSUE_ID}/links`, body: "nothing here" })).toEqual({ kind: "none" });
  });

  it("has no state between calls", () => {
    // The regexes are module-level; a `g` flag on either would make every
    // second call for the same input answer differently.
    const notification = { link: `/issues/${ISSUE_ID}`, body: `Вам назначена задача ${ISSUE_ID}` };
    expect(notificationTarget(notification)).toEqual(notificationTarget(notification));
    const bodyOnly = { link: "", body: `Вам назначена задача ${ISSUE_ID}` };
    expect(notificationTarget(bodyOnly)).toEqual(notificationTarget(bodyOnly));
  });
});
