import { beforeEach, describe, expect, it, vi } from "vitest";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";

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
});
