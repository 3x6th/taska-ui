import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { TenancyUnavailableError, WorkspaceClosedError, apiErrorFacts, refusalCode, refusalReasons } from "../errors";
import { MOCK_PROJECT_IDS } from "../mock/MockTaskaApi";
import { MOCK_TENANT_IDS } from "../mock/MockTenantServer";
import { createCompaniesMockApi } from "../mock/mockCompanies";
import type { WorkspaceClosedEvent, WorkspaceRestrictedEvent } from "../TaskaApi";
import { ForeignCompanyAnswerError } from "../tenants";
import { createLocalLockManager } from "../webSession";
import { RestTaskaApi } from "./RestTaskaApi";

/*
 * The company's plan reads on the wire (TAS-512, api-contract-guard §1, §5
 * parity, B1, B3, B8): the exact GETs with the company session, the
 * entitlement narrowed to what the page draws, a company the tab does not hold
 * refused without a request, an answer about another company a failed read,
 * the entitlement's refusal closing nothing — and the same Problem facts from
 * both implementations for a new issue at the task limit.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = MOCK_TENANT_IDS.northwind;
const GLOBEX = MOCK_TENANT_IDS.globex;

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

interface Sent {
  url: string;
  method: string;
  authorization: string | undefined;
}

const ENTITLEMENT = {
  tenantId: NORTHWIND,
  version: "3",
  planVersionId: "plan-free",
  coveragePeriodId: "period-1",
  validFrom: "2026-05-01T09:00:00Z",
  validUntil: "2026-12-07T09:00:00Z",
  restrictions: ["OVER_QUOTA"],
  limits: [
    { kind: "TASK_LIFETIME", limit: "50", unlimited: false },
    { kind: "API_CALLS", limit: "1000", unlimited: false },
    { kind: "SEAT", unlimited: true },
    { kind: "PROJECT" },
  ],
  features: ["projects.basic"],
  issuedAt: "2026-11-05T10:00:00Z",
};

let answers: Record<string, () => Response> = {};

function gateway() {
  const sent: Sent[] = [];
  let minted = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    sent.push({ url, method, authorization: (init.headers as Record<string, string> | undefined)?.Authorization });
    const path = url.replace(/^\/api\/v1/, "");
    const override = answers[`${method} ${path}`];
    if (override) return override();
    if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
    }
    if (path.startsWith("/auth/tenant-sessions/")) return new Response(null, { status: 204 });
    if (path === `/tenants/${NORTHWIND}/billing/entitlement`) return json(200, ENTITLEMENT);
    if (path === `/tenants/${NORTHWIND}/quotas`) {
      return json(200, { tenantId: NORTHWIND, version: "1", quotas: [{ kind: "SEAT", used: "4", reserved: "1", limit: "5", unlimited: false }], asOf: "2026-11-05T10:00:00Z" });
    }
    if (path === `/tenants/${NORTHWIND}/billing/subscription`) {
      return json(200, { tenantId: NORTHWIND, planVersionId: "plan-team", version: "2", paidThrough: "2026-12-07T09:00:00Z", renewalCancelled: false, autopayState: "CONSENTED", scheduledPlanVersionId: "plan-next", scheduledEffectiveAt: "2026-12-07T09:00:00Z" });
    }
    if (path === `/tenants/${NORTHWIND}`) return json(200, { id: NORTHWIND, name: "Northwind", ownerId: ANNA, lifecycle: "ACTIVE", restrictions: [], version: "3" });
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

beforeEach(() => {
  answers = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("the plan reads on the wire (TAS-512)", () => {
  it("today's build refuses getEntitlement without a request", async () => {
    const { fetch } = gateway();
    await expect(new RestTaskaApi("/api/v1").getEntitlement(NORTHWIND)).rejects.toBeInstanceOf(TenancyUnavailableError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the three exact GETs, each with the tab's company session (WEB_TENANT) and nothing else", async () => {
    const { sent } = gateway();
    const { api } = await inNorthwind();
    await api.getEntitlement(NORTHWIND);
    await api.getTenantQuotas(NORTHWIND);
    await api.getSubscription(NORTHWIND);
    const reads = sent.filter((request) => request.url.startsWith(`/api/v1/tenants/${NORTHWIND}/`));
    expect(reads.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET /api/v1/tenants/${NORTHWIND}/billing/entitlement`,
      `GET /api/v1/tenants/${NORTHWIND}/quotas`,
      `GET /api/v1/tenants/${NORTHWIND}/billing/subscription`,
    ]);
    expect(reads.every((request) => request.authorization === "Bearer t1-access")).toBe(true);
  });

  it("the entitlement narrowed: tenantId, version, planVersionId and the usable limits — no validUntil, period or features (B1)", async () => {
    gateway();
    const { api } = await inNorthwind();
    const entitlement = await api.getEntitlement(NORTHWIND);
    expect(entitlement).toEqual({
      tenantId: NORTHWIND,
      version: "3",
      planVersionId: "plan-free",
      limits: [
        { kind: "TASK_LIFETIME", limit: "50", unlimited: false },
        // An unknown kind is kept as it came; unlimited is no limit; a row with neither is dropped.
        { kind: "API_CALLS", limit: "1000", unlimited: false },
        { kind: "SEAT", limit: null, unlimited: true },
      ],
    });
    expect(entitlement).not.toHaveProperty("validUntil");
    expect(entitlement).not.toHaveProperty("coveragePeriodId");
    expect(entitlement).not.toHaveProperty("features");
  });

  it("the subscription carries the announced plan; an unreadable instant is dropped", async () => {
    gateway();
    const { api } = await inNorthwind();
    await expect(api.getSubscription(NORTHWIND)).resolves.toMatchObject({ scheduledPlanVersionId: "plan-next", scheduledEffectiveAt: "2026-12-07T09:00:00Z" });
    answers[`GET /tenants/${NORTHWIND}/billing/subscription`] = () =>
      json(200, { tenantId: NORTHWIND, planVersionId: "p", version: "2", renewalCancelled: false, autopayState: "DISABLED", scheduledPlanVersionId: "plan-next", scheduledEffectiveAt: "soon" });
    await expect(api.getSubscription(NORTHWIND)).resolves.toMatchObject({ scheduledEffectiveAt: null });
  });

  it("another company: WorkspaceClosedError and no request (the company session is this tab's)", async () => {
    const { sent } = gateway();
    const { api, closed } = await inNorthwind();
    const before = sent.length;
    for (const read of [() => api.getEntitlement(GLOBEX), () => api.getTenantQuotas(GLOBEX), () => api.getSubscription(GLOBEX)]) {
      await expect(read()).rejects.toBeInstanceOf(WorkspaceClosedError);
    }
    expect(sent.length).toBe(before);
    expect(closed).toEqual([]);
  });

  it("an answer naming another company is a failed read for the new read and the existing three (B3)", async () => {
    gateway();
    const { api, closed } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/billing/entitlement`] = () => json(200, { ...ENTITLEMENT, tenantId: GLOBEX });
    answers[`GET /tenants/${NORTHWIND}/quotas`] = () => json(200, { tenantId: GLOBEX, version: "1", quotas: [], asOf: "2026-11-05T10:00:00Z" });
    answers[`GET /tenants/${NORTHWIND}/billing/subscription`] = () =>
      json(200, { tenantId: GLOBEX, planVersionId: "p", version: "1", renewalCancelled: false, autopayState: "DISABLED" });
    answers[`GET /tenants/${NORTHWIND}`] = () => json(200, { id: GLOBEX, name: "Globex", ownerId: ANNA, lifecycle: "ACTIVE", restrictions: [], version: "3" });
    for (const read of [() => api.getEntitlement(NORTHWIND), () => api.getTenantQuotas(NORTHWIND), () => api.getSubscription(NORTHWIND), () => api.getTenant(NORTHWIND)]) {
      const error = await read().then(
        () => null,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(ForeignCompanyAnswerError);
      // The client's own rule: no status, no code, no request id, no words of anybody's server.
      expect(apiErrorFacts(error)).toEqual({ message: null, requestId: null, status: null, code: null, details: null });
    }
    // The tab keeps the company it holds, and its name is not learnt from the foreign answer.
    expect(closed).toEqual([]);
    expect(api.currentWorkspace()).toMatchObject({ tenantId: NORTHWIND });
    expect(api.currentWorkspace()?.tenantName).not.toBe("Globex");
  });

  it("the entitlement is control plane: a refusal with a pause's reasons marks nothing and closes nothing (B8)", async () => {
    gateway();
    const { api, closed, restricted } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/billing/entitlement`] = () => problem(403, "CAPABILITY_DISABLED", ["OWNER_PAUSE"]);
    const error = await api.getEntitlement(NORTHWIND).catch((failure: unknown) => failure);
    expect(refusalCode(error)).toBe("CAPABILITY_DISABLED");
    expect(apiErrorFacts(error).requestId).toBe("rid-CAPABILITY_DISABLED");
    expect(closed).toEqual([]);
    expect(restricted).toEqual([]);
    expect(api.currentWorkspace()?.tenantSessionId).toBe("ts-1");
  });
});

describe("parity: a new issue at the task limit (§5)", () => {
  it("both implementations answer 422 QUOTA_EXCEEDED with no reasons and a request id", async () => {
    gateway();
    answers[`POST /projects/${MOCK_PROJECT_IDS.web}/issues`] = () => problem(422, "QUOTA_EXCEEDED");
    const { api: rest } = await inNorthwind();
    const input = { summary: "One more", description: "", issueType: "TASK", priority: "LOW" } as const;
    const facts = (error: unknown) => ({ status: apiErrorFacts(error).status, code: refusalCode(error), reasons: [...refusalReasons(error)], id: typeof apiErrorFacts(error).requestId });
    const viaRest = await rest.createIssue(MOCK_PROJECT_IDS.web, input, crypto.randomUUID()).catch((failure: unknown) => failure);
    vi.unstubAllGlobals();

    const local = new MemoryStorage();
    const mock = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
    await mock.signIn({ email: "anna@example.com", password: "x" });
    await mock.enterCompany(NORTHWIND);
    const viaMock = await mock.createIssue(MOCK_PROJECT_IDS.web, input, crypto.randomUUID()).catch((failure: unknown) => failure);
    expect(facts(viaRest)).toEqual({ status: 422, code: "QUOTA_EXCEEDED", reasons: [], id: "string" });
    expect(facts(viaMock)).toEqual(facts(viaRest));
  });
});
