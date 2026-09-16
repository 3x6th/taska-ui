import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBER_USER_ID_REFUSAL_MESSAGE, PROJECT_ROLES, isUserId, normalizeUserId } from "./members";
import { apiErrorFacts, isConflict } from "./errors";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { ApiError, RestTaskaApi } from "./rest/RestTaskaApi";
import type { Project } from "../domain/types";

/**
 * The three project member writes (TAS-158), in one file across both
 * implementations — deliberately not split into `MockTaskaApi.test.ts` and
 * `RestTaskaApi.test.ts`. Parity is the thing being pinned: the same refusal
 * for the same input from either side, and a mock whose rules are the server's
 * rules in the server's order.
 *
 * The rules are read out of backend `develop` `1cfe4d79f074`
 * (`ProjectMemberValidatorImpl`, `GrpcProjectService`, the gateway's
 * `ProjectMapper` and `RestErrorMapper`), not measured on the stand. The mock
 * cases below pin that reading; the rest cases pin what this client sends and
 * how it reads an answer shaped the way that code builds one.
 */

// Seed facts these cases lean on, named rather than looked up so a changed seed
// fails loudly here instead of quietly testing something else. Anna is the
// only ADMIN of Taska Platform; Mark, Sofia and Tom are its MEMBERs; Mark is
// also the seed's only GLOBAL_ADMIN; Priya is a real account on two other
// projects and not on this one.
const TASKA = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const MARK = "e65186a2-b807-42ae-a66f-711be116a93b";
const TOM = "1ab80365-0843-460a-b0a1-e6dd3e0f2a0d";
const PRIYA = "fdf35fa6-e68b-4dbe-8a48-5867d7f08ce9";
/** Well-formed, and nobody's (TAS-227). */
const NOBODY = "0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b";

describe("the member id rule", () => {
  it.each([
    ["a canonical lower-case id", PRIYA],
    ["the same id in upper case, which names the same person", PRIYA.toUpperCase()],
    ["the nil id, which is a UUID like any other", "00000000-0000-0000-0000-000000000000"],
  ])("accepts %s", (_case, value) => {
    expect(isUserId(value)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["an id with whitespace around it, which the server also refuses", ` ${PRIYA} `],
    ["an id in braces", `{${PRIYA}}`],
    ["32 digits with no groups", PRIYA.replaceAll("-", "")],
    // The one spelling the server *accepts* and this refuses — see `isUserId`.
    ["short groups that `UUID.fromString` would take", "1-1-1-1-1"],
    ["a name somebody typed hoping for search", "Priya Nair"],
  ])("refuses %s", (_case, value) => {
    expect(isUserId(value)).toBe(false);
  });

  it("normalises a pasted id into the form the member list compares against", () => {
    expect(normalizeUserId(`  ${PRIYA.toUpperCase()}\n`)).toBe(PRIYA);
  });

  it("lists the roles in the contract's own order", () => {
    expect(PROJECT_ROLES).toEqual(["ADMIN", "MEMBER", "VIEWER"]);
  });
});

describe("MockTaskaApi member writes", () => {
  let api: MockTaskaApi;

  const signIn = (email: string) => api.login({ email, password: "mock-accepts-anything" });
  const rowFor = async (userId: string) => (await api.listMembers(TASKA)).find((member) => member.userId === userId);
  const refusal = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(Error);
    return apiErrorFacts(error);
  };

  beforeEach(async () => {
    window.localStorage.clear();
    api = new MockTaskaApi();
    await signIn("anna@example.com");
  });

  describe("add", () => {
    it("adds a real account with the role asked for, and the member read names them", async () => {
      await expect(api.addProjectMember(TASKA, PRIYA, "VIEWER")).resolves.toEqual({
        projectId: TASKA,
        userId: PRIYA,
        role: "VIEWER",
      });

      // The write's answer carries no person; the list does.
      await expect(rowFor(PRIYA)).resolves.toMatchObject({
        role: "VIEWER",
        user: { displayName: "Priya Nair", email: "priya@example.com" },
      });
    });

    it("gives the added person the project: it is in their list and they hold the role", async () => {
      await api.addProjectMember(TASKA, PRIYA, "MEMBER");

      await signIn("priya@example.com");
      const projects = await api.listProjects();
      expect(projects.map((project: Project) => project.id)).toContain(TASKA);
      await expect(api.getMembership(TASKA)).resolves.toEqual({ role: "MEMBER", isMember: true, projectExists: true });
    });

    it("adds an id nobody holds, and the member read returns it with no name (TAS-227)", async () => {
      // The server does not ask auth-service whether the user exists, so a
      // well-formed id is a 201. A mock that refused it would be claiming a
      // check the route does not make.
      await expect(api.addProjectMember(TASKA, NOBODY, "MEMBER")).resolves.toEqual({
        projectId: TASKA,
        userId: NOBODY,
        role: "MEMBER",
      });

      const row = await rowFor(NOBODY);
      expect(row).toBeDefined();
      expect(row?.role).toBe("MEMBER");
      expect(row?.user).toBeUndefined();
    });

    it("stores an upper-case id in the lower-case form the server does, so it is one person and not two", async () => {
      await expect(api.addProjectMember(TASKA, PRIYA.toUpperCase(), "MEMBER")).resolves.toMatchObject({
        userId: PRIYA,
      });

      const facts = await refusal(api.addProjectMember(TASKA, PRIYA, "MEMBER"));
      expect(facts.code).toBe("ALREADY_EXISTS");
    });

    it("refuses somebody already on the project with the server's own sentence", async () => {
      const facts = await refusal(api.addProjectMember(TASKA, MARK, "VIEWER"));

      expect(facts.code).toBe("ALREADY_EXISTS");
      expect(facts.message).toBe(`User with id: ${MARK} already exists in project: ${TASKA}`);
    });

    it("refuses a member who is not the project's ADMIN, a GLOBAL_ADMIN included", async () => {
      // Mark is the seed's only GLOBAL_ADMIN and a MEMBER here. The route gives
      // the global role no exemption.
      await signIn("mark@example.com");

      const facts = await refusal(api.addProjectMember(TASKA, PRIYA, "MEMBER"));
      expect(facts.code).toBe("PERMISSION_DENIED");
      expect(facts.message).toBe(`Actor ${MARK} is not an admin of project: ${TASKA}`);
      await expect(rowFor(PRIYA)).resolves.toBeUndefined();
    });

    it("answers NOT_FOUND for a project with no member rows, the server's test for one that does not exist", async () => {
      const missing = "9c3f7b18-6d21-4a55-8e0b-7f2a1d4c9e30";

      const facts = await refusal(api.addProjectMember(missing, PRIYA, "MEMBER"));
      expect(facts.code).toBe("NOT_FOUND");
      expect(facts.message).toBe(`Project: ${missing} doesn't exist`);
    });

    it("checks the id's shape before anything else, so a non-admin with a bad id hears about the id", async () => {
      await signIn("mark@example.com");

      const facts = await refusal(api.addProjectMember(TASKA, "1-1-1-1-1", "MEMBER"));
      expect(facts).toMatchObject({ code: "INVALID_ARGUMENT", message: MEMBER_USER_ID_REFUSAL_MESSAGE });
    });
  });

  describe("change role", () => {
    it("changes a member's role, and the member's own role read follows", async () => {
      await expect(api.changeProjectMemberRole(TASKA, MARK, "ADMIN")).resolves.toEqual({
        projectId: TASKA,
        userId: MARK,
        role: "ADMIN",
      });
      await expect(rowFor(MARK)).resolves.toMatchObject({ role: "ADMIN" });

      await signIn("mark@example.com");
      await expect(api.getMembership(TASKA)).resolves.toMatchObject({ role: "ADMIN" });
      await expect(api.getProject(TASKA)).resolves.toMatchObject({ currentUserRole: "ADMIN" });
    });

    it("answers NOT_FOUND about a non-member before it asks whether the actor is an admin", async () => {
      // The validator's order: the target's membership first, the actor's role
      // second. So a MEMBER asking about somebody who is not on the project is
      // told the person is not there, not that they may not ask.
      await signIn("mark@example.com");

      const facts = await refusal(api.changeProjectMemberRole(TASKA, PRIYA, "VIEWER"));
      expect(facts.code).toBe("NOT_FOUND");
      expect(facts.message).toBe(`Project member with id ${PRIYA} was not found in project with id ${TASKA}`);
    });

    it("refuses a non-admin once the target is a real member", async () => {
      await signIn("mark@example.com");

      const facts = await refusal(api.changeProjectMemberRole(TASKA, TOM, "VIEWER"));
      expect(facts.code).toBe("PERMISSION_DENIED");
      expect(facts.message).toBe(`User with id: ${MARK} is not an admin of project: ${TASKA}`);
    });

    it.each([
      ["demoting", "VIEWER" as const],
      // `validateBeforeModify` does not look at the role asked for at all.
      ["even re-stating ADMIN for", "ADMIN" as const],
    ])("refuses %s the last ADMIN, as FAILED_PRECONDITION that `isConflict` reads", async (_case, role) => {
      const error = await api.changeProjectMemberRole(TASKA, ANNA, role).catch((reason: unknown) => reason);

      expect(apiErrorFacts(error)).toMatchObject({
        code: "FAILED_PRECONDITION",
        message: `Can't modify last admin: ${ANNA} in project: ${TASKA}`,
      });
      expect(isConflict(error)).toBe(true);
      await expect(rowFor(ANNA)).resolves.toMatchObject({ role: "ADMIN" });
    });

    it("lets an ADMIN demote themselves once another ADMIN exists, and then refuses them as a MEMBER", async () => {
      await api.changeProjectMemberRole(TASKA, MARK, "ADMIN");

      await expect(api.changeProjectMemberRole(TASKA, ANNA, "MEMBER")).resolves.toMatchObject({ role: "MEMBER" });
      await expect(api.getMembership(TASKA)).resolves.toMatchObject({ role: "MEMBER", isMember: true });

      const facts = await refusal(api.changeProjectMemberRole(TASKA, TOM, "VIEWER"));
      expect(facts.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("remove", () => {
    it("removes a member from the list and takes the project out of theirs", async () => {
      await expect(api.removeProjectMember(TASKA, TOM)).resolves.toBeUndefined();
      await expect(rowFor(TOM)).resolves.toBeUndefined();

      await signIn("tom@example.com");
      expect((await api.listProjects()).map((project: Project) => project.id)).not.toContain(TASKA);
      await expect(api.getMembership(TASKA)).resolves.toMatchObject({ isMember: false });
    });

    it("removes only the membership: an issue assigned to them keeps its assignee", async () => {
      // TAS-104 is Tom's in the seed. project-service writes a `MemberRemoved`
      // event that only notification-service consumes, so nothing unassigns.
      await api.removeProjectMember(TASKA, TOM);

      const issues = await api.listIssues(TASKA);
      expect(issues.items.find((issue) => issue.issueKey === "TAS-104")?.assigneeId).toBe(TOM);
    });

    it("refuses to remove the last ADMIN, and lets them leave once there is another", async () => {
      const facts = await refusal(api.removeProjectMember(TASKA, ANNA));
      expect(facts.code).toBe("FAILED_PRECONDITION");

      await api.changeProjectMemberRole(TASKA, MARK, "ADMIN");
      await expect(api.removeProjectMember(TASKA, ANNA)).resolves.toBeUndefined();
      expect((await api.listProjects()).map((project: Project) => project.id)).not.toContain(TASKA);
    });

    it("removes a row nobody could name, by the id it carries", async () => {
      await api.addProjectMember(TASKA, NOBODY, "VIEWER");

      await api.removeProjectMember(TASKA, NOBODY);
      await expect(rowFor(NOBODY)).resolves.toBeUndefined();
    });

    it("answers NOT_FOUND for somebody who is not a member", async () => {
      const facts = await refusal(api.removeProjectMember(TASKA, PRIYA));
      expect(facts.code).toBe("NOT_FOUND");
    });
  });
});

describe("RestTaskaApi member writes", () => {
  const answer = (status: number, body: unknown, requestId: string | null = null) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => (name === "X-Request-Id" ? requestId : null) },
      json: async () => body,
    }) as unknown as Response;

  // The unused parameters are what type `mock.calls[0]`, and the request these
  // cases make is half of what they are checking.
  const stub = (response: Response) => {
    window.localStorage.setItem("taska.accessToken", "valid-access");
    const fetchStub = vi.fn(async (_input: string, _init?: RequestInit) => response);
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the id and the role to the project's member route, and reads the 201", async () => {
    const fetchStub = stub(answer(201, { projectId: TASKA, userId: PRIYA, role: "VIEWER" }));

    await expect(new RestTaskaApi().addProjectMember(TASKA, PRIYA, "VIEWER")).resolves.toEqual({
      projectId: TASKA,
      userId: PRIYA,
      role: "VIEWER",
    });

    const [path, init] = fetchStub.mock.calls[0];
    expect(path).toBe(`/api/v1/projects/${TASKA}/members`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ userId: PRIYA, role: "VIEWER" });
  });

  it("patches only the role, with the member in the path", async () => {
    const fetchStub = stub(answer(200, { projectId: TASKA, userId: MARK, role: "ADMIN" }));

    await expect(new RestTaskaApi().changeProjectMemberRole(TASKA, MARK, "ADMIN")).resolves.toEqual({
      projectId: TASKA,
      userId: MARK,
      role: "ADMIN",
    });

    const [path, init] = fetchStub.mock.calls[0];
    expect(path).toBe(`/api/v1/projects/${TASKA}/members/${MARK}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ role: "ADMIN" });
  });

  it("deletes the member and resolves on a 204 with no body", async () => {
    const fetchStub = stub(answer(204, undefined));

    await expect(new RestTaskaApi().removeProjectMember(TASKA, TOM)).resolves.toBeUndefined();

    const [path, init] = fetchStub.mock.calls[0];
    expect(path).toBe(`/api/v1/projects/${TASKA}/members/${TOM}`);
    expect(init?.method).toBe("DELETE");
    expect(init?.body).toBeUndefined();
  });

  it("fills a missing id from the request, and never fills a missing role from it", async () => {
    // No `required` block on `ProjectMemberResponseDto`, so an answer may omit
    // any of the three. The ids are the ones the request named; the role is
    // exactly the thing that must not be reported as confirmed.
    stub(answer(201, {}));

    await expect(new RestTaskaApi().addProjectMember(TASKA, PRIYA, "ADMIN")).resolves.toEqual({
      projectId: TASKA,
      userId: PRIYA,
      role: null,
    });
  });

  it.each([
    ["a role this build does not know", "OWNER"],
    ["an explicit null", null],
  ])("lands %s in the answer as null", async (_case, role) => {
    stub(answer(200, { projectId: TASKA, userId: MARK, role }));

    await expect(new RestTaskaApi().changeProjectMemberRole(TASKA, MARK, "MEMBER")).resolves.toMatchObject({
      role: null,
    });
  });

  it.each([
    ["add", (api: RestTaskaApi) => api.addProjectMember(TASKA, "1-1-1-1-1", "MEMBER")],
    ["change role", (api: RestTaskaApi) => api.changeProjectMemberRole(TASKA, ` ${MARK}`, "MEMBER")],
    ["remove", (api: RestTaskaApi) => api.removeProjectMember(TASKA, "Priya Nair")],
  ])("refuses a malformed id on %s before any request", async (_case, call) => {
    const fetchStub = stub(answer(200, {}));

    const error = await call(new RestTaskaApi()).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect(apiErrorFacts(error)).toMatchObject({
      code: "INVALID_ARGUMENT",
      status: 400,
      message: MEMBER_USER_ID_REFUSAL_MESSAGE,
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("passes the server's refusals through with their code, status and request id", async () => {
    stub(
      answer(
        409,
        { code: "ALREADY_EXISTS", message: `User with id: ${MARK} already exists in project: ${TASKA}` },
        "req-409",
      ),
    );

    const error = await new RestTaskaApi().addProjectMember(TASKA, MARK, "MEMBER").catch((reason: unknown) => reason);

    expect(apiErrorFacts(error)).toEqual({
      code: "ALREADY_EXISTS",
      status: 409,
      requestId: "req-409",
      message: `User with id: ${MARK} already exists in project: ${TASKA}`,
    });
  });

  it("reads the last-admin refusal as a conflict through its code, although it arrives as a 400", async () => {
    stub(answer(400, { code: "FAILED_PRECONDITION", message: `Can't modify last admin: ${ANNA} in project: ${TASKA}` }));

    const error = await new RestTaskaApi().removeProjectMember(TASKA, ANNA).catch((reason: unknown) => reason);

    expect(apiErrorFacts(error).status).toBe(400);
    expect(isConflict(error)).toBe(true);
  });
});

describe("mock and rest refuse a malformed member id alike", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("with the same code and the same sentence, so a caller cannot tell which answered", async () => {
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no request should have been made");
      }),
    );

    const [fromMock, fromRest] = await Promise.all([
      new MockTaskaApi().addProjectMember(TASKA, "not-an-id", "MEMBER").catch((reason: unknown) => reason),
      new RestTaskaApi().addProjectMember(TASKA, "not-an-id", "MEMBER").catch((reason: unknown) => reason),
    ]);

    const mock = apiErrorFacts(fromMock);
    const rest = apiErrorFacts(fromRest);
    expect(mock.code).toBe(rest.code);
    expect(mock.message).toBe(rest.message);
  });
});
