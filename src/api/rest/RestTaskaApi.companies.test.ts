import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import {
  TenancyUnavailableError,
  WorkspaceClosedError,
  apiErrorFacts,
  isUndeployedRoute,
  refusalCode,
  refusalReasons,
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

