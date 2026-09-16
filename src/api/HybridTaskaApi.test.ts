import { beforeEach, describe, expect, it, vi } from "vitest";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { isConflict } from "./errors";

/**
 * Since TAS-224 `HybridTaskaApi` invents nothing: every method hands its call
 * to the api it wraps. These tests pin that — the call goes down as it was
 * made, and what comes back, answer or rejection, comes back as `live`
 * produced it — for as long as the class lives, which is until TAS-209 makes
 * `rest` the default mode and deletes it.
 */
describe("HybridTaskaApi", () => {
  const liveApi = () => new MockTaskaApi();

  // Since TAS-150 the mock reads a persisted session out of localStorage in its
  // constructor, so the fixture is no longer stateless: a session left behind by
  // another file would decide which user these cases run as.
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("delegates the issue list and the workflow read to live", async () => {
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

  /**
   * The two reads TAS-224 turned into delegations. Until then this class
   * answered both itself, out of `GET /projects/{id}` and `GET /users/me`, and
   * with `VITE_TASKA_ASSUME_PROJECT_ADMIN` on it answered the role without
   * asking anything at all. So what is pinned is not only that `live` is asked,
   * but that nothing else is: a project or profile read left behind here would
   * be the synthesis coming back in part.
   */
  describe("the reader's role and the member list", () => {
    const refusal = () =>
      Object.assign(new Error("Internal error"), {
        status: 500,
        code: "INTERNAL",
        requestId: "6f1c2b40-a1e2-4d55",
      });

    it("answers the role with exactly what live answered, and asks nothing else for it", async () => {
      const live = liveApi();
      const hybrid = new HybridTaskaApi(live);
      const [project] = await live.listProjects();
      // A role the synthesis could never produce: it said ADMIN for the
      // project's creator, or for everybody under the flag, and VIEWER
      // otherwise.
      const answer = { role: "MEMBER" as const, isMember: true, projectExists: true };
      const getMembership = vi.spyOn(live, "getMembership").mockResolvedValue(answer);
      const getProject = vi.spyOn(live, "getProject");
      const getCurrentUser = vi.spyOn(live, "getCurrentUser");

      await expect(hybrid.getMembership(project.id)).resolves.toBe(answer);

      expect(getMembership).toHaveBeenCalledTimes(1);
      expect(getMembership).toHaveBeenCalledWith(project.id);
      expect(getProject).not.toHaveBeenCalled();
      expect(getCurrentUser).not.toHaveBeenCalled();
    });

    // The rejection is the half the flag had taken away. With it on,
    // `getMembership` could not reject on the stand at all, so the board's "your
    // role could not be loaded" state (TAS-163) was unreachable there; delegated,
    // it rejects whenever the read underneath does, with the very error — its
    // status, code and request id — that the board prints.
    it("rejects the role read with live's own error, and asks nothing else for it", async () => {
      const live = liveApi();
      const hybrid = new HybridTaskaApi(live);
      const [project] = await live.listProjects();
      const failure = refusal();
      vi.spyOn(live, "getMembership").mockRejectedValue(failure);
      const getProject = vi.spyOn(live, "getProject");
      const getCurrentUser = vi.spyOn(live, "getCurrentUser");

      await expect(hybrid.getMembership(project.id)).rejects.toBe(failure);

      expect(getProject).not.toHaveBeenCalled();
      expect(getCurrentUser).not.toHaveBeenCalled();
    });

    it("answers the member list with exactly what live answered, and asks nothing else for it", async () => {
      const live = liveApi();
      const hybrid = new HybridTaskaApi(live);
      const [project] = await live.listProjects();
      // The seeded project's own list, longer than the list of one — the reader
      // — that the synthesis used to answer with.
      const rows = await live.listMembers(project.id);
      expect(rows.length).toBeGreaterThan(1);
      const listMembers = vi.spyOn(live, "listMembers").mockResolvedValue(rows);
      const getProject = vi.spyOn(live, "getProject");
      const getCurrentUser = vi.spyOn(live, "getCurrentUser");

      await expect(hybrid.listMembers(project.id)).resolves.toBe(rows);

      expect(listMembers).toHaveBeenCalledTimes(1);
      expect(listMembers).toHaveBeenCalledWith(project.id);
      expect(getProject).not.toHaveBeenCalled();
      expect(getCurrentUser).not.toHaveBeenCalled();
    });

    it("rejects the member read with live's own error, and asks nothing else for it", async () => {
      const live = liveApi();
      const hybrid = new HybridTaskaApi(live);
      const [project] = await live.listProjects();
      const failure = refusal();
      vi.spyOn(live, "listMembers").mockRejectedValue(failure);
      const getProject = vi.spyOn(live, "getProject");
      const getCurrentUser = vi.spyOn(live, "getCurrentUser");

      await expect(hybrid.listMembers(project.id)).rejects.toBe(failure);

      expect(getProject).not.toHaveBeenCalled();
      expect(getCurrentUser).not.toHaveBeenCalled();
    });

    // Unstubbed, through the mock end to end. Mark is a MEMBER of Taska
    // Platform, and that is the role that arrives — where the flag used to say
    // ADMIN for him and offer an edit the server then refused. The refusal
    // still comes from the server, and it still arrives intact: role gating
    // hides UI, and the server stays the authority (AGENTS.md).
    it("reports a MEMBER as a MEMBER, and passes the server's refusal of their edit through", async () => {
      const live = liveApi();
      const hybrid = new HybridTaskaApi(live);
      await live.login({ email: "mark@example.com", password: "anything" });
      // Named rather than taken by position: Mark is a MEMBER of Taska Platform
      // and an ADMIN of Mobile, so which project this is decides the answer.
      const project = (await hybrid.listProjects()).find((item) => item.projectKey === "TAS")!;

      await expect(hybrid.getMembership(project.id)).resolves.toEqual(await live.getMembership(project.id));
      await expect(hybrid.getMembership(project.id)).resolves.toMatchObject({ role: "MEMBER" });
      await expect(hybrid.updateProject(project.id, { name: "Mark was here" })).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
      });
    });
  });

  // The board route is deployed and measured (TAS-191). Both halves matter:
  // the call reaches live with the filters untouched, and a failure comes back
  // as a failure rather than as a board — one invented here would be a board
  // nobody could tell from the server's.
  it("delegates the board read to live, filters and all", async () => {
    const live = liveApi();
    const getBoard = vi.spyOn(live, "getBoard");
    const hybrid = new HybridTaskaApi(live);
    const [project] = await hybrid.listProjects();

    const params = { issueType: "TASK", includeDone: true } as const;
    const board = await hybrid.getBoard(project.id, params);

    expect(getBoard).toHaveBeenCalledWith(project.id, params);
    expect(board.columns.map((column) => column.statusKey)).toEqual(["TODO", "IN_PROGRESS", "DONE"]);
  });

  it("lets a failing board read fail", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live);
    const [project] = await live.listProjects();
    vi.spyOn(live, "getBoard").mockRejectedValue(new Error("Internal error"));

    await expect(hybrid.getBoard(project.id, { issueType: "TASK" })).rejects.toThrow("Internal error");
  });

  // The global role has to arrive from the wrapped implementation exactly as
  // that one produced it, or the three implementations stop being
  // interchangeable.
  it("passes the global role through untouched", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live);

    await expect(hybrid.getCurrentUser()).resolves.toEqual(await live.getCurrentUser());
    await expect(hybrid.getCurrentUser()).resolves.toMatchObject({ globalRole: "USER" });

    await live.login({ email: "mark@example.com", password: "correct" });

    await expect(hybrid.getCurrentUser()).resolves.toEqual(await live.getCurrentUser());
    await expect(hybrid.getCurrentUser()).resolves.toMatchObject({ globalRole: "GLOBAL_ADMIN" });
  });

  /**
   * The project write (TAS-148) goes down untouched, body and all, and whatever
   * comes back comes back.
   *
   * Sharper here than for the reads around it, because the route is **not
   * deployed**: `PATCH /api/v1/projects/{id}` answered 405 on 2026-09-12, not
   * the static-resource 404 — backend PR #155 maps a method on a path that
   * already exists for GET. A class that compensated would be reporting a
   * rename to a gateway that never took one, and the next `GET /projects` would
   * contradict it.
   */
  it("passes a project edit straight to the live api, empty bodies and refusals included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live);
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
    const hybrid = new HybridTaskaApi(live);
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

  /**
   * The three admin user writes. A compensation for a write is a report of a
   * change that never happened, so each one goes straight down and the refusal
   * arrives intact.
   */
  it("passes all three admin user writes straight to the live api, refusals included", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live);
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
    const hybrid = new HybridTaskaApi(live);
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

  // Nothing is added to a search on the way through — including the
  // short-query guard, which belongs to whichever implementation is underneath
  // and must not be applied twice.
  it("passes a search straight through, guard and all", async () => {
    const live = liveApi();
    const searchIssues = vi.spyOn(live, "searchIssues");
    const hybrid = new HybridTaskaApi(live);

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
    const hybrid = new HybridTaskaApi(live);
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
    const hybrid = new HybridTaskaApi(live);
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
    const hybrid = new HybridTaskaApi(live);
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
    // A watcher row carries an id and no name, here as everywhere, and nothing
    // on the way through adds one. The panel names a watcher through the member
    // read, exactly as it names the assignee, the reporter and an attachment's
    // uploader — one mechanism for all four.
    expect(before.watchers.every((watcher) => !("displayName" in watcher))).toBe(true);

    await hybrid.unwatchIssue(project.id, issue.id);
    expect(unwatch).toHaveBeenCalledWith(project.id, issue.id);
    await hybrid.watchIssue(project.id, issue.id);
    expect(watch).toHaveBeenCalledWith(project.id, issue.id);

    // The member read is the pool the ADMIN add draws from, so the person added
    // and removed here is taken from it.
    const [member] = await hybrid.listMembers(project.id);
    await hybrid.addIssueWatcher(project.id, issue.id, member.userId);
    expect(add).toHaveBeenCalledWith(project.id, issue.id, member.userId);

    await hybrid.removeIssueWatcher(project.id, issue.id, member.userId);
    expect(remove).toHaveBeenCalledWith(project.id, issue.id, member.userId);
  });

  /**
   * The avatar family, delegated whole — including the leg that PUTs to the
   * object store rather than to the gateway. What is pinned is that nothing is
   * added on the way through.
   */
  it("delegates all five avatar calls untouched", async () => {
    const live = liveApi();
    const create = vi.spyOn(live, "createAvatarUploadUrl");
    const put = vi.spyOn(live, "putAvatarBytes");
    const confirm = vi.spyOn(live, "confirmAvatarUpload");
    const remove = vi.spyOn(live, "deleteMyAvatar");
    const read = vi.spyOn(live, "getUserAvatarUrl");

    const hybrid = new HybridTaskaApi(live);
    await hybrid.login({ email: "anna@example.com", password: "anything" });
    const me = await hybrid.getCurrentUser();

    const file = new File([new Uint8Array(32)], "face.png", { type: "image/png" });
    const candidate = { fileName: file.name, contentType: file.type, sizeBytes: file.size };
    const ticket = await hybrid.createAvatarUploadUrl(candidate);
    expect(create).toHaveBeenCalledWith(candidate);

    await hybrid.putAvatarBytes(ticket.uploadUrl, file, file.type);
    expect(put).toHaveBeenCalledWith(ticket.uploadUrl, file, file.type);

    const confirmInput = { objectKey: ticket.objectKey, fileName: file.name, contentType: file.type };
    const saved = await hybrid.confirmAvatarUpload(confirmInput);
    expect(confirm).toHaveBeenCalledWith(confirmInput);

    await expect(hybrid.getUserAvatarUrl(me.id)).resolves.toBe(saved.downloadUrl);
    expect(read).toHaveBeenCalledWith(me.id);

    await hybrid.deleteMyAvatar();
    expect(remove).toHaveBeenCalledTimes(1);
    await expect(hybrid.getUserAvatarUrl(me.id)).resolves.toBeNull();
  });

  it("passes a store failure straight up rather than compensating for it", async () => {
    const live = liveApi();
    const hybrid = new HybridTaskaApi(live);
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
