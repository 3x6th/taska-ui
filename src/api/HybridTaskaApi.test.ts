import { beforeEach, describe, expect, it, vi } from "vitest";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { isConflict } from "./errors";

/**
 * HybridTaskaApi is a compensation for a gateway gap, not a feature — see
 * docs/ai/API-DIVERGENCE.md. These tests pin exactly how much it invents, so
 * that when TAS-137 ships and the class is deleted, the behaviour being removed
 * is written down rather than remembered.
 */
describe("HybridTaskaApi", () => {
  const liveApi = () => new MockTaskaApi();

  // Since TAS-150 the mock reads a persisted session out of localStorage in its
  // constructor, so the fixture is no longer stateless: a session left behind by
  // another file would decide which user these cases run as.
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("delegates everything except membership and member reads", async () => {
    const live = liveApi();
    const listIssues = vi.spyOn(live, "listIssues");
    const getWorkflow = vi.spyOn(live, "getWorkflow");

    const hybrid = new HybridTaskaApi(live);
    const [project] = await hybrid.listProjects();

    await hybrid.listIssues(project.id);
    await hybrid.getWorkflow(project.id);

    expect(listIssues).toHaveBeenCalledWith(project.id, undefined);
    expect(getWorkflow).toHaveBeenCalledWith(project.id, undefined);
  });

  // The board route is deployed and measured (TAS-191), so this class has
  // nothing to add to it. Both halves matter: the call reaches live with the
  // filters untouched, and a failure comes back as a failure rather than as a
  // synthesised board — a compensation invented here would be a board nobody
  // could tell from the server's.
  it("delegates the board read to live, filters and all", async () => {
    const live = liveApi();
    const getBoard = vi.spyOn(live, "getBoard");
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await hybrid.listProjects();

    const params = { issueType: "TASK", includeDone: true } as const;
    const board = await hybrid.getBoard(project.id, params);

    expect(getBoard).toHaveBeenCalledWith(project.id, params);
    expect(board.columns.map((column) => column.statusKey)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
  });

  it("lets a failing board read fail", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await live.listProjects();
    vi.spyOn(live, "getBoard").mockRejectedValue(new Error("Internal error"));

    await expect(hybrid.getBoard(project.id, { issueType: "TASK" })).rejects.toThrow("Internal error");
  });

  it("synthesises membership without calling any endpoint at all", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await hybrid.listProjects();

    // Spied after the setup call above, so these count only what the membership
    // read itself does.
    const getMembership = vi.spyOn(live, "getMembership");
    const getProject = vi.spyOn(live, "getProject");
    const getCurrentUser = vi.spyOn(live, "getCurrentUser");

    const membership = await hybrid.getMembership(project.id);

    expect(membership).toEqual({ role: "ADMIN", isMember: true, projectExists: true });
    // The endpoint that does not exist yet (TAS-137) is still not called — and
    // neither are the two that do. Under this flag the answer is a constant,
    // so a read of the project only added a way for it to fail; the absence of
    // the call is the point, not the ADMIN above it.
    expect(getMembership).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  // The reason the call had to go: on the deployed stand this flag is on and
  // `GET /projects/{id}` is a 500 (TAS-162), which used to revoke write access
  // to the whole board. What must NOT follow is a member list invented without
  // the project — `addedAt` and `addedBy` only exist there.
  it("keeps the assumed role when the project read is failing, and still fails the member list", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await live.listProjects();
    vi.spyOn(live, "getProject").mockRejectedValue(new Error("Internal error"));

    await expect(hybrid.getMembership(project.id)).resolves.toEqual({
      role: "ADMIN",
      isMember: true,
      projectExists: true,
    });
    await expect(hybrid.listMembers(project.id)).rejects.toThrow("Internal error");
  });

  it("reports a single member — the current user — and nobody else", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);

    const [project] = await hybrid.listProjects();
    const realMembers = await live.listMembers(project.id);
    const members = await hybrid.listMembers(project.id);
    const me = await hybrid.getCurrentUser();

    // The gap that matters: a project with several real members appears to
    // have exactly one. Assignee filters and chips can only ever offer self.
    expect(realMembers.length).toBeGreaterThan(1);
    expect(members).toHaveLength(1);
    expect(members[0].userId).toBe(me.id);
  });

  // What exactly disappears the day PR #152 (TAS-137) deploys and these two
  // methods become plain delegations. `addedAt` and `addedBy` are optional on
  // `ProjectMember` since TAS-219 precisely because the wire does not carry
  // them — this class is the only thing in the codebase that produces them, and
  // it produces them from the project rather than from any record of when
  // anybody joined.
  it("synthesises the whole row from the project, timestamps included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await hybrid.listProjects();
    const me = await hybrid.getCurrentUser();

    await expect(hybrid.listMembers(project.id)).resolves.toEqual([
      {
        userId: me.id,
        role: "ADMIN",
        addedAt: project.createdAt,
        addedBy: project.createdBy,
        user: { displayName: me.displayName, email: me.email, color: me.color },
      },
    ]);
  });

  // The compensation does not read `currentUserRole`, and that is deliberate
  // rather than an oversight: while PR #152 is undeployed the field never
  // arrives, and once it does the fix is to delete this class's two
  // compensations — `getMembership` and `listMembers` become
  // `this.live.*` and the `assumeProjectAdmin` argument goes — not to teach the
  // synthesis a new input. Until that happens a real MEMBER who did not create
  // the project is a VIEWER here, which is the same floor the rest leg takes
  // and the same direction: hide a write rather than offer a refused one.
  it("keeps deriving the role from createdBy even when live states one", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, false);
    const [project] = await live.listProjects();
    const someoneElse = "00000000-0000-4000-8000-000000000000";
    vi.spyOn(live, "getProject").mockResolvedValue({
      ...project,
      createdBy: someoneElse,
      currentUserRole: "MEMBER",
    });

    await expect(hybrid.getMembership(project.id)).resolves.toMatchObject({ role: "VIEWER" });
  });

  // The hybrid invents a project role; the global role is not its business. It
  // has to arrive from the wrapped implementation exactly as that one produced
  // it, or the three implementations stop being interchangeable.
  it("passes the global role through untouched", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);

    await expect(hybrid.getCurrentUser()).resolves.toEqual(await live.getCurrentUser());
    await expect(hybrid.getCurrentUser()).resolves.toMatchObject({ globalRole: "USER" });

    await live.login({ email: "mark@example.com", password: "correct" });

    await expect(hybrid.getCurrentUser()).resolves.toEqual(await live.getCurrentUser());
    await expect(hybrid.getCurrentUser()).resolves.toMatchObject({ globalRole: "GLOBAL_ADMIN" });
  });

  it("falls back to VIEWER when the admin assumption is off and the user did not create the project", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, false);

    const [project] = await live.listProjects();
    const someoneElse = "00000000-0000-4000-8000-000000000000";
    // Every seeded project is created by the current user, so the foreign case
    // has to be constructed rather than found.
    vi.spyOn(live, "getProject").mockResolvedValue({ ...project, createdBy: someoneElse });

    await expect(hybrid.getMembership(project.id)).resolves.toMatchObject({ role: "VIEWER" });
  });

  it("grants ADMIN on a project the current user created even without the flag", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, false);

    const projects = await hybrid.listProjects();
    const me = await hybrid.getCurrentUser();
    const own = projects.find((project) => project.createdBy === me.id);

    expect(own).toBeDefined();
    await expect(hybrid.getMembership(own!.id)).resolves.toMatchObject({ role: "ADMIN" });
  });

  // Without the flag the project read is not decoration: it is where the role
  // comes from. A failure there has to reach the caller, because a role that
  // could not be derived is not one this class may invent — and the board's
  // "your role could not be loaded" state is exactly what that failure feeds.
  it("rejects when the project read fails and the assumption is off", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, false);
    const [project] = await live.listProjects();
    vi.spyOn(live, "getProject").mockRejectedValue(new Error("Internal error"));

    await expect(hybrid.getMembership(project.id)).rejects.toThrow("Internal error");
  });

  /**
   * The project write (TAS-148). This class synthesises project *membership*
   * and nothing else, and a rename is neither a membership question nor
   * something a view over live data could answer — so it goes down untouched,
   * body and all, and whatever comes back comes back.
   *
   * Sharper here than for the reads around it, because the route is **not
   * deployed**: `PATCH /api/v1/projects/{id}` answered 405 on 2026-09-12, which
   * is not even the static-resource 404 `isUndeployedRoute` matches. A class
   * that compensated would be reporting a rename to a gateway that never took
   * one, and the next `GET /projects` would contradict it.
   */
  it("passes a project edit straight to the live api, empty bodies and refusals included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const updateProject = vi.spyOn(live, "updateProject");
    const [project] = await hybrid.listProjects();

    const input = { name: "Taska Core", description: "", color: "#8b5cf6" };
    await expect(hybrid.updateProject(project.id, input)).resolves.toMatchObject({
      name: "Taska Core",
      description: "",
      color: "#8b5cf6",
    });
    // The body arrives as written — the empty description above is the value
    // that clears one, and a leg that tidied it away would silently do nothing.
    expect(updateProject).toHaveBeenCalledWith(project.id, input);

    // An all-absent body is a 200 with the project unchanged, and this class
    // does not turn that into a request it skipped or an error it invented.
    await expect(hybrid.updateProject(project.id, {})).resolves.toMatchObject({ name: "Taska Core" });

    // And a refusal arrives as a refusal: the empty colour the contract's
    // pattern rejects, which is why there is no way back to an automatic one.
    await expect(hybrid.updateProject(project.id, { color: "" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  // The 409 this class must not swallow. `ABORTED` on the server maps to 409,
  // and the mock underneath cannot produce a race — nothing in it interleaves —
  // so the gateway's own shape is stubbed in to prove this leg passes it up
  // with both arms `isConflict` reads still on it.
  it("lets a concurrent-edit conflict through untouched", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await hybrid.listProjects();
    vi.spyOn(live, "updateProject").mockRejectedValue(
      Object.assign(new Error("Project was concurrently modified by another request, please retry"), {
        code: "ABORTED",
        status: 409,
      }),
    );

    const failure = await hybrid.updateProject(project.id, { name: "Nope" }).catch((error: unknown) => error);

    expect(isConflict(failure)).toBe(true);
    expect((failure as Error).message).toMatch(/concurrently modified/);
  });

  // The ADMIN-only refusal, which the flag above does not soften. With
  // `assumeProjectAdmin` on, `getMembership` says ADMIN for everybody and the
  // board offers the control to every reader — but the write itself still goes
  // to the server, and the server is the authority (AGENTS.md).
  it("does not let the assumed ADMIN role talk the live api into a write", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    await live.login({ email: "mark@example.com", password: "anything" });
    // Named rather than taken by position: Mark is a MEMBER of Taska Platform
    // and an ADMIN of Mobile, so which project this is decides the answer.
    const project = (await hybrid.listProjects()).find((item) => item.projectKey === "TAS")!;

    await expect(hybrid.getMembership(project.id)).resolves.toMatchObject({ role: "ADMIN" });
    await expect(hybrid.updateProject(project.id, { name: "Mark was here" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
  });

  /**
   * The three admin user writes are the calls this class is most tempted to
   * compensate for — they are the ones the deployed gateway cannot answer — and
   * it must not. A compensation for a write is a report of a change that never
   * happened, so each one goes straight down and the refusal arrives intact.
   */
  it("passes all three admin user writes straight to the live api, refusals included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const rowOf = async (status: string) => {
      const { rows } = await live.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
      return String(rows.find((row) => row.status === status)!.id);
    };

    const blockUser = vi.spyOn(live, "blockUser");
    const unblockUser = vi.spyOn(live, "unblockUser");
    const resetCredentialLockout = vi.spyOn(live, "resetCredentialLockout");

    const active = await rowOf("ACTIVE");
    await expect(hybrid.blockUser(active, "Left the company")).resolves.toMatchObject({ currentStatus: "BLOCKED" });
    await expect(hybrid.unblockUser(active, "Came back")).resolves.toMatchObject({ currentStatus: "ACTIVE" });

    const locked = await rowOf("LOCKED");
    await expect(hybrid.resetCredentialLockout(locked, "Identity confirmed")).resolves.toMatchObject({
      previousStatus: "LOCKED",
      currentStatus: "ACTIVE",
    });

    expect(blockUser).toHaveBeenCalledWith(active, "Left the company");
    expect(unblockUser).toHaveBeenCalledWith(active, "Came back");
    expect(resetCredentialLockout).toHaveBeenCalledWith(locked, "Identity confirmed");

    // And nothing here softens a refusal into a success: the second reset finds
    // an account that is no longer locked and is refused by the same code the
    // gateway would send.
    await expect(hybrid.resetCredentialLockout(locked, "Again")).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "User is not in LOCKED status",
    });
  });

  /**
   * The Events section's retry (TAS-194), on the same terms as the writes above
   * and for a sharper version of the same reason: the operator's next act after
   * being told a stuck event was requeued is to stop looking at it. A
   * compensation here would be this class emptying a queue it cannot touch.
   *
   * The second call is the part worth pinning. It finds the same event already
   * back in `NEW` and is refused with the code the gateway sends — so nothing in
   * this class turns a repeated retry into a second success.
   */
  it("passes the outbox retry straight to the live api, refusals included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const retryOutboxEvent = vi.spyOn(live, "retryOutboxEvent");

    const summary = await live.getProblematicOutboxSummary();
    const failed = summary.events.find((event) => event.status === "FAILED")!;
    const service = failed.serviceKey as "auth" | "project" | "issue";

    await expect(hybrid.retryOutboxEvent(service, failed.id, "Kafka is back")).resolves.toMatchObject({
      eventId: failed.id,
      status: "NEW",
      // Not reset by the retry: the count is not in the backend's UPDATE.
      attempts: failed.attempts,
    });
    expect(retryOutboxEvent).toHaveBeenCalledWith(service, failed.id, "Kafka is back");

    await expect(hybrid.retryOutboxEvent(service, failed.id, "Again")).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Outbox event with status NEW is not eligible for retry",
    });
  });

  // Search is a gateway route with no membership in it, so this class has
  // nothing to add to it — including the short-query guard, which belongs to
  // whichever implementation is underneath and must not be applied twice.
  it("passes a search straight through, guard and all", async () => {
    const live = liveApi();
    const searchIssues = vi.spyOn(live, "searchIssues");
    const hybrid = new HybridTaskaApi(live, true);

    const page = await hybrid.searchIssues({ query: "board", pageSize: 100 });

    expect(searchIssues).toHaveBeenCalledWith({ query: "board", pageSize: 100 });
    expect(page.items.length).toBeGreaterThan(0);
    // The hit is as short here as it is underneath: nothing on the way through
    // widens it back into an issue.
    expect(Object.keys(page.items[0]).sort()).toEqual([
      "assigneeId",
      "id",
      "issueKey",
      "issueType",
      "priority",
      "storyPoints",
      "summary",
    ]);

    await expect(hybrid.searchIssues({ query: "bo" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  /**
   * TAS-189 adds no method for this class to route, so what has to be checked is
   * that it still routes the *meaning*: `UpdateIssueInput` now uses `undefined`
   * and `null` for two different things — leave it alone, and clear it — and a
   * pass-through that normalised either one would turn a partial edit into data
   * loss one layer above the adapter that was careful about it.
   */
  it("passes a planning-field edit through with its nulls and its absences intact", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    const [project] = await hybrid.listProjects();
    const { items } = await hybrid.listIssues(project.id, { pageSize: 100 });
    const full = items.find((issue) => issue.issueKey === "TAS-101");
    expect(full).toBeDefined();
    if (!full) return;

    const updateIssue = vi.spyOn(live, "updateIssue");

    // `storyPoints: null` means clear it; the four fields not mentioned mean
    // leave them alone. Both halves have to survive the delegation.
    const updated = await hybrid.updateIssue(project.id, full.id, { storyPoints: null });

    expect(updateIssue).toHaveBeenCalledWith(project.id, full.id, { storyPoints: null });
    expect(updated.storyPoints).toBeNull();
    expect(updated).toMatchObject({
      startDate: full.startDate,
      dueDate: full.dueDate,
      originalEstimateMinutes: full.originalEstimateMinutes,
      remainingEstimateMinutes: full.remainingEstimateMinutes,
    });

    // And a refusal is a refusal here too, with the same code either side.
    await expect(hybrid.updateIssue(project.id, full.id, { storyPoints: -1 })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  /**
   * The attachment family, delegated whole — including the leg that does not go
   * to the gateway at all. Nothing here is synthesised, and this pins that:
   * a compensation for `putAttachmentBytes` would mean this class reporting
   * bytes into a bucket it has no credentials for, which the very next call
   * would then be contradicted about by the real server.
   */
  it("delegates all six attachment calls untouched, the direct-to-store PUT included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    await hybrid.login({ email: "anna@example.com", password: "anything" });
    const [project] = await hybrid.listProjects();
    const { items } = await hybrid.listIssues(project.id, { pageSize: 100 });
    const issue = items.find((item) => item.issueKey === "TAS-101");
    expect(issue).toBeDefined();
    if (!issue) return;

    const listAttachments = vi.spyOn(live, "listAttachments");
    const createUrl = vi.spyOn(live, "createAttachmentUploadUrl");
    const putBytes = vi.spyOn(live, "putAttachmentBytes");
    const confirm = vi.spyOn(live, "confirmAttachmentUpload");
    const downloadUrl = vi.spyOn(live, "getAttachmentDownloadUrl");
    const remove = vi.spyOn(live, "deleteAttachment");

    const before = await hybrid.listAttachments(project.id, issue.id);
    expect(listAttachments).toHaveBeenCalledWith(project.id, issue.id);

    const file = new File(["hybrid"], "hybrid.txt", { type: "text/plain" });
    const input = { fileName: file.name, contentType: file.type, sizeBytes: file.size };
    const ticket = await hybrid.createAttachmentUploadUrl(project.id, issue.id, input);
    expect(createUrl).toHaveBeenCalledWith(project.id, issue.id, input);

    await hybrid.putAttachmentBytes(ticket.uploadUrl, file, file.type);
    expect(putBytes).toHaveBeenCalledWith(ticket.uploadUrl, file, file.type);

    const confirmBody = { objectKey: ticket.objectKey, fileName: file.name, contentType: file.type };
    const attachment = await hybrid.confirmAttachmentUpload(project.id, issue.id, confirmBody);
    expect(confirm).toHaveBeenCalledWith(project.id, issue.id, confirmBody);
    expect(attachment.fileName).toBe("hybrid.txt");
    expect(await hybrid.listAttachments(project.id, issue.id)).toHaveLength(before.length + 1);

    await hybrid.getAttachmentDownloadUrl(project.id, issue.id, attachment.id);
    expect(downloadUrl).toHaveBeenCalledWith(project.id, issue.id, attachment.id);

    await hybrid.deleteAttachment(project.id, issue.id, attachment.id);
    expect(remove).toHaveBeenCalledWith(project.id, issue.id, attachment.id);
  });

  it("delegates all five watcher calls and names none of the people in them", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    await hybrid.login({ email: "anna@example.com", password: "anything" });
    const [project] = await hybrid.listProjects();
    const { items } = await hybrid.listIssues(project.id, { pageSize: 100 });
    const issue = items.find((item) => item.issueKey === "TAS-101");
    expect(issue).toBeDefined();
    if (!issue) return;

    const list = vi.spyOn(live, "listIssueWatchers");
    const watch = vi.spyOn(live, "watchIssue");
    const unwatch = vi.spyOn(live, "unwatchIssue");
    const add = vi.spyOn(live, "addIssueWatcher");
    const remove = vi.spyOn(live, "removeIssueWatcher");

    const before = await hybrid.listIssueWatchers(project.id, issue.id);
    expect(list).toHaveBeenCalledWith(project.id, issue.id);
    // A watcher row carries an id and no name, here as everywhere. This class
    // must not invent one: the assignee, the reporter and an attachment's
    // byline all resolve through the same member read, and a watcher list that
    // looked healthy while those three said "Unknown" would be hiding TAS-137
    // on one surface out of four.
    expect(before.watchers.every((watcher) => !("displayName" in watcher))).toBe(true);

    await hybrid.unwatchIssue(project.id, issue.id);
    expect(unwatch).toHaveBeenCalledWith(project.id, issue.id);
    await hybrid.watchIssue(project.id, issue.id);
    expect(watch).toHaveBeenCalledWith(project.id, issue.id);

    // The single-member list this class synthesises is exactly the pool the
    // ADMIN add would draw from, so on the deployed stand it offers the caller
    // and nobody else — the same degradation the assignee picker already has.
    const [self] = await hybrid.listMembers(project.id);
    await hybrid.addIssueWatcher(project.id, issue.id, self.userId);
    expect(add).toHaveBeenCalledWith(project.id, issue.id, self.userId);

    await hybrid.removeIssueWatcher(project.id, issue.id, self.userId);
    expect(remove).toHaveBeenCalledWith(project.id, issue.id, self.userId);
  });

  it("passes a store failure straight up rather than compensating for it", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live, true);
    await hybrid.login({ email: "anna@example.com", password: "anything" });
    const [project] = await hybrid.listProjects();
    const { items } = await hybrid.listIssues(project.id, { pageSize: 100 });
    const issue = items[0];

    // The mock's stand-in for a blocked cross-origin PUT. Whatever this class
    // did with it, the object would not be in the bucket — so there is nothing
    // to do with it but say so.
    const file = new File(["x"], "cors-blocked.txt", { type: "text/plain" });
    const ticket = await hybrid.createAttachmentUploadUrl(project.id, issue.id, {
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    });

    await expect(hybrid.putAttachmentBytes(ticket.uploadUrl, file, file.type)).rejects.toMatchObject({
      code: "STORAGE_UNREACHABLE",
      storeStatus: null,
    });
  });
});
