import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { TenancyUnavailableError, WorkspaceClosedError, apiErrorFacts, refusalCode, refusalViolations } from "../errors";
import { MOCK_TENANT_IDS } from "../mock/MockTenantServer";
import { createCompaniesMockApi } from "../mock/mockCompanies";
import type { WorkspaceClosedEvent, WorkspaceRestrictedEvent } from "../TaskaApi";
import { ForeignCompanyAnswerError } from "../tenants";
import { createLocalLockManager } from "../webSession";
import { RestTaskaApi } from "./RestTaskaApi";

/*
 * The company's log on the wire (TAS-524, api-contract-guard B1–B3): the exact
 * GET and its query with the tab's company session only, `kind` sorted and
 * de-duplicated, today's build refusing it without a request, another
 * company's session never used, a foreign record failing the page, the read
 * marking and closing nothing — and the same Problem facts from both
 * implementations for a refused filter.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = MOCK_TENANT_IDS.northwind;
const GLOBEX = MOCK_TENANT_IDS.globex;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ type: "about:blank", title: "the server's words", status, code, requestId: `rid-${code}`, ...extra }), {
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

const PAGE = {
  items: [
    {
      id: "r-1",
      tenantId: NORTHWIND,
      createdAt: "2026-11-05T10:15:30Z",
      actor: { userId: ANNA, displayName: "Anna Ivanova", email: "anna@example.com", platformAdmin: false },
      kind: "TENANT_PAUSED",
      target: { type: "TENANT", id: NORTHWIND, displayName: "Northwind" },
      outcome: "SUCCEEDED",
    },
  ],
  nextCursor: "c-2",
};

interface Sent {
  url: string;
  method: string;
  authorization: string | undefined;
}

let answers: Record<string, () => Response> = {};

function gateway() {
  const sent: Sent[] = [];
  let minted = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ url, method, authorization: (init.headers as Record<string, string> | undefined)?.Authorization });
    const path = url.replace(/^\/api\/v1/, "");
    const bare = path.split("?")[0];
    const override = answers[`${method} ${bare}`];
    if (override) return override();
    if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
    }
    if (path.startsWith("/auth/tenant-sessions/")) return new Response(null, { status: 204 });
    if (bare === `/tenants/${NORTHWIND}/activity`) return json(200, PAGE);
    if (path.startsWith("/tenants")) return json(200, { items: [{ id: NORTHWIND, name: "Northwind", ownerId: ANNA, lifecycle: "ACTIVE", restrictions: [], version: "3" }] });
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

const activityRequests = (sent: Sent[]) => sent.filter((request) => request.url.includes("/activity"));

beforeEach(() => {
  answers = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("the company's log on the wire (TAS-524)", () => {
  it("today's build refuses it without a request", async () => {
    const { fetch } = gateway();
    await expect(new RestTaskaApi("/api/v1").listTenantActivity(NORTHWIND, { limit: 50 })).rejects.toBeInstanceOf(TenancyUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the exact GET with the tab's company session: limit, actorUserId, kind sorted and de-duplicated, cursor", async () => {
    const { sent } = gateway();
    const { api } = await inNorthwind();
    await api.listTenantActivity(NORTHWIND, { limit: 50 });
    await api.listTenantActivity(NORTHWIND, {
      limit: 50,
      actorUserId: ANNA,
      kinds: ["ROLE_CHANGED", "INVITATION_CREATED", "ROLE_CHANGED"],
      cursor: "c-2",
    });
    expect(activityRequests(sent).map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET /api/v1/tenants/${NORTHWIND}/activity?limit=50`,
      `GET /api/v1/tenants/${NORTHWIND}/activity?limit=50&actorUserId=${ANNA}&kind=INVITATION_CREATED&kind=ROLE_CHANGED&cursor=c-2`,
    ]);
    // WEB_TENANT, never the account session.
    expect(activityRequests(sent).every((request) => request.authorization === "Bearer t1-access")).toBe(true);
  });

  it("answers the narrowed page", async () => {
    gateway();
    const { api } = await inNorthwind();
    await expect(api.listTenantActivity(NORTHWIND, { limit: 50 })).resolves.toEqual({
      items: [
        {
          id: "r-1",
          tenantId: NORTHWIND,
          createdAt: "2026-11-05T10:15:30Z",
          actor: { userId: ANNA, displayName: "Anna Ivanova", email: "anna@example.com", platformAdmin: false },
          kind: "TENANT_PAUSED",
          target: { type: "TENANT", id: NORTHWIND, displayName: "Northwind", email: null },
          details: null,
          outcome: "SUCCEEDED",
          requestId: null,
        },
      ],
      nextCursor: "c-2",
    });
  });

  it("another company: WorkspaceClosedError and no request", async () => {
    const { sent } = gateway();
    const { api, closed } = await inNorthwind();
    const before = sent.length;
    await expect(api.listTenantActivity(GLOBEX, { limit: 50 })).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(sent.length).toBe(before);
    expect(closed).toEqual([]);
  });

  it("a record naming another company fails the page — the tab keeps its company", async () => {
    gateway();
    const { api, closed } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/activity`] = () => json(200, { items: [PAGE.items[0], { ...PAGE.items[0], id: "r-2", tenantId: GLOBEX }] });
    const error = await api.listTenantActivity(NORTHWIND, { limit: 50 }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ForeignCompanyAnswerError);
    expect(closed).toEqual([]);
    expect(api.currentWorkspace()).toMatchObject({ tenantId: NORTHWIND });
  });

  it("control plane: a 403 with a pause's reasons marks nothing and closes nothing; 403 SCOPE_DENIED is the read's own refusal", async () => {
    gateway();
    const { api, closed, restricted } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/activity`] = () => problem(403, "CAPABILITY_DISABLED", { reasons: ["OWNER_PAUSE"] });
    const paused = await api.listTenantActivity(NORTHWIND, { limit: 50 }).catch((failure: unknown) => failure);
    expect(refusalCode(paused)).toBe("CAPABILITY_DISABLED");
    answers[`GET /tenants/${NORTHWIND}/activity`] = () => problem(403, "SCOPE_DENIED");
    const denied = await api.listTenantActivity(NORTHWIND, { limit: 50 }).catch((failure: unknown) => failure);
    expect(refusalCode(denied)).toBe("SCOPE_DENIED");
    expect(apiErrorFacts(denied).requestId).toBe("rid-SCOPE_DENIED");
    expect(closed).toEqual([]);
    expect(restricted).toEqual([]);
    expect(api.currentWorkspace()?.tenantSessionId).toBe("ts-1");
  });

  it("a closing code on it closes the company, as on every request", async () => {
    gateway();
    const { api, closed } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/activity`] = () => problem(403, "MEMBERSHIP_INACTIVE");
    await expect(api.listTenantActivity(NORTHWIND, { limit: 50 })).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(closed.map((event) => event.reason)).toEqual(["MEMBERSHIP_INACTIVE"]);
  });
});

describe("parity: a refused filter (B8)", () => {
  it("both implementations answer 400 VALIDATION_FAILED with a violation naming the field", async () => {
    gateway();
    answers[`GET /tenants/${NORTHWIND}/activity`] = () =>
      problem(400, "VALIDATION_FAILED", { violations: [{ field: "kind", code: "INVALID", message: "kind is not an activity kind" }] });
    const { api: rest } = await inNorthwind();
    const facts = (error: unknown) => ({
      status: apiErrorFacts(error).status,
      code: refusalCode(error),
      fields: refusalViolations(error).map((violation) => violation.field),
      id: typeof apiErrorFacts(error).requestId,
    });
    const viaRest = await rest.listTenantActivity(NORTHWIND, { limit: 50, kinds: ["TENANT_EXPORTED"] }).catch((failure: unknown) => failure);
    vi.unstubAllGlobals();

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
    const viaMock = await mock.listTenantActivity(NORTHWIND, { limit: 50, kinds: ["TENANT_EXPORTED"] }).catch((failure: unknown) => failure);
    expect(facts(viaRest)).toEqual({ status: 400, code: "VALIDATION_FAILED", fields: ["kind"], id: "string" });
    expect(facts(viaMock)).toEqual(facts(viaRest));
  });
});
