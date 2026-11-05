import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import {
  TenancyUnavailableError,
  WorkspaceClosedError,
  apiErrorFacts,
  isUndeployedRoute,
  refusalCode,
  refusalReasons,
  refusalViolations,
} from "../errors";
import { TENANCY_WITHHELD_OPERATIONS, UNDEPLOYED_ROUTE_MESSAGE } from "../TaskaApi";
import { TAB_KEY, WEB_SESSION_KEY, createLocalLockManager } from "../webSession";
import { refusalRetryAfter } from "../errors";
import { ApiError, RestTaskaApi } from "./RestTaskaApi";

/*
 * `RestTaskaApi` in the companies build (TAS-500): exactly the blueprint's
 * routes, the credential api-contract-guard §2 names for each, the Problem
 * envelope read (B6), and nothing of today's session (B8). And today's build,
 * once more, untouched.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01";
const GLOBEX = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b02";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const problem = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  json(status, { type: "about:blank", title: code.toLowerCase(), status, code, requestId: `rid-${code}`, reasons: [], ...extra }, {
    "Content-Type": "application/problem+json",
  });

let minted = 0;
const accessSession = (sessionId: string, tag: string, tenantId?: string) => ({
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
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | undefined;
}

/** A gateway that speaks the blueprint; `override` answers first when it returns a response. */
function blueprintGateway(override?: (sent: Sent) => Response | Promise<Response> | undefined) {
  const sent: Sent[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const request: Sent = {
      url,
      method: init.method ?? "GET",
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      signal: init.signal ?? undefined,
    };
    sent.push(request);
    const answer = await override?.(request);
    if (answer) return answer;
    const path = url.replace(/^\/api\/v1/, "");
    if (path === "/auth/web-sessions") return json(200, accessSession("account-session", "g0"));
    if (path === "/auth/web-sessions/refresh") return json(200, accessSession("account-session", "g1"));
    if (path.startsWith("/tenants")) return json(200, { items: [{ id: NORTHWIND, name: "Northwind", ownerId: ANNA, lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "3", ownerVersion: "1" }] });
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, accessSession(`ts-${minted}`, `t${minted}`, (request.body as { tenantId: string }).tenantId));
    }
    if (path.startsWith("/auth/tenant-sessions/")) return new Response(null, { status: 204 });
    if (path === "/projects") return json(200, { items: [] });
    if (path === "/users/me") return json(200, { userId: ANNA, email: "anna@example.com", displayName: "Anna", status: "ACTIVE" });
    return json(404, { code: "NOT_FOUND", message: `No static resource api/v1${path}` });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, sent };
}

function companiesApi(local = new MemoryStorage(), session = new MemoryStorage()) {
  const api = new RestTaskaApi("/api/v1", {
    tenancy: true,
    local,
    session,
    locks: createLocalLockManager(),
    ownershipWaitMs: 25,
    events: null,
  });
  return { api, local, session };
}

const paths = (sent: Sent[]) => sent.map((request) => `${request.method} ${request.url}`);

beforeEach(() => {
  minted = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("today's build is untouched", () => {
  it("sends today's Accept, keeps today's two keys, offers no companies and asks nothing about them", async () => {
    const { fetch, sent } = blueprintGateway((request) =>
      request.url.endsWith("/auth/login") ? json(200, { accessToken: "a", refreshToken: "r", expiresIn: 3600 }) : undefined,
    );
    const api = new RestTaskaApi("/api/v1");
    expect(api.getTenancy()).toEqual({ companies: false, providerSignIn: true, accessTokenCreate: true, adminConsole: true });
    await expect(api.signIn({ email: "anna@example.com", password: "x" })).resolves.toEqual({ status: "SIGNED_IN", userId: null });
    await api.listProjects();
    expect(paths(sent)).toEqual(["POST /api/v1/auth/login", "GET /api/v1/projects"]);
    expect(sent.map((request) => request.headers.Accept)).toEqual(["application/json", "application/json"]);
    expect(sent.every((request) => request.signal === undefined)).toBe(true);
    expect(Object.keys(window.localStorage).sort()).toEqual(["taska.accessToken", "taska.refreshToken"]);
    expect(window.sessionStorage.length).toBe(0);

    for (const call of [() => api.listTenants(), () => api.enterCompany(NORTHWIND), () => api.leaveCompany()]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(api.currentWorkspace()).toBeNull();
    expect(api.lastCompanyHint()).toBeNull();
    expect(api.onWorkspaceClosed(() => {})).toEqual(expect.any(Function));
  });

  it("reads a Problem's reasons and title in today's build too — additive, since the stand answers none", async () => {
    blueprintGateway(() => problem(403, "READ_ONLY", { reasons: ["OWNER_PAUSE"], title: "The company is read-only" }));
    window.localStorage.setItem("taska.accessToken", "a");
    const api = new RestTaskaApi("/api/v1");
    const error = await api.listProjects().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(apiErrorFacts(error)).toMatchObject({ message: "The company is read-only", code: "READ_ONLY", status: 403, requestId: "rid-READ_ONLY" });
    expect(refusalReasons(error)).toEqual(["OWNER_PAUSE"]);
  });
});

describe("the Problem envelope (B6)", () => {
  it("message ?? title, the request id from the header then the body then the nested error, reasons and violations", async () => {
    const answers = [
      json(400, {
        type: "about:blank",
        title: "Invalid request",
        status: 400,
        code: "VALIDATION_FAILED",
        requestId: "rid-body",
        reasons: ["OVER_QUOTA", 7, ""],
        violations: [{ field: "limit", code: "MAX", message: "at most 100" }, { field: "x" }],
      }),
      json(403, { code: "VALIDATION_FAILED", title: "t", requestId: "rid-body" }, { "X-Request-Id": "rid-header" }),
      json(403, { code: "PERMISSION_DENIED", message: "Membership is not active", details: { reason: "MEMBERSHIP_INACTIVE" }, error: { code: "x", message: "y", requestId: "rid-nested" } }),
    ];
    blueprintGateway(() => answers.shift());
    window.localStorage.setItem("taska.accessToken", "a");
    const api = new RestTaskaApi("/api/v1");
    const first = (await api.listProjects().catch((failure: unknown) => failure)) as ApiError;
    expect(first.message).toBe("Invalid request");
    expect(first.requestId).toBe("rid-body");
    expect(first.reasons).toEqual(["OVER_QUOTA"]);
    expect(first.violations).toEqual([{ field: "limit", code: "MAX", message: "at most 100" }]);
    expect(refusalCode(first)).toBe("VALIDATION_FAILED");

    const second = (await api.listProjects().catch((failure: unknown) => failure)) as ApiError;
    expect(second.requestId).toBe("rid-header");

    const third = (await api.listProjects().catch((failure: unknown) => failure)) as ApiError;
    expect(third.message).toBe("Membership is not active");
    expect(third.requestId).toBe("rid-nested");
    expect(refusalCode(third)).toBe("MEMBERSHIP_INACTIVE");
    expect(third.reasons).toEqual([]);
  });
});

describe("the companies build calls exactly the blueprint's routes (§1, §2, B8)", () => {
  it("signs in with POST /auth/web-sessions and a key, never reads the legacy pair, and deletes it", async () => {
    const local = new MemoryStorage();
    local.setItem("taska.accessToken", "legacy-access");
    local.setItem("taska.refreshToken", "legacy-refresh");
    const { sent } = blueprintGateway();
    const { api } = companiesApi(local);
    expect(api.hasSession()).toBe(false);
    // Signed out, an account route goes with nothing — not with the legacy token.
    await api.getCurrentUser().catch(() => undefined);
    await expect(api.signIn({ email: "anna@example.com", password: "secret" })).resolves.toEqual({ status: "SIGNED_IN", userId: ANNA });

    const [signedOut, signIn] = sent;
    expect(signedOut.headers.Authorization).toBeUndefined();
    expect(`${signIn.method} ${signIn.url}`).toBe("POST /api/v1/auth/web-sessions");
    expect(signIn.body).toEqual({ email: "anna@example.com", password: "secret" });
    expect(signIn.headers["Idempotency-Key"]).toMatch(UUID);
    expect(signIn.headers.Authorization).toBeUndefined();
    expect(signIn.headers.Accept).toBe("application/json, application/problem+json");
    expect(local.getItem("taska.accessToken")).toBeNull();
    expect(local.getItem("taska.refreshToken")).toBeNull();
    expect(JSON.parse(local.getItem(WEB_SESSION_KEY) as string)).toMatchObject({ v: 1, userId: ANNA, sessionId: "account-session" });
    expect(sent.some((request) => JSON.stringify(request).includes("legacy-"))).toBe(false);
  });

  it("enters a company with the account's credential; then its data goes with the company's, the list with the account's", async () => {
    const { sent } = blueprintGateway();
    const { api, session, local } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await expect(api.enterCompany(NORTHWIND)).resolves.toEqual({ tenantId: NORTHWIND, tenantName: null, tenantSessionId: "ts-1" });
    await api.listProjects();
    await api.getCurrentUser();
    await api.listTenants({ limit: 100 });
    await api.enterCompany(GLOBEX);
    await api.leaveCompany();
    await vi.waitFor(() => expect(sent.filter((request) => request.method === "DELETE")).toHaveLength(2));

    const summary = sent.map((request) => [`${request.method} ${request.url}`, request.headers.Authorization ?? null]);
    expect(summary).toEqual([
      ["POST /api/v1/auth/web-sessions", null],
      ["POST /api/v1/auth/tenant-sessions", "Bearer g0-access"],
      ["GET /api/v1/projects", "Bearer t1-access"],
      ["GET /api/v1/users/me", "Bearer t1-access"],
      ["GET /api/v1/tenants?limit=100", "Bearer g0-access"],
      ["DELETE /api/v1/auth/tenant-sessions/ts-1", "Bearer g0-access"],
      ["POST /api/v1/auth/tenant-sessions", "Bearer g0-access"],
      ["DELETE /api/v1/auth/tenant-sessions/ts-2", "Bearer g0-access"],
    ]);
    expect(sent[1].body).toEqual({ tenantId: NORTHWIND });
    for (const command of sent.filter((request) => request.url.includes("/auth/"))) {
      expect(command.headers["Idempotency-Key"]).toMatch(UUID);
    }
    expect(session.getItem(TAB_KEY)).toBeNull();
    expect(JSON.parse(local.getItem("taska.lastCompany") as string)).toEqual({ userId: ANNA, companyId: GLOBEX });
  });

  it("refuses today's session routes and the withheld operations without a request", async () => {
    const { fetch } = blueprintGateway();
    const { api } = companiesApi();
    expect(api.getTenancy()).toEqual({ companies: true, providerSignIn: false, accessTokenCreate: false, adminConsole: false });
    for (const name of TENANCY_WITHHELD_OPERATIONS) {
      const error = await (api[name] as (...args: unknown[]) => Promise<unknown>)
        .call(api, "a", "b", "c")
        .catch((failure: unknown) => failure);
      expect(error, name).toBeInstanceOf(TenancyUnavailableError);
      expect(apiErrorFacts(error), name).toEqual({ message: null, requestId: null, status: null, code: null, details: null });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("on the stand today, sign-in fails closed on the static-resource 404 and nothing is stored", async () => {
    blueprintGateway((request) =>
      request.url.endsWith("/auth/web-sessions")
        ? json(404, { code: "NOT_FOUND", message: "No static resource api/v1/auth/web-sessions for request '/api/v1/auth/web-sessions'" })
        : undefined,
    );
    const { api, local, session } = companiesApi();
    const error = await api.signIn({ email: "anna@example.com", password: "x" }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(ApiError);
    expect(isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)).toBe(true);
    expect(local.length).toBe(0);
    expect(session.length).toBe(0);
    expect(api.hasSession()).toBe(false);
  });

  it("a GLOBAL_ADMIN's 403 MFA_REQUIRED (backend PR #288) is the dead end, with the Problem's request id", async () => {
    blueprintGateway((request) => (request.url.endsWith("/auth/web-sessions") ? problem(403, "MFA_REQUIRED") : undefined));
    const { api, local } = companiesApi();
    await expect(api.signIn({ email: "mark@example.com", password: "x" })).resolves.toEqual({
      status: "ADMIN_MFA_REQUIRED",
      requestId: "rid-MFA_REQUIRED",
    });
    expect(local.length).toBe(0);
  });

  it("renews the company family with its own refresh token and a key, then retries", async () => {
    let refused = false;
    const { sent } = blueprintGateway((request) => {
      if (request.url.endsWith("/projects") && request.headers.Authorization === "Bearer t1-access") {
        refused = true;
        return problem(401, "AUTHENTICATION_REQUIRED");
      }
      if (request.url.endsWith("/auth/web-sessions/refresh") && (request.body as { refreshToken: string }).refreshToken.startsWith("t1")) {
        return json(200, accessSession("ts-1", "t1b", NORTHWIND));
      }
      return undefined;
    });
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    await expect(api.listProjects()).resolves.toEqual([]);
    expect(refused).toBe(true);
    const refresh = sent.find((request) => request.url.endsWith("/auth/web-sessions/refresh"));
    expect(refresh?.body).toEqual({ refreshToken: "t1-refresh-0123456789abcdef0123456789" });
    expect(refresh?.headers.Authorization).toBeUndefined();
    expect(refresh?.headers["Idempotency-Key"]).toMatch(UUID);
    expect(sent.at(-1)?.headers.Authorization).toBe("Bearer t1b-access");
  });

  it("aborts a request of the company the tab has left, and answers it WorkspaceClosedError (B3)", async () => {
    let release!: () => void;
    const held = new Promise<Response>((resolve) => {
      release = () => resolve(json(200, { items: [{ id: "a project of Northwind" }] }));
    });
    const { sent } = blueprintGateway((request) => (request.url.endsWith("/projects") ? held : undefined));
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    const asked = api.listProjects();
    await vi.waitFor(() => expect(sent.some((request) => request.url.endsWith("/projects"))).toBe(true));
    await api.enterCompany(GLOBEX);
    expect(sent.find((request) => request.url.endsWith("/projects"))?.signal?.aborted).toBe(true);
    release();
    await expect(asked).rejects.toBeInstanceOf(WorkspaceClosedError);
  });
});

/* --------------------------------------------- creating a company (TAS-501) */

const NEW = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OPERATION = "4a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const KEY = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const pendingTenant = {
  id: NEW,
  name: "Acme",
  ownerId: ANNA,
  lifecycle: "AWAITING_PAYMENT",
  restrictions: ["PENDING_FIRST_PAYMENT"],
  createdAt: "2026-11-04T10:00:00Z",
  creationDeadline: "2026-12-04T10:00:00Z",
  version: "1",
  ownerVersion: "1",
};

/** The blueprint gateway with the creation routes answered. */
function creationGateway(extra?: (sent: Sent) => Response | undefined) {
  return blueprintGateway((request) => {
    const answer = extra?.(request);
    if (answer) return answer;
    const path = request.url.replace(/^\/api\/v1/, "");
    if (path.startsWith("/billing/plans")) return json(200, { items: [{ id: "plan-free", name: "Free", price: { amountMinor: "0", currency: "EUR", exponent: 2 }, period: "NONE", limits: [], capabilities: [], state: "PUBLISHED", code: "free", version: "1" }] });
    if (path === "/tenants" && request.method === "POST") {
      return json(202, {
        tenant: pendingTenant,
        operation: { id: OPERATION, type: "TENANT_PROVISION", state: "PENDING", createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:00Z", tenantId: NEW },
      });
    }
    if (path === `/tenants/${NEW}` && request.method === "GET") return json(200, pendingTenant);
    if (path === `/tenants/${NEW}/operations/${OPERATION}`) {
      return json(200, { id: OPERATION, type: "TENANT_PROVISION", state: "SUCCEEDED", createdAt: "2026-11-04T10:00:00Z", updatedAt: "2026-11-04T10:00:03Z", tenantId: NEW });
    }
    if (path === `/tenants/${NEW}/cancel-creation`) return json(200, { ...pendingTenant, lifecycle: "OWNER_CANCELLED", version: "2" });
    return undefined;
  });
}

describe("creating a company on the wire (TAS-501, api-contract-guard §1, §9 parity)", () => {
  it("today's build refuses all five without a request", async () => {
    const { fetch } = creationGateway();
    const api = new RestTaskaApi("/api/v1");
    for (const call of [
      () => api.listBillingPlans(),
      () => api.createTenant({ name: "Acme", planVersionId: "p" }, KEY),
      () => api.getTenant(NEW),
      () => api.getTenantOperation(NEW, OPERATION),
      () => api.cancelTenantCreation(NEW, "1", KEY),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("each route with its credential: plans none, creating the account's from inside a company, the rest the company's", async () => {
    const { sent } = creationGateway();
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    await expect(api.listBillingPlans({ limit: 100 })).resolves.toMatchObject({ items: [{ id: "plan-free" }], nextCursor: null });
    const created = await api.createTenant({ name: "Acme", planVersionId: "plan-team" }, KEY);
    expect(created.tenant).toMatchObject({ id: NEW, lifecycle: "AWAITING_PAYMENT", creationDeadline: "2026-12-04T10:00:00Z" });
    // A replayed 202's operation state is read as sent — the screens never trust it (ask A12).
    expect(created.operation.state).toBe("PENDING");
    await api.enterCompany(NEW);
    await expect(api.getTenant(NEW)).resolves.toMatchObject({ lifecycle: "AWAITING_PAYMENT" });
    await expect(api.getTenantOperation(NEW, OPERATION)).resolves.toMatchObject({ state: "SUCCEEDED" });
    await expect(api.cancelTenantCreation(NEW, "1", KEY)).resolves.toMatchObject({ lifecycle: "OWNER_CANCELLED", version: "2" });

    const at = (method: string, path: string) => sent.find((request) => request.method === method && request.url === `/api/v1${path}`);
    expect(at("GET", "/billing/plans?limit=100")?.headers.Authorization).toBeUndefined();
    const create = at("POST", "/tenants");
    expect(create?.headers.Authorization).toBe("Bearer g0-access");
    expect(create?.headers["Idempotency-Key"]).toBe(KEY);
    expect(create?.body).toEqual({ name: "Acme", planVersionId: "plan-team" });
    expect(create?.headers["If-Match"]).toBeUndefined();
    expect(at("GET", `/tenants/${NEW}`)?.headers.Authorization).toBe("Bearer t2-access");
    expect(at("GET", `/tenants/${NEW}/operations/${OPERATION}`)?.headers.Authorization).toBe("Bearer t2-access");
    const cancel = at("POST", `/tenants/${NEW}/cancel-creation`);
    expect(cancel?.headers).toMatchObject({ Authorization: "Bearer t2-access", "Idempotency-Key": KEY, "If-Match": '"1"' });
    expect(cancel?.body).toEqual({ confirmed: true });
  });

  it("a 429's Retry-After is the refusal's wait, in whole seconds; anything else is none", async () => {
    const answers = [
      problem(429, "RATE_LIMITED", {}),
      problem(429, "RATE_LIMITED", {}),
      problem(503, "DEPENDENCY_UNAVAILABLE", {}),
    ];
    const headers = ["30", "Wed, 21 Oct 2026 07:28:00 GMT", null];
    creationGateway((request) => {
      if (request.url !== "/api/v1/tenants" || request.method !== "POST") return undefined;
      const answer = answers.shift() as Response;
      const header = headers.shift();
      if (header) answer.headers.set("Retry-After", header);
      return answer;
    });
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    const refusals = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      refusals.push(await api.createTenant({ name: "Acme", planVersionId: "p" }, KEY).catch((failure: unknown) => failure));
    }
    expect(refusals.map((error) => [apiErrorFacts(error).status, refusalRetryAfter(error)])).toEqual([
      [429, 30],
      [429, null],
      [503, null],
    ]);
    expect((refusals[0] as ApiError).retryAfterSeconds).toBe(30);
  });
});


/* ------------------------------ members, invitations and seats (TAS-502) */

const MEMBER = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PROJECT_ID = "2e74e49f-0f29-4e03-b4ec-adc4dbf2382e";
const INVITATION = "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const membershipWire = { id: "m-1", tenantId: NORTHWIND, userId: MEMBER, role: "MEMBER", state: "ACTIVE", isOwner: false, displayName: "Sofia", email: "sofia@example.com", version: "3" };
const invitationWire = { id: INVITATION, tenantId: NORTHWIND, email: "kai@example.com", role: "MEMBER", state: "PENDING", expiresAt: "2026-11-12T10:00:00Z", createdBy: ANNA, projectGrants: [], version: "1" };

function membersGateway(extra?: (sent: Sent) => Response | undefined) {
  return blueprintGateway((request) => {
    const answer = extra?.(request);
    if (answer) return answer;
    const path = request.url.replace(/^\/api\/v1/, "");
    const base = `/tenants/${NORTHWIND}`;
    if (path.startsWith(`${base}/members?`) || path === `${base}/members`) return json(200, { items: [membershipWire] });
    if (path === `${base}/members/${MEMBER}/role` || path === `${base}/members/${MEMBER}/state`) return json(200, { ...membershipWire, version: "4" });
    if (path === `${base}/members/${MEMBER}`) {
      return json(202, { id: "op-1", type: "removeTenantMember", state: "PENDING", createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z", tenantId: NORTHWIND });
    }
    if (path === `${base}/leave`) {
      return json(202, { id: "op-2", type: "leaveTenant", state: "SUCCEEDED", createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z", tenantId: NORTHWIND });
    }
    if (path.startsWith(`${base}/invitations?`) || (path === `${base}/invitations` && request.method === "GET")) return json(200, { items: [invitationWire] });
    if (path === `${base}/invitations` && request.method === "POST") return json(201, invitationWire);
    if (path === `${base}/invitations/${INVITATION}/resend`) return json(200, { ...invitationWire, version: "2" });
    if (path === `${base}/invitations/${INVITATION}`) return new Response(null, { status: 204 });
    if (path === `${base}/quotas`) {
      return json(200, { tenantId: NORTHWIND, version: "9", quotas: [{ kind: "SEAT", used: "4", reserved: "1", limit: "5", unlimited: false }], asOf: "2026-11-05T10:00:00Z" });
    }
    return undefined;
  });
}

describe("members, invitations and seats on the wire (TAS-502, api-contract-guard §1, §7 parity)", () => {
  it("today's build refuses all eleven without a request", async () => {
    const { fetch } = membersGateway();
    const api = new RestTaskaApi("/api/v1");
    for (const call of [
      () => api.listTenantMembers(NORTHWIND),
      () => api.setTenantMemberRole(NORTHWIND, MEMBER, "MEMBER", "1", KEY),
      () => api.setTenantMemberState(NORTHWIND, MEMBER, "SUSPENDED", "1", KEY),
      () => api.removeTenantMember(NORTHWIND, MEMBER, "1", KEY),
      () => api.leaveTenant(NORTHWIND, KEY),
      () => api.listTenantInvitations(NORTHWIND),
      () => api.createTenantInvitation(NORTHWIND, { email: "k@example.com", role: "MEMBER", projectGrants: [] }, KEY),
      () => api.resendTenantInvitation(NORTHWIND, INVITATION, KEY),
      () => api.revokeTenantInvitation(NORTHWIND, INVITATION, "1", KEY),
      () => api.getTenantQuotas(NORTHWIND),
      () => api.reenterCompany(NORTHWIND),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("each route: the company session, the key, If-Match quoted, the bodies byte for byte, DELETE without one", async () => {
    const { sent } = membersGateway();
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    await expect(api.listTenantMembers(NORTHWIND, { limit: 100 })).resolves.toMatchObject({ items: [{ userId: MEMBER, version: "3" }], nextCursor: null });
    await expect(api.setTenantMemberRole(NORTHWIND, MEMBER, "TENANT_ADMIN", "3", KEY)).resolves.toMatchObject({ version: "4" });
    await api.setTenantMemberState(NORTHWIND, MEMBER, "SUSPENDED", "4", KEY);
    await expect(api.removeTenantMember(NORTHWIND, MEMBER, "4", KEY)).resolves.toMatchObject({ id: "op-1", state: "PENDING" });
    await api.listTenantInvitations(NORTHWIND, { cursor: "c1", limit: 100 });
    await api.createTenantInvitation(
      NORTHWIND,
      { email: "kai@example.com", role: "MEMBER", projectGrants: [{ projectId: PROJECT_ID, role: "VIEWER" }] },
      KEY,
    );
    await api.resendTenantInvitation(NORTHWIND, INVITATION, KEY);
    await expect(api.revokeTenantInvitation(NORTHWIND, INVITATION, "1", KEY)).resolves.toBeUndefined();
    await expect(api.getTenantQuotas(NORTHWIND)).resolves.toMatchObject({ version: "9", quotas: [{ kind: "SEAT", used: "4", reserved: "1", limit: "5" }] });

    const at = (method: string, path: string) => sent.find((request) => request.method === method && request.url === `/api/v1/tenants/${NORTHWIND}${path}`);
    const company = { Authorization: "Bearer t1-access" };
    expect(at("GET", "/members?limit=100")?.headers).toMatchObject(company);
    expect(at("GET", "/members?limit=100")?.headers["Idempotency-Key"]).toBeUndefined();
    const role = at("PATCH", `/members/${MEMBER}/role`);
    expect(role?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"3"', "Content-Type": "application/json" });
    expect(role?.body).toEqual({ role: "TENANT_ADMIN" });
    const state = at("PATCH", `/members/${MEMBER}/state`);
    expect(state?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"4"' });
    expect(state?.body).toEqual({ state: "SUSPENDED" });
    const remove = at("DELETE", `/members/${MEMBER}`);
    expect(remove?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"4"' });
    expect(remove?.body).toBeUndefined();
    expect(remove?.headers["Content-Type"]).toBeUndefined();
    expect(at("GET", "/invitations?cursor=c1&limit=100")?.headers).toMatchObject(company);
    const invite = sent.find((request) => request.method === "POST" && request.url === `/api/v1/tenants/${NORTHWIND}/invitations`);
    expect(invite?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY });
    expect(invite?.headers["If-Match"]).toBeUndefined();
    expect(JSON.stringify(invite?.body)).toBe(`{"email":"kai@example.com","role":"MEMBER","projectGrants":[{"projectId":"${PROJECT_ID}","role":"VIEWER"}]}`);
    const resend = at("POST", `/invitations/${INVITATION}/resend`);
    expect(resend?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY });
    expect(resend?.headers["If-Match"]).toBeUndefined();
    expect(resend?.body).toBeUndefined();
    const revoke = at("DELETE", `/invitations/${INVITATION}`);
    expect(revoke?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"1"' });
    expect(revoke?.body).toBeUndefined();
    expect(at("GET", "/quotas")?.headers).toMatchObject(company);

    // Leave: the key, `{confirmed: true}`, no If-Match (the blueprint's; ask A20) — and the company session goes.
    await expect(api.leaveTenant(NORTHWIND, KEY)).resolves.toMatchObject({ state: "SUCCEEDED" });
    const leave = at("POST", "/leave");
    expect(leave?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY });
    expect(leave?.headers["If-Match"]).toBeUndefined();
    expect(leave?.body).toEqual({ confirmed: true });
    expect(api.currentWorkspace()).toBeNull();
    expect(sent.some((request) => request.method === "DELETE" && request.url === "/api/v1/auth/tenant-sessions/ts-1")).toBe(true);
  });

  it("a Problem's violations, reasons and Retry-After are read as the mock's are", async () => {
    const answers = [
      problem(400, "VALIDATION_FAILED", { violations: [{ field: "projectGrants[0].projectId", code: "NOT_FOUND", message: "no such project" }] }),
      problem(403, "READ_ONLY", { reasons: ["PLATFORM_BLOCK"] }),
      problem(429, "RATE_LIMITED", {}),
    ];
    membersGateway((request) => {
      if (request.method !== "POST" || !request.url.endsWith("/invitations")) return undefined;
      const answer = answers.shift() as Response;
      if (answers.length === 0) answer.headers.set("Retry-After", "12");
      return answer;
    });
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    const send = () => api.createTenantInvitation(NORTHWIND, { email: "k@example.com", role: "MEMBER", projectGrants: [] }, KEY).catch((error: unknown) => error);
    const invalid = await send();
    expect(refusalViolations(invalid).map((item) => item.field)).toEqual(["projectGrants[0].projectId"]);
    const readOnly = await send();
    expect([refusalCode(readOnly), refusalReasons(readOnly)]).toEqual(["READ_ONLY", ["PLATFORM_BLOCK"]]);
    expect(refusalRetryAfter(await send())).toBe(12);
    // None of them closed the company.
    expect(api.currentWorkspace()?.tenantId).toBe(NORTHWIND);
  });
});

/* ---------------------------------- the company's name, owner and pause (TAS-504) */

const OWNER_B = "3a4b5c6d-7e8f-4a0b-8c1d-2e3f4a5b6c7d";
const tenantWire = (extra: Record<string, unknown> = {}) => ({
  id: NORTHWIND,
  name: "Northwind",
  ownerId: ANNA,
  lifecycle: "ACTIVE",
  restrictions: [],
  createdAt: "2026-05-01T09:00:00Z",
  version: "4",
  ownerVersion: "1",
  ...extra,
});

function companyGateway(extra?: (sent: Sent) => Response | undefined) {
  return blueprintGateway((request) => {
    const answer = extra?.(request);
    if (answer) return answer;
    const path = request.url.replace(/^\/api\/v1/, "");
    const base = `/tenants/${NORTHWIND}`;
    if (path === base && request.method === "PATCH") return json(200, tenantWire({ name: (request.body as { name: string }).name, version: "5" }));
    if (path === base && request.method === "GET") return json(200, tenantWire());
    if (path === `${base}/pause` && request.method === "PUT") return json(200, tenantWire({ restrictions: ["OWNER_PAUSE"], version: "5" }));
    if (path === `${base}/pause` && request.method === "DELETE") return json(200, tenantWire({ version: "6" }));
    if (path === `${base}/ownership-transfer`) return json(200, tenantWire({ ownerId: OWNER_B, ownerVersion: "2", version: "5" }));
    if (path === `${base}/billing/subscription`) {
      return json(200, { tenantId: NORTHWIND, planVersionId: "plan-team", version: "2", currentPeriodId: "period-1", paidThrough: "2026-12-07T09:00:00Z", anchorDay: 7, renewalCancelled: false, autopayState: "CONSENTED" });
    }
    return undefined;
  });
}

describe("the company's name, owner and pause on the wire (TAS-504, api-contract-guard §1, §6 parity)", () => {
  it("today's build refuses all five without a request", async () => {
    const { fetch } = companyGateway();
    const api = new RestTaskaApi("/api/v1");
    for (const call of [
      () => api.renameTenant(NORTHWIND, "Northwind Traders", "4", KEY),
      () => api.pauseTenant(NORTHWIND, "4", KEY),
      () => api.resumeTenant(NORTHWIND, "4", KEY),
      () => api.transferTenantOwnership(NORTHWIND, OWNER_B, "4", KEY),
      () => api.getSubscription(NORTHWIND),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("each command: the company session, the key, If-Match quoted, the bodies byte for byte, DELETE without one", async () => {
    const { sent } = companyGateway();
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    await expect(api.renameTenant(NORTHWIND, "Northwind Traders", "4", KEY)).resolves.toMatchObject({ name: "Northwind Traders", version: "5" });
    await expect(api.pauseTenant(NORTHWIND, "5", KEY)).resolves.toMatchObject({ restrictions: ["OWNER_PAUSE"] });
    await expect(api.resumeTenant(NORTHWIND, "5", KEY)).resolves.toMatchObject({ restrictions: [], version: "6" });
    await expect(api.transferTenantOwnership(NORTHWIND, OWNER_B, "6", KEY)).resolves.toMatchObject({ ownerId: OWNER_B });

    const at = (method: string, path: string) => sent.find((request) => request.method === method && request.url === `/api/v1/tenants/${NORTHWIND}${path}`);
    const company = { Authorization: "Bearer t1-access" };
    const rename = at("PATCH", "");
    expect(rename?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"4"', "Content-Type": "application/json" });
    expect(JSON.stringify(rename?.body)).toBe('{"name":"Northwind Traders"}');
    const pause = at("PUT", "/pause");
    expect(pause?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"5"' });
    expect(JSON.stringify(pause?.body)).toBe('{"confirmed":true}');
    const resume = at("DELETE", "/pause");
    expect(resume?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"5"' });
    expect(resume?.body).toBeUndefined();
    expect(resume?.headers["Content-Type"]).toBeUndefined();
    const transfer = at("POST", "/ownership-transfer");
    expect(transfer?.headers).toMatchObject({ ...company, "Idempotency-Key": KEY, "If-Match": '"6"' });
    expect(JSON.stringify(transfer?.body)).toBe(`{"newOwnerUserId":"${OWNER_B}","confirmed":true}`);
    // None of them is an account-session request.
    expect(sent.filter((request) => request.url.includes(`/tenants/${NORTHWIND}`)).every((request) => request.headers.Authorization === "Bearer t1-access")).toBe(true);
  });

  it("the subscription: GET with the company session, read field by field — absent fields null, an unknown autopay state kept", async () => {
    let answer: Record<string, unknown> | null = null;
    const { sent } = companyGateway((request) =>
      answer !== null && request.url.endsWith("/billing/subscription") ? json(200, answer) : undefined,
    );
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    await expect(api.getSubscription(NORTHWIND)).resolves.toEqual({
      tenantId: NORTHWIND,
      planVersionId: "plan-team",
      version: "2",
      paidThrough: "2026-12-07T09:00:00Z",
      autopayState: "CONSENTED",
      renewalCancelled: false,
    });
    const read = sent.find((request) => request.url === `/api/v1/tenants/${NORTHWIND}/billing/subscription`);
    expect(read?.method).toBe("GET");
    expect(read?.headers).toMatchObject({ Authorization: "Bearer t1-access" });
    answer = { tenantId: NORTHWIND, planVersionId: "plan-free", version: "1", renewalCancelled: false, autopayState: "PAUSED_BY_BANK" };
    await expect(api.getSubscription(NORTHWIND)).resolves.toMatchObject({ paidThrough: null, autopayState: "PAUSED_BY_BANK" });
  });

  it("a refusal's facts are the mock's: code, reasons, violations and the request id; none closes the company", async () => {
    const answers = [
      problem(403, "READ_ONLY", { reasons: ["OWNER_PAUSE"] }),
      problem(400, "VALIDATION_FAILED", { violations: [{ field: "name", code: "INVALID", message: "name is invalid" }] }),
      problem(412, "VERSION_CONFLICT", {}),
      problem(403, "OWNER_REQUIRED", {}),
    ];
    companyGateway((request) => (request.method === "PATCH" ? (answers.shift() as Response) : undefined));
    const { api } = companiesApi();
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    const send = () => api.renameTenant(NORTHWIND, "X", "4", KEY).catch((error: unknown) => error);
    const readOnly = await send();
    expect([refusalCode(readOnly), refusalReasons(readOnly), apiErrorFacts(readOnly).requestId]).toEqual(["READ_ONLY", ["OWNER_PAUSE"], "rid-READ_ONLY"]);
    expect(refusalViolations(await send()).map((item) => item.field)).toEqual(["name"]);
    expect(apiErrorFacts(await send())).toMatchObject({ status: 412, code: "VERSION_CONFLICT" });
    expect(refusalCode(await send())).toBe("OWNER_REQUIRED");
    expect(api.currentWorkspace()?.tenantId).toBe(NORTHWIND);
  });

  it("B2 on the wire: a project read refused for a pause marks the tab and keeps the session; /projects answering lifts it, /users/me does not", async () => {
    let paused = true;
    const { sent } = companyGateway((request) =>
      paused && request.url === "/api/v1/projects" ? problem(403, "CAPABILITY_DISABLED", { reasons: ["OWNER_PAUSE"] }) : undefined,
    );
    const { api } = companiesApi();
    const closed: unknown[] = [];
    const restricted: Array<{ restricted: boolean; reasons: readonly string[] }> = [];
    api.onWorkspaceClosed((event) => closed.push(event));
    api.onWorkspaceRestricted((event) => restricted.push(event));
    await api.signIn({ email: "anna@example.com", password: "x" });
    await api.enterCompany(NORTHWIND);
    await expect(api.listProjects()).rejects.toMatchObject({ status: 403, code: "CAPABILITY_DISABLED" });
    expect(closed).toEqual([]);
    expect(restricted).toEqual([{ tenantId: NORTHWIND, restricted: true, reasons: ["OWNER_PAUSE"], requestId: "rid-CAPABILITY_DISABLED" }]);
    expect(sent.some((request) => request.method === "DELETE" && request.url.startsWith("/api/v1/auth/tenant-sessions/"))).toBe(false);
    await api.getCurrentUser();
    expect(restricted).toHaveLength(1);
    paused = false;
    await api.listProjects();
    expect(restricted.at(-1)).toMatchObject({ restricted: false });
  });
});
