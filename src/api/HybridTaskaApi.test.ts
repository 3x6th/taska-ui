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
});
