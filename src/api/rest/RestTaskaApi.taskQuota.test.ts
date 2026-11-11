import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { TenancyUnavailableError, WorkspaceClosedError, apiErrorFacts, refusalCode } from "../errors";
import { MOCK_PROJECT_IDS } from "../mock/MockTaskaApi";
import { MOCK_TENANT_IDS } from "../mock/MockTenantServer";
import { createCompaniesMockApi } from "../mock/mockCompanies";
import type { WorkspaceClosedEvent, WorkspaceRestrictedEvent } from "../TaskaApi";
import { TaskQuotaAnswerError, toProjectTaskQuota } from "../tenantMembers";
import { createLocalLockManager } from "../webSession";
import { RestTaskaApi } from "./RestTaskaApi";

/*
 * A project's issue counter and the create's key on the wire (TAS-528,
 * api-contract-guard §1, §4, H1): the exact GET with the company session, the
 * answer narrowed and checked, another company refused without a request, a
 * concealed 404 closing nothing, and `Idempotency-Key` the caller's.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = MOCK_TENANT_IDS.northwind;
const GLOBEX = MOCK_TENANT_IDS.globex;
const TAS = MOCK_PROJECT_IDS.taska;
const WEB = MOCK_PROJECT_IDS.web;
const QUOTA_PATH = `/tenants/${NORTHWIND}/projects/${TAS}/task-quota`;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, code: string, reasons: string[] = []) =>
  new Response(JSON.stringify({ type: "about:blank", title: "the server's words", status, code, requestId: `rid-${code}`, reasons }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

const session = (sessionId: string, tag: string, tenantId?: string) => ({
  sessionId,
  userId: ANNA,
  ...(tenantId ? { tenantId } : {}),
  accessToken: `${tag}-access`,
  refreshToken: `${tag}-refresh-0123456789abcdef0123456789`,
  tokenType: "Bearer",
  expiresIn: 900,
  mfaVerified: false,
});

const USAGE = { kind: "TASK_LIFETIME", projectId: TAS, used: "1234567", reserved: "0", limit: "50", unlimited: false, version: "88" };

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

let answers: Record<string, () => Response> = {};

function gateway() {
  const sent: Sent[] = [];
  let minted = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ url, method, headers: { ...((init.headers as Record<string, string> | undefined) ?? {}) }, body: typeof init.body === "string" ? init.body : null });
    const path = url.replace(/^\/api\/v1/, "");
    const override = answers[`${method} ${path}`];
    if (override) return override();
    if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
    }
    if (path.startsWith("/auth/tenant-sessions/")) return new Response(null, { status: 204 });
    if (path === QUOTA_PATH) return json(200, USAGE);
    if (path.startsWith("/tenants")) return json(200, { items: [{ id: NORTHWIND, name: "Northwind", ownerId: ANNA, lifecycle: "ACTIVE", restrictions: [], version: "3" }] });
    if (path === `/projects/${TAS}/issues`) {
      return json(201, { id: "issue-1", issueKey: "TAS-48", summary: "One more", issueType: "TASK", priority: "LOW", statusKey: "TODO", version: 1, createdAt: "2026-11-11T10:00:00Z", updatedAt: "2026-11-11T10:00:00Z" });
    }
    return json(404, { code: "NOT_FOUND", message: `No static resource api/v1${path}` });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, sent };
}

async function inNorthwind() {
  const api = new RestTaskaApi("/api/v1", {
    tenancy: true,
    local: new MemoryStorage(),
    session: new MemoryStorage(),
    locks: createLocalLockManager(),
    ownershipWaitMs: 25,
    events: null,
  });
  await api.signIn({ email: "anna@example.com", password: "x" });
  await api.enterCompany(NORTHWIND);
  const closed: WorkspaceClosedEvent[] = [];
  const restricted: WorkspaceRestrictedEvent[] = [];
  api.onWorkspaceClosed((event) => closed.push(event));
  api.onWorkspaceRestricted((event) => restricted.push(event));
  return { api, closed, restricted };
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error,
  );

beforeEach(() => {
  answers = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("getProjectTaskQuota on the wire (§1, §4)", () => {
  it("today's build refuses it without a request", async () => {
    const { fetch } = gateway();
    await expect(new RestTaskaApi("/api/v1").getProjectTaskQuota(NORTHWIND, TAS)).rejects.toBeInstanceOf(TenancyUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("one bare GET with the tab's company session — no key, no If-Match", async () => {
    const { sent } = gateway();
    const { api } = await inNorthwind();
    const before = sent.length;
    await api.getProjectTaskQuota(NORTHWIND, TAS);
    const reads = sent.slice(before);
    expect(reads.map((request) => `${request.method} ${request.url}`)).toEqual([`GET /api/v1${QUOTA_PATH}`]);
    expect(reads[0].headers.Authorization).toBe("Bearer t1-access");
    expect(Object.keys(reads[0].headers)).not.toContain("Idempotency-Key");
    expect(Object.keys(reads[0].headers)).not.toContain("If-Match");
  });

  it("narrowed to the project, used, limit and unlimited — the digits as sent, reserved and version dropped", async () => {
    gateway();
    const { api } = await inNorthwind();
    const quota = await api.getProjectTaskQuota(NORTHWIND, TAS);
    expect(quota).toEqual({ projectId: TAS, used: "1234567", limit: "50", unlimited: false });
    answers[`GET ${QUOTA_PATH}`] = () => json(200, { kind: "TASK_LIFETIME", used: "50", reserved: "0", unlimited: true, version: "51" });
    // No projectId: the requested one's (the path named it).
    await expect(api.getProjectTaskQuota(NORTHWIND, TAS)).resolves.toEqual({ projectId: TAS, used: "50", limit: null, unlimited: true });
  });

  it("another project, another kind or no counts: a failed read that is no server's words, and the company stays", async () => {
    gateway();
    const { api, closed } = await inNorthwind();
    for (const body of [
      { ...USAGE, projectId: WEB },
      { ...USAGE, kind: "SEAT" },
      { ...USAGE, used: "12.5" },
      { kind: "TASK_LIFETIME", used: "3", reserved: "0", unlimited: false, version: "4" },
    ]) {
      answers[`GET ${QUOTA_PATH}`] = () => json(200, body);
      const error = await failure(api.getProjectTaskQuota(NORTHWIND, TAS));
      expect(error).toBeInstanceOf(TaskQuotaAnswerError);
      expect(apiErrorFacts(error)).toMatchObject({ message: null, status: null, requestId: null });
    }
    expect(closed).toEqual([]);
  });

  it("another company: WorkspaceClosedError and no request", async () => {
    const { sent } = gateway();
    const { api, closed } = await inNorthwind();
    const before = sent.length;
    await expect(api.getProjectTaskQuota(GLOBEX, TAS)).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(sent.length).toBe(before);
    expect(closed).toEqual([]);
  });

  it("a concealed 404 is the project's answer: the company is neither closed nor marked", async () => {
    gateway();
    const { api, closed, restricted } = await inNorthwind();
    answers[`GET ${QUOTA_PATH}`] = () => problem(404, "RESOURCE_NOT_FOUND");
    const error = await failure(api.getProjectTaskQuota(NORTHWIND, TAS));
    expect(apiErrorFacts(error)).toMatchObject({ status: 404, requestId: "rid-RESOURCE_NOT_FOUND" });
    expect(closed).toEqual([]);
    expect(restricted).toEqual([]);
    expect(api.currentWorkspace()?.tenantSessionId).toBe("ts-1");
  });

  it("a read: CAPABILITY_DISABLED with a pause's reasons marks the tab as content reads do, and closes nothing", async () => {
    gateway();
    const { api, closed, restricted } = await inNorthwind();
    answers[`GET ${QUOTA_PATH}`] = () => problem(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"]);
    expect(refusalCode(await failure(api.getProjectTaskQuota(NORTHWIND, TAS)))).toBe("CAPABILITY_DISABLED");
    expect(closed).toEqual([]);
    expect(restricted.map((event) => event.tenantId)).toEqual([NORTHWIND]);
  });

  it("parity: the mock answers the same narrowed shape for the same project", async () => {
    const mock = createCompaniesMockApi({
      local: new MemoryStorage(),
      session: new MemoryStorage(),
      locks: createLocalLockManager(),
      events: null,
      latencyMs: 0,
      ownershipWaitMs: 25,
    });
    await mock.signIn({ email: "anna@example.com", password: "x" });
    await mock.enterCompany(NORTHWIND);
    const viaMock = await mock.getProjectTaskQuota(NORTHWIND, TAS);
    expect(Object.keys(viaMock).sort()).toEqual(["limit", "projectId", "unlimited", "used"]);
    expect(viaMock).toEqual({ projectId: TAS, used: "47", limit: "50", unlimited: false });
  });
});

describe("the mapper (§4)", () => {
  it("keeps a decimal string as it came and refuses what is not one project's TASK_LIFETIME row", () => {
    expect(toProjectTaskQuota({ ...USAGE, used: "0" }, TAS)).toEqual({ projectId: TAS, used: "0", limit: "50", unlimited: false });
    expect(toProjectTaskQuota({ ...USAGE, used: "9223372036854775807" }, TAS).used).toBe("9223372036854775807");
    expect(() => toProjectTaskQuota(null, TAS)).toThrow(TaskQuotaAnswerError);
    expect(() => toProjectTaskQuota({ ...USAGE, used: 47 }, TAS)).toThrow(TaskQuotaAnswerError);
    expect(() => toProjectTaskQuota({ ...USAGE, reserved: undefined }, TAS)).toThrow(TaskQuotaAnswerError);
    expect(() => toProjectTaskQuota({ ...USAGE, projectId: WEB }, TAS)).toThrow(expect.objectContaining({ reason: "another-project" }));
  });
});

describe("createIssue sends the caller's Idempotency-Key (H1)", () => {
  it("the key as given, and the same bytes for the same body under the same key", async () => {
    const { sent } = gateway();
    const api = new RestTaskaApi("/api/v1");
    const input = { issueType: "TASK", summary: "One more", description: "", priority: "LOW", storyPoints: 3 } as const;
    await api.createIssue(TAS, input, "8d3b0a6e-1f2c-4d5e-9a7b-0c1d2e3f4a5b");
    await api.createIssue(TAS, { ...input }, "8d3b0a6e-1f2c-4d5e-9a7b-0c1d2e3f4a5b");
    const posts = sent.filter((request) => request.method === "POST");
    expect(posts.map((request) => request.headers["Idempotency-Key"])).toEqual([
      "8d3b0a6e-1f2c-4d5e-9a7b-0c1d2e3f4a5b",
      "8d3b0a6e-1f2c-4d5e-9a7b-0c1d2e3f4a5b",
    ]);
    expect(posts[0].body).toBe(posts[1].body);
  });
});
