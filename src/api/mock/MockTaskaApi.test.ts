import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_ATTACHMENT_TRIGGERS, MOCK_INVITE_TOKENS, MOCK_PROJECT_TRIGGERS, MockTaskaApi, buildMockBoard } from "./MockTaskaApi";
import type { UpdateIssueInput } from "../TaskaApi";
import { DIRECTORY_QUERY_REFUSAL_MESSAGE } from "../TaskaApi";
import type { Board, BoardIssue, Issue, NotificationType, Project } from "../../domain/types";
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  attachmentSizeRefusalMessage,
  attachmentTypeRefusalMessage,
} from "../attachments";
import {
  AVATAR_GATEWAY_REFUSAL_MESSAGE,
  AVATAR_MAX_SIZE_BYTES,
  avatarSizeRefusalMessage,
  avatarTypeRefusalMessage,
} from "../avatars";
import { IssueVersionConflictError, apiErrorFacts } from "../errors";
import { datesOutOfOrderServerMessage } from "../issuePatch";
import { ObjectStoreError } from "../objectStore";
import { ESTIMATE_MAX_MESSAGE, STORY_POINTS_RANGE_MESSAGE } from "../planningFields";
import { accountLockedUntil, lockedUntilOf } from "../../lib/accountLock";
import { commentWasEdited } from "../../lib/format";
import { selectableCodes } from "../../lib/enumLabel";
import { workflowCopyInput } from "../../lib/workflows";

/**
 * The mock is the reference implementation of the TaskaApi contract: it is what
 * the UI is developed against and what `api-contract-guard` compares the REST
 * adapter to. These tests pin the behaviour that parity is measured
 * against, not the seed data.
 */
const ANNA_ID = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK_ID = "e65186a2-b807-42ae-a66f-711be116a93b";

describe("MockTaskaApi", () => {
  let api: MockTaskaApi;
  let project: Project;

  beforeEach(async () => {
    // The mock session lives in localStorage so it survives a reload; clearing
    // it here keeps every case independent of the one before it.
    window.localStorage.clear();
    api = new MockTaskaApi();
    [project] = await api.listProjects();
  });

  /**
   * An edit at the version the issue has *now*, which is what the panel sends:
   * it reads the version it holds just before each write (TAS-246). A chain of
   * edits needs each one's version, or the second conflicts with the first.
   */
  const versionOf = async (issueId: string) => (await api.getIssue(project.id, issueId)).issue.version;
  const edit = async (issueId: string, input: UpdateIssueInput) =>
    api.updateIssue(project.id, issueId, input, await versionOf(issueId));
  /** The TASK workflow as the board reads it — from the project context, since TAS-251. */
  const taskWorkflow = async () => (await api.getProjectContext(project.id)).workflows.TASK!;

  describe("session", () => {
    it("holds no session until someone signs in", () => {
      expect(api.hasSession()).toBe(false);
    });

    it("holds a session after a successful sign-in and drops it on sign-out", async () => {
      await api.login({ email: "anna@example.com", password: "mock-accepts-anything" });
      expect(api.hasSession()).toBe(true);

      await api.logout();
      expect(api.hasSession()).toBe(false);
    });

    it("does not open a session for a rejected sign-in", async () => {
      await expect(api.login({ email: "nobody@example.com", password: "x" })).rejects.toThrow();
      expect(api.hasSession()).toBe(false);
    });

    // Omar is seeded LOCKED because nothing in this product can create that
    // state — it takes repeated failed sign-ins against the real auth-service.
    // The shape matters as much as the refusal: the gateway answers a lockout
    // with PERMISSION_DENIED (403 over REST) carrying the deadline in the
    // message and, since backend PR #199, in `details.lockedUntil`, and every
    // other sign-in failure with UNAUTHENTICATED. A mock that answered
    // "Invalid credentials" here would leave the login screen's lock branch
    // unreachable in the only environment the e2e suite has.
    it("refuses a locked account the way the gateway does, with a readable deadline in the message and the details", async () => {
      const before = Date.now();
      const refusal = await api
        .login({ email: "omar@example.com", password: "anything" })
        .then(() => null)
        .catch((error: Error) => error);

      expect(refusal).toMatchObject({ code: "PERMISSION_DENIED" });
      expect(api.hasSession()).toBe(false);

      // AUTH_SECURITY_LOCK_DURATION is 15m. Bounded rather than pinned to the
      // millisecond, because the clock moves between the refusal and this
      // line — which is also why the deadline is read back through the same
      // parser the login screen uses rather than compared as a string.
      const until = accountLockedUntil(refusal?.message ?? null);
      expect(until).not.toBeNull();
      expect(until!.getTime()).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
      expect(until!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000);

      // The same instant, stated once more where a machine reads it — the only
      // key `details` carries, and the one the login screen reads first.
      const { details } = apiErrorFacts(refusal);
      expect(details).toEqual({ lockedUntil: until!.toISOString() });
      expect(lockedUntilOf(refusal)?.getTime()).toBe(until!.getTime());
    });

    it("states no details on any other refusal, as the gateway answers `details: null`", async () => {
      const failure = await api
        .login({ email: "nina@example.com", password: "anything" })
        .catch((error: unknown) => error);
      expect(apiErrorFacts(failure)).toMatchObject({ code: "UNAUTHENTICATED", details: null });
    });

    // The other two non-ACTIVE statuses stay where they were: AuthServiceImpl
    // raises UNAUTHENTICATED for BLOCKED and INVITED, so only LOCKED takes the
    // branch above.
    it("still refuses a blocked account as a bad credential, not as a lockout", async () => {
      await expect(api.login({ email: "nina@example.com", password: "anything" })).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    });

    it("does not open a session for an accepted invitation", async () => {
      // `POST /auth/invitations/accept` answers 204 with no tokens, so `rest`
      // cannot produce a session here and neither may the mock; the contract
      // says the client signs in afterwards (backend #204).
      await api.acceptInvitation({ token: MOCK_INVITE_TOKENS.leo, newPassword: "Correct-horse-1" });

      expect(api.hasSession()).toBe(false);
    });

    it("restores the signed-in user on the next page load", async () => {
      await api.login({ email: "mark@example.com", password: "mock-accepts-anything" });

      // A fresh instance is what a reload produces: same storage, new store.
      const reloaded = new MockTaskaApi();

      expect(reloaded.hasSession()).toBe(true);
      await expect(reloaded.getCurrentUser()).resolves.toMatchObject({ email: "mark@example.com" });
    });

    it("drops a stored id that no longer names an active user", () => {
      window.localStorage.setItem("taska.mockSession", "00000000-0000-4000-8000-000000000000");

      expect(new MockTaskaApi().hasSession()).toBe(false);
      expect(window.localStorage.getItem("taska.mockSession")).toBeNull();
    });
  });

  describe("the reader's own role on a project", () => {
    // `currentUserRole` is what backend TAS-137 (PR #152) added to
    // `ProjectResponseDto`, and it is the whole of what the rest leg derives
    // `getMembership` from. The mock serves it so the two implementations
    // answer the same shape — otherwise the derivation could only ever be
    // tested against a stub.
    it("states the role of whoever is reading, on the project read itself", async () => {
      await expect(api.getProject(project.id)).resolves.toMatchObject({ currentUserRole: "ADMIN" });
      await api.login({ email: "mark@example.com", password: "anything" });
      await expect(api.getProject(project.id)).resolves.toMatchObject({ currentUserRole: "MEMBER" });
    });

    // Backend PR #152, read at head `1ad6ffad815d`, fills `currentUserRole` on
    // every row of `GET /projects` too, not only the single-project read —
    // `ProjectRepository.findAllByMemberUserId` joins `project_members` for
    // it. `withCurrentUserRole` is what both `getProject` and `listProjects`
    // share so the mock cannot drift into serving one route a shape the other
    // does not.
    it("states the role on every row of the project list too, not only the single read", async () => {
      await expect(api.listProjects()).resolves.toContainEqual(
        expect.objectContaining({ id: project.id, currentUserRole: "ADMIN" }),
      );

      // Mark is the first id in Mobile's own `memberIds`, so this is his
      // project — deterministic from the seed, not an assumption.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile?.currentUserRole).toBe("ADMIN");
    });

    it("agrees with getMembership about the role", async () => {
      const [fromProject, membership] = await Promise.all([
        api.getProject(project.id),
        api.getMembership(project.id),
      ]);

      expect(fromProject.currentUserRole).toBe(membership.role);
    });

    it("leaves the field absent for a reader it computed no role for", async () => {
      // Anna is not on Mobile. The gateway would answer 403 to this read and
      // the mock answers the project instead — a known divergence documented
      // on `MockTaskaApi.withCurrentUserRole` rather than in
      // docs/ai/API-DIVERGENCE.md, which has no entry for it. The field is
      // missing when no role was computed — the mock's shape; a deployed
      // gateway would not answer this read at all, and states a role on every
      // 200 it does give. The rest leg would read the missing role as
      // `role: null`, never as VIEWER (TAS-226); this store's `getMembership`
      // answers VIEWER for a non-member because that is its documented stand-in.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;

      await api.login({ email: "anna@example.com", password: "anything" });
      const read = await api.getProject(mobile.id);

      expect(read.currentUserRole).toBeUndefined();
      expect("currentUserRole" in read).toBe(false);
      await expect(api.getMembership(mobile.id)).resolves.toMatchObject({ role: "VIEWER", isMember: false });
    });

    it("does not write one reader's role into the answer the next one gets", async () => {
      // The role belongs to the reader, not to the stored project row — so the
      // read has to be a copy, and a second reader must not find the first
      // one's role still on it.
      await expect(api.getProject(project.id)).resolves.toMatchObject({ currentUserRole: "ADMIN" });

      await api.login({ email: "mark@example.com", password: "anything" });
      await expect(api.getProject(project.id)).resolves.toMatchObject({ currentUserRole: "MEMBER" });

      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.getProject(project.id)).resolves.toMatchObject({ currentUserRole: "ADMIN" });
    });

    it("seeds one VIEWER who is a member, not only the non-member standing in for one", async () => {
      // Tom on Taska Platform (TAS-226). Every VIEWER path before him ran
      // through a non-member, which the gateway refuses on membership before it
      // reads a role — so this is the first seeded reader whose VIEWER is the
      // role itself.
      const tom = (await api.listMembers(project.id)).find((member) => member.user?.displayName === "Tom Becker");
      expect(tom?.role).toBe("VIEWER");

      await api.login({ email: "tom@example.com", password: "anything" });
      await expect(api.getMembership(project.id)).resolves.toEqual({
        role: "VIEWER",
        isMember: true,
        projectExists: true,
      });
      await expect(api.getProject(project.id)).resolves.toMatchObject({ currentUserRole: "VIEWER" });
    });

    it("still carries addedAt and addedBy on a member row, which the wire does not", async () => {
      // Both are optional on `ProjectMember` since TAS-219, because
      // `ProjectMemberDetailsDto` carries neither. The mock keeps producing
      // them: they are seed data here, not a claim about the gateway.
      const [first] = await api.listMembers(project.id);

      expect(first.role).toBe("ADMIN");
      expect(first.addedAt).toEqual(expect.any(String));
      expect(first.addedBy).toEqual(expect.any(String));
      expect(first.user?.displayName).toEqual(expect.any(String));
    });
  });

  /**
   * `PATCH /projects/{projectId}` (TAS-148, TAS-149), backend PR #155 as
   * merged and deployed — out of `ProjectServiceImpl.updateProject` rather than
   * out of the yml.
   *
   * Three spellings per string field: absent keeps, `null` clears, a string
   * sets — and a blank description is stored as `null`, where `""` is a 400
   * for a colour.
   */
  /**
   * `GET /projects/{projectId}/context` (backend PR #169, TAS-212), with the
   * rules its Java states rather than its yml (TAS-251).
   */
  describe("the project context", () => {
    it("answers the project, the reader's role, members, three-field labels and timestamp-free workflows", async () => {
      const context = await api.getProjectContext(project.id);

      expect(context.project).toMatchObject({ id: project.id, currentUserRole: "ADMIN" });
      expect(context.role).toBe("ADMIN");
      expect(context.members).toEqual(await api.listMembers(project.id));
      for (const label of context.labels) expect(Object.keys(label).sort()).toEqual(["color", "id", "name"]);
      expect(Object.keys(context.workflows).sort()).toEqual(["BUG", "STORY", "TASK"]);
      expect(context.workflows.TASK).not.toHaveProperty("createdAt");
      expect(context.workflows.TASK).not.toHaveProperty("updatedAt");
    });

    it("lists a workflow only for the issue types the project allows", async () => {
      const ops = (await api.listProjects()).find((item) => item.projectKey === "OPS")!;
      const context = await api.getProjectContext(ops.id);
      expect(Object.keys(context.workflows).sort()).toEqual(["BUG", "TASK"]);
    });

    it("refuses to create an issue of a type the project does not allow, and creates one it does", async () => {
      const ops = (await api.listProjects()).find((item) => item.projectKey === "OPS")!;
      const input = { summary: "Rotate the keys", description: "", priority: "LOW" as const };
      await expect(api.createIssue(ops.id, { ...input, issueType: "STORY" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Issue type STORY is not allowed in project OPS",
      });
      await expect(api.createIssue(ops.id, { ...input, issueType: "BUG" })).resolves.toMatchObject({ issueType: "BUG" });
    });

    // TAS-173: WEB is the project where values this build does not know can be
    // clicked through — a type, a status and a priority the backend could add
    // before the frontend ships.
    it("lets WEB allow EPIC with a workflow of its own, carrying a status key this build does not know", async () => {
      const web = (await api.listProjects()).find((item) => item.projectKey === "WEB")!;
      const context = await api.getProjectContext(web.id);

      expect(Object.keys(context.workflows)).toEqual(["TASK", "BUG", "STORY", "EPIC"]);
      // By sortOrder, as the server reads them: In Review (25) between In Progress and Done.
      expect(context.workflows.EPIC!.statuses.map((status) => status.statusKey)).toEqual([
        "TODO",
        "IN_PROGRESS",
        "IN_REVIEW",
        "DONE",
      ]);
      expect(context.workflows.EPIC!.statuses.find((status) => status.statusKey === "IN_REVIEW")).toMatchObject({
        name: "In Review",
        category: "IN_PROGRESS",
        sortOrder: 25,
      });
      expect(context.workflows.TASK!.statuses.map((status) => status.statusKey)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);

      const issues = (await api.listIssues(web.id)).items;
      expect(issues.find((issue) => issue.issueKey === "WEB-15")).toMatchObject({
        issueType: "EPIC",
        status: "IN_REVIEW",
        priority: "URGENT",
      });
      expect(issues.find((issue) => issue.issueKey === "WEB-16")).toMatchObject({
        issueType: "TASK",
        status: "BLOCKED_BY_QA",
      });
    });

    it("creates an EPIC in WEB, refuses one in OPS, and moves an epic through its own workflow", async () => {
      const projects = await api.listProjects();
      const web = projects.find((item) => item.projectKey === "WEB")!;
      const ops = projects.find((item) => item.projectKey === "OPS")!;
      const input = { summary: "Quarterly plan", description: "", priority: "MEDIUM", issueType: "EPIC" };

      await expect(api.createIssue(ops.id, input)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Issue type EPIC is not allowed in project OPS",
      });
      const epic = await api.createIssue(web.id, input);
      expect(epic).toMatchObject({ issueType: "EPIC", status: "TODO" });

      const workflow = (await api.getProjectContext(web.id)).workflows.EPIC!;
      const byName = (name: string) => workflow.transitions.find((transition) => transition.name === name)!.id;
      await api.transitionIssue(web.id, epic.id, byName("Start Progress"));
      await expect(api.transitionIssue(web.id, epic.id, byName("Send to review"))).resolves.toMatchObject({
        status: "IN_REVIEW",
      });
    });

    it("accepts a priority /meta lists and refuses one it does not, on create and on edit", async () => {
      await expect(
        api.createIssue(project.id, { summary: "Hot fix", description: "", priority: "URGENT", issueType: "TASK" }),
      ).resolves.toMatchObject({ priority: "URGENT" });
      await expect(
        api.createIssue(project.id, { summary: "Hot fix", description: "", priority: "BLOCKER", issueType: "TASK" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "Invalid request parameters" });

      const [issue] = (await api.listIssues(project.id)).items;
      await expect(api.updateIssue(project.id, issue.id, { priority: "BLOCKER" }, issue.version)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Invalid request parameters",
      });
      await expect(api.updateIssue(project.id, issue.id, { priority: "URGENT" }, issue.version)).resolves.toMatchObject({
        priority: "URGENT",
      });
    });

    it("refuses a link type /meta does not list", async () => {
      const [first, second] = (await api.listIssues(project.id)).items;
      await expect(
        api.createIssueLink(project.id, first.id, { targetIssueId: second.id, linkType: "SUPERSEDES" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "Invalid request parameters" });
    });

    it("refuses a non-member of any global role with the project-service sentence, and a missing project with 404", async () => {
      // `ProjectServiceImpl.getProjectContext` at backend PR #186 (TAS-255,
      // head `cc03c0d`): no membership row is PERMISSION_DENIED "You don't have
      // access to this project" whatever the global role, before any sub-read.
      const refusal = { code: "PERMISSION_DENIED", message: "You don't have access to this project" };

      // Mark is the seed's GLOBAL_ADMIN, and not on WEB.
      const web = (await api.listProjects()).find((item) => item.projectKey === "WEB")!;
      await api.login({ email: "mark@example.com", password: "anything" });
      await expect(api.getProjectContext(web.id)).rejects.toMatchObject(refusal);

      // Anna is a plain USER and not on MOB. Mark's sign-in above is what finds
      // MOB: `listProjects` answers a non-member nothing.
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;
      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.getCurrentUser()).resolves.toMatchObject({ globalRole: "USER" });
      await expect(api.getProjectContext(mobile.id)).rejects.toMatchObject(refusal);

      await expect(api.getProjectContext("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    });
  });

  /**
   * `GET /meta` as the stand answers it since backend #201 (develop
   * `e8a8d316b326`): English names for every contract code, `selectable` on
   * every pair and `false` on the four placeholders, and `linkViewTypes` —
   * plus `EPIC` named in English and `URGENT` still named in Russian, the two
   * codes TAS-173's states are seen through, the second now the witness of
   * the Cyrillic check DESIGN.md §6 keeps.
   */
  describe("the dictionaries", () => {
    it("answers the stand's body with the two codes this build does not know", async () => {
      const meta = await api.getMeta();

      expect(meta.issueTypes?.map((entry) => entry.code)).toEqual(["TASK", "BUG", "STORY", "EPIC"]);
      expect(meta.issueTypes?.map((entry) => entry.name)).toEqual(["Task", "Bug", "Story", "Epic"]);
      expect(meta.priorities?.map((entry) => entry.code)).toEqual(["LOW", "MEDIUM", "HIGH", "URGENT"]);
      expect(meta.priorities?.find((entry) => entry.code === "URGENT")?.name).toBe("Срочный");
      expect(meta.linkTypes).toEqual([
        { code: "BLOCKS", name: "Blocks", selectable: true },
        { code: "RELATES_TO", name: "Relates to", selectable: true },
        { code: "DUPLICATES", name: "Duplicates", selectable: true },
      ]);
      // Twenty-four since backend PR #159 added `PROJECT_ARCHIVED`.
      expect(meta.notificationTypes).toHaveLength(24);
      expect(meta.notificationTypes?.find((entry) => entry.code === "PROJECT_ARCHIVED")).toEqual({
        code: "PROJECT_ARCHIVED",
        name: "Project archived",
        selectable: true,
      });
      expect(meta.notificationTypes?.at(-1)).toEqual({ code: "UNKNOWN", name: "Unknown", selectable: false });
      expect(meta.userStatuses).toEqual([
        { code: "INVITED", name: "Invited", selectable: true },
        { code: "ACTIVE", name: "Active", selectable: true },
        { code: "BLOCKED", name: "Blocked", selectable: true },
        { code: "LOCKED", name: "Locked", selectable: true },
        { code: "UNSPECIFIED", name: "Unspecified", selectable: false },
      ]);
    });

    it("hands the link view types over as the rest leg reads them: prefix off, placeholders out", async () => {
      // The wire spells them `ISSUE_LINK_VIEW_TYPE_BLOCKS` and lists
      // `ISSUE_LINK_VIEW_TYPE_UNSPECIFIED` and `UNRECOGNIZED` beside them; a
      // link row's `viewLinkType` is read through the same function, so
      // stripped codes are what the two are compared as.
      const meta = await api.getMeta();

      expect(meta.linkViewTypes).toEqual([
        { code: "RELATES_TO", name: "Relates to", selectable: true },
        { code: "BLOCKS", name: "Blocks", selectable: true },
        { code: "IS_BLOCKED_BY", name: "Is blocked by", selectable: true },
        { code: "DUPLICATES", name: "Duplicates", selectable: true },
        { code: "IS_DUPLICATED_BY", name: "Is duplicated by", selectable: true },
      ]);
    });

    it("lists the placeholders as the stand does, and no picker offers one (TAS-173)", async () => {
      const meta = await api.getMeta();
      // Exactly the kinds `NotificationType` names: a `Record` over the union
      // will not compile with one missing or one extra, so the seed, the union
      // and the contract's `NotificationTypeDto` cannot drift apart unseen.
      const named: Record<NotificationType, true> = {
        ISSUE_ASSIGNED: true,
        ISSUE_TRANSITIONED: true,
        ISSUE_CREATED: true,
        ISSUE_UPDATED: true,
        ISSUE_DELETED: true,
        ISSUE_LINK_CREATED: true,
        ISSUE_LINK_DELETED: true,
        ISSUE_COMMENT_CREATED: true,
        ISSUE_COMMENT_UPDATED: true,
        ISSUE_COMMENT_DELETED: true,
        ISSUE_ATTACHMENT_ADDED: true,
        ISSUE_ATTACHMENT_DELETED: true,
        LABEL_ADDED: true,
        LABEL_REMOVED: true,
        USER_INVITED: true,
        USER_ACTIVATED: true,
        USER_BLOCKED: true,
        USER_UNBLOCKED: true,
        PROJECT_CREATED: true,
        PROJECT_ARCHIVED: true,
        MEMBER_ADDED: true,
        MEMBER_UPDATED: true,
        MEMBER_REMOVED: true,
        UNKNOWN: true,
      };
      const notificationCodes = meta.notificationTypes?.map((entry) => entry.code) ?? [];
      expect([...notificationCodes].sort()).toEqual(Object.keys(named).sort());

      expect(selectableCodes(meta.userStatuses, ["INVITED", "ACTIVE", "BLOCKED", "LOCKED"])).toEqual([
        "INVITED",
        "ACTIVE",
        "BLOCKED",
        "LOCKED",
      ]);
      expect(selectableCodes(meta.notificationTypes, [])).not.toContain("UNKNOWN");
      expect(selectableCodes(meta.priorities, ["LOW", "MEDIUM", "HIGH"])).toEqual(["LOW", "MEDIUM", "HIGH", "URGENT"]);
    });

    it("hands out a copy, so a caller cannot change what the store checks writes against", async () => {
      const meta = await api.getMeta();
      meta.priorities!.length = 0;
      await expect(
        api.createIssue(project.id, { summary: "Still fine", description: "", priority: "URGENT", issueType: "TASK" }),
      ).resolves.toMatchObject({ priority: "URGENT" });
      expect((await api.getMeta()).priorities).toHaveLength(4);
    });
  });

  describe("creating a project", () => {
    it("keeps the description and the colour it was given", async () => {
      // Both are new on `CreateProjectRequestDto` in backend PR #155, and until
      // TAS-148 the rest leg dropped them on the floor — so the create form's
      // Description box had never once reached a server.
      const created = await api.createProject({
        projectKey: "NEW",
        name: "New Thing",
        description: "  Something to build  ",
        color: "#3fa863",
      });

      expect(created).toMatchObject({ projectKey: "NEW", description: "Something to build", color: "#3fa863" });
      await expect(api.getProject(created.id)).resolves.toMatchObject({ color: "#3fa863" });
    });

    it("states no description at all when none was typed, rather than inventing one", async () => {
      // It used to store "Project workspace" — the *card's* placeholder for a
      // project with no description — so nothing created here could ever
      // demonstrate the state the card draws for (TAS-148).
      const created = await api.createProject({ projectKey: "BARE", name: "Bare" });

      expect(created.description).toBeUndefined();
      expect(created.color).toBeUndefined();
    });

    it("treats an empty colour as none given rather than refusing it", async () => {
      // Create has no "clear" to tell an empty value from an absent one, so
      // both legs read `""` as "no colour stated" — `RestTaskaApi` omits a
      // falsy `color` from the body for the same reason. The update route is
      // the opposite and deliberately so.
      const created = await api.createProject({ projectKey: "EMPT", name: "Empty", color: "" });

      expect(created.color).toBeUndefined();
    });

    it.each([["violet"], ["#12345"]])("refuses %s, which the contract pattern rejects", async (color) => {
      await expect(api.createProject({ projectKey: "BAD", name: "Bad", color })).rejects.toThrow(/six-digit hex/);
    });
  });

  describe("editing a project", () => {
    it("changes the three fields the route takes, and moves updatedAt", async () => {
      const before = await api.getProject(project.id);
      const saved = await api.updateProject(project.id, {
        name: "Taska Core",
        description: "Gateway and services",
        color: "#8b5cf6",
      });

      expect(saved).toMatchObject({
        id: project.id,
        name: "Taska Core",
        description: "Gateway and services",
        color: "#8b5cf6",
      });
      expect(saved.updatedAt).not.toBe(before.updatedAt);
      // And it is stored, not merely answered with.
      await expect(api.getProject(project.id)).resolves.toMatchObject({ name: "Taska Core" });
    });

    it("leaves out what the body left out", async () => {
      const before = await api.getProject(project.id);
      const saved = await api.updateProject(project.id, { name: "Renamed only" });

      expect(saved.description).toBe(before.description);
      expect(saved.color).toBe(before.color);
    });

    it("answers an all-absent body with the project unchanged, not with a 400", async () => {
      // The service logs "nothing to update" and returns. `updatedAt` does not
      // move, which is what makes "nothing happened" observable rather than
      // merely quiet.
      const before = await api.getProject(project.id);
      const saved = await api.updateProject(project.id, {});

      expect(saved).toEqual(before);
    });

    it.each([[""], ["   "]])("stores a blank description %j as null, the same clear", async (description) => {
      // PR #155 as merged: no blank description is ever stored.
      const saved = await api.updateProject(project.id, { description });

      expect(saved.description).toBeNull();
      await expect(api.getProject(project.id)).resolves.toMatchObject({ description: null });
    });

    it("clears a description and a colour with an explicit null, and answers null rather than dropping the key", async () => {
      // The gateway tells an explicit `null` from an absent key and forwards it
      // as `clear_description` / `clear_color`.
      const saved = await api.updateProject(project.id, { description: null, color: null });

      expect(saved.description).toBeNull();
      expect(saved.color).toBeNull();
      // The key is there, holding `null`, as Jackson's default inclusion sends it.
      expect(Object.hasOwn(saved, "color")).toBe(true);
      await expect(api.getProject(project.id)).resolves.toMatchObject({ description: null, color: null });
    });

    it("refuses an empty colour, because the clear is null and not the empty string", async () => {
      await expect(api.updateProject(project.id, { color: "" })).rejects.toThrow(/six-digit hex/);
      await expect(api.getProject(project.id)).resolves.toMatchObject({ color: "#0052cc" });
    });

    it.each([["violet"], ["#12345"], ["#0052CCC"]])("refuses %s, which the contract pattern rejects", async (color) => {
      await expect(api.updateProject(project.id, { color })).rejects.toThrow(/six-digit hex/);
    });

    it("refuses a blank name rather than storing one", async () => {
      await expect(api.updateProject(project.id, { name: "   " })).rejects.toThrow(/1 to 255/);
      await expect(api.getProject(project.id)).resolves.toMatchObject({ name: "Taska Platform" });
    });

    it("refuses a member below ADMIN, and says so as PERMISSION_DENIED", async () => {
      // Mark is a MEMBER of Taska Platform. The gateway answers 403 with
      // `PERMISSION_DENIED`; this is the same refusal without a wire under it.
      await api.login({ email: "mark@example.com", password: "anything" });

      await expect(api.updateProject(project.id, { name: "Mark was here" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      await expect(api.getProject(project.id)).resolves.toMatchObject({ name: "Taska Platform" });
    });

    it("refuses a non-member the same way it refuses a member", async () => {
      // Anna is not on Mobile at all. On the wire that is the same refusal the
      // MEMBER above takes — `ProjectRoleChecker` stops a non-member before any
      // role is looked at, and both arrive as `PERMISSION_DENIED` on 403 — so
      // the UI must not read either one as a dead session.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;

      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.updateProject(mobile.id, { name: "Not hers" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
    });

    it("answers NOT_FOUND for a project that is not there", async () => {
      await expect(api.updateProject("00000000-0000-0000-0000-000000000000", { name: "Ghost" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuses an archived project's edit after the ADMIN check, so only its ADMIN is told it is archived", async () => {
      await api.archiveProject(project.id);

      await expect(api.updateProject(project.id, { name: "Too late" })).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Project is archived",
        details: { reason: "PROJECT_ARCHIVED" },
      });
      // A MEMBER is refused for the role first, as before.
      await api.login({ email: "mark@example.com", password: "anything" });
      await expect(api.updateProject(project.id, { name: "Too late" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      await expect(api.getProject(project.id)).resolves.toMatchObject({ name: "Taska Platform" });
    });
  });

  /**
   * `DELETE /projects/{projectId}` (TAS-149), backend PR #159 as merged and
   * deployed on 2026-10-23: an archived project leaves the list, stays
   * readable, and refuses every write with one refusal whose only key is
   * `details.reason`.
   */
  describe("archiving a project", () => {
    const archivedRefusal = {
      code: "FAILED_PRECONDITION",
      message: "Project is archived",
      details: { reason: "PROJECT_ARCHIVED" },
    };

    it("archives for an ADMIN and answers the row with archivedAt set and the ADMIN role", async () => {
      expect(project.archivedAt).toBeNull();
      const archived = await api.archiveProject(project.id);

      expect(archived.id).toBe(project.id);
      expect(archived.archivedAt).toEqual(expect.any(String));
      expect(archived.currentUserRole).toBe("ADMIN");
      // `@LastModifiedDate`: the save that archives stamps `updatedAt` too.
      expect(archived.updatedAt).toBe(archived.archivedAt);
      expect(archived.updatedAt).not.toBe(project.updatedAt);
    });

    it("is idempotent: a second archive answers the same archivedAt", async () => {
      const first = await api.archiveProject(project.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await api.archiveProject(project.id);

      expect(second.archivedAt).toBe(first.archivedAt);
      // Nothing is saved the second time, so nothing is stamped.
      expect(second.updatedAt).toBe(first.updatedAt);
    });

    it("refuses a member below ADMIN and a non-member alike, with PERMISSION_DENIED", async () => {
      const refused = { code: "PERMISSION_DENIED", message: "Project ADMIN role is required" };
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;

      await expect(api.archiveProject(project.id)).rejects.toMatchObject(refused);
      await expect(api.getProject(project.id)).resolves.toMatchObject({ archivedAt: null });

      // Anna is not on Mobile at all.
      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.archiveProject(mobile.id)).rejects.toMatchObject(refused);
    });

    it("answers NOT_FOUND for a project that is not there", async () => {
      await expect(api.archiveProject("00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Project not found",
      });
    });

    it("leaves the project list, for every member, and the unscoped search with it", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];
      await api.archiveProject(project.id);

      expect((await api.listProjects()).map((item) => item.id)).not.toContain(project.id);
      const unscoped = await api.searchIssues({ query: issue.issueKey });
      expect(unscoped.items.map((hit) => hit.id)).not.toContain(issue.id);

      await api.login({ email: "tom@example.com", password: "anything" });
      expect((await api.listProjects()).map((item) => item.id)).not.toContain(project.id);
    });

    it("keeps every read open, to every member", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];
      expect(issue).toBeDefined();
      await api.archiveProject(project.id);

      for (const email of ["anna@example.com", "tom@example.com"]) {
        await api.login({ email, password: "anything" });
        await expect(api.getProject(project.id)).resolves.toMatchObject({ archivedAt: expect.any(String) });
        const context = await api.getProjectContext(project.id);
        expect(context.project.archivedAt).toEqual(expect.any(String));
        await expect(api.listIssues(project.id)).resolves.toMatchObject({ totalCount: items.length });
        await expect(api.getBoard(project.id, { issueType: "TASK" })).resolves.toBeDefined();
        await expect(api.getIssue(project.id, issue.id)).resolves.toMatchObject({ issue: { id: issue.id } });
        await expect(api.getIssueByKey(issue.issueKey)).resolves.toMatchObject({ id: issue.id });
        await expect(api.listComments(project.id, issue.id)).resolves.toBeDefined();
        await expect(api.listProjectLabels(project.id)).resolves.toBeDefined();
        await expect(api.listIssueLinks(project.id, issue.id)).resolves.toBeDefined();
        await expect(api.listIssueWorklogs(project.id, issue.id)).resolves.toBeDefined();
        await expect(api.listIssueWatchers(project.id, issue.id)).resolves.toBeDefined();
        await expect(api.listAttachments(project.id, issue.id)).resolves.toBeDefined();
        await expect(api.listMembers(project.id)).resolves.not.toHaveLength(0);
        await expect(api.listProjectWorkflows(project.id)).resolves.not.toHaveLength(0);
        // Scoped to it, the search still answers.
        await expect(api.searchIssues({ projectId: project.id, query: issue.issueKey })).resolves.toMatchObject({
          totalCount: 1,
        });
      }
    });

    it("refuses every write with the one archived refusal", async () => {
      const { items } = await api.listIssues(project.id);
      const [issue, other] = items;
      const [label] = await api.listProjectLabels(project.id);
      const [worklog] = await api.listIssueWorklogs(project.id, issue.id);
      const [comment] = (await api.listComments(project.id, issue.id)).items;
      const workflows = await api.listProjectWorkflows(project.id);
      await api.archiveProject(project.id);
      const version = (await api.getIssue(project.id, issue.id)).issue.version;
      const writes: [string, () => Promise<unknown>][] = [
        ["createIssue", () => api.createIssue(project.id, { issueType: "TASK", summary: "Late", description: "", priority: "LOW" })],
        ["updateIssue", () => api.updateIssue(project.id, issue.id, { summary: "Late" }, version)],
        ["transitionIssue", () => api.transitionIssue(project.id, issue.id, "any")],
        ["deleteIssue", () => api.deleteIssue(project.id, issue.id)],
        ["addComment", () => api.addComment(project.id, issue.id, "Late")],
        ["createIssueLink", () => api.createIssueLink(project.id, issue.id, { linkType: "RELATES_TO", targetIssueId: other.id })],
        ["createProjectLabel", () => api.createProjectLabel(project.id, { name: "Late", color: "#0052cc" })],
        ["deleteProjectLabel", () => api.deleteProjectLabel(project.id, label.id)],
        ["addIssueLabel", () => api.addIssueLabel(project.id, issue.id, label.id)],
        ["watchIssue", () => api.watchIssue(project.id, issue.id)],
        ["unwatchIssue", () => api.unwatchIssue(project.id, issue.id)],
        ["addIssueWatcher", () => api.addIssueWatcher(project.id, issue.id, MARK_ID)],
        [
          "createAttachmentUploadUrl",
          () => api.createAttachmentUploadUrl(project.id, issue.id, { fileName: "a.png", contentType: "image/png", sizeBytes: 10 }),
        ],
        ["addIssueWorklog", () => api.addIssueWorklog(project.id, issue.id, { spentMinutes: 30, workDate: "2026-01-02" })],
        ["changeProjectMemberRole", () => api.changeProjectMemberRole(project.id, MARK_ID, "VIEWER")],
        ["removeProjectMember", () => api.removeProjectMember(project.id, MARK_ID)],
        ["addProjectMember", () => api.addProjectMember(project.id, "11111111-1111-4111-8111-111111111111", "VIEWER")],
        [
          "createProjectWorkflow",
          () => api.createProjectWorkflow(project.id, workflowCopyInput(workflows[0].workflow, "Late", ["TASK"])),
        ],
      ];
      if (worklog) writes.push(["deleteIssueWorklog", () => api.deleteIssueWorklog(project.id, issue.id, worklog.id)]);
      if (comment) writes.push(["deleteComment", () => api.deleteComment(project.id, issue.id, comment.id)]);

      for (const [name, write] of writes) {
        await expect(write(), name).rejects.toMatchObject(archivedRefusal);
      }
      // And nothing was written.
      await expect(api.getIssue(project.id, issue.id)).resolves.toMatchObject({ issue: { summary: issue.summary } });
    });

    it("tells a member of any role that it is archived before it checks the role", async () => {
      // Tom is the VIEWER: before archiving he is refused for his role, after
      // it for the archive — membership, then the archive, then the role.
      const { items } = await api.listIssues(project.id);
      const issue = items[0];
      await api.login({ email: "tom@example.com", password: "anything" });
      await expect(api.addIssueWorklog(project.id, issue.id, { spentMinutes: 30, workDate: "2026-01-02" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });

      await api.login({ email: "anna@example.com", password: "anything" });
      await api.archiveProject(project.id);
      await api.login({ email: "tom@example.com", password: "anything" });

      await expect(api.addIssueWorklog(project.id, issue.id, { spentMinutes: 30, workDate: "2026-01-02" })).rejects.toMatchObject(
        archivedRefusal,
      );
      await expect(api.addProjectMember(project.id, "11111111-1111-4111-8111-111111111111", "VIEWER")).rejects.toMatchObject(
        archivedRefusal,
      );
      await expect(api.addWorkflowStatus(project.id, "0f0f0f0f-0000-4000-8000-000000000382", {
        statusKey: "LATE",
        name: "Late",
        category: "IN_PROGRESS",
        sortOrder: 99,
      })).rejects.toMatchObject(archivedRefusal);
    });

    // The mock-only seam that stands in for another session's archive, so the
    // board turning read-only under its reader can be seen without a gateway.
    it("archives meanwhile on a comment that asks for it, then refuses that comment", async () => {
      const [issue] = (await api.listIssues(project.id)).items;

      await expect(
        api.addComment(project.id, issue.id, `Ship it ${MOCK_PROJECT_TRIGGERS.archivedMeanwhile}`),
      ).rejects.toMatchObject(archivedRefusal);
      await expect(api.getProject(project.id)).resolves.toMatchObject({ archivedAt: expect.any(String) });
      expect((await api.listComments(project.id, issue.id)).items.map((item) => item.body)).not.toContain(
        `Ship it ${MOCK_PROJECT_TRIGGERS.archivedMeanwhile}`,
      );
    });

    // The server looks the attachment up before anything else: a missing one
    // is a 204 with no check made, archived or not; a present one meets
    // `checkProjectWriteRole` — membership, archive, role (api-contract-guard).
    it("looks an attachment up before refusing its delete on an archived project", async () => {
      const issue = (await api.listIssues(project.id)).items.find((item) => item.issueKey === "TAS-101")!;
      const [attachment] = await api.listAttachments(project.id, issue.id);
      expect(attachment).toBeDefined();
      await api.archiveProject(project.id);

      await expect(
        api.deleteAttachment(project.id, issue.id, "00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
      await expect(api.deleteAttachment(project.id, issue.id, attachment.id)).rejects.toMatchObject(archivedRefusal);
      expect((await api.listAttachments(project.id, issue.id)).map((item) => item.id)).toContain(attachment.id);
    });

    it("tells the last ADMIN it is archived, not that they are the last admin", async () => {
      await api.archiveProject(project.id);

      await expect(api.changeProjectMemberRole(project.id, ANNA_ID, "MEMBER")).rejects.toMatchObject(archivedRefusal);
    });

    it("never tells an outsider that a project is archived", async () => {
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB")!;
      const [issue] = (await api.listIssues(mobile.id)).items;
      // Mark is Mobile's ADMIN in the seed.
      await api.archiveProject(mobile.id);

      await api.login({ email: "anna@example.com", password: "anything" });
      const refusal = await api.addComment(mobile.id, issue.id, "Hello?").catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: "PERMISSION_DENIED" });
      expect(apiErrorFacts(refusal).details).toBeNull();
    });
  });

  describe("workflow transitions", () => {
    it("moves an issue to the target status of a legal transition", async () => {
      const { items } = await api.listIssues(project.id);
      const todo = items.find((issue) => issue.status === "TODO");
      expect(todo).toBeDefined();

      const workflow = await taskWorkflow();
      const from = workflow.statuses.find((status) => status.statusKey === "TODO");
      const transition = workflow.transitions.find((item) => item.fromStatusId === from?.id);
      expect(transition).toBeDefined();

      const target = workflow.statuses.find((status) => status.id === transition!.toStatusId);
      const moved = await api.transitionIssue(project.id, todo!.id, transition!.id);

      expect(moved.status).toBe(target!.statusKey);
      expect(moved.version).toBe(todo!.version + 1);
    });

    it("rejects a transition that is not legal from the current status", async () => {
      const { items } = await api.listIssues(project.id);
      const done = items.find((issue) => issue.status === "DONE");
      expect(done).toBeDefined();

      const workflow = await taskWorkflow();
      const todoStatus = workflow.statuses.find((status) => status.statusKey === "TODO");
      const fromTodo = workflow.transitions.find((item) => item.fromStatusId === todoStatus?.id);

      await expect(api.transitionIssue(project.id, done!.id, fromTodo!.id)).rejects.toThrow();
    });

    it("records a TRANSITIONED history event carrying both endpoints", async () => {
      const { items } = await api.listIssues(project.id);
      const todo = items.find((issue) => issue.status === "TODO")!;

      const workflow = await taskWorkflow();
      const from = workflow.statuses.find((status) => status.statusKey === "TODO");
      const transition = workflow.transitions.find((item) => item.fromStatusId === from?.id)!;

      await api.transitionIssue(project.id, todo.id, transition.id);
      const { history } = await api.getIssue(project.id, todo.id);
      const event = history.find((item) => item.eventType === "TRANSITIONED");

      expect(event).toBeDefined();
      expect(event!.payload.from).toBe("TODO");
      expect(event!.payload.to).toBeTruthy();
    });
  });

  /**
   * Assigning through the edit — `PATCH /issues/{issueId}` with `assigneeId`
   * since TAS-246, where it was `PUT …/assignee`. issue-service holds the
   * assignee to `assign-issue-roles` (ADMIN, MEMBER), not only the caller
   * (TAS-226), and only when the assignee actually changes to somebody other
   * than `null` or the caller (`IssuePatchServiceImpl.checkPatchAssigneeRoles`,
   * read at `60d62ee`). The contract says none of it. Anna, the default reader,
   * is the ADMIN of Taska Platform.
   */
  describe("assigning an issue", () => {
    const issueByKey = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };

    const memberNamed = async (displayName: string) => {
      const member = (await api.listMembers(project.id)).find((item) => item.user?.displayName === displayName);
      if (!member) throw new Error(`no ${displayName} on the project`);
      return member;
    };

    it("assigns a MEMBER", async () => {
      const issue = await issueByKey("TAS-102");
      const mark = await memberNamed("Mark Lee");
      expect(mark.role).toBe("MEMBER");

      await expect(edit(issue.id, { assigneeId: mark.userId })).resolves.toMatchObject({ assigneeId: mark.userId });
    });

    it("refuses a VIEWER as the assignee, and changes nothing", async () => {
      const issue = await issueByKey("TAS-102");
      const tom = await memberNamed("Tom Becker");
      expect(tom.role).toBe("VIEWER");

      await expect(edit(issue.id, { assigneeId: tom.userId })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(api.getIssue(project.id, issue.id)).resolves.toMatchObject({
        issue: { assigneeId: issue.assigneeId, version: issue.version },
      });
    });

    it("refuses somebody who is not on the project, where it used to take anyone it knew", async () => {
      const issue = await issueByKey("TAS-102");
      // Priya is on WEB and MOB and not on Taska Platform. She exists, so what
      // refuses her here is the role check, not the user lookup.
      await api.login({ email: "priya@example.com", password: "anything" });
      const priya = await api.getCurrentUser();
      await api.login({ email: "anna@example.com", password: "anything" });

      await expect(edit(issue.id, { assigneeId: priya.id })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("unassigns an issue a VIEWER holds, because nobody is named to check", async () => {
      // TAS-110 is Tom's from before he was a VIEWER — the seeded shape of a
      // demotion after the assignment. `null` is a legal assignee on PATCH,
      // where the old assign route required an id.
      const issue = await issueByKey("TAS-110");
      expect(issue.assigneeId).toBe((await memberNamed("Tom Becker")).userId);

      await expect(edit(issue.id, { assigneeId: null })).resolves.toMatchObject({ assigneeId: null });
      const { history } = await api.getIssue(project.id, issue.id);
      expect(history.at(-1)).toMatchObject({ eventType: "ASSIGNED", payload: { to: null } });
    });

    it("lets the reader assign themselves, and subscribes them as the server does", async () => {
      // TAS-102 is Anna's and nobody watches it — the seed predates the
      // subscription — so it is handed away first, to make the assignment a
      // change.
      const issue = await issueByKey("TAS-102");
      const me = await api.getCurrentUser();
      await edit(issue.id, { assigneeId: null });
      const before = await api.getIssue(project.id, issue.id);
      expect(before.issue.isWatching).toBe(false);

      await expect(edit(issue.id, { assigneeId: me.id })).resolves.toMatchObject({ assigneeId: me.id });

      const after = await api.getIssue(project.id, issue.id);
      expect(after.issue.isWatching).toBe(true);
      // The subscription writes no history row of its own: only the assignment.
      expect(after.history.slice(before.history.length).map((event) => event.eventType)).toEqual(["ASSIGNED"]);
    });

    it("subscribes a new assignee once, however often they are assigned", async () => {
      const issue = await issueByKey("TAS-102");
      const mark = await memberNamed("Mark Lee");
      const markRows = async () =>
        (await api.listIssueWatchers(project.id, issue.id)).watchers.filter((row) => row.userId === mark.userId);

      await edit(issue.id, { assigneeId: mark.userId });
      expect(await markRows()).toHaveLength(1);
      // Made by whoever assigned, as the server records it.
      expect((await markRows())[0].createdBy).toBe((await api.getCurrentUser()).id);

      // Away and back again: a second assignment, and still one subscription —
      // and unassigning does not unsubscribe anybody.
      await edit(issue.id, { assigneeId: null });
      expect(await markRows()).toHaveLength(1);
      await edit(issue.id, { assigneeId: mark.userId });
      expect(await markRows()).toHaveLength(1);
    });

    it("subscribes the reporter to the issue they create", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Filed by Anna",
        description: "",
        priority: "LOW",
      });

      const { issue, history } = await api.getIssue(project.id, created.id);
      expect(issue.isWatching).toBe(true);
      expect(issue.watchers?.watchers.map((row) => row.userId)).toEqual([created.reporterId]);
      expect(history.map((event) => event.eventType)).toEqual(["CREATED"]);
    });
  });

  /**
   * The edit itself, `PATCH /issues/{issueId}` with `If-Match` (TAS-246), in
   * the order issue-service checks it at `60d62ee`: the version before anything
   * the write would change, and a write that changes nothing changes nothing —
   * not even the version.
   */
  describe("editing an issue", () => {
    const issueByKey = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };
    const snapshot = async (issueId: string) => {
      const { issue, history } = await api.getIssue(project.id, issueId);
      return { version: issue.version, updatedAt: issue.updatedAt, priority: issue.priority, history: history.length };
    };

    it("refuses a stale version with the issue as it stands, and writes nothing", async () => {
      const issue = await issueByKey("TAS-101");
      const before = await snapshot(issue.id);

      const failure = await api
        .updateIssue(project.id, issue.id, { priority: "LOW" }, before.version - 1 || before.version + 1)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(IssueVersionConflictError);
      const conflict = failure as IssueVersionConflictError;
      expect(conflict.status).toBe(409);
      expect(conflict.current).toMatchObject({ id: issue.id, version: before.version, priority: before.priority });
      expect(conflict.current).not.toHaveProperty("labels");
      expect(await snapshot(issue.id)).toEqual(before);
    });

    it("bumps the version by exactly one on a change, and not at all on a no-op", async () => {
      const issue = await issueByKey("TAS-101");
      const before = await snapshot(issue.id);

      const changed = await edit(issue.id, { priority: before.priority === "LOW" ? "HIGH" : "LOW" });
      expect(changed.version).toBe(before.version + 1);
      expect(changed).not.toHaveProperty("labels");

      const settled = await snapshot(issue.id);
      const same = await edit(issue.id, { priority: changed.priority, summary: changed.summary });
      expect(same.version).toBe(settled.version);
      expect(await snapshot(issue.id)).toEqual(settled);
    });

    it("clears with null — the description to the empty string, which is how the domain spells it", async () => {
      const issue = await issueByKey("TAS-101");

      const cleared = await edit(issue.id, { description: null, storyPoints: null });

      expect(cleared.description).toBe("");
      expect(cleared.storyPoints).toBeNull();
      expect((await api.getIssue(project.id, issue.id)).issue.description).toBe("");
    });

    it("answers a stale version as a conflict even when its dates would also be refused", async () => {
      const issue = await issueByKey("TAS-101");
      const version = await versionOf(issue.id);

      await expect(
        api.updateIssue(project.id, issue.id, { startDate: "2026-07-01" }, version + 3),
      ).rejects.toBeInstanceOf(IssueVersionConflictError);
    });

    it("conflicts after a transition, which bumps the version, and not after a label, which does not", async () => {
      const issue = await issueByKey("TAS-102");
      const labelled = await versionOf(issue.id);
      const [label] = await api.listProjectLabels(project.id);
      await api.addIssueLabel(project.id, issue.id, label.id);
      await expect(api.updateIssue(project.id, issue.id, { summary: "Still mine" }, labelled)).resolves.toMatchObject({
        version: labelled + 1,
      });

      const moved = await versionOf(issue.id);
      const workflow = await taskWorkflow();
      const from = workflow.statuses.find((status) => status.statusKey === issue.status);
      const transition = workflow.transitions.find((item) => item.fromStatusId === from?.id)!;
      await api.transitionIssue(project.id, issue.id, transition.id);
      await expect(api.updateIssue(project.id, issue.id, { summary: "Too late" }, moved)).rejects.toBeInstanceOf(
        IssueVersionConflictError,
      );
    });

    it("refuses a version the gateway cannot use and a blank summary, before looking anything up", async () => {
      const issue = await issueByKey("TAS-101");
      await expect(api.updateIssue(project.id, issue.id, { priority: "LOW" }, 0)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      await expect(api.updateIssue(project.id, issue.id, { priority: "LOW" }, 1.5)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(api.updateIssue(project.id, issue.id, { priority: "LOW" }, Number.NaN)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(api.updateIssue(project.id, "no-such-issue", { summary: " " }, 1)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "body.summary must not be blank",
      });
    });
  });

  describe("comments", () => {
    it("returns the newest comment first", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];

      await api.addComment(project.id, issue.id, "first");
      const second = await api.addComment(project.id, issue.id, "second");

      const page = await api.listComments(project.id, issue.id);
      expect(page.items[0].id).toBe(second.id);
    });

    it("paginates with a total count spanning every page", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];

      for (const body of ["a", "b", "c"]) {
        await api.addComment(project.id, issue.id, body);
      }

      const first = await api.listComments(project.id, issue.id, { page: 0, pageSize: 2 });
      const rest = await api.listComments(project.id, issue.id, { page: 1, pageSize: 2 });

      expect(first.items).toHaveLength(2);
      expect(first.totalCount).toBeGreaterThanOrEqual(3);
      expect(rest.items[0].id).not.toBe(first.items[0].id);
    });

    it("leaves a new comment with the stamps the server's insert leaves, and moves both on an edit", async () => {
      const { items } = await api.listIssues(project.id);
      const issue = items[0];

      // The insert, as issue-service performs it: `@CreatedDate` and
      // `@LastModifiedDate` written in one save, so the two stamps are equal
      // and `version` is 1. This mock answered `updatedAt: null` until TAS-233,
      // which is a shape the gateway never sends and which made the badge's
      // defect unreachable from any test in this repository.
      const created = await api.addComment(project.id, issue.id, "first");
      expect(created.updatedAt).toBe(created.createdAt);
      expect(created.version).toBe(1);
      expect(commentWasEdited(created)).toBe(false);

      const edited = await api.updateComment(project.id, issue.id, created.id, "second");
      expect(edited.createdAt).toBe(created.createdAt);
      expect(Date.parse(edited.updatedAt ?? "")).toBeGreaterThan(Date.parse(edited.createdAt));
      // The independent witness. `version = version + 1` and `updated_at =
      // NOW()` are one statement on the server, so a mock that moved only the
      // stamp would still pass the line above and would be modelling something
      // else. The badge itself reads neither of these — it reads the stamps.
      expect(edited.version).toBe(2);
      expect(commentWasEdited(edited)).toBe(true);
    });

    it("seeds comments nobody has edited", async () => {
      // The seed is what the UI and the end-to-end suite are developed against,
      // so a seeded thread has to read like an untouched one.
      const { items } = await api.listIssues(project.id);
      const seeded = (await Promise.all(items.map((issue) => api.listComments(project.id, issue.id)))).flatMap(
        (page) => page.items,
      );

      expect(seeded.length).toBeGreaterThan(0);
      expect(seeded.filter(commentWasEdited)).toEqual([]);
      expect(seeded.every((comment) => comment.version === 1)).toBe(true);
    });

    it("refuses to edit or delete a comment the current user does not own", async () => {
      const { items } = await api.listIssues(project.id);
      const me = await api.getCurrentUser();

      // Walk the seed until an issue with a foreign comment turns up, so this
      // test cannot silently pass by picking an uncommented issue. The first
      // shipped version did exactly that — see docs/ai/HARNESS.md.
      let issueId: string | undefined;
      let foreignId: string | undefined;
      for (const issue of items) {
        const page = await api.listComments(project.id, issue.id);
        const foreign = page.items.find((comment) => comment.authorUserId !== me.id);
        if (foreign) {
          issueId = issue.id;
          foreignId = foreign.id;
          break;
        }
      }
      expect(issueId).toBeDefined();
      expect(foreignId).toBeDefined();

      await expect(api.updateComment(project.id, issueId!, foreignId!, "hijack")).rejects.toThrow();
      await expect(api.deleteComment(project.id, issueId!, foreignId!)).rejects.toThrow();
    });
  });

  describe("issue links", () => {
    const issueByKey = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id);
      const issue = items.find((item) => item.issueKey === issueKey);
      expect(issue, `seed is missing ${issueKey}`).toBeDefined();
      return issue!;
    };

    it("seeds links so the panel has something to show on first load", async () => {
      const source = await issueByKey("TAS-101");
      const links = await api.listIssueLinks(project.id, source.id);

      expect(links.length).toBeGreaterThan(0);
      expect(links.every((link) => link.id && link.createdAt)).toBe(true);
    });

    it("answers each end with the relation as that end sees it", async () => {
      const source = await issueByKey("TAS-101");
      const target = await issueByKey("TAS-102");

      const fromSource = (await api.listIssueLinks(project.id, source.id)).find(
        (link) => link.targetIssueId === target.id,
      );
      const fromTarget = (await api.listIssueLinks(project.id, target.id)).find(
        (link) => link.sourceIssueId === source.id,
      );

      // Same link, same id, two views — this is what `viewLinkType` means, and
      // the receiving end's value is not one the request enum can express.
      expect(fromSource!.id).toBe(fromTarget!.id);
      expect(fromSource!.viewLinkType).toBe("BLOCKS");
      expect(fromTarget!.viewLinkType).toBe("IS_BLOCKED_BY");
    });

    it("creates a link and returns it as the asking issue sees it", async () => {
      const issue = await issueByKey("TAS-104");
      const target = await issueByKey("TAS-105");

      const link = await api.createIssueLink(project.id, issue.id, {
        targetIssueId: target.id,
        linkType: "RELATES_TO",
      });

      expect(link).toMatchObject({
        projectId: project.id,
        sourceIssueId: issue.id,
        targetIssueId: target.id,
        viewLinkType: "RELATES_TO",
      });
      await expect(api.listIssueLinks(project.id, issue.id)).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: link.id })]),
      );
    });

    it("refuses to link an issue to itself", async () => {
      const issue = await issueByKey("TAS-104");

      await expect(
        api.createIssueLink(project.id, issue.id, { targetIssueId: issue.id, linkType: "BLOCKS" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("refuses a duplicate link in either direction", async () => {
      const source = await issueByKey("TAS-101");
      const target = await issueByKey("TAS-102");

      await expect(
        api.createIssueLink(project.id, source.id, { targetIssueId: target.id, linkType: "RELATES_TO" }),
      ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
      // The seeded link runs source -> target; asking from the other end is the
      // same relation, not a second one.
      await expect(
        api.createIssueLink(project.id, target.id, { targetIssueId: source.id, linkType: "RELATES_TO" }),
      ).rejects.toMatchObject({ code: "ALREADY_EXISTS" });
    });

    it("refuses an issue or a target it does not know", async () => {
      const issue = await issueByKey("TAS-104");
      const missing = "00000000-0000-4000-8000-000000000000";

      await expect(
        api.createIssueLink(project.id, issue.id, { targetIssueId: missing, linkType: "BLOCKS" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        api.createIssueLink(project.id, missing, { targetIssueId: issue.id, linkType: "BLOCKS" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(api.listIssueLinks(project.id, missing)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("deletes a link from either of its ends", async () => {
      const source = await issueByKey("TAS-101");
      const target = await issueByKey("TAS-102");
      const [link] = (await api.listIssueLinks(project.id, source.id)).filter(
        (item) => item.targetIssueId === target.id,
      );

      // Removed from the receiving end: the route is issue-scoped and that end
      // sees the link just as much.
      await api.deleteIssueLink(project.id, target.id, link.id);

      await expect(api.listIssueLinks(project.id, source.id)).resolves.toEqual(
        expect.not.arrayContaining([expect.objectContaining({ id: link.id })]),
      );
      await expect(api.listIssueLinks(project.id, target.id)).resolves.toEqual(
        expect.not.arrayContaining([expect.objectContaining({ id: link.id })]),
      );
    });

    it("refuses to delete a link that does not belong to the issue", async () => {
      const unrelated = await issueByKey("TAS-104");
      const source = await issueByKey("TAS-101");
      const [link] = await api.listIssueLinks(project.id, source.id);

      await expect(api.deleteIssueLink(project.id, unrelated.id, link.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(api.deleteIssueLink(project.id, source.id, "no-such-link")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("issue listing", () => {
    it("filters by status without leaking other statuses", async () => {
      const { items } = await api.listIssues(project.id, { status: "DONE" });
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((issue) => issue.status === "DONE")).toBe(true);
    });

    it("excludes deleted issues", async () => {
      const before = await api.listIssues(project.id);
      const victim = before.items[0];

      await api.deleteIssue(project.id, victim.id);
      const after = await api.listIssues(project.id);

      expect(after.items.some((issue) => issue.id === victim.id)).toBe(false);
    });
  });

  /**
   * `GET /projects/{projectId}/board` since backend #205 (TAS-213). The mock
   * builds it out of its own workflows and its own issues rather than from a
   * fixture, so these cases are about the *semantics* read off the merged
   * `BoardServiceImpl` (develop 562d84de) — the types it reads, how it merges
   * their columns, where it puts an issue outside its own type's workflow,
   * what `includeDone` does and does not remove, the order inside a column,
   * what it joins into a card, and its access rule — not about the seed.
   *
   * `RestTaskaApi.test.ts` pins the same shape on the wire. Between them they
   * are what "mock and rest are interchangeable" means for this route.
   */
  describe("board", () => {
    const columnShape = (board: Board) =>
      board.columns.map((column) => [column.statusKey, column.category, column.sortOrder]);
    const cardsOf = (board: Board) => [...board.columns.flatMap((column) => column.issues), ...board.unplacedIssues];
    const card = (fields: Partial<BoardIssue> & Pick<BoardIssue, "id" | "issueType" | "statusKey">): BoardIssue => ({
      issueKey: fields.id.toUpperCase(),
      summary: "",
      priority: "MEDIUM",
      description: null,
      createdAt: "2026-06-08T09:10:00Z",
      updatedAt: "2026-06-08T09:10:00Z",
      version: 1,
      assignee: null,
      labels: [],
      ...fields,
    });
    const status = (statusKey: string, category: string, sortOrder: number, name = statusKey) => ({
      statusKey,
      name,
      category,
      sortOrder,
    });

    it("answers the columns of TASK, BUG and STORY merged, in sortOrder, with no issue type asked", async () => {
      const board = await api.getBoard(project.id);

      expect(board.projectId).toBe(project.id);
      expect(columnShape(board)).toEqual([
        ["TODO", "TODO", 10],
        ["IN_PROGRESS", "IN_PROGRESS", 20],
        ["DONE", "DONE", 30],
      ]);
      expect(board.columns.map((column) => column.name)).toEqual(["To Do", "In Progress", "Done"]);
      expect(board.unplacedIssues).toEqual([]);
    });

    it("holds every live issue of the three types, each in its status's column, with includeDone", async () => {
      const board = await api.getBoard(project.id, { includeDone: true });
      const { items } = await api.listIssues(project.id, { pageSize: 100 });

      expect(cardsOf(board).map((issue) => issue.id).sort()).toEqual(items.map((issue) => issue.id).sort());
      for (const column of board.columns) {
        expect(column.issues.every((issue) => issue.statusKey === column.statusKey)).toBe(true);
      }
    });

    it("keeps every column and leaves out done issues unless includeDone is asked for", async () => {
      const without = await api.getBoard(project.id);
      const with_ = await api.getBoard(project.id, { includeDone: true });

      // The flag filters issues, never columns.
      expect(columnShape(with_)).toEqual(columnShape(without));
      const done = (board: Board) => board.columns.find((column) => column.category === "DONE");
      expect(done(without)?.issues).toEqual([]);
      expect(done(with_)?.issues.length).toBeGreaterThan(0);
      const open = (board: Board) =>
        board.columns.filter((column) => column.category !== "DONE").map((column) => column.issues);
      expect(open(with_)).toEqual(open(without));
    });

    it("reads one type when it is asked for one", async () => {
      const board = await api.getBoard(project.id, { issueType: "BUG", includeDone: true });
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const bugs = items.filter((issue) => issue.issueType === "BUG").map((issue) => issue.issueKey);

      expect(bugs.length).toBeGreaterThan(0);
      expect(cardsOf(board).map((issue) => issue.issueKey).sort()).toEqual([...bugs].sort());
    });

    it("orders a column by type — TASK, BUG, STORY — then oldest first, then id", async () => {
      const board = await api.getBoard(project.id, { includeDone: true });
      const rank: Record<string, number> = { TASK: 0, BUG: 1, STORY: 2 };

      for (const column of board.columns) {
        const sorted = [...column.issues].sort(
          (a, b) =>
            rank[a.issueType] - rank[b.issueType] ||
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
            (a.id < b.id ? -1 : 1),
        );
        expect(column.issues.map((issue) => issue.id)).toEqual(sorted.map((issue) => issue.id));
      }
      // The seed's To Do holds all three types, so the order is not vacuous.
      const todo = board.columns.find((column) => column.statusKey === "TODO")!;
      expect(new Set(todo.issues.map((issue) => issue.issueType)).size).toBeGreaterThan(1);
    });

    it("joins in the assignee's name and face and the labels' names and colours", async () => {
      const board = await api.getBoard(project.id, { includeDone: true });
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const members = await api.listMembers(project.id);
      const assigned = cardsOf(board).filter((issue) => issue.assignee !== null);
      const labelled = items.find((issue) => issue.labels.length > 0)!;

      expect(assigned.length).toBeGreaterThan(0);
      for (const issue of assigned) {
        const member = members.find((row) => row.userId === issue.assignee!.id);
        expect(issue.assignee).toEqual({
          id: issue.assignee!.id,
          displayName: member?.user?.displayName ?? expect.any(String),
          avatarUrl: member?.user?.avatarUrl ?? null,
        });
      }
      const cardOfLabelled = cardsOf(board).find((issue) => issue.id === labelled.id)!;
      expect(cardOfLabelled.labels).toEqual(labelled.labels.map(({ id, name, color }) => ({ id, name, color })));
    });

    it("filters server-side by assignee, label, priority and query, down to every column empty", async () => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const assigned = items.find((issue) => issue.assigneeId !== null)!;
      const labelled = items.find((issue) => issue.labels.length > 0)!;

      const byAssignee = cardsOf(await api.getBoard(project.id, { assigneeId: assigned.assigneeId!, includeDone: true }));
      expect(byAssignee.map((issue) => issue.id)).toContain(assigned.id);
      expect(byAssignee.every((issue) => issue.assignee?.id === assigned.assigneeId)).toBe(true);

      const byLabel = cardsOf(await api.getBoard(project.id, { labelId: labelled.labels[0].id, includeDone: true }));
      expect(byLabel.map((issue) => issue.id)).toContain(labelled.id);
      expect(byLabel.every((issue) => issue.labels.some((label) => label.id === labelled.labels[0].id))).toBe(true);

      const byPriority = cardsOf(await api.getBoard(project.id, { priority: "HIGH", includeDone: true }));
      expect(byPriority.every((issue) => issue.priority === "HIGH")).toBe(true);

      // A literal substring, any case, over the key, the summary and the description.
      const byQuery = cardsOf(await api.getBoard(project.id, { query: assigned.issueKey.toLowerCase(), includeDone: true }));
      expect(byQuery.map((issue) => issue.id)).toEqual([assigned.id]);

      const nobody = await api.getBoard(project.id, {
        assigneeId: "00000000-0000-4000-8000-000000000000",
        includeDone: true,
      });
      expect(columnShape(nobody)).toEqual(columnShape(await api.getBoard(project.id)));
      expect(cardsOf(nobody)).toEqual([]);
    });

    it("leaves an issue whose own workflow lacks its status outside, and reads no type but the three (backend A4)", async () => {
      const web = (await api.listProjects()).find((item) => item.projectKey === "WEB")!;
      const board = await api.getBoard(web.id, { includeDone: true });
      const context = await api.getProjectContext(web.id);

      // The context offers EPIC, whose workflow adds In Review; the board reads
      // TASK, BUG and STORY only, so neither the column nor the epic is on it.
      expect(context.workflows.EPIC?.statuses.map((item) => item.statusKey)).toContain("IN_REVIEW");
      expect(board.columns.map((column) => column.statusKey)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
      expect(cardsOf(board).some((issue) => issue.issueKey === "WEB-15")).toBe(false);
      // A task in a status no workflow of its own lists.
      expect(board.unplacedIssues.map((issue) => [issue.issueKey, issue.statusKey])).toEqual([["WEB-16", "BLOCKED_BY_QA"]]);
    });

    it("places by the issue's own type: a status another type has is a column, and still outside for this one", () => {
      const types = [
        { issueType: "TASK", statuses: [status("TODO", "TODO", 10), status("DONE", "DONE", 30)] },
        { issueType: "BUG", statuses: [status("TODO", "TODO", 10), status("TRIAGE", "IN_PROGRESS", 20)] },
        // A type whose workflow was not found: every issue of it is outside.
        { issueType: "STORY", statuses: undefined },
      ];
      const board = buildMockBoard(
        project.id,
        types,
        [
          card({ id: "a", issueType: "TASK", statusKey: "TRIAGE" }),
          card({ id: "b", issueType: "BUG", statusKey: "TRIAGE" }),
          card({ id: "c", issueType: "TASK", statusKey: "" }),
          card({ id: "d", issueType: "STORY", statusKey: "TODO" }),
          card({ id: "e", issueType: "TASK", statusKey: "TODO" }),
        ],
        { includeDone: true },
      );

      expect(board.columns.map((column) => [column.statusKey, column.issues.map((issue) => issue.id)])).toEqual([
        ["TODO", ["e"]],
        ["TRIAGE", ["b"]],
        ["DONE", []],
      ]);
      // By type, then status ("" before "TRIAGE" for the two tasks).
      expect(board.unplacedIssues.map((issue) => issue.id)).toEqual(["c", "a", "d"]);
    });

    it("orders unplacedIssues by type, then status, then oldest first, then id — as the server reads them", () => {
      const types = [
        { issueType: "TASK", statuses: [status("TODO", "TODO", 10)] },
        { issueType: "BUG", statuses: [status("TODO", "TODO", 10)] },
      ];
      const board = buildMockBoard(
        project.id,
        types,
        [
          // The older task is in the later status: by date alone it would lead.
          card({ id: "task-zeta", issueType: "TASK", statusKey: "ZETA", createdAt: "2026-06-01T00:00:00Z" }),
          card({ id: "task-alpha-new", issueType: "TASK", statusKey: "ALPHA", createdAt: "2026-06-09T00:00:00Z" }),
          card({ id: "task-alpha-old", issueType: "TASK", statusKey: "ALPHA", createdAt: "2026-06-08T00:00:00Z" }),
          // Oldest of all, and in the first status, yet after the tasks: the type leads.
          card({ id: "bug-alpha", issueType: "BUG", statusKey: "ALPHA", createdAt: "2026-05-01T00:00:00Z" }),
          card({ id: "task-tie-b", issueType: "TASK", statusKey: "BETA", createdAt: "2026-06-02T00:00:00Z" }),
          card({ id: "task-tie-a", issueType: "TASK", statusKey: "BETA", createdAt: "2026-06-02T00:00:00Z" }),
        ],
        { includeDone: true },
      );

      expect(board.unplacedIssues.map((issue) => issue.id)).toEqual([
        "task-alpha-old",
        "task-alpha-new",
        "task-tie-a",
        "task-tie-b",
        "task-zeta",
        "bug-alpha",
      ]);
    });

    it("keeps a column in type, then oldest-first order whatever order the issues arrive in", () => {
      const types = [
        { issueType: "TASK", statuses: [status("TODO", "TODO", 10)] },
        { issueType: "BUG", statuses: [status("TODO", "TODO", 10)] },
      ];
      const board = buildMockBoard(
        project.id,
        types,
        [
          card({ id: "bug", issueType: "BUG", statusKey: "TODO", createdAt: "2026-05-01T00:00:00Z" }),
          card({ id: "task-new", issueType: "TASK", statusKey: "TODO", createdAt: "2026-06-09T00:00:00Z" }),
          card({ id: "task-old", issueType: "TASK", statusKey: "TODO", createdAt: "2026-06-08T00:00:00Z" }),
        ],
        { includeDone: true },
      );

      expect(board.columns[0].issues.map((issue) => issue.id)).toEqual(["task-old", "task-new", "bug"]);
    });

    it("merges columns by key, the first type's status winning, then stably by sortOrder", () => {
      const board = buildMockBoard(project.id, [
        { issueType: "TASK", statuses: [status("TODO", "TODO", 10, "To Do"), status("REVIEW", "IN_PROGRESS", 20, "Review")] },
        { issueType: "BUG", statuses: [status("TODO", "TODO", 5, "Bug inbox"), status("FIXING", "IN_PROGRESS", 20, "Fixing")] },
      ], []);

      // TASK's To Do keeps its name and its 10; REVIEW and FIXING tie at 20
      // and stay in the order they were met.
      expect(board.columns.map((column) => [column.statusKey, column.name, column.sortOrder])).toEqual([
        ["TODO", "To Do", 10],
        ["REVIEW", "Review", 20],
        ["FIXING", "Fixing", 20],
      ]);
    });

    it("keys includeDone on the DONE category of the issue's own type, whatever the status is called (backend #202)", () => {
      // `DONE` filed under IN_PROGRESS for TASK, and `RESOLVED` filed under
      // DONE: the category decides, never the key — and only for the type
      // whose workflow says so.
      const types = [
        { issueType: "TASK", statuses: [status("DONE", "IN_PROGRESS", 10), status("RESOLVED", "DONE", 20)] },
        { issueType: "BUG", statuses: [status("DONE", "IN_PROGRESS", 10), status("RESOLVED", "IN_PROGRESS", 20)] },
      ];
      const issues = [
        card({ id: "task-done", issueType: "TASK", statusKey: "DONE" }),
        card({ id: "task-resolved", issueType: "TASK", statusKey: "RESOLVED" }),
        card({ id: "bug-resolved", issueType: "BUG", statusKey: "RESOLVED" }),
      ];

      const hidden = buildMockBoard(project.id, types, issues);
      expect(cardsOf(hidden).map((issue) => issue.id).sort()).toEqual(["bug-resolved", "task-done"]);
      expect(hidden.columns.map((column) => column.statusKey)).toEqual(["DONE", "RESOLVED"]);

      const shown = buildMockBoard(project.id, types, issues, { includeDone: true });
      expect(cardsOf(shown)).toHaveLength(3);
    });

    it("refuses a project that is not there before a reader who is not on it", async () => {
      await expect(api.getBoard("11111111-2222-4333-8444-555555555555")).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Project not found",
      });

      await api.login({ email: "mark@example.com", password: "mock-accepts-anything" });
      const notAnnas = (await api.listProjects()).find((item) => !["TAS", "WEB", "OPS"].includes(item.projectKey))!;
      await api.login({ email: "anna@example.com", password: "mock-accepts-anything" });
      await expect(api.getBoard(notAnnas.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Access denied" });
    });
  });

  /**
   * `GET /project-stats` (backend TAS-211): one entry per listed project, in
   * the list's order, with counts and a five-person preview.
   */
  describe("project stats", () => {
    it("answers one entry per listed project, in the list's order, archived ones left out", async () => {
      const projects = await api.listProjects();
      await api.archiveProject(projects[0].id);
      const listed = await api.listProjects();
      const stats = await api.getProjectStats();

      expect(stats.map((entry) => entry.projectId)).toEqual(listed.map((item) => item.id));
    });

    it("counts every live issue of any type and status, and every member", async () => {
      const stats = await api.getProjectStats();
      for (const item of await api.listProjects()) {
        const entry = stats.find((row) => row.projectId === item.id)!;
        const { totalCount } = await api.listIssues(item.id, { pageSize: 100 });
        expect(entry.issueCount).toBe(totalCount);
        expect(entry.memberCount).toBe((await api.listMembers(item.id)).length);
      }
    });

    it("previews the first five members by addedAt, then userId", async () => {
      const stats = await api.getProjectStats();
      for (const entry of stats) {
        const members = await api.listMembers(entry.projectId);
        const expected = [...members]
          .sort((a, b) => (a.addedAt ?? "").localeCompare(b.addedAt ?? "") || (a.userId < b.userId ? -1 : 1))
          .slice(0, 5)
          .map((member) => member.userId);
        expect(entry.members.map((member) => member.userId)).toEqual(expected);
        expect(entry.members.length).toBeLessThanOrEqual(5);
      }
    });
  });

  /**
   * The five planning fields (TAS-189) through the edit, which is a merge patch
   * since TAS-246: a key left out is left alone, `null` clears, and only the
   * stated keys move. These cases pin that on the mock, which is the reference
   * implementation and what the e2e suite runs against; `RestTaskaApi.test.ts`
   * pins the wire, and both sides share the input rules in
   * src/api/planningFields.ts so they cannot answer differently.
   */
  describe("planning fields", () => {
    const issueByKey = async (key: string): Promise<Issue> => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const found = items.find((item) => item.issueKey === key);
      if (!found) throw new Error(`the seed has no ${key}`);
      return found;
    };

    it("seeds the two values a plausible reader gets wrong", async () => {
      // Zero points is an estimate of nothing, not the absence of an estimate,
      // and 1.5 is legal because the field is a double. Both are seeded so the
      // UI half has something to be wrong about.
      expect((await issueByKey("TAS-102")).storyPoints).toBe(0);
      expect((await issueByKey("TAS-103")).storyPoints).toBe(1.5);

      const full = await issueByKey("TAS-101");
      expect(full).toMatchObject({
        storyPoints: 3,
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
    });

    it("keeps all five when only the summary is edited — the regression this exists for", async () => {
      const before = await issueByKey("TAS-101");

      const updated = await edit(before.id, { summary: "Login form validation, revisited" });

      expect(updated.summary).toBe("Login form validation, revisited");
      expect(updated).toMatchObject({
        storyPoints: 3,
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
      // And the store agrees with what the write answered.
      const { issue } = await api.getIssue(project.id, before.id);
      expect(issue).toMatchObject({
        storyPoints: 3,
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });
    });

    it("keeps zero and a fraction through an unrelated edit, rather than reading them as nothing", async () => {
      const zero = await issueByKey("TAS-102");
      const half = await issueByKey("TAS-103");

      expect((await edit(zero.id, { priority: "HIGH" })).storyPoints).toBe(0);
      expect((await edit(half.id, { description: "Rewritten." })).storyPoints).toBe(1.5);
    });

    it("clears the one field asked for by an explicit null and leaves the others standing", async () => {
      const before = await issueByKey("TAS-101");

      const updated = await edit(before.id, { storyPoints: null });

      expect(updated.storyPoints).toBeNull();
      expect(updated).toMatchObject({
        startDate: "2026-06-15",
        dueDate: "2026-06-26",
        originalEstimateMinutes: 480,
        remainingEstimateMinutes: 240,
      });

      // And a negative value after the clear is a refusal, not a second clear:
      // the pin `HybridTaskaApi.test.ts` held on this mock until TAS-209
      // deleted the class it wrapped.
      await expect(edit(before.id, { storyPoints: -1 })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("reads an explicitly undefined key as 'leave it alone', not as 'clear it'", async () => {
      const before = await issueByKey("TAS-101");

      // What a component produces by spreading a form state that has not been
      // touched. `Object.assign(issue, { ...input })` used to write the
      // `undefined` straight over the stored value.
      const updated = await edit(before.id, { storyPoints: undefined, dueDate: undefined });

      expect(updated.storyPoints).toBe(3);
      expect(updated.dueDate).toBe("2026-06-26");
    });

    it("sets and clears each of the five in turn", async () => {
      const target = await issueByKey("TAS-104");

      const set = await edit(target.id, {
        storyPoints: 0.25,
        startDate: "2026-07-01",
        dueDate: "2026-07-31",
        originalEstimateMinutes: 0,
        remainingEstimateMinutes: 45,
      });
      expect(set).toMatchObject({
        storyPoints: 0.25,
        startDate: "2026-07-01",
        dueDate: "2026-07-31",
        originalEstimateMinutes: 0,
        remainingEstimateMinutes: 45,
      });

      const cleared = await edit(target.id, {
        storyPoints: null,
        startDate: null,
        dueDate: null,
        originalEstimateMinutes: null,
        remainingEstimateMinutes: null,
      });
      expect(cleared).toMatchObject({
        storyPoints: null,
        startDate: null,
        dueDate: null,
        originalEstimateMinutes: null,
        remainingEstimateMinutes: null,
      });
    });

    it("refuses a story-point value the column cannot hold", async () => {
      const target = await issueByKey("TAS-104");
      const refuse = (storyPoints: number) => edit(target.id, { storyPoints });

      // `>= 0` is what the server enforces even though its message says "must
      // be positive", so 0 is accepted and -0.5 is not.
      //
      // The sentence is asserted here and on the same input in
      // `RestTaskaApi.test.ts`: both read it from src/api/planningFields.ts, and
      // pinning it on both sides is what makes "a caller cannot tell which
      // implementation refused it" a test rather than a claim.
      await expect(refuse(-0.5)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: STORY_POINTS_RANGE_MESSAGE,
      });
      // numeric(5,2): above this the database raises and the answer is a 500.
      await expect(refuse(1000)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // Beyond the scale Postgres rounds silently — 1.235 would come back 1.23.
      await expect(refuse(1.235)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // JSON.stringify writes NaN as null, and null on this wire means "clear
      // it" — so an unguarded Number("") would erase the field it meant to set.
      await expect(refuse(Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      await expect(refuse(999.99)).resolves.toMatchObject({ storyPoints: 999.99 });
      await expect(refuse(0)).resolves.toMatchObject({ storyPoints: 0 });
    });

    it("refuses an estimate that is negative, fractional, or larger than an int32", async () => {
      const target = await issueByKey("TAS-104");

      await expect(
        edit(target.id, { originalEstimateMinutes: -1 }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        edit(target.id, { remainingEstimateMinutes: 30.5 }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      // The bound the field has in all three descriptions of it — `format:
      // int32`, `int32` in the proto, `integer` in the column. Without it the
      // mock would store and display a value the gateway could not bind, which
      // is the one way these two stop being interchangeable on this input.
      // Asserted with the sentence, here and on the same input in
      // `RestTaskaApi.test.ts`.
      await expect(
        edit(target.id, { originalEstimateMinutes: 2_147_483_648 }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: ESTIMATE_MAX_MESSAGE });

      // Both ends of what is still accepted: zero is an estimate of nothing,
      // and the ceiling itself fits.
      await expect(
        edit(target.id, { remainingEstimateMinutes: 0 }),
      ).resolves.toMatchObject({ remainingEstimateMinutes: 0 });
      await expect(
        edit(target.id, { originalEstimateMinutes: 2_147_483_647 }),
      ).resolves.toMatchObject({ originalEstimateMinutes: 2_147_483_647 });
    });

    it("refuses a date that is not a real calendar day", async () => {
      const target = await issueByKey("TAS-104");
      const refuse = (startDate: string) => edit(target.id, { startDate });

      await expect(refuse("2026-13-01")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(refuse("2026-02-30")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(refuse("01-09-2026")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(refuse("2026-9-1")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      // A leap day that exists, against one that does not.
      await expect(refuse("2028-02-29")).resolves.toMatchObject({ startDate: "2028-02-29" });
      await expect(refuse("2027-02-29")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("refuses a start date later than the due date stated in the same request", async () => {
      const target = await issueByKey("TAS-104");

      await expect(
        edit(target.id, { startDate: "2026-08-02", dueDate: "2026-08-01" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        edit(target.id, { startDate: "2026-08-01", dueDate: "2026-08-01" }),
      ).resolves.toMatchObject({ startDate: "2026-08-01", dueDate: "2026-08-01" });
    });

    it("checks the merged pair: a start date alone past the stored due date is refused in the server's words", async () => {
      // Since TAS-246 the edit is a PATCH, and the server lays the request's
      // dates over the stored ones and checks the result
      // (`IssuePatchServiceImpl.validateStartNotAfterDue`, read at `60d62ee`).
      const target = await issueByKey("TAS-101");

      await expect(edit(target.id, { startDate: "2026-07-01" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: datesOutOfOrderServerMessage("2026-07-01", "2026-06-26"),
      });

      // Nothing was written before the refusal.
      const { issue } = await api.getIssue(project.id, target.id);
      expect(issue).toMatchObject({ startDate: "2026-06-15", dueDate: "2026-06-26" });
    });

    it("accepts a start date past the stored due date when the same request clears that due date", async () => {
      // The merged pair is (07-01, nothing), which has no order to be wrong
      // about. Refused under the old PUT, which compared against the stored row.
      const target = await issueByKey("TAS-101");

      await expect(edit(target.id, { startDate: "2026-07-01", dueDate: null })).resolves.toMatchObject({
        startDate: "2026-07-01",
        dueDate: null,
      });
    });

    it("moves a whole window forward in one request, where the PUT refused it", async () => {
      const target = await issueByKey("TAS-101");

      await expect(edit(target.id, { startDate: "2026-07-01", dueDate: "2026-07-20" })).resolves.toMatchObject({
        startDate: "2026-07-01",
        dueDate: "2026-07-20",
      });
    });

    it("refuses a due date that would land before the stored start date, in the server's words", async () => {
      const target = await issueByKey("TAS-105");
      expect(target.startDate).toBe("2026-06-20");

      await expect(edit(target.id, { dueDate: "2026-06-01" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: datesOutOfOrderServerMessage("2026-06-20", "2026-06-01"),
      });
      await expect(edit(target.id, { dueDate: "2026-06-20" })).resolves.toMatchObject({ dueDate: "2026-06-20" });
    });

    it("accepts the five on a create and refuses the same values it refuses on an update", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Plan the migration",
        description: "With dates.",
        priority: "MEDIUM",
        storyPoints: 2.5,
        startDate: "2026-09-01",
        dueDate: "2026-09-30",
        originalEstimateMinutes: 600,
      });

      expect(created).toMatchObject({
        storyPoints: 2.5,
        startDate: "2026-09-01",
        dueDate: "2026-09-30",
        originalEstimateMinutes: 600,
        // Not stated on the create, and there is no prior value to keep.
        remainingEstimateMinutes: null,
      });

      await expect(
        api.createIssue(project.id, {
          issueType: "TASK",
          summary: "Backwards",
          description: "",
          priority: "LOW",
          startDate: "2026-09-30",
          dueDate: "2026-09-01",
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("carries storyPoints on a search hit and still carries nothing else the short DTO lacks", async () => {
      const { items } = await api.searchIssues({ query: "Login form validation" });
      const hit = items.find((item) => item.issueKey === "TAS-101");

      expect(hit).toBeDefined();
      expect(hit?.storyPoints).toBe(3);
      // The shape itself is pinned by the search section above; what this adds
      // is that a *seeded* value survives the mapping rather than arriving as
      // `undefined`, which is the failure a spread would have produced.
      expect(hit).not.toHaveProperty("dueDate");
      expect(hit).not.toHaveProperty("originalEstimateMinutes");
    });
  });

  /**
   * `GET /issues/search` as the deployed gateway was measured behaving on
   * 2026-08-23 — which the contract has said too since backend PR #200 — and
   * in the order that PR declares. Two of those measurements are the reason
   * these cases exist at all: the gateway refuses a query below three
   * characters, and an empty one. The e2e suite runs against this mock, so a
   * mock that quietly accepted either would let the suite pass a case the
   * gateway answers 400 to.
   */
  describe("issue search", () => {
    it("refuses a query below the minimum, and the empty string with it, in the gateway's words", async () => {
      // The gateway binds `minLength: 3` and answers before sign-in (probed
      // 2026-10-19, `f4857c3e…` and `69e851a1…`); issue-service's own sentence
      // is never reached for these.
      const binding = { code: "INVALID_ARGUMENT", message: "Invalid request parameters" };
      await expect(api.searchIssues({ query: "bo" })).rejects.toMatchObject(binding);
      await expect(api.searchIssues({ query: "" })).rejects.toMatchObject(binding);
      // Whitespace is not length: the field the reader types into trims, and so
      // does the rest leg before sending — so the mock refuses " a " too, in the
      // client's own words, where the gateway would take three characters and
      // search them for one.
      await expect(api.searchIssues({ query: " a " })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Search query must be at least 3 characters",
      });
    });

    it("answers newest first, and breaks a tie in time by id, descending", async () => {
      const { items } = await api.searchIssues({ query: "the", pageSize: 100 });
      expect(items.length).toBeGreaterThan(2);
      // A hit carries no time of its own, so each is read back for it.
      const created = await Promise.all(
        items.map(async (hit) => Date.parse((await api.getIssue(hit.projectId!, hit.id)).issue.createdAt)),
      );
      expect(created.every(Number.isFinite)).toBe(true);
      expect([...created].sort((a, b) => b - a)).toEqual(created);

      // Three issues in one instant reach the tiebreak: `createdAt desc, id
      // desc` is the route's declared order, and ids are random, so the order
      // below is the ids' and nothing else's.
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
        const twins = [];
        for (const n of [1, 2, 3]) {
          twins.push(
            await api.createIssue(project.id, {
              issueType: "TASK",
              summary: `Tiebreak twin ${n}`,
              description: "",
              priority: "LOW",
            }),
          );
        }
        const hits = await api.searchIssues({ query: "Tiebreak twin", projectId: project.id, pageSize: 100 });
        expect(hits.items.map((hit) => hit.id)).toEqual(twins.map((twin) => twin.id).sort().reverse());
      } finally {
        vi.useRealTimers();
      }
    });

    it("treats an absent query as no text filter rather than as an empty one", async () => {
      // The trap the compensation exists for: omitting the parameter is a 200
      // with everything, sending it empty is a 400. They must not collapse.
      const everything = await api.searchIssues({});
      const inProject = await api.listIssues(project.id, { pageSize: 100 });

      expect(everything.totalCount).toBeGreaterThanOrEqual(inProject.items.length);
    });

    it("matches the key, the summary and the description, case-insensitively", async () => {
      const byKey = await api.searchIssues({ query: "tas-104", projectId: project.id, pageSize: 100 });
      expect(byKey.items.map((hit) => hit.issueKey)).toContain("TAS-104");

      const bySummary = await api.searchIssues({ query: "ONBOARDING", projectId: project.id, pageSize: 100 });
      expect(bySummary.items.map((hit) => hit.issueKey)).toContain("TAS-102");

      // The word appears in TAS-104's description and in no summary or key, so
      // this is the OR the probe recorded and not a coincidence of wording.
      const byDescription = await api.searchIssues({ query: "gRPC", projectId: project.id, pageSize: 100 });
      expect(byDescription.items.map((hit) => hit.issueKey)).toEqual(["TAS-104"]);
    });

    it("searches every project the caller can see, and no further", async () => {
      const hits = await api.searchIssues({ query: "board", pageSize: 100 });
      const projects = await api.listProjects();
      const keys = hits.items.map((hit) => hit.issueKey);

      // More than one project answers, which is what "no projectId" means.
      expect(new Set(keys.map((key) => key.split("-")[0])).size).toBeGreaterThan(1);
      // And nothing from a project this account is not in. Anna is a member of
      // three of the four seeded projects.
      const visible = new Set(projects.map((item) => item.projectKey));
      expect(keys.every((key) => visible.has(key.split("-")[0]))).toBe(true);
      expect(keys.some((key) => key.startsWith("MOB-"))).toBe(false);
    });

    it("scopes to one project when asked, and refuses a project that is not there", async () => {
      const scoped = await api.searchIssues({ query: "board", projectId: project.id, pageSize: 100 });
      expect(scoped.items.length).toBeGreaterThan(0);
      expect(scoped.items.every((hit) => hit.issueKey.startsWith(`${project.projectKey}-`))).toBe(true);

      await expect(api.searchIssues({ query: "board", projectId: "no-such-project" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("refuses a project the caller is not a member of, the same way as one that is not there", async () => {
      // Mark is in the seed's fourth project and Anna is not, so the id has to
      // be fetched as him before the question can be asked as her.
      await api.login({ email: "mark@example.com", password: "mock-accepts-anything" });
      const marks = await api.listProjects();
      const notAnnas = marks.find((item) => !["TAS", "WEB", "OPS"].includes(item.projectKey));
      expect(notAnnas).toBeDefined();

      await api.login({ email: "anna@example.com", password: "mock-accepts-anything" });
      await expect(await api.listProjects().then((items) => items.map((item) => item.id))).not.toContain(notAnnas!.id);

      // Existence is not access. Checking only that the project exists let a
      // non-member read every issue in it — the mock stating an access rule in
      // its own comment and not keeping it, which is worse than not stating one.
      await expect(api.searchIssues({ query: "issues", projectId: notAnnas!.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("ANDs every filter onto the query", async () => {
      const all = await api.searchIssues({ query: "the", projectId: project.id, pageSize: 100 });
      const bugs = await api.searchIssues({
        query: "the",
        projectId: project.id,
        issueType: "BUG",
        priority: "HIGH",
        pageSize: 100,
      });

      expect(bugs.items.length).toBeGreaterThan(0);
      expect(bugs.items.length).toBeLessThan(all.items.length);
      expect(bugs.items.every((hit) => hit.issueType === "BUG" && hit.priority === "HIGH")).toBe(true);
    });

    it("counts the whole matching set and pages the answer after it", async () => {
      const whole = await api.searchIssues({ query: "the", projectId: project.id, pageSize: 100 });
      expect(whole.totalCount).toBeGreaterThan(2);

      const first = await api.searchIssues({ query: "the", projectId: project.id, page: 0, pageSize: 2 });
      const second = await api.searchIssues({ query: "the", projectId: project.id, page: 1, pageSize: 2 });

      expect(first.items).toHaveLength(2);
      // The count is about the search, not about the page — the first honest
      // issue total this frontend can print.
      expect(first.totalCount).toBe(whole.totalCount);
      expect(second.totalCount).toBe(whole.totalCount);
      expect(first.items.map((hit) => hit.id)).not.toEqual(second.items.map((hit) => hit.id));
    });

    // Backend TAS-218: a filter value nobody holds passes the edge and matches
    // nothing — neither a 400 (TAS-168) nor the whole set (TAS-180). Cast,
    // because no caller of this build can spell one.
    it("answers an empty page for a priority or issue type it does not know", async () => {
      const params = { query: "board", priority: "URGENT", issueType: "EPIC" } as unknown as Parameters<
        MockTaskaApi["searchIssues"]
      >[0];
      await expect(api.searchIssues(params)).resolves.toMatchObject({ items: [], totalCount: 0 });
    });

    it("answers with the ten fields of the short DTO and nothing else", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Unassigned needle for the search",
        description: "Nobody owns this one yet.",
        priority: "LOW",
      });

      const { items } = await api.searchIssues({ query: "needle", projectId: project.id, pageSize: 100 });
      const hit = items.find((item) => item.id === created.id);

      expect(hit).toBeDefined();
      // No description, no labels, no version: a hit that carried them would
      // let a card or an edit claim something the gateway never sent. The
      // project and the status key are TAS-218's; `storyPoints` is the one
      // planning field, with no dates and no estimates beside it.
      expect(Object.keys(hit ?? {}).sort()).toEqual([
        "assigneeId",
        "id",
        "issueKey",
        "issueType",
        "priority",
        "projectId",
        "projectKey",
        "statusKey",
        "storyPoints",
        "summary",
      ]);
      expect(hit).toMatchObject({ projectId: project.id, projectKey: project.projectKey, statusKey: "TODO" });
      // Created without one, so this states "not estimated" rather than a value.
      expect(hit?.storyPoints).toBeNull();
      // `""` on the wire for nobody, `null` here, exactly as `Issue.assigneeId`.
      expect(hit?.assigneeId).toBeNull();
    });

    it("does not find a deleted issue", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Doomed haystack entry",
        description: "About to be deleted.",
        priority: "LOW",
      });
      await api.deleteIssue(project.id, created.id);

      const { items } = await api.searchIssues({ query: "haystack", projectId: project.id, pageSize: 100 });
      expect(items).toEqual([]);
    });
  });

  /**
   * The label rules the gateway states in TAS-119 — project scope, one name per
   * project case-insensitively, a HEX colour, and a soft delete that reaches
   * every issue at once. The cases below find their subjects in the seed rather
   * than naming them, so a reshuffled seed changes nothing here.
   */
  describe("labels", () => {
    it("lists the project's own labels and puts them on the issues that carry them", async () => {
      const labels = await api.listProjectLabels(project.id);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((label) => label.projectId === project.id && label.deletedAt === null)).toBe(true);

      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;

      // What the issue carries is the project's label narrowed to the three
      // fields the issue side of the contract has.
      const projectIds = labels.map((label) => label.id);
      expect(projectIds).toEqual(expect.arrayContaining(carrier.labels.map((label) => label.id)));
      expect(Object.keys(carrier.labels[0]).sort()).toEqual(["color", "id", "name"]);
    });

    it("lists labels by name, then id — on the project, on the issue — and the board's ids by id", async () => {
      // The order both label reads declare since backend PR #200. Created
      // last, named to sort first: insertion order would put it at the end.
      const first = await api.createProjectLabel(project.id, { name: "a11y", color: "#0052cc" });
      const labels = await api.listProjectLabels(project.id);
      expect(labels[0].id).toBe(first.id);
      const names = labels.map((label) => label.name);
      expect([...names].sort((a, b) => a.localeCompare(b, "en"))).toEqual(names);

      // Attached in reverse: the issue still answers by name.
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const bare = items.find((issue) => issue.labels.length === 0 && issue.issueType === "TASK")!;
      for (const label of [...labels].reverse().slice(0, 3)) await api.addIssueLabel(project.id, bare.id, label.id);
      const onIssue = await api.listIssueLabels(project.id, bare.id);
      expect(onIssue.map((label) => label.name)).toEqual(
        [...labels].reverse().slice(0, 3).map((label) => label.name).sort((a, b) => a.localeCompare(b, "en")),
      );

      // The board's card carries the same labels, in the issue's own order,
      // with their names and colours (backend #205).
      const board = await api.getBoard(project.id, { issueType: "TASK", includeDone: true });
      const card = board.columns.flatMap((column) => column.issues).find((issue) => issue.id === bare.id)!;
      expect(card.labels).toEqual(onIssue.map(({ id, name, color }) => ({ id, name, color })));
    });

    it("creates a label, trimming the name the caller typed", async () => {
      const created = await api.createProjectLabel(project.id, { name: "  spacing  ", color: "#0052cc" });

      expect(created).toMatchObject({ projectId: project.id, name: "spacing", color: "#0052cc", deletedAt: null });
      expect((await api.listProjectLabels(project.id)).some((label) => label.id === created.id)).toBe(true);
    });

    it("refuses a name the project already uses, whatever its case", async () => {
      const [existing] = await api.listProjectLabels(project.id);

      await expect(
        api.createProjectLabel(project.id, { name: existing.name.toUpperCase(), color: "#123456" }),
      ).rejects.toThrow();
    });

    it("refuses a colour the contract's own pattern rejects", async () => {
      await expect(api.createProjectLabel(project.id, { name: "unheard-of", color: "red" })).rejects.toThrow();
      await expect(api.createProjectLabel(project.id, { name: "unheard-of", color: "#12345" })).rejects.toThrow();
    });

    it("lets a label keep its own name through a recolour", async () => {
      const [label] = await api.listProjectLabels(project.id);

      const updated = await api.updateProjectLabel(project.id, label.id, { name: label.name, color: "#123456" });

      expect(updated).toMatchObject({ id: label.id, name: label.name, color: "#123456" });
    });

    it("shows a rename through every issue carrying the label", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      await api.updateProjectLabel(project.id, carried.id, { name: "renamed", color: "#123456" });

      const after = await api.getIssue(project.id, carrier.id);
      expect(after.issue.labels?.find((label) => label.id === carried.id)).toEqual({
        id: carried.id,
        name: "renamed",
        color: "#123456",
      });
    });

    it("puts a label on an issue once and refuses the second attempt", async () => {
      const { items } = await api.listIssues(project.id);
      const bare = items.find((issue) => issue.labels.length === 0);
      const [label] = await api.listProjectLabels(project.id);
      expect(bare).toBeDefined();
      if (!bare) return;

      await api.addIssueLabel(project.id, bare.id, label.id);

      expect((await api.listIssueLabels(project.id, bare.id)).map((item) => item.id)).toEqual([label.id]);
      expect((await api.getIssue(project.id, bare.id)).issue.labels?.map((item) => item.id)).toEqual([label.id]);
      await expect(api.addIssueLabel(project.id, bare.id, label.id)).rejects.toThrow();
    });

    it("takes a label off an issue and refuses to take off one it does not carry", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      await api.removeIssueLabel(project.id, carrier.id, carried.id);

      expect((await api.listIssueLabels(project.id, carrier.id)).some((label) => label.id === carried.id)).toBe(false);
      await expect(api.removeIssueLabel(project.id, carrier.id, carried.id)).rejects.toThrow();
    });

    it("takes a soft-deleted label off the project and off every issue at once", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      await api.deleteProjectLabel(project.id, carried.id);

      expect((await api.listProjectLabels(project.id)).some((label) => label.id === carried.id)).toBe(false);
      expect((await api.listIssueLabels(project.id, carrier.id)).some((label) => label.id === carried.id)).toBe(false);
      // A deleted label cannot be addressed again, which is what stops the UI
      // from "restoring" one by re-adding it to an issue.
      await expect(api.addIssueLabel(project.id, carrier.id, carried.id)).rejects.toThrow();
    });

    it("filters the issue list by label", async () => {
      const { items } = await api.listIssues(project.id);
      const carrier = items.find((issue) => issue.labels.length > 0);
      expect(carrier).toBeDefined();
      if (!carrier) return;
      const [carried] = carrier.labels;

      const filtered = await api.listIssues(project.id, { labelId: carried.id });

      expect(filtered.items.length).toBeGreaterThan(0);
      expect(filtered.items.every((issue) => issue.labels.some((label) => label.id === carried.id))).toBe(true);
      expect(filtered.items.some((issue) => issue.id === carrier.id)).toBe(true);
      expect(filtered.items.length).toBeLessThan(items.length);
    });

    it("answers a label from another project with a not-found rather than a cross-project write", async () => {
      const projects = await api.listProjects();
      const other = projects.find((item) => item.id !== project.id);
      expect(other).toBeDefined();
      if (!other) return;
      const [foreign] = await api.listProjectLabels(other.id);
      const { items } = await api.listIssues(project.id);

      await expect(api.addIssueLabel(project.id, items[0].id, foreign.id)).rejects.toThrow();
    });
  });

  /**
   * The inbox in the shape the gateway sends since TAS-243: the issue a
   * notification is about is stated by id, and the unread total is the
   * server's own count rather than a count of the page.
   */
  describe("notifications", () => {
    it("counts every unread notification, whatever the page was narrowed to", async () => {
      const everything = await api.listNotifications({ pageSize: 100 });
      const unread = everything.items.filter((item) => !item.readAt).length;
      expect(unread, "the seed stopped holding more than one unread notification").toBeGreaterThan(1);
      expect(everything.unreadCount).toBe(unread);

      // A page of one, a page past the end, and the unread filter: the count
      // is the inbox's, never the page's.
      await expect(api.listNotifications({ pageSize: 1 })).resolves.toMatchObject({ unreadCount: unread });
      await expect(api.listNotifications({ offset: 100 })).resolves.toMatchObject({ items: [], unreadCount: unread });
      await expect(api.listNotifications({ unreadOnly: true, pageSize: 1 })).resolves.toMatchObject({
        unreadCount: unread,
      });
    });

    it("moves the count when one is marked read, and only the first time", async () => {
      const { items, unreadCount } = await api.listNotifications();
      const unread = items.find((item) => !item.readAt);
      expect(unread).toBeDefined();

      await api.markNotificationRead(unread!.id);
      await expect(api.listNotifications()).resolves.toMatchObject({ unreadCount: unreadCount - 1 });
      await api.markNotificationRead(unread!.id);
      await expect(api.listNotifications()).resolves.toMatchObject({ unreadCount: unreadCount - 1 });
    });

    it("marks every notification read, reports how many changed, and reports none the second time", async () => {
      const before = await api.listNotifications({ unreadOnly: true });
      expect(before.items.length).toBeGreaterThan(0);

      const { updatedCount } = await api.markAllNotificationsRead();
      const after = await api.listNotifications({ unreadOnly: true });

      expect(updatedCount).toBe(before.unreadCount);
      expect(after.items).toHaveLength(0);
      expect(after.unreadCount).toBe(0);
      // The gateway's route is idempotent and says so in its count.
      await expect(api.markAllNotificationsRead()).resolves.toEqual({ updatedCount: 0 });
    });

    it("seeds every shape the gateway sends, and names real issues where it names one", async () => {
      const { items } = await api.listNotifications({ pageSize: 100 });
      const issues = (await api.listIssues(project.id, { pageSize: 100 })).items;
      const byType = (type: string) => items.filter((item) => item.notificationType === type);

      // Ids of an issue Anna can open: the three fields agree with a real row.
      for (const type of ["ISSUE_ASSIGNED", "ISSUE_COMMENT_CREATED"]) {
        const [row] = byType(type);
        expect(row, `the seed has no ${type}`).toBeDefined();
        const issue = issues.find((item) => item.id === row.issueId);
        expect(issue, `${type} names an issue the seed does not hold`).toBeDefined();
        expect(row).toMatchObject({ issueKey: issue!.issueKey, projectId: issue!.projectId });
      }

      // Not about an issue: all three null, together.
      expect(byType("MEMBER_ADDED")[0]).toMatchObject({ issueId: null, issueKey: null, projectId: null });

      // An issue notification older than the columns: all three null as well.
      const legacy = items.find((item) => item.notificationType.startsWith("ISSUE_") && item.issueId === null);
      expect(legacy, "the seed has no issue notification from before the ids").toBeDefined();
      expect(legacy).toMatchObject({ issueKey: null, projectId: null });

      // A deleted issue: both ids, and no issue behind them.
      const [deleted] = byType("ISSUE_DELETED");
      expect(deleted.issueId).not.toBeNull();
      expect(deleted.projectId).toBe(project.id);
      expect(issues.some((item) => item.id === deleted.issueId)).toBe(false);

      // An attachment notification as issue-service writes it since backend
      // PR #191 (TAS-245): all three issue fields, and the key in the body.
      // Read, so it does not add to the unread count the other rows already
      // account for.
      const [attachment] = byType("ISSUE_ATTACHMENT_ADDED");
      const tas101 = issues.find((item) => item.issueKey === "TAS-101");
      expect(tas101, "the seed has no TAS-101 to pin the attachment row to").toBeDefined();
      expect(attachment).toMatchObject({
        issueId: tas101!.id,
        issueKey: "TAS-101",
        projectId: project.id,
        body: "An attachment was added to TAS-101",
      });
      expect(attachment.readAt).not.toBeNull();
    });

    it("states the issue on every notification the product makes", async () => {
      const created = await api.createIssue(project.id, {
        issueType: "TASK",
        summary: "Rotate the signing key",
        description: "",
        priority: "LOW",
      });
      const [createdRow] = (await api.listNotifications()).items;
      expect(createdRow).toMatchObject({
        notificationType: "ISSUE_CREATED",
        issueId: created.id,
        issueKey: created.issueKey,
        projectId: project.id,
      });

      const mark = (await api.listMembers(project.id)).find((item) => item.user?.displayName === "Mark Lee");
      await edit(created.id, { assigneeId: mark!.userId });
      const [assignedRow] = (await api.listNotifications()).items;
      expect(assignedRow).toMatchObject({ notificationType: "ISSUE_ASSIGNED", issueId: created.id, projectId: project.id });

      const workflow = await taskWorkflow();
      const todo = workflow.statuses.find((status) => status.statusKey === "TODO");
      const transition = workflow.transitions.find((item) => item.fromStatusId === todo?.id);
      await api.transitionIssue(project.id, created.id, transition!.id);
      const [movedRow] = (await api.listNotifications()).items;
      expect(movedRow).toMatchObject({
        notificationType: "ISSUE_TRANSITIONED",
        issueId: created.id,
        issueKey: created.issueKey,
        projectId: project.id,
      });
    });

    it("carries neither of the two fields the schema dropped", async () => {
      const { items } = await api.listNotifications();
      for (const item of items) {
        expect(item).not.toHaveProperty("link");
        expect(item).not.toHaveProperty("userId");
      }
    });
  });
  describe("read-only admin", () => {
    it("seeds a catalog whose tables are all readable", async () => {
      const catalog = await api.getAdminCatalog();

      expect(catalog.services.length).toBeGreaterThan(1);
      for (const service of catalog.services) {
        for (const table of service.tables) {
          const result = await api.listAdminRows({ service: service.name, table: table.name });
          // The seed exists so the console is clickable without a gateway; an
          // advertised table that answers nothing would defeat that.
          expect(result.rows.length).toBeGreaterThan(0);
          expect(result.meta.columns).toEqual(table.columns.map((column) => column.name));
        }
      }
    });

    // The console branches on the catalog's column types — which operators a
    // filter offers, and whether a row can be opened at all — so a seed that
    // does not carry those cases proves nothing about the screen above it.
    it("spells column types the way information_schema does", async () => {
      const catalog = await api.getAdminCatalog();
      const types = new Set(
        catalog.services.flatMap((service) => service.tables).flatMap((table) => table.columns.map((c) => c.type)),
      );

      // Every class the gateway distinguishes is present.
      expect(types).toContain("character varying");
      expect(types).toContain("timestamp with time zone");
      expect(types).toContain("integer");
      expect(types).toContain("boolean");
      expect(types).toContain("uuid");
      // And none of the short aliases, which the gateway matches exactly and
      // would therefore classify as "unknown" — offering operators it refuses.
      expect(types).not.toContain("varchar");
      expect(types).not.toContain("timestamptz");
    });

    it("keys every seeded table by a uuid, as every table on the stand is", async () => {
      const catalog = await api.getAdminCatalog();
      const keyTypes = catalog.services
        .flatMap((service) => service.tables)
        .map((table) => table.columns.find((column) => column.name === table.primaryKey)?.type);

      // Read at backend develop `398285cde074`: every table the catalog lists
      // has a uuid key, so every row the console shows is addressable. §5.8's
      // other branch — a key the gateway cannot take, not linked — is pinned
      // in src/screens/admin/AdminScreen.test.tsx on a made-up table rather
      // than seeded here as though the stand had one.
      expect(keyTypes.length).toBeGreaterThan(0);
      expect(keyTypes.every((type) => type === "uuid")).toBe(true);
    });

    it("lists admin-service's audit table as the stand does, with the Audit section's rows", async () => {
      const catalog = await api.getAdminCatalog();
      const admin = catalog.services.find((service) => service.name === "admin");
      expect(admin?.tables.map((table) => table.name)).toEqual(["admin_audit_log"]);
      expect(admin?.tables[0].columns.map((column) => `${column.name}:${column.type}`)).toEqual([
        "id:uuid",
        "request_id:text",
        "actor_user_id:uuid",
        // Renamed in place from `actor_login` and retyped by changeset
        // `0003-audit-actor-identity` (backend PR #219, TAS-388)…
        "actor_display_name:text",
        "actor_roles:jsonb",
        "action:text",
        "target_service:text",
        "target_table:text",
        "target_id:text",
        "old_value:jsonb",
        "new_value:jsonb",
        "reason:text",
        "created_at:timestamp with time zone",
        // …and added by it, so last.
        "actor_email:character varying",
      ]);

      // One log, two views of it: every row here is an entry the audit read
      // answers with, under the same id. The audit read is GLOBAL_ADMIN only.
      await api.login({ email: "mark@example.com", password: "anything" });
      const { rows } = await api.listAdminRows({ service: "admin", table: "admin_audit_log", pageSize: 100 });
      const { entries } = await api.listAuditEntries({ pageSize: 100 });
      expect(rows.map((row) => row.id).sort()).toEqual(entries.map((entry) => entry.id).sort());
      const id = String(rows[0].id);
      await expect(api.getAdminRow({ service: "admin", table: "admin_audit_log", id })).resolves.toMatchObject({
        id,
      });
    });

    it("sends the audit table's jsonb columns as text in PostgreSQL's form, and its times to the second", async () => {
      // As probed 2026-10-19 (`940a576d-2d14-483d-9377-7e1b71fbf5ad`): a
      // `jsonb` cell is a string, `": "` and `", "` between the parts, keys in
      // jsonb's order — shorter first — which is neither the order the seed
      // wrote them in nor alphabetical.
      const { rows } = await api.listAdminRows({
        service: "admin",
        table: "admin_audit_log",
        pageSize: 100,
        filters: [{ column: "action", operator: "equals", value: "RESET_CREDENTIAL_LOCKOUT" }],
      });
      expect(rows.length).toBeGreaterThan(0);
      const [row] = rows;
      expect(row.old_value).toBe('{"status": "LOCKED", "passwordHash": "***", "failedAttempts": 5}');
      expect(row.new_value).toBe('{"status": "ACTIVE", "passwordHash": "***", "failedAttempts": 0}');
      // A user operation stores the actor's one role, a JSON string.
      expect(row.actor_roles).toBe('"GLOBAL_ADMIN"');
      expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

      // The audit route sends the same document compact, as Jackson prints the
      // `JsonNode` it read back — but in the same key order, so the Audit
      // section's detail and the Data section's card list one entry's keys
      // alike.
      await api.login({ email: "mark@example.com", password: "anything" });
      const audit = await api.listAuditEntries({ action: "RESET_CREDENTIAL_LOCKOUT", pageSize: 100 });
      const entry = audit.entries.find((item) => item.id === row.id)!;
      expect(entry.oldValue).toBe('{"status":"LOCKED","passwordHash":"***","failedAttempts":5}');
      expect(Object.keys(JSON.parse(entry.oldValue!))).toEqual(Object.keys(JSON.parse(String(row.old_value))));

      // The outbox retry stores the whole role list instead, a JSON array.
      const { rows: retries } = await api.listAdminRows({
        service: "admin",
        table: "admin_audit_log",
        pageSize: 100,
        filters: [{ column: "action", operator: "equals", value: "RETRY_OUTBOX_EVENT" }],
      });
      expect(retries.length).toBeGreaterThan(0);
      expect(retries.every((retry) => retry.actor_roles === '["GLOBAL_ADMIN"]')).toBe(true);

      // A document the log does not hold stays `null`, not the text "null".
      const { rows: all } = await api.listAdminRows({ service: "admin", table: "admin_audit_log", pageSize: 100 });
      expect(all.some((item) => item.old_value === null)).toBe(true);
      expect(all.every((item) => item.old_value === null || typeof item.old_value === "string")).toBe(true);
    });

    it("reads one row by its key and refuses a key nobody has", async () => {
      const page = await api.listAdminRows({ service: "auth", table: "users" });
      const id = String(page.rows[0].id);

      await expect(api.getAdminRow({ service: "auth", table: "users", id })).resolves.toMatchObject({ id });
      // The way the REST implementation's 404 reaches the card, so the
      // missing-row state is reachable without a gateway.
      await expect(
        api.getAdminRow({ service: "auth", table: "users", id: "0f3d5cb0-0000-0000-0000-000000000000" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    // The gateway types the path parameter as a UUID, so a hand-typed address
    // with anything else in it is refused before admin-service sees it. It has
    // to hit the same wall in both modes, or mock mode teaches a card that does
    // not exist.
    it("refuses a row id the gateway would not parse", async () => {
      await expect(
        api.getAdminRow({ service: "admin", table: "admin_audit_log", id: "audit-001" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("marks at least one column sensitive, so masking is reachable without a gateway", async () => {
      const catalog = await api.getAdminCatalog();
      const sensitive = catalog.services
        .flatMap((service) => service.tables)
        .flatMap((table) => table.columns)
        .filter((column) => column.sensitive);

      expect(sensitive.length).toBeGreaterThan(0);
    });

    it("answers an unknown service and an unserved table the way the gateway does", async () => {
      // An unknown service key is a rejected argument there, not a missing
      // resource: the gateway resolves the key before it looks for anything and
      // answers `400 INVALID_ARGUMENT` with this exact sentence (measured
      // 2026-08-25). A table it will not serve is a refusal rather than an
      // absence. The mock is the reference implementation and should not teach
      // the wrong shape to whoever reads it next.
      //
      // The wording is load-bearing beyond this test: the Events section tells
      // "the gateway has not deployed the summary yet" from a real failure by
      // this sentence and this code together.
      await expect(api.listAdminRows({ service: "no_such_service", table: "users" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Unknown service: no_such_service",
      });
      await expect(api.listAdminRows({ service: "auth", table: "no_such_table" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
    });

    it("matches case the way the gateway does: exactly, except for contains", async () => {
      // The gateway's `contains` is ILIKE and its equality is not. A mock that
      // lowercased both accepted `global_admin`, so a filter that passed every
      // test found nothing against a real database.
      const exact = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "global_role", operator: "equals", value: "global_admin" }],
      });
      expect(exact.rows).toHaveLength(0);

      const insensitive = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "email", operator: "contains", value: "ANNA@" }],
      });
      expect(insensitive.rows).toHaveLength(1);
    });

    it("pages, and reports the totals the pager is drawn from", async () => {
      const first = await api.listAdminRows({ service: "admin", table: "admin_audit_log", page: 1, pageSize: 20 });

      expect(first.rows).toHaveLength(20);
      expect(first.pagination.totalRows).toBeGreaterThan(20);
      expect(first.pagination.hasPrev).toBe(false);
      expect(first.pagination.hasNext).toBe(true);

      const last = await api.listAdminRows({
        service: "admin",
        table: "admin_audit_log",
        page: first.pagination.totalPages,
        pageSize: 20,
      });

      expect(last.pagination.hasNext).toBe(false);
      expect(last.rows[0]).not.toEqual(first.rows[0]);
    });

    it("sorts both ways", async () => {
      const query = { service: "admin" as const, table: "admin_audit_log", sort: "id", pageSize: 100 };
      const asc = await api.listAdminRows({ ...query, order: "asc" });
      const desc = await api.listAdminRows({ ...query, order: "desc" });

      expect(asc.rows[0]).not.toEqual(desc.rows[0]);
      expect(asc.rows[0]).toEqual(desc.rows[desc.rows.length - 1]);
    });

    /**
     * The gateway compares a `from`/`to` range typed — `BigDecimal` for a
     * numeric column, `OffsetDateTime` for a temporal one — and the mock is
     * both the reference implementation and what the e2e suite runs against
     * (AGENTS.md: the two implementations stay behaviourally
     * interchangeable). Comparing as text is not a mock detail: it answers a
     * different set of rows than the wire does.
     */
    it("compares a numeric range as numbers, not as text", async () => {
      const from = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        filters: [{ column: "failed_logins", operator: "from", value: "10" }],
      });

      // As text, "5" >= "10" — so the row with 5 came back from a filter that
      // asked for 10 and up. The list runs to 40 since TAS-186 seeded a sixth
      // and seventh account, TAS-188 an eighth and TAS-297 a ninth
      // (`failed_logins` is `index * 5`), which is what makes the two-digit
      // half of this assertion several values rather than one.
      expect(from.rows.map((row) => row.failed_logins)).toEqual([10, 15, 20, 25, 30, 35, 40]);

      const to = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        filters: [{ column: "failed_logins", operator: "to", value: "10" }],
      });

      expect(to.rows.map((row) => row.failed_logins)).toEqual([0, 5, 10]);
    });

    it("compares a temporal range as instants, not as text", async () => {
      // The same moment, spelled with the milliseconds the picker used to emit.
      // As text `"…10:00:00Z" <= "…10:00:00.000Z"` is false, so the boundary row
      // the gateway keeps was the one row the mock dropped.
      // The oldest of the audit table's thirty rows is stamped without them.
      const to = await api.listAdminRows({
        service: "admin",
        table: "admin_audit_log",
        pageSize: 100,
        filters: [{ column: "created_at", operator: "to", value: "2026-09-19T03:40:00.000Z" }],
      });

      expect(to.rows).toHaveLength(1);
      expect(to.rows[0].created_at).toBe("2026-09-19T03:40:00Z");

      const from = await api.listAdminRows({
        service: "admin",
        table: "admin_audit_log",
        pageSize: 100,
        filters: [{ column: "created_at", operator: "from", value: "2026-09-19T03:40:00.000Z" }],
      });

      // The boundary belongs to both halves, and nothing else is missing from
      // this one: all thirty rows, one of which is the boundary.
      expect(from.rows).toHaveLength(30);
    });

    it("sorts a numeric column as numbers, not as locale-collated text", async () => {
      const asc = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        sort: "failed_logins",
        order: "asc",
      });

      // `localeCompare` put 10 before 5 here, and did it differently depending
      // on the machine's locale.
      expect(asc.rows.map((row) => row.failed_logins)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40]);

      const desc = await api.listAdminRows({
        service: "auth",
        table: "users",
        pageSize: 100,
        sort: "failed_logins",
        order: "desc",
      });

      expect(desc.rows.map((row) => row.failed_logins)).toEqual([40, 35, 30, 25, 20, 15, 10, 5, 0]);
    });

    /**
     * A `uuid` column is its own class since backend PR #184 (TAS-232): an
     * `equals` value is parsed as a `java.util.UUID`, so the case of its hex
     * digits does not matter and anything but the canonical 8-4-4-4-12 form is
     * a 400 — `UUID.fromString` alone would take `1-1-1-1-1`, and the gateway
     * checks the round trip to refuse it.
     */
    it("matches a uuid column case-insensitively, and refuses a value that is not a canonical UUID", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users" });
      const id = String(rows[0].id);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      for (const value of [id, id.toUpperCase()]) {
        const match = await api.listAdminRows({
          service: "auth",
          table: "users",
          filters: [{ column: "id", operator: "equals", value }],
        });
        expect(match.rows.map((row) => row.id)).toEqual([id]);
      }

      for (const value of ["1-1-1-1-1", id.replaceAll("-", ""), ` ${id}`, "not-a-uuid"]) {
        await expect(
          api.listAdminRows({ service: "auth", table: "users", filters: [{ column: "id", operator: "equals", value }] }),
        ).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "Invalid UUID value for column 'id': expected UUID in 8-4-4-4-12 format",
        });
      }
    });

    /**
     * The gateway validates in passes, not filter by filter (backend PR #184,
     * `buildSafePageableListQueries`): every filter's operator against its
     * column's class first, then the values, column by column in name order.
     * So a bad pairing is reported over a bad uuid however the two were
     * applied — a mock that refused in application order named the uuid.
     */
    it("reports a bad pairing over a bad uuid, whichever filter comes first, as the gateway's passes do", async () => {
      await expect(
        api.listAdminRows({
          service: "auth",
          table: "users",
          filters: [
            { column: "id", operator: "equals", value: "not-a-uuid" },
            { column: "email", operator: "from", value: "anna@" },
          ],
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message:
          "Operator 'from' is not supported for column 'email' (type: TEXT). Only temporal and numeric columns support range filters",
      });
    });

    it("parses uuid values in column-name order, not in the order the filters were applied", async () => {
      // `user_id` applied first, `id` second: the gateway sorts its filter map
      // by column before it parses, so `id` is the one it names.
      await expect(
        api.listAdminRows({
          service: "auth",
          table: "sessions",
          filters: [
            { column: "user_id", operator: "equals", value: "1-1-1-1-1" },
            { column: "id", operator: "equals", value: "not-a-uuid" },
          ],
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Invalid UUID value for column 'id': expected UUID in 8-4-4-4-12 format",
      });
    });

    it("refuses contains, from and to on a uuid column in the gateway's words, naming the UUID class", async () => {
      const refusal = (operator: "contains" | "from" | "to") =>
        api.listAdminRows({
          service: "auth",
          table: "users",
          filters: [{ column: "id", operator, value: "6d774efa" }],
        });

      await expect(refusal("contains")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Operator 'contains' is not supported for column 'id' (type: UUID)",
      });
      for (const operator of ["from", "to"] as const) {
        await expect(refusal(operator)).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: `Operator '${operator}' is not supported for column 'id' (type: UUID). Only temporal and numeric columns support range filters`,
        });
      }
    });

    it("applies each filter operator", async () => {
      const contains = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "email", operator: "contains", value: "anna@" }],
      });
      expect(contains.rows).toHaveLength(1);

      const equals = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "global_role", operator: "equals", value: "GLOBAL_ADMIN" }],
      });
      expect(equals.rows).toHaveLength(1);

      const none = await api.listAdminRows({
        service: "auth",
        table: "users",
        filters: [{ column: "email", operator: "contains", value: "nobody-here" }],
      });
      // An empty result is a real answer, not an error.
      expect(none.rows).toHaveLength(0);
      expect(none.pagination.totalRows).toBe(0);
    });
  });

  /**
   * `GET /readonly/audit-entries` as backend PR #197 (TAS-160) answers it,
   * merged and deployed 2026-10-19 (TAS-251, TAS-265): paged and sorted by the
   * server, an id on every entry, and refusals in the server's own words.
   */
  describe("the audit log", () => {
    beforeEach(async () => {
      await api.login({ email: "mark@example.com", password: "anything" });
    });

    it("answers newest first, twenty to a page by default, with 1-based pagination", async () => {
      const first = await api.listAuditEntries({});
      expect(first.entries).toHaveLength(20);
      expect(first.pagination).toMatchObject({ currentPage: 1, pageSize: 20, totalRows: 30, totalPages: 2, hasNext: true, hasPrev: false });
      const times = first.entries.map((entry) => Date.parse(entry.createdAt!));
      expect([...times].sort((a, b) => b - a)).toEqual(times);

      const second = await api.listAuditEntries({ page: 2 });
      expect(second.entries).toHaveLength(10);
      expect(second.pagination).toMatchObject({ currentPage: 2, hasNext: false, hasPrev: true });
    });

    it("gives every entry an id of its own, which a filtered read hands back unchanged", async () => {
      const { entries } = await api.listAuditEntries({ pageSize: 100 });
      const ids = entries.map((entry) => entry.id);
      expect(ids.every((id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))).toBe(true);
      expect(new Set(ids).size).toBe(entries.length);

      // The id is the row's, not the page's: the same entry read through a
      // filter carries the same one.
      const target = entries[7];
      const narrowed = await api.listAuditEntries({ requestId: target.requestId ?? undefined, action: target.action! });
      expect(narrowed.entries.find((entry) => entry.createdAt === target.createdAt)?.id).toBe(target.id);
    });

    it("refuses a pageSize outside 1–100 with the gateway's 400, as the stand does, and reads a page below 1 as the first", async () => {
      // Probed tokenless 2026-10-19: 101 and 0 are refused at the edge before
      // authentication; admin-service's own fallback and clamp are never reached.
      const binding = { code: "INVALID_ARGUMENT", message: "Invalid request parameters" };
      await expect(api.listAuditEntries({ pageSize: 101 })).rejects.toMatchObject(binding);
      await expect(api.listAuditEntries({ pageSize: 0 })).rejects.toMatchObject(binding);
      await expect(api.listAuditEntries({ pageSize: 20.5 })).rejects.toMatchObject(binding);
      await expect(api.listAuditEntries({ page: 1.5 })).rejects.toMatchObject(binding);
      // The wire's page is this one less one, and `int32`: 2147483647 binds,
      // 2147483648 does not (probed 2026-10-19).
      await expect(api.listAuditEntries({ page: 2147483649 })).rejects.toMatchObject(binding);
      expect((await api.listAuditEntries({ page: 2147483648 })).entries).toEqual([]);
      expect((await api.listAuditEntries({ pageSize: 100 })).pagination.pageSize).toBe(100);
      expect((await api.listAuditEntries({ pageSize: 1 })).entries).toHaveLength(1);
      // The rest leg sends `max(0, page - 1)`, so a domain page below 1 is the
      // wire's page 0 there; it is the first page here too.
      expect((await api.listAuditEntries({ page: 0 })).pagination.currentPage).toBe(1);
      expect((await api.listAuditEntries({ page: -3 })).pagination.currentPage).toBe(1);
    });

    it("carries null documents, a null request id and masked values, as the log does", async () => {
      const { entries } = await api.listAuditEntries({ pageSize: 100 });
      expect(entries.some((entry) => entry.oldValue === null)).toBe(true);
      expect(entries.some((entry) => entry.newValue === null)).toBe(true);
      expect(entries.some((entry) => entry.requestId === null)).toBe(true);
      expect(entries.some((entry) => entry.newValue?.includes('"***"'))).toBe(true);
    });

    it("keeps the actor in the stand's two shapes since backend PR #219: name and email, or the old login alone", async () => {
      const { entries } = await api.listAuditEntries({});
      // Every row on the first page has a name — the column is NOT NULL and
      // admin-service refuses a blank one — and both shapes are there.
      expect(entries.every((entry) => typeof entry.actorDisplayName === "string" && entry.actorDisplayName !== "")).toBe(true);
      const current = entries.filter((entry) => entry.actorEmail !== null);
      const historical = entries.filter((entry) => entry.actorEmail === null);
      expect(current.length).toBeGreaterThan(0);
      expect(historical.length).toBeGreaterThan(0);
      expect(current.every((entry) => entry.actorDisplayName === "Mark Lee" && entry.actorEmail === "mark@example.com")).toBe(
        true,
      );
      // Newest first, and the rename is a moment: every row since it is newer
      // than every row before it.
      expect(entries.findIndex((entry) => entry.actorEmail === null)).toBe(current.length);
      expect(new Set(historical.map((entry) => entry.actorDisplayName))).toEqual(new Set(["mark", "vera", "migrator"]));

      // One account under two labels: the same id as "Mark Lee" and as "mark".
      const labels = new Set(
        entries.filter((entry) => entry.actorUserId === current[0].actorUserId).map((entry) => entry.actorDisplayName),
      );
      expect(labels).toEqual(new Set(["Mark Lee", "mark"]));

      // The raw table says the same, column for column.
      const { rows } = await api.listAdminRows({ service: "admin", table: "admin_audit_log", pageSize: 100 });
      const all = (await api.listAuditEntries({ pageSize: 100 })).entries;
      for (const entry of all) {
        const row = rows.find((item) => item.id === entry.id)!;
        expect([row.actor_display_name, row.actor_email]).toEqual([entry.actorDisplayName, entry.actorEmail]);
        expect(row).not.toHaveProperty("actor_login");
      }
    });

    it("matches every filter exactly, and takes a blank one as no filter", async () => {
      const blocks = await api.listAuditEntries({ action: "BLOCK_USER", pageSize: 100 });
      expect(blocks.entries.length).toBeGreaterThan(0);
      expect(blocks.entries.every((entry) => entry.action === "BLOCK_USER")).toBe(true);
      expect((await api.listAuditEntries({ action: "BLOCK" })).entries).toEqual([]);
      expect((await api.listAuditEntries({ action: "  " })).pagination.totalRows).toBe(30);

      const target = blocks.entries[0];
      const narrowed = await api.listAuditEntries({
        actorUserId: target.actorUserId!,
        targetService: target.targetService!,
        targetTable: target.targetTable!,
        targetId: target.targetId!,
        pageSize: 100,
      });
      expect(narrowed.entries).toContainEqual(target);
    });

    it("bounds by whole UTC days with both ends inclusive", async () => {
      const { entries } = await api.listAuditEntries({ pageSize: 100 });
      const day = entries[3].createdAt!.slice(0, 10);
      const sameDay = entries.filter((entry) => entry.createdAt!.startsWith(day));
      const answer = await api.listAuditEntries({ createdAtFrom: day, createdAtTo: day, pageSize: 100 });
      expect(answer.entries).toEqual(sameDay);
    });

    it("refuses a date in any other spelling and a non-UUID actor with the gateway's own 400", async () => {
      // The gateway's parameter binding, in its one fixed sentence: it names
      // neither the parameter nor the rule.
      const binding = { code: "INVALID_ARGUMENT", message: "Invalid request parameters" };
      await expect(api.listAuditEntries({ createdAtFrom: "2026-10-01T00:00:00Z" })).rejects.toMatchObject(binding);
      await expect(api.listAuditEntries({ createdAtTo: "2026-02-30" })).rejects.toMatchObject(binding);
      await expect(api.listAuditEntries({ actorUserId: "mark" })).rejects.toMatchObject(binding);
    });

    it("refuses a from after to in admin-service's words", async () => {
      await expect(api.listAuditEntries({ createdAtFrom: "2026-10-02", createdAtTo: "2026-10-01" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "body.createdAtFrom cannot be later than body.createdAtTo",
      });
    });

    it("refuses anyone but a GLOBAL_ADMIN with 403 — after the binding, before the dates are compared", async () => {
      await api.login({ email: "anna@example.com", password: "anything" });
      const denied = { code: "PERMISSION_DENIED", message: "User doesn't have permission" };
      await expect(api.listAuditEntries({})).rejects.toMatchObject(denied);
      // The binding answers before authentication is even read…
      await expect(api.listAuditEntries({ actorUserId: "mark" })).rejects.toMatchObject({
        message: "Invalid request parameters",
      });
      await expect(api.listAuditEntries({ pageSize: 101 })).rejects.toMatchObject({
        message: "Invalid request parameters",
      });
      // …and the dates' order is admin-service's question, which a non-admin
      // never reaches.
      await expect(api.listAuditEntries({ createdAtFrom: "2026-10-02", createdAtTo: "2026-10-01" })).rejects.toMatchObject(
        denied,
      );
    });
  });

  /**
   * The Events section (TAS-167). The summary endpoint is deployed — backend
   * PR #141 (TAS-105) merged 2026-08-27 — and this is the reference
   * implementation of it: derived from the very rows the Outbox journal reads,
   * so the two views of the section can never disagree. That derivation is what
   * these tests are about.
   */
  describe("problematic outbox summary", () => {
    it("gives exactly auth, project and issue an outbox_events table", async () => {
      const catalog = await api.getAdminCatalog();
      const withOutbox = catalog.services
        .filter((service) => service.tables.some((table) => table.name === "outbox_events"))
        .map((service) => service.name);

      // The Events service selector is built from this and nothing else, so a
      // seed where every service had one would make that filter untestable.
      expect(withOutbox).toEqual(["auth", "project", "issue"]);
    });

    it("counts what the journal's own rows say, service by service", async () => {
      const summary = await api.getProblematicOutboxSummary();

      for (const count of summary.counts) {
        const { rows } = await api.listAdminRows({
          service: count.serviceKey,
          table: "outbox_events",
          pageSize: 500,
        });
        const failed = rows.filter((row) => row.status === "FAILED");
        // The two other categories are thresholds rather than states, so the
        // strong claim here is FAILED — and that every counted row is real.
        expect(count.failedCount).toBe(failed.length);
        const problematic = count.failedCount + count.stuckProcessingCount + count.overdueNewCount;
        expect(problematic).toBeLessThanOrEqual(rows.length);
        expect(problematic).toBeGreaterThan(0);
      }
    });

    it("does not count a row that has not been waiting long enough", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const { rows } = await api.listAdminRows({ service: "issue", table: "outbox_events", pageSize: 500 });
      const issue = summary.counts.find((count) => count.serviceKey === "issue")!;

      // The seed carries a NEW and a PROCESSING row a couple of minutes old.
      // Without them nothing would prove the summary applies a threshold rather
      // than counting states.
      expect(rows.filter((row) => row.status === "NEW").length).toBeGreaterThan(issue.overdueNewCount);
      expect(rows.filter((row) => row.status === "PROCESSING").length).toBeGreaterThan(issue.stuckProcessingCount);
    });

    it("lists the oldest first and says when it had to stop", async () => {
      const summary = await api.getProblematicOutboxSummary();

      const times = summary.events.map((event) => new Date(event.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));

      const total = summary.counts.reduce(
        (sum, count) => sum + count.failedCount + count.stuckProcessingCount + count.overdueNewCount,
        0,
      );
      // The list is capped and the counts are not, which is the whole reason
      // `notAllShown` exists: the matrix still covers what was cut.
      expect(summary.events.length).toBeLessThan(total);
      expect(summary.notAllShown).toBe(true);
    });

    /**
     * `retryable` (backend PR #195, TAS-200), computed with the rule the retry
     * command applies: `FAILED`, or `PROCESSING` started more than the retry
     * threshold (10m) ago. The seeded row in the gap — listed as stuck after
     * the summary's shorter timeout, not yet past the retry threshold — is the
     * one that tells this apart from a status rule.
     */
    it("marks each event retryable by the retry command's own rule, the gap row false", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const tenMinutesAgo = Date.now() - 10 * 60_000;

      for (const event of summary.events) {
        const expected =
          event.status === "FAILED" ||
          (event.status === "PROCESSING" &&
            event.processingStartedAt !== null &&
            Date.parse(event.processingStartedAt) < tenMinutesAgo);
        expect(event.retryable, `${event.serviceKey} ${event.id} ${event.status}`).toBe(expected);
      }

      const gap = summary.events.filter((event) => event.status === "PROCESSING" && !event.retryable);
      expect(gap, "the seed lost its row between the two thresholds").toHaveLength(1);
      expect(gap[0].serviceKey).toBe("project");
      // Listed for a reason, and still refused by the command if asked by hand.
      await expect(api.retryOutboxEvent("project", gap[0].id, "Looks stuck")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
      });
      expect(summary.events.some((event) => event.status === "NEW" && event.retryable)).toBe(false);
    });

    it("gives each event the backend's own sentence for why it is here", async () => {
      const summary = await api.getProblematicOutboxSummary();

      for (const event of summary.events) {
        // Prose, not an enum — the UI derives the category from `status` and
        // never parses these. They are seeded word for word so that what the
        // card shows in mock mode is what it will show against the gateway.
        expect(event.reason).toBe(
          event.status === "FAILED"
            ? "Event processing failed"
            : event.status === "PROCESSING"
              ? "Event stuck in PROCESSING state (exceeded processing timeout)"
              : "Event stuck in NEW state (not picked up for processing)",
        );
      }
      // All three sentences are reachable from one read of the seed, or the
      // card's own rendering would only ever be seen with one of them.
      expect(new Set(summary.events.map((event) => event.status))).toEqual(new Set(["FAILED", "PROCESSING", "NEW"]));
    });

    it("names every listed event with a row the journal can open", async () => {
      const summary = await api.getProblematicOutboxSummary();

      for (const event of summary.events) {
        // The summary's row link goes straight to `GET /{service}/{table}/{id}`,
        // so an id the journal cannot resolve would be a link to a 404.
        await expect(
          api.getAdminRow({ service: event.serviceKey, table: "outbox_events", id: event.id }),
        ).resolves.toMatchObject({ id: event.id, status: event.status });
      }
    });

    it("seeds payloads that are all documents, which is all a jsonb column can hold", async () => {
      const { rows } = await api.listAdminRows({ service: "issue", table: "outbox_events", pageSize: 500 });
      const payloads = rows.map((row) => String(row.payload));

      // This used to assert the opposite for one row. The seed carried a
      // `JsonByteArrayInput{…}` payload, because admin-service served every
      // jsonb column through a wrapper's toString and what arrived was not JSON.
      // Backend PR #141 (TAS-105) fixed that, and the probe that closes the
      // divergence entry was taken on 2026-09-08: 20 live `issue.outbox_events`
      // rows, every payload clean JSON, no `JsonByteArrayInput` in the response.
      // So the mock stopped modelling a wire format the gateway cannot produce.
      // The card's rule did not change and is not a compensation — a payload
      // that does not parse is still printed verbatim, and that branch is tested
      // where it lives, in src/screens/admin/columns.test.ts.
      expect(payloads.length).toBeGreaterThan(0);
      for (const payload of payloads) {
        expect(() => JSON.parse(payload) as unknown).not.toThrow();
      }
    });

    it("seeds a payload whose values arrived masked", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "outbox_events", pageSize: 500 });

      // admin-service masks fields *inside* the document, so a masked payload is
      // still valid JSON — which is what makes it fall out of the card's one
      // rule with no special case.
      const masked = rows.find((row) => String(row.payload).includes("****"));
      expect(masked).toBeDefined();
      expect(() => JSON.parse(String(masked!.payload)) as unknown).not.toThrow();
    });
  });

  /**
   * Retrying a stuck outbox event (TAS-194) —
   * `POST /admin/outbox/{service}/{eventId}/retry`, backend TAS-106.
   *
   * Every rule below is admin-service's own, read out of `OutboxRetryServiceImpl`
   * and `OutboxRetryRepositoryImpl` on `develop` at 2026-09-08. The contract
   * states none of them: it declares `400/401/403/404` and a response of
   * `{eventId, status, attempts}`, and everything about *which* events may be
   * retried and *what changes* lives in the service. The mock is where those
   * rules are demonstrable without a broken queue on a real stand.
   */
  describe("retrying an outbox event", () => {
    const failedEvent = async () => {
      const summary = await api.getProblematicOutboxSummary();
      const event = summary.events.find((candidate) => candidate.status === "FAILED");
      expect(event).toBeDefined();
      return event!;
    };

    it("puts a failed event back into NEW and clears the error it stopped on", async () => {
      const event = await failedEvent();
      expect(event.serviceKey === "auth" || event.serviceKey === "project" || event.serviceKey === "issue").toBe(true);

      const result = await api.retryOutboxEvent(
        event.serviceKey as "auth" | "project" | "issue",
        event.id,
        "Kafka is back",
      );

      expect(result).toEqual({ eventId: event.id, status: "NEW", attempts: event.attempts });
      // The journal reads the same rows, so the change has to be visible there
      // too — the two views of this section are one store.
      const row = await api.getAdminRow({ service: event.serviceKey, table: "outbox_events", id: event.id });
      expect(row.status).toBe("NEW");
      expect(row.last_error_message).toBeNull();
      expect(row.processing_started_at).toBeNull();
    });

    /**
     * The single most assumable thing about this endpoint, and it is false:
     * `attempts` is absent from the backend's `UPDATE`, so the count survives
     * the retry. A mock that reset it would teach the opposite of the server.
     */
    it("does not reset the attempt count", async () => {
      const event = await failedEvent();
      expect(event.attempts).toBeGreaterThan(0);

      const result = await api.retryOutboxEvent(event.serviceKey as "auth", event.id, "Retry after incident");

      expect(result.attempts).toBe(event.attempts);
      const row = await api.getAdminRow({ service: event.serviceKey, table: "outbox_events", id: event.id });
      expect(row.attempts).toBe(event.attempts);
    });

    /**
     * The refusal an operator meets without having done anything wrong. `NEW` is
     * where retry *puts* an event, so retrying one is `FAILED_PRECONDITION` —
     * which reaches the dialog's "conflict" sentence through `isConflict`'s code
     * arm, since on the wire it is a 400.
     */
    it("refuses an overdue NEW event, with the server's own sentence", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const overdue = summary.events.find((candidate) => candidate.status === "NEW");
      expect(overdue).toBeDefined();

      await expect(
        api.retryOutboxEvent(overdue!.serviceKey as "auth", overdue!.id, "Please go"),
      ).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Outbox event with status NEW is not eligible for retry",
      });
    });

    /**
     * The divergence this whole feature has to be honest about, reachable here
     * because the seed puts a row in the gap on purpose. admin-service calls a
     * `PROCESSING` row stuck after the producing service's timeout (5m) and
     * retryable only after its own, longer one (10m), so between the two the
     * summary lists an event that the retry route refuses — and no client can
     * predict which, since both numbers are server configuration
     * (docs/ai/API-DIVERGENCE.md).
     */
    it("lists a briefly stuck PROCESSING event and still refuses to retry it", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const briefly = summary.events.find(
        (event) => event.status === "PROCESSING" && event.serviceKey === "project",
      );
      // Listed: the summary's own threshold has passed.
      expect(briefly).toBeDefined();
      expect(briefly!.reason).toContain("PROCESSING");

      // And refused: the retry route's has not.
      await expect(api.retryOutboxEvent("project", briefly!.id, "It looks stuck")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Outbox event with status PROCESSING is not eligible for retry",
      });
    });

    it("retries a PROCESSING event that has been stuck long enough", async () => {
      const summary = await api.getProblematicOutboxSummary();
      const longStuck = summary.events.find(
        (event) => event.status === "PROCESSING" && event.serviceKey === "issue",
      );
      expect(longStuck).toBeDefined();

      await expect(api.retryOutboxEvent("issue", longStuck!.id, "Consumer restarted")).resolves.toMatchObject({
        status: "NEW",
      });
    });

    it("refuses a published event, which is not in the summary at all", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "outbox_events", pageSize: 500 });
      const published = rows.find((row) => row.status === "PUBLISHED");
      expect(published).toBeDefined();

      await expect(api.retryOutboxEvent("auth", String(published!.id), "Send it again")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
      });
    });

    it("answers NOT_FOUND for an event this service does not have", async () => {
      // A real uuid that is simply not in this outbox — and specifically not the
      // INVALID_ARGUMENT below, which is what a malformed one gets.
      await expect(
        api.retryOutboxEvent("auth", "00000000-0000-4000-8000-000000000000", "Nothing there"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("refuses an id the gateway's path could not carry", async () => {
      // `eventId` is `format: uuid` in the contract, so a non-uuid is rejected
      // before admin-service is reached — the same wall `adminRow` puts up.
      await expect(api.retryOutboxEvent("auth", "not-a-uuid", "Try it")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
    });

    /**
     * A blank reason against an event nobody has is a 400, not a 404: the reason
     * is checked before the event is looked up, and the obvious implementation
     * has it the other way round.
     *
     * Not because "Spring validates `@Valid @RequestBody` before the controller
     * method runs" — the gateway's controller takes the body as a `Mono` and
     * subscribes it after the admin check (`MockTaskaApi.retryOutboxEvent`
     * records the measurement). This pins the mock's own order, which is the
     * thing the two API modes are compared on.
     */
    it("checks the reason before the event, and refuses a blank one", async () => {
      await expect(
        api.retryOutboxEvent("auth", "00000000-0000-4000-8000-000000000000", "   "),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "A reason is required" });
    });

    /**
     * 1000, not the user writes' 550. Two contract limits, two guards — the
     * point of this case is that the *number* is this route's own, so a build
     * that folded the two families into one would fail here at 551.
     */
    it("takes a reason up to 1000 characters and refuses 1001", async () => {
      const event = await failedEvent();

      await expect(
        api.retryOutboxEvent(event.serviceKey as "auth", event.id, "x".repeat(1001)),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "A reason is at most 1000 characters" });
      // 551 would be refused by the admin *user* writes and must not be here.
      await expect(api.retryOutboxEvent(event.serviceKey as "auth", event.id, "x".repeat(1000))).resolves.toMatchObject(
        { status: "NEW" },
      );
    });
  });

  /**
   * Blocking and unblocking an account (TAS-186). Every rule below is the
   * backend's own, read out of `AdminUserManagementServiceImpl` — on the TAS-107
   * branch when these were written, on `develop` since backend PR #146 merged.
   *
   * The routes are deployed now, and that does not make this less load-bearing:
   * these refusals cannot be produced against the live gateway without blocking
   * a real account, so the mock stays the implementation that demonstrates them,
   * and it has to answer exactly what the gateway does
   * (docs/ai/API-DIVERGENCE.md).
   */
  /**
   * Accepting an invitation (backend #204): `AuthServiceImpl.setPasswordByToken`'s
   * checks in its order and its words, the one 401 for every dead link, and
   * a link spent only by a success. Leo's seeded link works; Ivy's expired.
   */
  describe("accepting an invitation", () => {
    const accept = (token: string, newPassword = "Correct-horse-1") => api.acceptInvitation({ token, newPassword });
    const statusOf = async (email: string) =>
      (await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 })).rows.find((row) => row.email === email)
        ?.status;

    it("refuses a blank token or password in the gRPC transport's words, the token first, before the service", async () => {
      // `GrpcRequestValidators.requireNonBlank` in auth-service's transport,
      // ahead of `AuthServiceImpl`: the stand never says "Token required" or
      // "Password is required" on this route (TAS-299).
      await expect(accept("  ", "")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "body.token must not be blank",
      });
      await expect(accept(MOCK_INVITE_TOKENS.leo, "")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "body.newPassword must not be blank",
      });
      await expect(accept(MOCK_INVITE_TOKENS.leo, "   ")).rejects.toMatchObject({
        message: "body.newPassword must not be blank",
      });
      // Spent by neither.
      await expect(accept(MOCK_INVITE_TOKENS.leo)).resolves.toBeUndefined();
    });

    it("refuses in the server's order: the password, then the token's length", async () => {
      await expect(accept("x".repeat(300), "weak")).rejects.toMatchObject({
        message: "Password must be at least 8 characters and not exceed 128 characters",
      });
      await expect(accept("x".repeat(300))).rejects.toMatchObject({ message: "Invite token is too long" });
    });

    it.each([
      ["Sh0rt!", "Password must be at least 8 characters and not exceed 128 characters"],
      [`Aa1!${"ж".repeat(40)}`, "Password exceeds the BCrypt limit of 72 UTF-8 bytes"],
      ["lowercase1!", "Password must have at least 1 upper character"],
      ["NoDigitsHere!", "Password must have at least 1 digit character"],
      ["NoSymbol123", "Password must have at least 1 special character"],
    ])("refuses %j with the policy's own sentence, and the link survives it", async (password, message) => {
      await expect(accept(MOCK_INVITE_TOKENS.leo, password)).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message });
      await expect(accept(MOCK_INVITE_TOKENS.leo)).resolves.toBeUndefined();
    });

    it("activates the account once: the link is single-use, and every dead link is the same 401", async () => {
      await accept(MOCK_INVITE_TOKENS.leo);
      expect(await statusOf("leo@example.com")).toBe("ACTIVE");

      const dead = { code: "UNAUTHENTICATED", message: "Invalid or expired token" };
      await expect(accept(MOCK_INVITE_TOKENS.leo)).rejects.toMatchObject(dead);
      await expect(accept(MOCK_INVITE_TOKENS.ivy)).rejects.toMatchObject(dead);
      await expect(accept("nobody-holds-this-token")).rejects.toMatchObject(dead);
      expect(await statusOf("ivy@example.com")).toBe("INVITED");
    });

    it("lets the activated account sign in, and leaves whoever was signed in alone", async () => {
      await api.login({ email: "anna@example.com", password: "x" });
      await accept(MOCK_INVITE_TOKENS.leo);
      await expect(api.getCurrentUser()).resolves.toMatchObject({ email: "anna@example.com" });

      await api.logout();
      await expect(api.login({ email: "leo@example.com", password: "x" })).resolves.toBeDefined();
    });

    it("refuses a link a newer invitation replaced", async () => {
      await api.login({ email: "mark@example.com", password: "x" });
      await expect(api.inviteUser({ email: "leo@example.com", resend: true })).resolves.toMatchObject({
        deliveryQueued: true,
      });

      await expect(accept(MOCK_INVITE_TOKENS.leo)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    });
  });

  /**
   * The people directory (backend #204): the gateway's binding first, before
   * sign-in, then auth-service's own measure of the trimmed query; then
   * `searchDirectory`'s set, order and page.
   */
  describe("people search", () => {
    it("refuses a raw query out of range at the gateway, and a trimmed one in auth-service's words", async () => {
      for (const params of [
        { query: "ab" },
        { query: "x".repeat(101) },
        { query: "anna", page: -1 },
        { query: "anna", page: 1001 },
        { query: "anna", pageSize: 0 },
        { query: "anna", pageSize: 51 },
      ]) {
        await expect(api.searchUsers(params)).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "Invalid request parameters",
        });
      }
      // Three characters on the wire, two once trimmed: the second refusal.
      await expect(api.searchUsers({ query: " ab " })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: DIRECTORY_QUERY_REFUSAL_MESSAGE,
      });
    });

    it("matches name or email case-insensitively, leaves BLOCKED out, and keeps INVITED and LOCKED in", async () => {
      const page = await api.searchUsers({ query: "EXAMPLE.COM" });
      const emails = page.items.map((person) => person.email);

      expect(emails).toContain("leo@example.com");
      expect(emails).toContain("omar@example.com");
      expect(emails).not.toContain("nina@example.com");
      await expect(api.searchUsers({ query: "fisch" })).resolves.toMatchObject({
        items: [{ email: "leo@example.com", displayName: "Leo Fischer" }],
        hasMore: false,
      });
      // Exactly the four wire fields, and no status or role.
      expect(Object.keys(page.items[0]).sort()).toEqual(["avatarUrl", "displayName", "email", "id"]);
    });

    it("orders by lower(displayName), lower(email), then id, and pages with hasMore from one extra row", async () => {
      const first = await api.searchUsers({ query: "example", pageSize: 3 });
      const second = await api.searchUsers({ query: "example", page: 1, pageSize: 3 });
      const all = await api.searchUsers({ query: "example", pageSize: 50 });

      expect(all.items.map((person) => person.displayName)).toEqual(
        [...all.items.map((person) => person.displayName)].sort((a, b) =>
          a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
        ),
      );
      expect(first.hasMore).toBe(true);
      expect([...first.items, ...second.items]).toEqual(all.items.slice(0, 6));
      const last = await api.searchUsers({ query: "example", page: 2, pageSize: 3 });
      expect(last.hasMore).toBe(all.items.length > 9);
    });

    it("carries an avatar link for a person with a picture and null for one without", async () => {
      const sofia = (await api.searchUsers({ query: "sofia" })).items[0];
      const tom = (await api.searchUsers({ query: "tom@" })).items[0];

      expect(sofia.avatarUrl).toEqual(expect.any(String));
      expect(tom.avatarUrl).toBeNull();
    });
  });

  /**
   * Inviting (backend #204), as `AdminInviteUserServiceImpl` answers: by what
   * the address already belongs to, with the 60-second floor between links.
   */
  describe("inviting a user", () => {
    beforeEach(async () => {
      await api.login({ email: "mark@example.com", password: "x" });
    });

    it("refuses anybody who is not a global admin, first", async () => {
      await api.logout();
      await api.login({ email: "anna@example.com", password: "x" });
      await expect(api.inviteUser({ email: "" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        message: "User doesn't have permission",
      });
    });

    it("refuses an address or a name the server cannot take, in its own sentences", async () => {
      for (const email of ["", "   ", "not-an-address", "a@", "@b.c", "two@@at.com"]) {
        await expect(api.inviteUser({ email })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "A valid email address is required (maximum 320 characters)",
        });
      }
      await expect(api.inviteUser({ email: `${"a".repeat(321)}@x.io` })).rejects.toMatchObject({
        message: "Invalid request parameters",
      });
      await expect(api.inviteUser({ email: "new@example.com", displayName: "Bad\u0007name" })).rejects.toMatchObject({
        message: "Display name must contain at most 128 characters and no control characters",
      });
    });

    it("creates an INVITED account for a new address — 201 — named by the local part when no name is given", async () => {
      const result = await api.inviteUser({ email: "  New.Person@Example.com " });

      expect(result).toMatchObject({ created: true, deliveryQueued: true, status: "INVITED" });
      const week = Date.parse(result.expiresAt) - Date.now();
      expect(week).toBeGreaterThan(6.9 * 24 * 3_600_000);
      await expect(api.searchUsers({ query: "new.person" })).resolves.toMatchObject({
        items: [{ id: result.userId, email: "new.person@example.com", displayName: "new.person" }],
      });
    });

    it("answers 200 with nothing sent while the link works, and queues a new one on resend or expiry", async () => {
      await expect(api.inviteUser({ email: "leo@example.com" })).resolves.toMatchObject({
        created: false,
        deliveryQueued: false,
      });
      await expect(api.inviteUser({ email: "ivy@example.com" })).resolves.toMatchObject({
        created: false,
        deliveryQueued: true,
      });
      await expect(api.inviteUser({ email: "leo@example.com", resend: true })).resolves.toMatchObject({
        created: false,
        deliveryQueued: true,
      });
    });

    it("refuses another link within a minute of the last one, with the wait as a string in details", async () => {
      const first = await api.inviteUser({ email: "fresh@example.com" });
      expect(first.created).toBe(true);

      const refusal = await api.inviteUser({ email: "fresh@example.com", resend: true }).catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "RESOURCE_EXHAUSTED", message: "Invitation was sent recently; try again later" });
      const { details } = apiErrorFacts(refusal);
      expect(details?.retryAfterSeconds).toMatch(/^[1-9][0-9]*$/);
      expect(Number(details?.retryAfterSeconds)).toBeLessThanOrEqual(61);
      // Without `resend` the live link is simply reported, not refused.
      await expect(api.inviteUser({ email: "fresh@example.com" })).resolves.toMatchObject({ deliveryQueued: false });
    });

    it.each([["anna@example.com"], ["omar@example.com"], ["nina@example.com"]])(
      "refuses %s — an account that exists — with a 409, and changes nothing",
      async (email) => {
        await expect(api.inviteUser({ email: email.toUpperCase() })).rejects.toMatchObject({
          code: "ALREADY_EXISTS",
          message: "An account with this email already exists",
        });
      },
    );
  });

  describe("admin user block and unblock", () => {
    /** Whoever the seed gave this status, found through the same table the section reads. */
    const findByStatus = async (status: string) => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      const row = rows.find((candidate) => candidate.status === status);
      expect(row, `the seed has nobody with status ${status}`).toBeDefined();
      return String(row!.id);
    };

    it("seeds one account of every status, so the section can be seen whole", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });

      // All four since TAS-188. `LOCKED` is the one nobody in this product puts
      // an account into — it takes failed sign-ins against the real auth-service
      // — so without a seeded row the third action would be unreachable in the
      // only environment a reviewer or an e2e run has.
      expect(new Set(rows.map((row) => row.status))).toEqual(new Set(["ACTIVE", "INVITED", "BLOCKED", "LOCKED"]));
      // And exactly one global admin, which is what makes the last-active-admin
      // refusal reachable by clicking rather than only by unit test.
      expect(rows.filter((row) => row.global_role === "GLOBAL_ADMIN")).toHaveLength(1);
    });

    it("blocks an active account and says what it changed", async () => {
      const id = await findByStatus("ACTIVE");

      await expect(api.blockUser(id, "Left the company")).resolves.toMatchObject({
        userId: id,
        previousStatus: "ACTIVE",
        currentStatus: "BLOCKED",
      });
      // The list is what the section refetches, so the write has to be visible
      // there and not only in the response.
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(rows.find((row) => row.id === id)?.status).toBe("BLOCKED");
    });

    it("blocks an invited account, and unblocking it makes it active rather than invited", async () => {
      const id = await findByStatus("INVITED");

      await expect(api.blockUser(id, "Invitation sent to the wrong address")).resolves.toMatchObject({
        previousStatus: "INVITED",
        currentStatus: "BLOCKED",
      });
      // The backend does not restore the invite state, and the mock must not
      // invent a kinder rule than the server's — the confirmation dialog says
      // this out loud precisely because it is surprising.
      await expect(api.unblockUser(id, "Address corrected")).resolves.toMatchObject({
        previousStatus: "BLOCKED",
        currentStatus: "ACTIVE",
      });
    });

    it("unblocks a blocked account", async () => {
      const id = await findByStatus("BLOCKED");

      await expect(api.unblockUser(id, "Back from leave")).resolves.toMatchObject({
        previousStatus: "BLOCKED",
        currentStatus: "ACTIVE",
      });
    });

    it("refuses a transition the current status does not allow, in the server's words and its code", async () => {
      // `ABORTED`, which the gateway maps to 409 — and deliberately not the
      // code the last-admin refusal below carries. The two are different
      // `DomainStatus` values on the backend and land on different HTTP
      // statuses, so a mock that gave them one code would be the only place
      // they looked alike.
      const blocked = await findByStatus("BLOCKED");
      await expect(api.blockUser(blocked, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot block user with current status: BLOCKED",
      });

      const active = await findByStatus("ACTIVE");
      await expect(api.unblockUser(active, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot unblock user with current status: ACTIVE",
      });

      const invited = await findByStatus("INVITED");
      await expect(api.unblockUser(invited, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot unblock user with current status: INVITED",
      });
    });

    it("resets a lockout, which is the only way out of LOCKED and always lands on ACTIVE", async () => {
      const id = await findByStatus("LOCKED");

      await expect(api.resetCredentialLockout(id, "Called in, identity confirmed")).resolves.toMatchObject({
        userId: id,
        previousStatus: "LOCKED",
        currentStatus: "ACTIVE",
      });
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(rows.find((row) => row.id === id)?.status).toBe("ACTIVE");
    });

    it("refuses a lockout reset on an account that is not locked, with a code the gateway sends as a 400", async () => {
      // FAILED_PRECONDITION, not ABORTED: this refusal wears the shape of the
      // last-active-admin guard rather than of the transition guard, so it
      // reaches the dialog by its code and not by a 409. The sentence is the
      // server's own (`AdminUserManagementServiceImpl.resetCredentialLockout`).
      for (const status of ["ACTIVE", "INVITED", "BLOCKED"]) {
        await expect(api.resetCredentialLockout(await findByStatus(status), "Just in case")).rejects.toMatchObject({
          code: "FAILED_PRECONDITION",
          message: "User is not in LOCKED status",
        });
      }
    });

    it("refuses the two transitions that are not legal from LOCKED either", async () => {
      // The reason `actionFor` maps LOCKED to the reset action rather than to
      // Block: the account is not blocked and cannot be unblocked, and blocking
      // it is refused as a transition.
      const locked = await findByStatus("LOCKED");

      await expect(api.blockUser(locked, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot block user with current status: LOCKED",
      });
      await expect(api.unblockUser(locked, "Again")).rejects.toMatchObject({
        code: "ABORTED",
        message: "Cannot unblock user with current status: LOCKED",
      });
    });

    it("checks a lockout reset's body and its user the way the other two writes do", async () => {
      const locked = await findByStatus("LOCKED");

      await expect(api.resetCredentialLockout(locked, "  ")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "A reason is required",
      });
      await expect(
        api.resetCredentialLockout("0f3d5cb0-0000-0000-0000-000000000000", "Nobody"),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "User not found" });
      await expect(api.resetCredentialLockout("not-a-uuid", "Nobody")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
      });
      // Refused, not partly applied.
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(rows.find((row) => row.id === locked)?.status).toBe("LOCKED");
    });

    it("refuses to block the last active global admin", async () => {
      const { rows } = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      const admin = rows.find((row) => row.global_role === "GLOBAL_ADMIN");

      // FAILED_PRECONDITION, which the gateway maps to **400**: this refusal
      // reaches the dialog by its code and not by a 409.
      await expect(api.blockUser(String(admin!.id), "Testing the guard")).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "Cannot block the last active global admin",
      });
      // Refused, not partly applied.
      const after = await api.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      expect(after.rows.find((row) => row.id === admin!.id)?.status).toBe("ACTIVE");
    });

    it("refuses a user nobody has, and an id the gateway would not parse", async () => {
      await expect(
        api.blockUser("0f3d5cb0-0000-0000-0000-000000000000", "Nobody"),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "User not found" });

      // The path parameter is typed `UUID` on the gateway, so anything else is
      // a 400 there before auth-service is reached — the same wall `adminRow`
      // puts in front of a non-uuid row id.
      await expect(api.blockUser("not-a-uuid", "Nobody")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("validates the body before it looks for the account", async () => {
      // A blank reason on an account nobody has is a 400 and not a 404.
      // Unreachable from the section, and pinned because the mock is what the
      // two modes are compared against. The reason is *not* the one this
      // comment used to give — see `adminUser` in MockTaskaApi.ts for what the
      // gateway actually does with a body and a path.
      await expect(
        api.blockUser("0f3d5cb0-0000-0000-0000-000000000000", "  "),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("refuses a blank reason, and one past the server's limit", async () => {
      const id = await findByStatus("ACTIVE");

      // Whitespace-only is blank to `@NotBlank`, and the gateway answers 400 —
      // so the mock refuses it too, or the e2e suite would never see the rule.
      await expect(api.blockUser(id, "   ")).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "A reason is required",
      });
      await expect(api.unblockUser(id, "")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(api.blockUser(id, "x".repeat(551))).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "A reason is at most 550 characters",
      });
      // 550 exactly is accepted: the bound is inclusive on the server.
      await expect(api.blockUser(id, "x".repeat(550))).resolves.toMatchObject({ currentStatus: "BLOCKED" });
    });

    it("states a changedAt, under the name the wire uses, that the section is nonetheless not allowed to draw", async () => {
      const id = await findByStatus("ACTIVE");
      const change = await api.blockUser(id, "Left the company");

      // `changedAt` and not `updatedAt`: the gateway's mapper calls
      // `setChangedAt` and the DTO requires that name, so the old spelling read
      // `undefined` out of every 200 while the type still promised a string.
      // A real instant, and nothing renders it — the section refetches the list
      // and reads the row's own timestamp there.
      expect(Object.keys(change).sort()).toEqual(["changedAt", "currentStatus", "previousStatus", "userId"]);
      expect(new Date(change.changedAt).getUTCFullYear()).toBeGreaterThan(2000);
    });
  });

  /**
   * The three-legged upload, every way it can be refused, and the two rules
   * that decide what the panel is allowed to say afterwards. Backend TAS-131
   * has deployed since this was written, but this store is still the one place
   * every refusal below can be produced on demand, so the fidelity of these
   * branches is the deliverable rather than scaffolding for it.
   */
  describe("attachments", () => {
    /** A file the allowlist accepts, of a size the ceiling accepts. */
    const textFile = (name: string, contents = "trace line\n") =>
      new File([contents], name, { type: "text/plain" });

    const openIssue = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };

    /** The whole choreography, as the panel runs it. */
    const upload = async (issueId: string, file: File) => {
      const ticket = await api.createAttachmentUploadUrl(project.id, issueId, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      return api.confirmAttachmentUpload(project.id, issueId, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });
    };

    beforeEach(async () => {
      await api.login({ email: "anna@example.com", password: "anything" });
    });

    it("seeds an issue with two attachments from two different people", async () => {
      const issue = await openIssue("TAS-101");
      const attachments = await api.listAttachments(project.id, issue.id);

      expect(attachments.map((item) => item.fileName)).toEqual([
        "login-500-trace.txt",
        "validation-error.png",
      ]);
      // Two uploaders on one issue is what makes the split delete rule visible:
      // one row is the signed-in person's and one is not.
      expect(new Set(attachments.map((item) => item.uploadedBy)).size).toBe(2);
      // The gateway's mapper does not send the object key, so neither does this.
      expect(Object.keys(attachments[0]).sort()).toEqual([
        "checksum",
        "contentType",
        "createdAt",
        "fileName",
        "id",
        "issueId",
        "sizeBytes",
        "uploadedBy",
        "uploadedByUser",
      ]);
      // And the list names nobody; only the issue's detail read does (TAS-214).
      expect(attachments.every((item) => item.uploadedByUser === null)).toBe(true);
    });

    it("runs the three legs and lands a row the list can see", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile("notes.txt", "one\ntwo\n");

      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      // A presigned URL on the object store, not on the gateway — and the
      // signature covers the content type, which is why leg 2 may not change it.
      expect(ticket.uploadUrl).toContain("http://127.0.0.1:9000/taska-attachments/");
      expect(ticket.uploadUrl).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
      expect(ticket.objectKey).toBeTruthy();

      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      const attachment = await api.confirmAttachmentUpload(project.id, issue.id, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });

      expect(attachment).toMatchObject({ fileName: "notes.txt", contentType: "text/plain", sizeBytes: file.size });
      // The checksum is a fact about the bytes that were actually sent.
      expect(attachment.checksum).toMatch(/^[0-9a-f]{32}$/);
      expect((await api.listAttachments(project.id, issue.id)).map((item) => item.fileName)).toEqual(["notes.txt"]);
    });

    it("writes the history event the activity feed reads", async () => {
      const issue = await openIssue("TAS-102");
      const attachment = await upload(issue.id, textFile("notes.txt"));

      const afterUpload = (await api.getIssue(project.id, issue.id)).history.at(-1);
      expect(afterUpload).toMatchObject({ eventType: "ATTACHMENT_UPLOADED" });
      expect(afterUpload?.payload.fileName).toBe("notes.txt");

      await api.deleteAttachment(project.id, issue.id, attachment.id);
      expect((await api.getIssue(project.id, issue.id)).history.at(-1)).toMatchObject({
        eventType: "ATTACHMENT_DELETED",
        payload: { fileName: "notes.txt" },
      });
    });

    it("refuses a type outside the thirteen-entry allowlist, in the server's own words", async () => {
      const issue = await openIssue("TAS-102");
      // The `.zip` that Windows browsers report differently, and the case-folded
      // spelling of a type that *is* on the list: both are refused, because the
      // server compares exact strings.
      for (const contentType of ["application/x-zip-compressed", "IMAGE/PNG", "application/octet-stream", "image/gif"]) {
        await expect(
          api.createAttachmentUploadUrl(project.id, issue.id, { fileName: "f", contentType, sizeBytes: 10 }),
        ).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: attachmentTypeRefusalMessage(contentType),
        });
      }
    });

    it("refuses an empty file and one over the 2 MB ceiling, and accepts the ceiling exactly", async () => {
      const issue = await openIssue("TAS-102");
      const ask = (sizeBytes: number) =>
        api.createAttachmentUploadUrl(project.id, issue.id, {
          fileName: "f.txt",
          contentType: "text/plain",
          sizeBytes,
        });

      await expect(ask(0)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "File size must be positive, got: 0",
      });
      // INVALID_ARGUMENT, not OUT_OF_RANGE: the contract's `maximum: 2097152`
      // refuses the size in the gateway's own bean validation, before the issue
      // service that would say OUT_OF_RANGE — as it already did at backend
      // PR #147's head `deeedbf`, before any gateway served the route.
      await expect(ask(ATTACHMENT_MAX_SIZE_BYTES + 1)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: attachmentSizeRefusalMessage(ATTACHMENT_MAX_SIZE_BYTES + 1),
      });
      // Inclusive: 2097152 is the largest accepted, not the smallest refused.
      await expect(ask(ATTACHMENT_MAX_SIZE_BYTES)).resolves.toMatchObject({ objectKey: expect.any(String) });
    });

    it("answers a blocked cross-origin PUT with no status at all", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.storeUnreachable}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const error = await api.putAttachmentBytes(ticket.uploadUrl, file, file.type).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ObjectStoreError);
      // The whole point of the shape: no `status`, so nothing in
      // src/api/errors.ts reads a store failure as a gateway one.
      expect(error).toMatchObject({ code: "STORAGE_UNREACHABLE", storeStatus: null });
      expect((error as { status?: unknown }).status).toBeUndefined();
    });

    it("carries a store's own status in storeStatus and never in status", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.storeRefused}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const error = await api.putAttachmentBytes(ticket.uploadUrl, file, file.type).catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "STORAGE_REJECTED", storeStatus: 500 });
      expect((error as { status?: unknown }).status).toBeUndefined();
    });

    it("answers 403 for an expired link and for a content type that was not the one signed", async () => {
      const issue = await openIssue("TAS-102");

      const stale = textFile(`${MOCK_ATTACHMENT_TRIGGERS.expiredTicket}.txt`);
      const staleTicket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: stale.name,
        contentType: stale.type,
        sizeBytes: stale.size,
      });
      await expect(api.putAttachmentBytes(staleTicket.uploadUrl, stale, stale.type)).rejects.toMatchObject({
        code: "STORAGE_REJECTED",
        storeStatus: 403,
      });

      // The signature covers `Content-Type`, so "text/plain; charset=utf-8" is
      // a different request from "text/plain" and the store says so.
      const file = textFile("ok.txt");
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await expect(
        api.putAttachmentBytes(ticket.uploadUrl, file, "text/plain; charset=utf-8"),
      ).rejects.toMatchObject({ storeStatus: 403 });
    });

    it("leaves the object in the bucket when the confirm fails, and lists nothing", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.confirmFails}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      // Leg 2 succeeds: the bytes are in the bucket.
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);

      await expect(
        api.confirmAttachmentUpload(project.id, issue.id, {
          objectKey: ticket.objectKey,
          fileName: file.name,
          contentType: file.type,
        }),
      ).rejects.toMatchObject({ code: "UNAVAILABLE" });

      // No row — which is exactly the orphan: an object nothing points at, and
      // nothing on either side can remove it.
      expect(await api.listAttachments(project.id, issue.id)).toEqual([]);
    });

    it("refuses a confirm for an object nobody uploaded", async () => {
      const issue = await openIssue("TAS-102");
      await expect(
        api.confirmAttachmentUpload(project.id, issue.id, {
          objectKey: "never-put-here",
          fileName: "ghost.txt",
          contentType: "text/plain",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Object not found in storage" });
    });

    it("creates a second row when a confirm is repeated, which is why it is never retried", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile("duplicate.txt");
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);

      const body = { objectKey: ticket.objectKey, fileName: file.name, contentType: file.type };
      const first = await api.confirmAttachmentUpload(project.id, issue.id, body);
      const second = await api.confirmAttachmentUpload(project.id, issue.id, body);

      // `object_key` has no unique constraint on the server and the insert is
      // unconditional, so a repeat is a duplicate row rather than a no-op. Two
      // ids, two rows, two history events. Pinned so nobody "helpfully" adds a
      // retry to the confirm.
      expect(first.id).not.toBe(second.id);
      expect(await api.listAttachments(project.id, issue.id)).toHaveLength(2);
    });

    it("gives a fresh presigned download link per call, carrying the checksum", async () => {
      const issue = await openIssue("TAS-101");
      const [attachment] = await api.listAttachments(project.id, issue.id);

      const link = await api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);
      expect(link.downloadUrl).toContain("http://127.0.0.1:9000/taska-attachments/");
      expect(link.downloadUrl).toContain("X-Amz-Signature=");
      expect(link.checksum).toBe(attachment.checksum);

      await expect(
        api.getAttachmentDownloadUrl(project.id, issue.id, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("hands back the very bytes that were uploaded, for a link it signed (TAS-253)", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile("round-trip.txt", "one\ntwo\n");
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      const attachment = await api.confirmAttachmentUpload(project.id, issue.id, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });

      const link = await api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);
      // No disposition parameter: the deployed store sets none, so the link opens inline.
      expect(link.downloadUrl).not.toContain("response-content-disposition");
      const blob = await api.getAttachmentBytes(link.downloadUrl);
      expect(blob.type).toBe("text/plain");
      expect(await blob.text()).toBe("one\ntwo\n");
    });

    it("answers a seeded row with a deterministic stand-in, and refuses links it never signed", async () => {
      const issue = await openIssue("TAS-101");
      const [attachment] = await api.listAttachments(project.id, issue.id);
      const link = await api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);

      const blob = await api.getAttachmentBytes(link.downloadUrl);
      expect(blob.type).toBe(attachment.contentType);
      expect(await blob.text()).toContain(attachment.fileName);

      await expect(api.getAttachmentBytes(`${link.downloadUrl}x`)).rejects.toMatchObject({
        name: "ObjectStoreError",
        storeStatus: 403,
      });
      await expect(api.getAttachmentBytes("")).rejects.toMatchObject({ code: "STORAGE_URL_UNUSABLE" });
    });

    it("fails the byte GET with no response for a file named to, so Download's fallback is reachable", async () => {
      const issue = await openIssue("TAS-102");
      const file = textFile(`${MOCK_ATTACHMENT_TRIGGERS.downloadBlocked}.txt`);
      const ticket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      const attachment = await api.confirmAttachmentUpload(project.id, issue.id, {
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });
      const link = await api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);

      const error = await api.getAttachmentBytes(link.downloadUrl).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ObjectStoreError);
      expect(error).toMatchObject({ storeStatus: null });
    });

    it("ignores the avatar-only object-lost trigger: the attachment's bytes stay downloadable", async () => {
      const issue = await openIssue("TAS-102");
      const attachment = await upload(issue.id, textFile(`${MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost}.txt`, "kept\n"));
      const link = await api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);

      const blob = await api.getAttachmentBytes(link.downloadUrl);
      expect(await blob.text()).toBe("kept\n");
    });

    it("soft-deletes: the row leaves the list and the id stops resolving", async () => {
      const issue = await openIssue("TAS-101");
      const before = await api.listAttachments(project.id, issue.id);

      await api.deleteAttachment(project.id, issue.id, before[0].id);

      const after = await api.listAttachments(project.id, issue.id);
      expect(after.map((item) => item.id)).not.toContain(before[0].id);
      expect(after).toHaveLength(before.length - 1);
      await expect(api.getAttachmentDownloadUrl(project.id, issue.id, before[0].id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("lets a MEMBER delete their own attachment and refuses somebody else's", async () => {
      // Mark is a MEMBER of TAS; Anna is its ADMIN. The seed puts one file from
      // each on TAS-101 precisely so this rule has both cases to answer.
      await api.login({ email: "mark@example.com", password: "anything" });
      const issue = await openIssue("TAS-101");
      const attachments = await api.listAttachments(project.id, issue.id);
      const mine = attachments.find((item) => item.fileName === "validation-error.png");
      const theirs = attachments.find((item) => item.fileName === "login-500-trace.txt");
      expect(mine && theirs).toBeTruthy();
      if (!mine || !theirs) return;

      await expect(api.deleteAttachment(project.id, issue.id, theirs.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      await expect(api.deleteAttachment(project.id, issue.id, mine.id)).resolves.toBeUndefined();

      // And an ADMIN may remove the one they did not upload.
      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.deleteAttachment(project.id, issue.id, theirs.id)).resolves.toBeUndefined();
    });

    it("answers a delete for an attachment that is not there, and refuses its download", async () => {
      const issue = await openIssue("TAS-101");
      const [attachment] = await api.listAttachments(project.id, issue.id);
      const ghost = "00000000-0000-0000-0000-000000000000";

      // `AttachmentServiceImpl.deleteAttachment` opens on
      // `findByIdAndDeletedAtIsNull` with **no** `switchIfEmpty`, so an empty
      // result skips both `flatMap`s and `GrpcAttachmentService` closes with
      // `.thenReturn(Empty)` — 204, not the 404 the contract documents. The
      // implementation is reproduced rather than the contract, and the gap is
      // written down in docs/ai/API-DIVERGENCE.md rather than absorbed here.
      await expect(api.deleteAttachment(project.id, issue.id, ghost)).resolves.toBeUndefined();

      // The case a stale list actually produces — a second tab, or somebody
      // else's delete. A 404 here would roll the panel's optimistic removal
      // back and put a file that *is* deleted back on screen under an error
      // message, which is worse than the divergence.
      await api.deleteAttachment(project.id, issue.id, attachment.id);
      await expect(api.deleteAttachment(project.id, issue.id, attachment.id)).resolves.toBeUndefined();

      // Lenient, not silently repeated: the second call writes no second event.
      const deletions = (await api.getIssue(project.id, issue.id)).history.filter(
        (event) => event.eventType === "ATTACHMENT_DELETED",
      );
      expect(deletions).toHaveLength(1);

      // And the leniency is one method wide. `getDownloadUrl` goes through the
      // server's private `findActiveAttachment`, which *does* carry
      // `switchIfEmpty(NOT_FOUND)`, so both of these are 404s — pinned here
      // beside the 204s so nobody makes the lookup lenient for everyone.
      await expect(api.getAttachmentDownloadUrl(project.id, issue.id, attachment.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(api.getAttachmentDownloadUrl(project.id, issue.id, ghost)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("checks upload-attachment-roles on both legs that reach the gateway", async () => {
      // `upload-attachment-roles: ADMIN,MEMBER`, checked once by
      // `createUploadUrl` and again by `confirmUpload` — a presigned URL is a
      // bearer token for the bucket and says nothing about who may add a row.
      // Nothing in the UI can reach either leg as a VIEWER, because the picker
      // is hidden; that is exactly why it is proved here, since a hidden
      // control is a courtesy and the server stays the authority.
      //
      // Mark is a member of the Mobile project and Anna is not, so the gate is
      // two sign-ins on one issue — and the project id is read from his list
      // rather than pasted in as a second copy of a seed literal.
      //
      // Neither half is the role it stands for. The seed gives `memberIds[0]`
      // ADMIN, and Mark is Mobile's first member, so the allowed side below is
      // an ADMIN; and the refused side is a non-member that `getMembership`
      // answers `VIEWER` for — Mobile has no VIEWER member, the seed's one being
      // Tom on Taska Platform (TAS-226), and MOB-5 is where the seeded
      // attachment is. Against the gateway that second substitution is not
      // equivalent — a non-member is refused on `!isMember` before a role is
      // read at all — which is why it is written down here and in
      // docs/ai/API-DIVERGENCE.md rather than passed off as a VIEWER test.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;
      const { items } = await api.listIssues(mobile.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === "MOB-5");
      expect(issue).toBeDefined();
      if (!issue) return;

      // An allowed role runs all three legs, so the gate is not one notch too
      // tight. `upload-attachment-roles` is ADMIN and MEMBER; this is the ADMIN.
      const file = textFile("mark.txt");
      const ticket = await api.createAttachmentUploadUrl(mobile.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAttachmentBytes(ticket.uploadUrl, file, file.type);
      await expect(
        api.confirmAttachmentUpload(mobile.id, issue.id, {
          objectKey: ticket.objectKey,
          fileName: file.name,
          contentType: file.type,
        }),
      ).resolves.toMatchObject({ fileName: "mark.txt" });

      // Anna is not a member of MOB at all, so `getMembership` answers VIEWER.
      await api.login({ email: "anna@example.com", password: "anything" });

      // Reading stays hers **in the mock, which is looser than the gateway
      // here**. It is not that `view-attachment-roles` includes VIEWER:
      // `ProjectRoleChecker.validateAccess` refuses a non-member with
      // `PERMISSION_DENIED "Access denied"` before it maps a role or consults
      // `allowedRoles`, so the gateway answers 403 to these two reads whatever
      // that config contains. The mock membership-checks neither read, the
      // same convention every project-scoped read in the store follows —
      // recorded in docs/ai/API-DIVERGENCE.md, and left as it is
      // because adding the check would cost the read-only seed this section
      // demonstrates.
      const attachments = await api.listAttachments(mobile.id, issue.id);
      const seeded = attachments.find((item) => item.fileName === "crash-report.json");
      expect(seeded).toBeDefined();
      if (!seeded) return;
      await expect(api.getAttachmentDownloadUrl(mobile.id, issue.id, seeded.id)).resolves.toMatchObject({
        downloadUrl: expect.stringContaining("X-Amz-Signature="),
      });

      await expect(
        api.createAttachmentUploadUrl(mobile.id, issue.id, {
          fileName: "notes.txt",
          contentType: "text/plain",
          sizeBytes: 10,
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      // Refused before the object is looked for, the way the server refuses it:
      // `confirmUpload` opens with its own role check, so this never reaches
      // "Object not found in storage".
      await expect(
        api.confirmAttachmentUpload(mobile.id, issue.id, {
          objectKey: "never-put-here",
          fileName: "notes.txt",
          contentType: "text/plain",
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });

      // Somebody else's file, and this reader is no ADMIN of MOB.
      await expect(api.deleteAttachment(mobile.id, issue.id, seeded.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      // But an attachment that is not there is refused by nothing at all: the
      // server's empty lookup skips the role check along with everything else.
      await expect(
        api.deleteAttachment(mobile.id, issue.id, "00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
    });

    it("judges the file before the role at leg 1, and the role before the object at leg 3", async () => {
      // Not symmetry, and not what this store used to assume. `createUploadUrl`
      // is `checkUserHasRoleForIssue(...).then(createPresignedUploadUrl(...))`,
      // and `Mono.then(Mono)` evaluates its argument at assembly — while
      // `S3StorageClient.createPresignedUploadUrl` calls `validateFileParams`
      // synchronously before it returns a Mono. So the file refusal escapes
      // before the role check ever subscribes, and leg 1 answers 400 where a
      // reader would expect 403. Verified against backend `f53dca38`.
      //
      // `confirmUpload` has no such argument and does check the role first,
      // which is why the two assertions below differ.
      // Mark's sign-in only to read the ids: `listProjects` answers a
      // non-member nothing, so Anna cannot find MOB herself.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;
      const issue = (await api.listIssues(mobile.id, { pageSize: 100 })).items.find(
        (item) => item.issueKey === "MOB-5",
      );
      expect(issue).toBeDefined();
      if (!issue) return;
      await api.login({ email: "anna@example.com", password: "anything" });

      // Anna may not upload here at all, and the file is unacceptable too. The
      // server answers the file, so this does as well — and `RestTaskaApi`,
      // which refuses before it sends anything, answers the same.
      await expect(
        api.createAttachmentUploadUrl(mobile.id, issue.id, {
          fileName: "bundle.zip",
          contentType: "application/x-zip-compressed",
          sizeBytes: 10,
        }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

      // Same two problems on leg 3, opposite answer: the role goes first.
      await expect(
        api.confirmAttachmentUpload(mobile.id, issue.id, {
          objectKey: "never-put-here",
          fileName: "bundle.zip",
          contentType: "application/x-zip-compressed",
        }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("refuses an upload URL that is not one instead of PUTting to this origin", async () => {
      // `RestTaskaApi` lands a response with no `uploadUrl` as `""`, and
      // `fetch("")` resolves against the document rather than failing — so an
      // unguarded leg 2 would PUT the file to the SPA's own origin with
      // cookies attached. Refused by both implementations, in the store-error
      // shape and with its own code, because nothing was sent and no store was
      // asked.
      const file = textFile("notes.txt");
      for (const url of ["", "/api/v1/upload", "javascript:void 0"]) {
        await expect(api.putAttachmentBytes(url, file, file.type)).rejects.toMatchObject({
          name: "ObjectStoreError",
          code: "STORAGE_URL_UNUSABLE",
          storeStatus: null,
        });
      }
    });

    it("scopes every read to the project in the path, unlike the gateway", async () => {
      const issue = await openIssue("TAS-101");
      const other = (await api.listProjects()).find((item) => item.id !== project.id);
      expect(other).toBeDefined();
      if (!other) return;

      // The gateway forwards only `issueId` and says in its own comment that
      // `projectId` takes no part in authorisation, so it would answer this.
      // The mock resolves an issue *within* a project and refuses — the same
      // known divergence `getIssue` carries, recorded here rather than found by
      // somebody at a boundary.
      await expect(api.listAttachments(other.id, issue.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("watchers", () => {
    const openIssue = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };

    beforeEach(async () => {
      await api.login({ email: "anna@example.com", password: "anything" });
    });

    it("answers with the rows and with its own count, and sends no name", async () => {
      const issue = await openIssue("TAS-101");
      const answer = await api.listIssueWatchers(project.id, issue.id);

      expect(answer.totalCount).toBe(3);
      expect(answer.watchers).toHaveLength(3);
      // The list route names nobody: issue-service fills a watcher's name only
      // when it assembles the issue's detail read (backend TAS-214). A mock
      // that named them here would let a component rely on a name the gateway
      // does not send on this route.
      expect(answer.watchers.every((watcher) => watcher.displayName === null && watcher.avatarUrl === null)).toBe(true);
      // Anna subscribed Sofia, so at least one row's author is not its subject.
      expect(answer.watchers.some((watcher) => watcher.createdBy !== watcher.userId)).toBe(true);
    });

    it("seeds a watcher who is not a member of the project, so the unnamed row is reachable", async () => {
      // Priya belongs to WEB and MOB, not to TAS. `GET /projects/{TAS}/members`
      // therefore cannot name her, and her row is the one seeded watcher the
      // section has to draw unnamed.
      const issue = await openIssue("TAS-103");
      const { watchers } = await api.listIssueWatchers(project.id, issue.id);
      const members = new Set((await api.listMembers(project.id)).map((member) => member.userId));

      expect(watchers).toHaveLength(2);
      expect(watchers.some((watcher) => !members.has(watcher.userId))).toBe(true);
    });

    it("subscribes the signed-in user and says how many are watching afterwards", async () => {
      const issue = await openIssue("TAS-102");
      const me = await api.getCurrentUser();

      const result = await api.watchIssue(project.id, issue.id);

      expect(result.watcher?.userId).toBe(me.id);
      expect(result.watchersCount).toBe(1);
      const { watchers, totalCount } = await api.listIssueWatchers(project.id, issue.id);
      expect(watchers.map((watcher) => watcher.userId)).toEqual([me.id]);
      expect(totalCount).toBe(1);
    });

    it("is idempotent on a second watch, because the response has no flag to say otherwise", async () => {
      const issue = await openIssue("TAS-102");

      const first = await api.watchIssue(project.id, issue.id);
      const second = await api.watchIssue(project.id, issue.id);

      // The same subscription, not a second one. `WatchIssueResponseDto` has no
      // sibling of `removed` — nothing in it can report "already watching" — so
      // a route that created a duplicate would have no way to say so.
      expect(second.watcher?.id).toBe(first.watcher?.id);
      expect(second.watchersCount).toBe(1);
    });

    it("reports removed:true once and removed:false after, and neither is a failure", async () => {
      const issue = await openIssue("TAS-101");

      const first = await api.unwatchIssue(project.id, issue.id);
      expect(first).toMatchObject({ issueId: issue.id, removed: true, watchersCount: 2 });

      // The end state is the one that was asked for, so this is a 200 rather
      // than a 404 — and `removed` is how the caller learns nothing happened.
      const second = await api.unwatchIssue(project.id, issue.id);
      expect(second).toMatchObject({ issueId: issue.id, removed: false, watchersCount: 2 });
    });

    it("lets a project ADMIN subscribe somebody else, recording who did it", async () => {
      const issue = await openIssue("TAS-102");
      const me = await api.getCurrentUser();
      const other = (await api.listMembers(project.id)).find((member) => member.userId !== me.id);
      expect(other).toBeDefined();
      if (!other) return;

      const result = await api.addIssueWatcher(project.id, issue.id, other.userId);

      expect(result.watcher).toMatchObject({ userId: other.userId, createdBy: me.id });
      expect(result.watchersCount).toBe(1);
    });

    it("refuses a MEMBER somebody else's subscription, and lets them manage their own through either route", async () => {
      // issue-service's `IssueWatcherServiceImpl.checkMutationRole` (read at
      // develop, unchanged at `4277199`; the contract states it once backend
      // PR #194, TAS-228, merges): another person's `userId` takes
      // `manage-watchers-roles` — ADMIN — and the actor's own takes
      // `watch-issue-roles` — ADMIN or MEMBER — on every route.
      await api.login({ email: "mark@example.com", password: "anything" });
      const issue = await openIssue("TAS-101");
      const me = await api.getCurrentUser();
      const sofia = (await api.listIssueWatchers(project.id, issue.id)).watchers.find(
        (watcher) => watcher.userId !== me.id,
      );
      expect(sofia).toBeDefined();
      if (!sofia) return;

      await expect(api.removeIssueWatcher(project.id, issue.id, sofia.userId)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      const anna = (await api.listMembers(project.id)).find((member) => member.user?.displayName === "Anna Ivanova");
      expect(anna).toBeDefined();
      await expect(api.addIssueWatcher(project.id, issue.id, anna!.userId)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });

      await expect(api.removeIssueWatcher(project.id, issue.id, me.id)).resolves.toMatchObject({ removed: true });
      await expect(api.addIssueWatcher(project.id, issue.id, me.id)).resolves.toMatchObject({
        watchersCount: 3,
      });
      await expect(api.unwatchIssue(project.id, issue.id)).resolves.toMatchObject({ removed: true });
      await expect(api.watchIssue(project.id, issue.id)).resolves.toMatchObject({ watchersCount: 3 });
    });

    it("refuses a VIEWER both halves of the me pair, and still lets them read who watches", async () => {
      // This case used to assert the opposite — "lets a VIEWER watch an issue
      // they can read" — on the belief that the contract's silence about
      // `…/watchers/me` meant no role. issue-service's `watch-issue-roles` is
      // ADMIN and MEMBER (TAS-226).
      //
      // `listProjects` answers a non-member nothing, so Mobile has to be found
      // as somebody who belongs to it before Anna — who does not — can be the
      // VIEWER of it. The same two-step every other cross-project case here
      // uses, and the same non-member standing in for a VIEWER
      // (docs/ai/API-DIVERGENCE.md); the seeded VIEWER member is the next case.
      await api.login({ email: "mark@example.com", password: "anything" });
      const mobile = (await api.listProjects()).find((item) => item.projectKey === "MOB");
      expect(mobile).toBeDefined();
      if (!mobile) return;
      const { items } = await api.listIssues(mobile.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === "MOB-5");
      expect(issue).toBeDefined();
      if (!issue) return;

      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(api.getMembership(mobile.id)).resolves.toMatchObject({ role: "VIEWER" });
      await expect(api.watchIssue(mobile.id, issue.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      // Refused with nothing to remove too: the role is what is refused, so this
      // is not the `removed: false` a MEMBER would be told.
      await expect(api.unwatchIssue(mobile.id, issue.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      // Neither refusal wrote anything, and reading the list is not gated.
      await expect(api.listIssueWatchers(mobile.id, issue.id)).resolves.toMatchObject({ totalCount: 1 });
      // And still cannot touch anybody else's subscription.
      await expect(api.addIssueWatcher(mobile.id, issue.id, "anything")).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
    });

    it("refuses the seeded VIEWER member the same way, on a project they belong to", async () => {
      // Tom is a member of Taska Platform with the role VIEWER, so this is the
      // refusal for the role itself rather than for a non-member standing in.
      // Anna subscribed him to TAS-110, so his unwatch has something to remove
      // and is refused all the same.
      const unwatched = await openIssue("TAS-102");
      const watched = await openIssue("TAS-110");
      await api.login({ email: "tom@example.com", password: "anything" });
      const tom = await api.getCurrentUser();

      await expect(api.watchIssue(project.id, unwatched.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      await expect(api.unwatchIssue(project.id, watched.id)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
      // Naming himself on the userId routes changes nothing: his own id takes
      // `watch-issue-roles` there too, and VIEWER is not in it.
      await expect(api.addIssueWatcher(project.id, unwatched.id, tom.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      await expect(api.removeIssueWatcher(project.id, watched.id, tom.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
      const { watchers, totalCount } = await api.listIssueWatchers(project.id, watched.id);
      expect(totalCount).toBe(1);
      expect(watchers.map((watcher) => watcher.userId)).toEqual([tom.id]);
    });

    it("lets an ADMIN subscribe a VIEWER, because only the actor's role is checked", async () => {
      // The other side of the same rule: `manage-watchers-roles` is read off
      // whoever is subscribing somebody else, never off the person subscribed —
      // which is why the watcher picker offers every member, a VIEWER included.
      const issue = await openIssue("TAS-102");
      const tom = (await api.listMembers(project.id)).find((member) => member.user?.displayName === "Tom Becker");
      expect(tom?.role).toBe("VIEWER");
      if (!tom) return;

      await expect(api.addIssueWatcher(project.id, issue.id, tom.userId)).resolves.toMatchObject({
        watcher: { userId: tom.userId },
        watchersCount: 1,
      });
    });

    it("answers an ADMIN removal of somebody who was never watching, rather than refusing it", async () => {
      const issue = await openIssue("TAS-102");
      const tom = (await api.listMembers(project.id)).at(-1);
      expect(tom).toBeDefined();
      if (!tom) return;

      // Not a 404. The whole point of `removed` is that this case is a success
      // that changed nothing — and a row belonging to a deleted account is
      // exactly the one an ADMIN has to be able to clear.
      await expect(api.removeIssueWatcher(project.id, issue.id, tom.userId)).resolves.toMatchObject({
        removed: false,
        watchersCount: 0,
      });
    });

    it("refuses to subscribe a user this deployment has never heard of", async () => {
      const issue = await openIssue("TAS-102");
      await expect(
        api.addIssueWatcher(project.id, issue.id, "00000000-0000-4000-8000-000000000000"),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
  /**
   * TAS-246: the panel's one read and the key lookup, as issue-service
   * assembles and checks them at backend develop `60d62ee`.
   */
  describe("issue details and the key lookup", () => {
    const openIssue = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };

    beforeEach(async () => {
      await api.login({ email: "anna@example.com", password: "anything" });
    });

    it("answers the panel's whole read, the parts the list routes do not name included", async () => {
      const issue = await openIssue("TAS-101");

      const { issue: details } = await api.getIssue(project.id, issue.id);

      expect(details.reporter?.displayName).toBeTruthy();
      expect(details.labels?.map((label) => label.name).sort()).toEqual(["backend", "tech-debt"]);
      // Three rows and no count: the details DTO states none, as the gateway's
      // does not, and a length would be a number nobody said.
      expect(details.watchers?.watchers).toHaveLength(3);
      expect(details.watchers?.totalCount).toBeNull();
      expect(details.watchers?.watchers.every((watcher) => watcher.displayName)).toBe(true);
      // Anna watches TAS-101, and the read says so in its own field.
      expect(details.isWatching).toBe(true);
      expect(details.links?.length).toBeGreaterThan(0);
      expect(details.links?.every((link) => link.target?.issueKey)).toBe(true);
      expect(details.attachments?.every((item) => item.uploadedByUser?.id === item.uploadedBy)).toBe(true);
      expect(details.commentCount).toBe(1);
    });

    it("names the other end of a link from either side", async () => {
      const blocker = await openIssue("TAS-101");
      const blocked = await openIssue("TAS-102");

      const fromBlocked = (await api.getIssue(project.id, blocked.id)).issue.links ?? [];

      expect(fromBlocked.find((link) => link.sourceIssueId === blocker.id)?.target).toMatchObject({
        id: blocker.id,
        issueKey: "TAS-101",
        projectId: project.id,
      });
    });

    it("lists watchers newest first, as both server routes do", async () => {
      const issue = await openIssue("TAS-102");
      await api.addIssueWatcher(project.id, issue.id, (await api.getCurrentUser()).id);
      const mark = (await api.listMembers(project.id)).find((item) => item.user?.displayName === "Mark Lee")!;
      await api.addIssueWatcher(project.id, issue.id, mark.userId);

      const fromDetails = (await api.getIssue(project.id, issue.id)).issue.watchers?.watchers ?? [];
      const fromList = (await api.listIssueWatchers(project.id, issue.id)).watchers;

      expect(fromDetails.map((row) => row.userId)).toEqual([mark.userId, (await api.getCurrentUser()).id]);
      expect(fromList.map((row) => row.userId)).toEqual(fromDetails.map((row) => row.userId));
    });

    it("leaves a link to a deleted issue off the details read and on the list route, as the server does", async () => {
      const blocker = await openIssue("TAS-101");
      const blocked = await openIssue("TAS-102");
      await api.deleteIssue(project.id, blocked.id);

      const onDetails = (await api.getIssue(project.id, blocker.id)).issue.links ?? [];
      const onList = await api.listIssueLinks(project.id, blocker.id);

      expect(onDetails.some((link) => link.targetIssueId === blocked.id)).toBe(false);
      expect(onList.some((link) => link.targetIssueId === blocked.id)).toBe(true);
    });

    it("leaves a watcher nobody can name without a name, rather than dropping the row", async () => {
      const issue = await openIssue("TAS-106");

      const watchers = (await api.getIssue(project.id, issue.id)).issue.watchers?.watchers ?? [];

      expect(watchers).toHaveLength(1);
      expect(watchers[0]).toMatchObject({ displayName: null, avatarUrl: null });
    });

    it("resolves a key to its issue whatever its case", async () => {
      const issue = await openIssue("TAS-101");

      await expect(api.getIssueByKey("tas-101")).resolves.toMatchObject({ id: issue.id, projectId: project.id });
    });

    it("answers a key nobody has with NOT_FOUND", async () => {
      await expect(api.getIssueByKey("NOPE-1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("answers a key in a project the reader is not on with PERMISSION_DENIED", async () => {
      // Anna is not a member of MOB, and the lookup checks what the issue read
      // in this mock does not.
      await expect(api.getIssueByKey("MOB-5")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    });

    it("does not find a deleted issue by its key", async () => {
      const issue = await openIssue("TAS-105");
      await api.deleteIssue(project.id, issue.id);

      await expect(api.getIssueByKey("TAS-105")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  /**
   * The avatar family — backend PR #150 (TAS-129), merged at `develop`
   * `368ae77355bd` and deployed on 2026-09-14. This mock is still the only
   * place the choreography runs in a test: nothing here calls a gateway, live
   * or otherwise. What is pinned here is the contract's own awkward parts —
   * the enforced ceiling that is not the declared one, the delete that cannot
   * say whether it deleted anything, "no avatar" being a 200 with a null
   * rather than a 404 — and the confirm's rules since backend PR #198
   * (TAS-221): only the caller's own key is accepted, and the key the saved
   * row already holds changes nothing.
   */
  describe("avatars", () => {
    /** A PNG-shaped file of a size the ceiling accepts. */
    const imageFile = (name: string, bytes = 64, type = "image/png") =>
      new File([new Uint8Array(bytes)], name, { type });

    /** The whole choreography, as the profile menu runs it. */
    const upload = async (file: File) => {
      const ticket = await api.createAvatarUploadUrl({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      await api.putAvatarBytes(ticket.uploadUrl, file, file.type);
      return api.confirmAvatarUpload({
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });
    };

    beforeEach(async () => {
      await api.login({ email: "anna@example.com", password: "anything" });
    });

    it("runs the three legs and hands back a link the confirm already carries", async () => {
      const me = await api.getCurrentUser();
      const file = imageFile("face.png");

      const ticket = await api.createAvatarUploadUrl({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      // A presigned URL on the object store and not on the gateway, in the
      // avatar bucket and not the attachment one — and the signature covers the
      // content type, which is why leg 2 may not change it.
      expect(ticket.uploadUrl).toContain("http://127.0.0.1:9000/taska-avatars/");
      expect(ticket.uploadUrl).toContain("X-Amz-SignedHeaders=content-type%3Bhost");
      // In the caller's own folder, as the server mints it since PR #198 — the
      // shape the confirm accepts as theirs.
      expect(ticket.objectKey).toMatch(new RegExp(`^avatars/${me.id}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`));
      // Fifteen minutes, as the server states it rather than as this client
      // assumes it.
      expect(ticket.expiresIn).toBe(900);

      await api.putAvatarBytes(ticket.uploadUrl, file, file.type);
      const avatar = await api.confirmAvatarUpload({
        objectKey: ticket.objectKey,
        fileName: file.name,
        contentType: file.type,
      });

      expect(avatar).toMatchObject({
        userId: me.id,
        fileName: "face.png",
        contentType: "image/png",
        sizeBytes: file.size,
      });
      // The confirm answers with the link, so a freshly uploaded face needs no
      // follow-up read.
      expect(avatar.downloadUrl).toBeTruthy();
      // And `GET /users/me` carries it from then on (TAS-223), with the id that
      // tells a re-signed link from a new picture, and the flag that says the
      // profile read worked (backend PR #193).
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        avatarUrl: avatar.downloadUrl,
        avatarId: avatar.id,
        avatarUnavailable: false,
      });
    });

    it("refuses anything over 2 MB the way the gateway does, before the avatar service or the type is asked", async () => {
      // Since backend TAS-222 the schema's `maximum` is 2097152, the number
      // auth-service enforces, so the generated DTO's `@Max` fails as the
      // gateway reads the body: its fixed sentence on 400. One band, where there
      // used to be two, and the type never comes into it.
      const threeMegabytes = 3 * 1024 * 1024;
      expect(threeMegabytes).toBeGreaterThan(AVATAR_MAX_SIZE_BYTES);

      await expect(
        api.createAvatarUploadUrl({ fileName: "huge.png", contentType: "image/png", sizeBytes: threeMegabytes }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: AVATAR_GATEWAY_REFUSAL_MESSAGE });
      await expect(
        api.createAvatarUploadUrl({ fileName: "huge.gif", contentType: "image/gif", sizeBytes: threeMegabytes }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: AVATAR_GATEWAY_REFUSAL_MESSAGE });
    });

    it("still refuses an oversized object at the confirm, as OUT_OF_RANGE", async () => {
      // The one place the service's own ceiling still answers: leg 3 re-measures
      // what is in the bucket, whatever leg 1 was told.
      const ticket = await api.createAvatarUploadUrl({ fileName: "liar.png", contentType: "image/png", sizeBytes: 64 });
      const tooBig = new File([new Uint8Array(AVATAR_MAX_SIZE_BYTES + 1)], "liar.png", { type: "image/png" });
      await api.putAvatarBytes(ticket.uploadUrl, tooBig, "image/png");

      await expect(
        api.confirmAvatarUpload({ objectKey: ticket.objectKey, fileName: "liar.png", contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "OUT_OF_RANGE", message: avatarSizeRefusalMessage(AVATAR_MAX_SIZE_BYTES + 1) });
    });

    it("refuses a type outside the three-entry allowlist, in the server's own words", async () => {
      // GIF is the one people try: an image, not on auth-service's list, and
      // compared by exact string with no `image/*` anywhere in the chain.
      await expect(
        api.createAvatarUploadUrl({ fileName: "wave.gif", contentType: "image/gif", sizeBytes: 4096 }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: avatarTypeRefusalMessage("image/gif"),
      });
    });

    it("replaces rather than appends, so a second upload leaves one avatar", async () => {
      const me = await api.getCurrentUser();
      const first = await upload(imageFile("first.png", 32));
      const second = await upload(imageFile("second.png", 96));

      expect(second.id).not.toBe(first.id);
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        id: me.id,
        avatarUrl: second.downloadUrl,
        avatarId: second.id,
        avatarUnavailable: false,
      });
      // And the first object is gone from the bucket with its row, which is
      // where this differs from an attachment delete.
      await expect(
        api.confirmAvatarUpload({ objectKey: first.objectKey, fileName: "first.png", contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("hands the saved row back unchanged when its own key is confirmed again, and deletes nothing", async () => {
      const file = imageFile("face.png");
      const ticket = await api.createAvatarUploadUrl({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
      await api.putAvatarBytes(ticket.uploadUrl, file, file.type);
      const saved = await api.confirmAvatarUpload({ objectKey: ticket.objectKey, fileName: file.name, contentType: file.type });

      // `replaceAvatarInDb` sees the saved row already holds this key: the row
      // comes back as it is — even under another name in the request — and no
      // "previous" object is deleted, because there is none.
      const again = await api.confirmAvatarUpload({
        objectKey: ticket.objectKey,
        fileName: "renamed.png",
        contentType: file.type,
      });
      expect(again).toEqual(saved);

      // And the picture is still there to read.
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        avatarUrl: saved.downloadUrl,
        avatarId: saved.id,
        avatarUnavailable: false,
      });
    });

    it("refuses a key minted for somebody else as one that does not exist, and changes nothing on either side", async () => {
      // Mark uploads; Anna then sends his key. Before PR #198 that pointed her
      // row at his object, which the next replace on either side deleted.
      await api.login({ email: "mark@example.com", password: "anything" });
      const marks = await upload(imageFile("mark.png"));
      await api.login({ email: "anna@example.com", password: "anything" });
      const annaBefore = await api.getCurrentUser();

      await expect(
        api.confirmAvatarUpload({ objectKey: marks.objectKey, fileName: "mine.png", contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "An object with this key was not found in the storage." });

      await expect(api.getCurrentUser()).resolves.toMatchObject({
        avatarUrl: annaBefore.avatarUrl,
        avatarId: annaBefore.avatarId,
      });
      await api.login({ email: "mark@example.com", password: "anything" });
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        avatarUrl: marks.downloadUrl,
        avatarId: marks.id,
        avatarUnavailable: false,
      });
    });

    it("answers a key nobody minted, and one of the caller's with nothing behind it, in the same words", async () => {
      const me = await api.getCurrentUser();
      const notFound = { code: "NOT_FOUND", message: "An object with this key was not found in the storage." };
      // Not in the caller's folder at all…
      await expect(
        api.confirmAvatarUpload({ objectKey: "avatar-object-1", fileName: "x.png", contentType: "image/png" }),
      ).rejects.toMatchObject(notFound);
      // …in it, but spelt the way leg 1 never spells a UUID…
      await expect(
        api.confirmAvatarUpload({
          objectKey: `avatars/${me.id}/0A1B2C3D-0000-4000-8000-000000000000`,
          fileName: "x.png",
          contentType: "image/png",
        }),
      ).rejects.toMatchObject(notFound);
      // …and minted for the caller, with no upload behind it.
      const ticket = await api.createAvatarUploadUrl({ fileName: "x.png", contentType: "image/png", sizeBytes: 64 });
      await expect(
        api.confirmAvatarUpload({ objectKey: ticket.objectKey, fileName: "x.png", contentType: "image/png" }),
      ).rejects.toMatchObject(notFound);
      await expect(api.getCurrentUser()).resolves.toMatchObject({ avatarUrl: null, avatarUnavailable: false });
    });

    it("still accepts a saved key from before the folders, for its owner and nobody else", async () => {
      // Sofia's seeded row holds `seeded-avatar-sofia`, a key no leg 1 mints
      // any more — what every row saved before PR #198 holds. Its owner may
      // confirm it again; that changes nothing.
      await api.login({ email: "sofia@example.com", password: "anything" });
      const before = await api.getCurrentUser();
      const again = await api.confirmAvatarUpload({
        objectKey: "seeded-avatar-sofia",
        fileName: "sofia.png",
        contentType: "image/png",
      });
      expect(again.id).toBe(before.avatarId);
      expect(again.downloadUrl).toBe(before.avatarUrl);

      // Anybody else is told it does not exist, and her face survives it.
      await api.login({ email: "anna@example.com", password: "anything" });
      await expect(
        api.confirmAvatarUpload({ objectKey: "seeded-avatar-sofia", fileName: "s.png", contentType: "image/png" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", message: "An object with this key was not found in the storage." });
      await api.login({ email: "sofia@example.com", password: "anything" });
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        avatarId: before.avatarId,
        avatarUrl: before.avatarUrl,
        avatarUnavailable: false,
      });
    });

    it("gets out of a lost object by a removal, which answers 204 like any other", async () => {
      const me = await api.getCurrentUser();
      await upload(imageFile(`${MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost}.png`));
      await expect(api.getCurrentUser()).resolves.toMatchObject({ avatarUrl: null, avatarUnavailable: true });

      // The row goes, and deleting an object that is already gone is not an
      // error on the store's side either. With no row, the profile read
      // succeeds again and says "none", not "unknown".
      await expect(api.deleteMyAvatar()).resolves.toBeUndefined();
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        id: me.id,
        avatarUrl: null,
        avatarId: null,
        avatarUnavailable: false,
      });
    });

    it("answers the confirm with its link and then loses the object, for a file named object-lost", async () => {
      // `MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost`: storage loses the object
      // behind this reader's saved row — the one way left to that state since
      // PR #198. The confirm itself succeeded and said so.
      const saved = await upload(imageFile(`${MOCK_ATTACHMENT_TRIGGERS.avatarObjectLost}.png`));
      expect(saved.downloadUrl).toBeTruthy();

      // Every read from then on: 200, no picture, and the flag.
      const after = await api.getCurrentUser();
      expect(after).toMatchObject({ avatarUrl: null, avatarId: null, avatarUnavailable: true });
      await expect(api.getCurrentUser()).resolves.toMatchObject({ avatarUnavailable: true });
      // …and no member row draws a face that nothing can serve.
      const members = await api.listMembers(project.id);
      expect(members.find((member) => member.userId === after.id)?.user?.avatarUrl).toBeNull();

      // An upload replaces the row and the next read is whole again.
      const fresh = await upload(imageFile("face.png"));
      await expect(api.getCurrentUser()).resolves.toMatchObject({
        avatarUrl: fresh.downloadUrl,
        avatarId: fresh.id,
        avatarUnavailable: false,
      });
    });

    it("draws the seeded face through the same read as an uploaded one", async () => {
      // Sofia's seeded row has its object in the bucket, so the HEAD a read
      // presigns through finds it — a row with nothing behind it is the broken
      // state above, not a seed.
      await api.login({ email: "sofia@example.com", password: "anything" });
      const sofia = await api.getCurrentUser();
      expect(sofia.displayName).toBe("Sofia Reyes");
      expect(sofia.avatarUrl).toMatch(/^data:image\/png;base64,/);
      expect(sofia.avatarId).toBeTruthy();
      expect(sofia.avatarUnavailable).toBe(false);
    });

    it("deletes idempotently: twice in a row is two successes, and so is deleting nothing", async () => {
      const me = await api.getCurrentUser();
      await upload(imageFile("face.png"));

      await expect(api.deleteMyAvatar()).resolves.toBeUndefined();
      await expect(api.getCurrentUser()).resolves.toMatchObject({ id: me.id, avatarUrl: null, avatarUnavailable: false });
      // The second call is the one that matters: the contract promises 204
      // whether or not there was an avatar, so nothing here may throw and
      // nothing may report which case it was.
      await expect(api.deleteMyAvatar()).resolves.toBeUndefined();
      await expect(api.getCurrentUser()).resolves.toMatchObject({ id: me.id, avatarUrl: null, avatarUnavailable: false });
    });

    it("answers a person with no avatar with an explicit null on the profile", async () => {
      // Anna is deliberately unseeded — the profile flow starts at "no photo".
      // `null`, not absent: the server was asked and stated it (TAS-223). And
      // `false`, because asking worked: "none", not "unknown" (backend PR #193).
      const me = await api.getCurrentUser();
      expect(me.avatarUrl).toBeNull();
      expect(me.avatarId).toBeNull();
      expect(me.avatarUnavailable).toBe(false);
    });

    it("carries the avatar on the member row, so a board of faces is one read", async () => {
      const members = await api.listMembers(project.id);
      const sofia = members.find((member) => member.user?.displayName === "Sofia Reyes");
      expect(sofia?.user?.avatarUrl).toMatch(/^data:image\/png;base64,/);
      // Everyone else on the project answers `null` — the row asked, inline,
      // and the answer was "none". Never `undefined`, which is reserved for
      // nobody having asked.
      const anna = members.find((member) => member.user?.displayName === "Anna Ivanova");
      expect(anna?.user?.avatarUrl).toBeNull();
    });

    it("shows a new photo on the member row without a second request", async () => {
      const me = await api.getCurrentUser();
      const saved = await upload(imageFile("face.png"));

      const members = await api.listMembers(project.id);
      expect(members.find((member) => member.userId === me.id)?.user?.avatarUrl).toBe(saved.downloadUrl);
    });

    it("keeps the two buckets apart: an attachment link is not an avatar link", async () => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items[0];
      const file = imageFile("shot.png");
      const attachmentTicket = await api.createAttachmentUploadUrl(project.id, issue.id, {
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      // S3 answers 403 for a signature it did not mint, and so does this: the
      // object is not the thing being denied.
      await expect(api.putAvatarBytes(attachmentTicket.uploadUrl, file, file.type)).rejects.toMatchObject({
        name: "ObjectStoreError",
        storeStatus: 403,
      });
    });

    it("fails the middle leg the way a blocked preflight does, without a status", async () => {
      // The mock reads the file name, because this failure is otherwise
      // unreachable from a browser: nothing in the backend repository
      // configures CORS on the bucket.
      const file = imageFile("cors-blocked.png");
      const ticket = await api.createAvatarUploadUrl({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      const failure = await api.putAvatarBytes(ticket.uploadUrl, file, file.type).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ObjectStoreError);
      // No status, and no field called `status` either — see ObjectStoreError:
      // `isMissingOrForbidden` reads `status` off any Error, and a store's
      // refusal is not a gateway permission answer.
      expect(failure).toMatchObject({ storeStatus: null, code: "STORAGE_UNREACHABLE" });
    });

    it("refuses a content type that differs from the one that was signed", async () => {
      const file = imageFile("face.png");
      const ticket = await api.createAvatarUploadUrl({
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });

      // The presign covers `Content-Type`, so a value that differs by so much
      // as a charset is a signature mismatch and a 403.
      await expect(api.putAvatarBytes(ticket.uploadUrl, file, "image/jpeg")).rejects.toMatchObject({
        storeStatus: 403,
      });
    });
  });

  /**
   * Backend PR #178 (TAS-118), as the mock reproduces the Java at its head: the
   * three role rules, the two 404s, the partial update's own rules, and what
   * every write does to the issue.
   */
  describe("worklogs", () => {
    const issueByKey = async (issueKey: string) => {
      const { items } = await api.listIssues(project.id, { pageSize: 100 });
      const issue = items.find((item) => item.issueKey === issueKey);
      if (!issue) throw new Error(`no ${issueKey} in the seed`);
      return issue;
    };
    const signIn = (email: string) => api.login({ email, password: "anything" });

    it("lists the seeded entries newest day first, unnamed, for every member role", async () => {
      await signIn("tom@example.com");
      const issue = await issueByKey("TAS-101");
      const worklogs = await api.listIssueWorklogs(project.id, issue.id);
      expect(worklogs.map((item) => item.workDate)).toEqual(["2026-06-13", "2026-06-13", "2026-06-12"]);
      expect(worklogs[0]).not.toHaveProperty("author");
    });

    it("refuses a non-member the list, as ProjectRoleChecker does", async () => {
      // Priya is not a member of Taska Platform.
      await signIn("priya@example.com");
      const issue = await issueByKey("TAS-101");
      await expect(api.listIssueWorklogs(project.id, issue.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        message: "Access denied",
      });
    });

    it("lets a VIEWER read and not log", async () => {
      await signIn("tom@example.com");
      const issue = await issueByKey("TAS-101");
      await expect(
        api.addIssueWorklog(project.id, issue.id, { spentMinutes: 30, workDate: "2026-06-14" }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Not allowed role" });
    });

    it("moves the issue's version and remaining estimate on an add, an edit and a delete", async () => {
      await signIn("anna@example.com");
      const issue = await issueByKey("TAS-101");
      await edit(issue.id, { remainingEstimateMinutes: 300 });
      const start = (await api.getIssue(project.id, issue.id)).issue;

      const added = await api.addIssueWorklog(project.id, issue.id, { spentMinutes: 90, workDate: "2026-06-14" });
      let now = (await api.getIssue(project.id, issue.id)).issue;
      expect(now.version).toBe(start.version + 1);
      expect(now.remainingEstimateMinutes).toBe(210);

      await api.updateIssueWorklog(project.id, issue.id, added.id, { spentMinutes: 60 });
      now = (await api.getIssue(project.id, issue.id)).issue;
      expect(now.version).toBe(start.version + 2);
      expect(now.remainingEstimateMinutes).toBe(240);

      // A change of the comment alone still moves the version, and not the estimate.
      await api.updateIssueWorklog(project.id, issue.id, added.id, { comment: "Reviewed" });
      now = (await api.getIssue(project.id, issue.id)).issue;
      expect(now.version).toBe(start.version + 3);
      expect(now.remainingEstimateMinutes).toBe(240);

      await api.deleteIssueWorklog(project.id, issue.id, added.id);
      now = (await api.getIssue(project.id, issue.id)).issue;
      expect(now.version).toBe(start.version + 4);
      expect(now.remainingEstimateMinutes).toBe(300);
    });

    it("never takes the remaining estimate below zero", async () => {
      await signIn("anna@example.com");
      const issue = await issueByKey("TAS-101");
      await edit(issue.id, { remainingEstimateMinutes: 30 });
      await api.addIssueWorklog(project.id, issue.id, { spentMinutes: 90, workDate: "2026-06-14" });
      expect((await api.getIssue(project.id, issue.id)).issue.remainingEstimateMinutes).toBe(0);
    });

    it("stores a blank comment as null, and clears one with an empty string", async () => {
      await signIn("anna@example.com");
      const issue = await issueByKey("TAS-101");
      const blank = await api.addIssueWorklog(project.id, issue.id, {
        spentMinutes: 15,
        workDate: "2026-06-14",
        comment: "   ",
      });
      expect(blank.comment).toBeNull();

      const noted = await api.addIssueWorklog(project.id, issue.id, {
        spentMinutes: 15,
        workDate: "2026-06-14",
        comment: "Pairing",
      });
      const cleared = await api.updateIssueWorklog(project.id, issue.id, noted.id, { comment: "" });
      expect(cleared.comment).toBeNull();
      expect(cleared.spentMinutes).toBe(15);
    });

    it("refuses an empty update, a non-positive duration and a date past tomorrow", async () => {
      await signIn("anna@example.com");
      const issue = await issueByKey("TAS-101");
      const [first] = await api.listIssueWorklogs(project.id, issue.id);
      await expect(api.updateIssueWorklog(project.id, issue.id, first.id, {})).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "No data provided for update",
      });
      await expect(
        api.addIssueWorklog(project.id, issue.id, { spentMinutes: 0, workDate: "2026-06-14" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      await expect(
        api.addIssueWorklog(project.id, issue.id, { spentMinutes: 10, workDate: "2999-01-01" }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "WorkDate is too far in the future" });
      await expect(
        api.addIssueWorklog(project.id, issue.id, { spentMinutes: 10, workDate: "2026-06-14", comment: "x".repeat(2001) }),
      ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    });

    it("answers 404 for a worklog of another issue", async () => {
      await signIn("anna@example.com");
      const tas101 = await issueByKey("TAS-101");
      const tas107 = await issueByKey("TAS-107");
      const [other] = await api.listIssueWorklogs(project.id, tas107.id);
      await expect(api.updateIssueWorklog(project.id, tas101.id, other.id, { spentMinutes: 5 })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(api.deleteIssueWorklog(project.id, tas101.id, other.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await api.listIssueWorklogs(project.id, tas107.id)).toHaveLength(2);
    });

    it("lets a MEMBER change their own entry and nobody else's, and an ADMIN change anybody's", async () => {
      const issue = await issueByKey("TAS-101");
      await signIn("mark@example.com");
      const entries = await api.listIssueWorklogs(project.id, issue.id);
      const marks = entries.find((item) => item.authorUserId === "e65186a2-b807-42ae-a66f-711be116a93b");
      const someoneElses = entries.find((item) => item.authorUserId !== "e65186a2-b807-42ae-a66f-711be116a93b");
      if (!marks || !someoneElses) throw new Error("seed changed");

      await expect(api.updateIssueWorklog(project.id, issue.id, marks.id, { spentMinutes: 100 })).resolves.toMatchObject({
        spentMinutes: 100,
      });
      await expect(
        api.updateIssueWorklog(project.id, issue.id, someoneElses.id, { spentMinutes: 100 }),
      ).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: "Not allowed role" });
      await expect(api.deleteIssueWorklog(project.id, issue.id, someoneElses.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });

      await signIn("anna@example.com");
      await api.deleteIssueWorklog(project.id, issue.id, marks.id);
      expect((await api.listIssueWorklogs(project.id, issue.id)).map((item) => item.id)).not.toContain(marks.id);
    });

    it("writes a history row for each write", async () => {
      await signIn("anna@example.com");
      const issue = await issueByKey("TAS-101");
      const added = await api.addIssueWorklog(project.id, issue.id, { spentMinutes: 45, workDate: "2026-06-14" });
      await api.updateIssueWorklog(project.id, issue.id, added.id, { workDate: "2026-06-13" });
      await api.deleteIssueWorklog(project.id, issue.id, added.id);
      const { history } = await api.getIssue(project.id, issue.id);
      const events = history.map((event) => event.eventType).filter((type) => type.startsWith("WORKLOG_"));
      expect(events).toEqual(["WORKLOG_ADDED", "WORKLOG_UPDATED", "WORKLOG_DELETED"]);
      expect(history.find((event) => event.eventType === "WORKLOG_ADDED")?.payload.worklogSpentMinutes).toBe(45);
    });
  });

  /**
   * Backend PR #208 (TAS-381), as api-contract-guard read it from the Java at
   * `9a04e99` for TAS-382: the list `ProjectWorkflowListService` builds, the
   * create `WorkflowCreateService` makes, the adds `WorkflowEditService`
   * makes, and every refusal in their order and their words.
   */
  describe("project workflows", () => {
    const signIn = (email: string) => api.login({ email, password: "anything" });
    const projectByKey = async (key: string) => (await api.listProjects()).find((item) => item.projectKey === key)!;
    /** The shared default as the list sends it, with its last transition made hidden for the copy. */
    const copyWithHidden = async (projectId: string, name: string, issueTypes: string[]) => {
      const [shared] = await api.listProjectWorkflows(projectId);
      const input = workflowCopyInput(shared.workflow, name, issueTypes);
      return { ...input, transitions: input.transitions.map((item, index, all) => ({ ...item, hidden: index === all.length - 1 })) };
    };
    const status = { statusKey: "CODE_REVIEW", name: "Code Review", category: "IN_PROGRESS", sortOrder: 25 };
    const UNKNOWN_WORKFLOW = "0f0f0f0f-0000-4000-8000-000000000382";

    it("lists the shared default once, with every type and the six transitions of migration 0001", async () => {
      const entries = await api.listProjectWorkflows(project.id);

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ shared: true, issueTypes: ["TASK", "BUG", "STORY"] });
      expect(entries[0].workflow.statuses.map((item) => item.statusKey)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
      expect(entries[0].workflow.transitions.map((item) => [item.name, item.sortOrder, item.hidden])).toEqual([
        ["Start Progress", 10, false],
        ["Complete", 20, false],
        ["Reopen", 30, false],
        ["Stop Progress", 40, false],
        ["Close", 50, false],
        ["Back to To Do", 60, false],
      ]);
      // The old invented name is gone; the three new moves reach the board, by
      // sortOrder as the server's repository reads them (Reopen 30 before Stop Progress 40).
      const context = await taskWorkflow();
      expect(context.transitions.map((item) => item.name)).toEqual([
        "Start Progress",
        "Complete",
        "Reopen",
        "Stop Progress",
        "Close",
        "Back to To Do",
      ]);
    });

    it("walks TASK, BUG and STORY whatever the project allows, and leaves WEB's EPIC workflow out", async () => {
      const ops = await projectByKey("OPS");
      const web = await projectByKey("WEB");

      expect((await api.listProjectWorkflows(ops.id)).map((entry) => entry.issueTypes)).toEqual([["TASK", "BUG", "STORY"]]);
      const webEntries = await api.listProjectWorkflows(web.id);
      expect(webEntries.map((entry) => [entry.workflow.name, entry.issueTypes])).toEqual([
        ["Default workflow", ["TASK", "BUG", "STORY"]],
      ]);
    });

    it("refuses the list to a missing project and to a non-member, a GLOBAL_ADMIN included", async () => {
      await expect(api.listProjectWorkflows("missing")).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found" });
      const web = await projectByKey("WEB");
      // Mark is the seed's GLOBAL_ADMIN and not on WEB.
      await signIn("mark@example.com");
      await expect(api.listProjectWorkflows(web.id)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        message: "You don't have access to this project",
      });
    });

    it("creates from a copy and answers ProjectWorkflowDto: by sortOrder, hidden ones marked, version 1, its types, not shared", async () => {
      const input = await copyWithHidden(project.id, "  Development  ", ["BUG"]);

      const answer = await api.createProjectWorkflow(project.id, input);
      const created = answer.workflow;

      // Backend PR #225: every write answers the whole workflow with its types.
      expect(answer).toMatchObject({ issueTypes: ["BUG"], shared: false });
      expect(created).toMatchObject({ name: "Development", version: 1 });
      expect(created.statuses.map((item) => item.statusKey)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
      expect(created.transitions.map((item) => [item.sortOrder, item.hidden])).toEqual([
        [10, false],
        [20, false],
        [30, false],
        [40, false],
        [50, false],
        [60, true],
      ]);

      const entries = await api.listProjectWorkflows(project.id);
      expect(entries.map((entry) => [entry.workflow.id === created.id, entry.shared, entry.issueTypes])).toEqual([
        [false, true, ["TASK", "STORY"]],
        [true, false, ["BUG"]],
      ]);
      // The context reads only the visible transitions, and none carries the flag.
      const bug = (await api.getProjectContext(project.id)).workflows.BUG!;
      expect(bug.id).toBe(created.id);
      expect(bug.transitions).toHaveLength(5);
      for (const transition of bug.transitions) expect(transition).not.toHaveProperty("hidden");
    });

    it("refuses a create in the server's order: the gateway, the role, the body, then a type already bound", async () => {
      const ops = await projectByKey("OPS");
      const input = await copyWithHidden(project.id, "Development", ["TASK"]);

      await expect(api.createProjectWorkflow(project.id, { ...input, issueTypes: ["EPIC"] })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Invalid request parameters",
      });
      await expect(
        api.createProjectWorkflow(project.id, { ...input, statuses: [{ ...input.statuses[0], category: "REVIEW" }] }),
      ).rejects.toMatchObject({ message: "Invalid request parameters" });
      await expect(api.createProjectWorkflow("missing", input)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Project not found" });

      await signIn("mark@example.com");
      await expect(api.createProjectWorkflow(project.id, input)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        message: "Not allowed role",
      });
      await expect(api.createProjectWorkflow(ops.id, input)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        message: "Access denied",
      });

      await signIn("anna@example.com");
      // On create a duplicate is a 400 like everything else, in validateDto's order.
      await expect(
        api.createProjectWorkflow(project.id, {
          name: " ",
          issueTypes: ["TASK", "TASK"],
          statuses: [
            { statusKey: "TODO", name: "To Do", category: "TODO", sortOrder: 10 },
            { statusKey: " TODO ", name: "Again", category: "TODO", sortOrder: 20 },
          ],
          transitions: [{ fromStatusKey: " TODO", toStatusKey: "TODO", name: "Loop", sortOrder: -1, hidden: false }],
        }),
      ).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message:
          "Workflow creation failed: Workflow name must not be blank, Duplicate issue type: TASK, Status key is not unique: TODO, " +
          "Transition references unknown status key:  TODO, Transition sort order must not be negative: from  TODO to TODO",
      });

      const first = await api.createProjectWorkflow(project.id, input);
      expect(first.workflow.id).toBeTruthy();
      await expect(api.createProjectWorkflow(project.id, { ...input, issueTypes: ["BUG", "TASK"] })).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
        message: `Workflow binding already exists for project ${project.id} and issue types: [TASK]`,
      });
    });

    it("accepts a create with no status and no transition, as the server does (docs/ai/API-DIVERGENCE.md)", async () => {
      await expect(
        api.createProjectWorkflow(project.id, { name: "Empty", issueTypes: ["STORY"], statuses: [], transitions: [] }),
      ).resolves.toMatchObject({ workflow: { statuses: [], transitions: [] } });
    });

    it("adds a status and a transition: the 201 the whole workflow by sortOrder, hidden ones included, the version up each time", async () => {
      const { workflow: created } = await api.createProjectWorkflow(
        project.id,
        await copyWithHidden(project.id, "Development", ["TASK"]),
      );

      const statusAnswer = await api.addWorkflowStatus(project.id, created.id, { ...status, name: "  Code Review " });
      const afterStatus = statusAnswer.workflow;
      expect(statusAnswer).toMatchObject({ issueTypes: ["TASK"], shared: false });
      expect(afterStatus.version).toBe(2);
      expect(afterStatus.statuses.map((item) => item.statusKey)).toEqual(["TODO", "IN_PROGRESS", "CODE_REVIEW", "DONE"]);
      expect(afterStatus.statuses.find((item) => item.statusKey === "CODE_REVIEW")?.name).toBe("Code Review");
      // Since backend PR #225 the hidden transition is in the answer, as in the list.
      expect(afterStatus.transitions.filter((item) => item.hidden)).toHaveLength(1);
      expect(afterStatus.transitions).toHaveLength(6);

      const { workflow: afterTransition } = await api.addWorkflowTransition(project.id, created.id, {
        fromStatusKey: "IN_PROGRESS",
        toStatusKey: "CODE_REVIEW",
        name: "Move to Code Review",
        sortOrder: 70,
        hidden: false,
      });
      expect(afterTransition.version).toBe(3);
      expect(afterTransition.transitions.at(-1)?.name).toBe("Move to Code Review");

      // On the board at once: the column, and the move from In Progress.
      const board = await api.getBoard(project.id, { issueType: "TASK" });
      expect(board.columns.map((column) => column.statusKey)).toEqual(["TODO", "IN_PROGRESS", "CODE_REVIEW", "DONE"]);
      const context = await taskWorkflow();
      const move = context.transitions.find((item) => item.name === "Move to Code Review")!;
      const doing = (await api.listIssues(project.id)).items.find((item) => item.issueType === "TASK" && item.status === "IN_PROGRESS")!;
      await expect(api.transitionIssue(project.id, doing.id, move.id)).resolves.toMatchObject({ status: "CODE_REVIEW" });
    });

    it("refuses an add in the server's order: the path, the role, an unknown workflow, the shared one, another project's", async () => {
      const web = await projectByKey("WEB");
      const [shared] = await api.listProjectWorkflows(project.id);
      const { workflow: elsewhere } = await api.createProjectWorkflow(web.id, await copyWithHidden(web.id, "Web flow", ["TASK"]));

      await expect(api.addWorkflowStatus(project.id, "not-a-uuid", status)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: "Invalid request parameters",
      });
      await signIn("mark@example.com");
      await expect(api.addWorkflowStatus(project.id, UNKNOWN_WORKFLOW, status)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        message: "Not allowed role",
      });
      await signIn("anna@example.com");
      await expect(api.addWorkflowStatus(project.id, UNKNOWN_WORKFLOW, status)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: `Workflow not found: id=${UNKNOWN_WORKFLOW}`,
      });
      for (const write of [
        () => api.addWorkflowStatus(project.id, shared.workflow.id, status),
        () =>
          api.addWorkflowTransition(project.id, shared.workflow.id, {
            fromStatusKey: "TODO",
            toStatusKey: "DONE",
            name: "Again",
            sortOrder: 70,
            hidden: false,
          }),
      ]) {
        await expect(write()).rejects.toMatchObject({
          code: "FAILED_PRECONDITION",
          message: `Default workflow is shared by all projects and cannot be modified: id=${shared.workflow.id}. Create a project workflow first`,
        });
      }
      await expect(api.addWorkflowStatus(project.id, elsewhere.id, status)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: `Workflow not found in project: id=${elsewhere.id}`,
      });
    });

    it("re-validates the whole workflow on an add: 409 only when every violation is a duplicate key or pair", async () => {
      const { workflow: created } = await api.createProjectWorkflow(
        project.id,
        await copyWithHidden(project.id, "Development", ["TASK"]),
      );
      const addStatus = (input: Partial<typeof status>) => api.addWorkflowStatus(project.id, created.id, { ...status, ...input });
      const addTransition = (input: { fromStatusKey: string; toStatusKey: string; sortOrder: number }) =>
        api.addWorkflowTransition(project.id, created.id, { name: "Move", hidden: false, ...input });
      const prefix = "Workflow update failed: ";

      await expect(addStatus({ statusKey: " TODO " })).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
        message: `${prefix}Status key is not unique: TODO`,
      });
      await expect(addStatus({ sortOrder: 10 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: `${prefix}Status sort order is not unique: 10`,
      });
      await expect(addStatus({ statusKey: "TODO", sortOrder: 10 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: `${prefix}Status key is not unique: TODO, Status sort order is not unique: 10`,
      });
      await expect(addStatus({ statusKey: "qa" })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: `${prefix}Status key has invalid format: qa`,
      });
      await expect(addStatus({ name: "x".repeat(101) })).rejects.toMatchObject({
        message: `${prefix}Status name exceeds maximum length of 100 for status: CODE_REVIEW`,
      });

      await expect(addTransition({ fromStatusKey: "TODO", toStatusKey: "IN_PROGRESS", sortOrder: 70 })).rejects.toMatchObject({
        code: "ALREADY_EXISTS",
        message: `${prefix}Duplicate transition from 'TODO' to 'IN_PROGRESS'`,
      });
      // The hidden transition's 60 is taken too: the list shows it, the context does not.
      // A duplicate pair beside anything else is a 400, in validateDto's order.
      await expect(addTransition({ fromStatusKey: "IN_PROGRESS", toStatusKey: "DONE", sortOrder: 60 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: `${prefix}Transition sort order is not unique: 60, Duplicate transition from 'IN_PROGRESS' to 'DONE'`,
      });
      await expect(addTransition({ fromStatusKey: "TODO", toStatusKey: "TODO", sortOrder: 70 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: `${prefix}Self-transition is not allowed for status: TODO`,
      });
      await expect(addTransition({ fromStatusKey: "TODO", toStatusKey: "NOPE", sortOrder: 70 })).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        message: `${prefix}Transition references unknown status key: NOPE`,
      });
      // Nothing refused moved the version.
      const own = (await api.listProjectWorkflows(project.id)).find((entry) => !entry.shared);
      expect(own?.workflow.version).toBe(1);
    });

    /**
     * Backend PR #225 (TAS-384, develop `6ba4ed6`): the six edit and delete
     * routes as `WorkflowMutationService` and issue-service's
     * `WorkflowIssueMigrationService` run them.
     */
    describe("edits and deletes", () => {
      const ownWorkflow = async (types: string[] = ["TASK"]) =>
        (await api.createProjectWorkflow(project.id, await copyWithHidden(project.id, "Development", types))).workflow;
      const statusOf = <T extends { statusKey: string }>(workflow: { statuses: T[] }, key: string) =>
        workflow.statuses.find((item) => item.statusKey === key)!;
      const transitionNamed = <T extends { name: string }>(workflow: { transitions: T[] }, name: string) =>
        workflow.transitions.find((item) => item.name === name)!;
      const tasksIn = async (statusKey: string) =>
        (await api.listIssues(project.id)).items.filter((item) => item.issueType === "TASK" && item.status === statusKey);

      it("renames, changes a status and a transition, each answering the whole workflow one version up", async () => {
        const created = await ownWorkflow();

        const renamed = await api.updateProjectWorkflow(project.id, created.id, { version: 1, name: "  Delivery " });
        expect(renamed).toMatchObject({ issueTypes: ["TASK"], shared: false, workflow: { name: "Delivery", version: 2 } });

        const doing = statusOf(created, "IN_PROGRESS");
        const moved = await api.updateWorkflowStatus(project.id, created.id, doing.id, {
          version: 2,
          name: "Doing",
          sortOrder: 35,
        });
        expect(moved.workflow.version).toBe(3);
        // By sortOrder; the key never changes.
        expect(moved.workflow.statuses.map((item) => [item.statusKey, item.name, item.sortOrder])).toEqual([
          ["TODO", "To Do", 10],
          ["DONE", "Done", 30],
          ["IN_PROGRESS", "Doing", 35],
        ]);
        const board = await api.getBoard(project.id, { issueType: "TASK" });
        expect(board.columns.map((column) => [column.statusKey, column.name])).toEqual([
          ["TODO", "To Do"],
          ["DONE", "Done"],
          ["IN_PROGRESS", "Doing"],
        ]);

        const close = transitionNamed(created, "Close");
        const hidden = await api.updateWorkflowTransition(project.id, created.id, close.id, {
          version: 3,
          name: "Shut",
          sortOrder: 55,
          hidden: true,
        });
        expect(hidden.workflow.version).toBe(4);
        expect(hidden.workflow.transitions.find((item) => item.id === close.id)).toMatchObject({
          name: "Shut",
          sortOrder: 55,
          hidden: true,
          fromStatusId: close.fromStatusId,
          toStatusId: close.toStatusId,
        });
        // The board offers no hidden transition.
        expect((await taskWorkflow()).transitions.map((item) => item.name)).not.toContain("Shut");
      });

      it("serves the context's statuses and transitions by sortOrder once an edit has renumbered them", async () => {
        const created = await ownWorkflow();
        const close = transitionNamed(created, "Close");
        const done = statusOf(created, "DONE");

        await api.updateWorkflowTransition(project.id, created.id, close.id, { version: 1, sortOrder: 5 });
        await api.updateWorkflowStatus(project.id, created.id, done.id, { version: 2, sortOrder: 5 });

        const context = await taskWorkflow();
        // The order the issue panel offers its move buttons in.
        expect(context.transitions.map((item) => [item.name, item.sortOrder])).toEqual([
          ["Close", 5],
          ["Start Progress", 10],
          ["Complete", 20],
          ["Reopen", 30],
          ["Stop Progress", 40],
        ]);
        expect(context.statuses.map((item) => [item.statusKey, item.sortOrder])).toEqual([
          ["DONE", 5],
          ["TODO", 10],
          ["IN_PROGRESS", 20],
        ]);
      });

      it("compares the version: a stale one is ABORTED and changes nothing, one left out is not compared", async () => {
        const created = await ownWorkflow();
        await api.updateProjectWorkflow(project.id, created.id, { version: 1, name: "Second" });

        await expect(api.updateProjectWorkflow(project.id, created.id, { version: 1, name: "Third" })).rejects.toMatchObject({
          code: "ABORTED",
          message: "Workflow version changed",
        });
        await expect(
          api.deleteWorkflowStatus(project.id, created.id, statusOf(created, "DONE").id, { version: 1 }),
        ).rejects.toMatchObject({ code: "ABORTED" });
        expect((await api.listProjectWorkflows(project.id)).find((entry) => !entry.shared)?.workflow).toMatchObject({
          name: "Second",
          version: 2,
        });

        await expect(api.updateProjectWorkflow(project.id, created.id, { name: "Third" })).resolves.toMatchObject({
          workflow: { name: "Third", version: 3 },
        });
      });

      it("refuses what the gateway would and what has nothing to change, and a row or workflow not this one's", async () => {
        const created = await ownWorkflow();
        const [shared] = (await api.listProjectWorkflows(project.id)).filter((entry) => entry.shared);
        const doing = statusOf(created, "IN_PROGRESS").id;
        const invalid = { code: "INVALID_ARGUMENT", message: "Invalid request parameters" };

        // additionalProperties: false, no explicit null, the DTO's bounds.
        for (const body of [{ name: null }, { statusKey: "DOING" }, { sortOrder: -1 }, { category: "REVIEW" }, { version: 0, name: "x" }]) {
          await expect(
            api.updateWorkflowStatus(project.id, created.id, doing, body as unknown as { name: string }),
          ).rejects.toMatchObject(invalid);
        }
        await expect(api.updateWorkflowStatus(project.id, created.id, "not-a-uuid", { name: "x" })).rejects.toMatchObject(invalid);
        await expect(
          api.deleteWorkflowStatus(project.id, created.id, doing, { targetStatusKey: "to do" }),
        ).rejects.toMatchObject(invalid);

        await expect(api.updateWorkflowStatus(project.id, created.id, doing, { version: 1 })).rejects.toMatchObject({
          code: "INVALID_ARGUMENT",
          message: "At least one status field is required",
        });
        await expect(
          api.updateWorkflowTransition(project.id, created.id, created.transitions[0].id, { version: 1 }),
        ).rejects.toMatchObject({ message: "At least one transition field is required" });
        await expect(api.updateProjectWorkflow(project.id, created.id, { version: 1 })).rejects.toMatchObject({
          message: "name is required",
        });

        await expect(api.updateWorkflowStatus(project.id, created.id, UNKNOWN_WORKFLOW, { name: "x" })).rejects.toMatchObject({
          code: "NOT_FOUND",
          message: "Status not found in this workflow",
        });
        await expect(api.deleteWorkflowTransition(project.id, created.id, UNKNOWN_WORKFLOW, {})).rejects.toMatchObject({
          code: "NOT_FOUND",
          message: "Transition not found in this workflow",
        });
        await expect(api.updateProjectWorkflow(project.id, shared.workflow.id, { name: "Mine" })).rejects.toMatchObject({
          code: "FAILED_PRECONDITION",
          message: `Default workflow is shared by all projects and cannot be modified: id=${shared.workflow.id}. Create a project workflow first`,
        });
        await signIn("mark@example.com");
        await expect(api.updateProjectWorkflow(project.id, created.id, { name: "Mine" })).rejects.toMatchObject({
          code: "PERMISSION_DENIED",
          message: "Not allowed role",
        });
      });

      it("keeps a TODO and a visible transition, and refuses a sortOrder another row holds as a 400", async () => {
        const created = await ownWorkflow();
        const prefix = "Workflow update failed: ";

        await expect(
          api.deleteWorkflowStatus(project.id, created.id, statusOf(created, "TODO").id, { version: 1 }),
        ).rejects.toMatchObject({ code: "FAILED_PRECONDITION", message: "The initial TODO status cannot be deleted" });
        await expect(
          api.updateWorkflowStatus(project.id, created.id, statusOf(created, "IN_PROGRESS").id, { version: 1, sortOrder: 10 }),
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: `${prefix}Status sort order is not unique: 10` });
        await expect(
          api.updateWorkflowTransition(project.id, created.id, transitionNamed(created, "Complete").id, {
            version: 1,
            sortOrder: 10,
          }),
        ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: `${prefix}Transition sort order is not unique: 10` });

        // Hide every visible transition but one; the last one cannot go.
        let version = 1;
        const visible = created.transitions.filter((item) => !item.hidden);
        for (const transition of visible.slice(0, -1)) {
          version = (await api.updateWorkflowTransition(project.id, created.id, transition.id, { version, hidden: true }))
            .workflow.version;
        }
        const last = visible.at(-1)!;
        const requires = { code: "INVALID_ARGUMENT", message: "Workflow requires a TODO status and at least one visible transition" };
        await expect(api.updateWorkflowTransition(project.id, created.id, last.id, { version, hidden: true })).rejects.toMatchObject(
          requires,
        );
        await expect(api.deleteWorkflowTransition(project.id, created.id, last.id, { version })).rejects.toMatchObject(requires);
        expect((await api.listProjectWorkflows(project.id)).find((entry) => !entry.shared)?.workflow.version).toBe(version);
      });

      it("deletes a status with its transitions; one with issues is refused with the count until a target takes them", async () => {
        const created = await ownWorkflow();
        const doing = statusOf(created, "IN_PROGRESS");
        const moving = await tasksIn("IN_PROGRESS");
        const bugsDoing = (await api.listIssues(project.id)).items.filter(
          (item) => item.issueType === "BUG" && item.status === "IN_PROGRESS",
        );
        expect(moving.length).toBeGreaterThan(0);

        const refusal = await api
          .deleteWorkflowStatus(project.id, created.id, doing.id, { version: 1 })
          .catch((error: unknown) => error);
        expect(apiErrorFacts(refusal)).toMatchObject({
          code: "FAILED_PRECONDITION",
          message: `Workflow statuses have ${moving.length} issues; supply a target status mapping`,
          details: { issueCount: String(moving.length), statusKeys: "IN_PROGRESS" },
        });
        for (const target of ["IN_PROGRESS", "NOPE"]) {
          await expect(
            api.deleteWorkflowStatus(project.id, created.id, doing.id, { version: 1, targetStatusKey: target }),
          ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", message: "Target status is not in this workflow" });
        }

        const answer = await api.deleteWorkflowStatus(project.id, created.id, doing.id, { version: 1, targetStatusKey: "TODO" });
        expect(answer.workflow.version).toBe(2);
        expect(answer.workflow.statuses.map((item) => item.statusKey)).toEqual(["TODO", "DONE"]);
        expect(
          answer.workflow.transitions.filter((item) => item.fromStatusId === doing.id || item.toStatusId === doing.id),
        ).toEqual([]);
        expect(answer.workflow.transitions.map((item) => item.name)).toEqual(["Close", "Back to To Do"]);

        // The tasks moved, with a history entry that says why; the bugs, on the shared default, did not.
        expect((await tasksIn("TODO")).map((item) => item.id)).toEqual(expect.arrayContaining(moving.map((item) => item.id)));
        const history = (await api.getIssue(project.id, moving[0].id)).history;
        expect(history.at(-1)).toMatchObject({
          eventType: "TRANSITIONED",
          payload: { from: "IN_PROGRESS", to: "TODO", reason: "WORKFLOW_CONFIGURATION_CHANGED", workflowId: created.id },
        });
        const stillDoing = (await api.listIssues(project.id)).items.filter(
          (item) => item.issueType === "BUG" && item.status === "IN_PROGRESS",
        );
        expect(stillDoing.map((item) => item.id)).toEqual(bugsDoing.map((item) => item.id));

        // A status nobody is in goes at once.
        const added = await api.addWorkflowStatus(project.id, created.id, status);
        const review = statusOf(added.workflow, "CODE_REVIEW");
        await expect(
          api.deleteWorkflowStatus(project.id, created.id, review.id, { version: added.workflow.version }),
        ).resolves.toMatchObject({ workflow: { statuses: [{ statusKey: "TODO" }, { statusKey: "DONE" }] } });
      });

      it("deletes a transition, which the board then no longer offers", async () => {
        const created = await ownWorkflow();
        const close = transitionNamed(created, "Close");

        const answer = await api.deleteWorkflowTransition(project.id, created.id, close.id, { version: 1 });

        expect(answer.workflow.transitions.map((item) => item.id)).not.toContain(close.id);
        expect((await taskWorkflow()).transitions.map((item) => item.name)).not.toContain("Close");
      });

      it("deletes an own workflow: its types back on the shared default, the statuses it lacks mapped first", async () => {
        const created = await ownWorkflow();
        const [shared] = (await api.listProjectWorkflows(project.id)).filter((entry) => entry.shared);
        const added = await api.addWorkflowStatus(project.id, created.id, status);
        const withMove = await api.addWorkflowTransition(project.id, created.id, {
          fromStatusKey: "IN_PROGRESS",
          toStatusKey: "CODE_REVIEW",
          name: "Move to Code Review",
          sortOrder: 70,
          hidden: false,
        });
        const [task] = await tasksIn("IN_PROGRESS");
        const move = (await taskWorkflow()).transitions.find((item) => item.name === "Move to Code Review")!;
        await api.transitionIssue(project.id, task.id, move.id);
        const version = withMove.workflow.version;
        expect(version).toBe(added.workflow.version + 1);

        const refusal = await api.deleteProjectWorkflow(project.id, created.id, { version }).catch((error: unknown) => error);
        expect(apiErrorFacts(refusal)).toMatchObject({
          code: "FAILED_PRECONDITION",
          message: "Workflow statuses have 1 issues; supply a target status mapping",
          details: { issueCount: "1", statusKeys: "CODE_REVIEW" },
        });
        const both = {
          code: "INVALID_ARGUMENT",
          message: "Map to statuses present in both workflows; add a target status to the current workflow first if needed",
        };
        const wrong: Record<string, string>[] = [{ CODE_REVIEW: "CODE_REVIEW" }, { NOPE: "TODO" }, { CODE_REVIEW: "NOPE" }];
        for (const statusMappings of wrong) {
          await expect(api.deleteProjectWorkflow(project.id, created.id, { version, statusMappings })).rejects.toMatchObject(both);
        }
        await expect(
          api.deleteProjectWorkflow(project.id, created.id, { version: 1, statusMappings: { CODE_REVIEW: "IN_PROGRESS" } }),
        ).rejects.toMatchObject({ code: "ABORTED" });

        const answer = await api.deleteProjectWorkflow(project.id, created.id, {
          version,
          statusMappings: { CODE_REVIEW: "IN_PROGRESS" },
        });

        // The shared default, with the deleted workflow's types only.
        expect(answer).toMatchObject({ shared: true, issueTypes: ["TASK"], workflow: { id: shared.workflow.id } });
        expect(answer.workflow.transitions).toHaveLength(6);
        expect((await api.listProjectWorkflows(project.id)).map((entry) => [entry.shared, entry.issueTypes])).toEqual([
          [true, ["TASK", "BUG", "STORY"]],
        ]);
        expect((await taskWorkflow()).id).toBe(shared.workflow.id);
        expect((await api.getIssue(project.id, task.id)).issue.status).toBe("IN_PROGRESS");
        await expect(api.updateProjectWorkflow(project.id, created.id, { name: "Gone" })).rejects.toMatchObject({
          code: "NOT_FOUND",
        });
      });

      it("refuses an edit on an archived project with the archive's reason", async () => {
        const created = await ownWorkflow();
        await api.archiveProject(project.id);

        const refusal = await api.updateProjectWorkflow(project.id, created.id, { name: "Late" }).catch((error: unknown) => error);

        expect(apiErrorFacts(refusal)).toMatchObject({ code: "FAILED_PRECONDITION", details: { reason: "PROJECT_ARCHIVED" } });
      });
    });
  });
});
