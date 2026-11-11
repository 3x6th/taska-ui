import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { TenancyUnavailableError, apiErrorFacts, refusalCode, refusalRetryAfter, refusalViolations } from "../errors";
import { MockTaskaApi } from "../mock/MockTaskaApi";
import { MOCK_TENANT_IDS } from "../mock/MockTenantServer";
import { createCompaniesMockApi } from "../mock/mockCompanies";
import { createLocalLockManager } from "../webSession";
import { RestTaskaApi } from "./RestTaskaApi";

/*
 * The account's own credentials on the wire (TAS-527, api-contract-guard §1,
 * §7, F3): the exact five requests — the recovery pair with no credential, the
 * three commands with the account session from inside a company too — each with
 * the caller's `Idempotency-Key` and its body exactly; today's build refusing
 * all five without a request; and the same Problem facts from both
 * implementations.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = MOCK_TENANT_IDS.northwind;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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
  key: string | undefined;
  body: string | undefined;
}

let answers: Record<string, () => Response> = {};

function gateway() {
  const sent: Sent[] = [];
  let minted = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers as Record<string, string> | undefined) ?? {};
    sent.push({ url, method, authorization: headers.Authorization, key: headers["Idempotency-Key"], body: init.body as string | undefined });
    const path = url.replace(/^\/api\/v1/, "");
    const override = answers[`${method} ${path}`];
    if (override) return override();
    if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
    if (path === "/auth/web-sessions/refresh") return json(200, session("account-session", "g1"));
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
    }
    if (path === "/auth/password-recovery") return json(202, { accepted: true, retryAfterSeconds: 60 });
    if (path === "/auth/password-recovery/complete" || path === "/account/password" || path === "/account/email-changes/confirm") {
      return new Response(null, { status: 204 });
    }
    if (path === "/account/email-changes") {
      return json(201, { challengeId: "c-1", purpose: "CHANGE_EMAIL", expiresAt: "2026-11-11T10:10:00Z", delivery: "EMAIL", maskedDestination: "n•••@example.com" });
    }
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
  return api;
}

beforeEach(() => {
  answers = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("the account's credentials on the wire (TAS-527)", () => {
  it("today's build refuses all five without a request, in both implementations, and never tells of a change", async () => {
    const { fetch } = gateway();
    for (const api of [new RestTaskaApi("/api/v1"), new MockTaskaApi()]) {
      for (const call of [
        () => api.requestPasswordRecovery("anna@example.com", "k"),
        () => api.completePasswordRecovery("t".repeat(43), "a long new password", "k"),
        () => api.changeAccountPassword("p", "a long new password", "k"),
        () => api.requestAccountEmailChange("new@example.com", "p", "k"),
        () => api.confirmAccountEmailChange("c", "12345678", "k"),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
      }
      expect(typeof api.onAccountChanged(() => undefined)).toBe("function");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the exact five requests: the recovery pair bare, the commands with WEB_GLOBAL from inside a company, the key and the body exactly", async () => {
    const { sent } = gateway();
    const api = await inNorthwind();
    const before = sent.length;
    await expect(api.requestPasswordRecovery("anna@example.com", "k-1")).resolves.toEqual({ retryAfterSeconds: 60 });
    await api.completePasswordRecovery("t".repeat(43), "a long new password", "k-2");
    await api.changeAccountPassword("old password", "a long new password", "k-3");
    await expect(api.requestAccountEmailChange("new@example.com", "old password", "k-4")).resolves.toEqual({
      challengeId: "c-1",
      expiresAt: "2026-11-11T10:10:00Z",
      delivery: "EMAIL",
      maskedDestination: "n•••@example.com",
    });
    await api.confirmAccountEmailChange("c-1", "12345678", "k-5");
    expect(sent.slice(before)).toEqual([
      { url: "/api/v1/auth/password-recovery", method: "POST", authorization: undefined, key: "k-1", body: '{"email":"anna@example.com"}' },
      {
        url: "/api/v1/auth/password-recovery/complete",
        method: "POST",
        authorization: undefined,
        key: "k-2",
        body: `{"token":"${"t".repeat(43)}","newPassword":"a long new password"}`,
      },
      {
        url: "/api/v1/account/password",
        method: "PUT",
        authorization: "Bearer g0-access",
        key: "k-3",
        body: '{"currentPassword":"old password","newPassword":"a long new password"}',
      },
      {
        url: "/api/v1/account/email-changes",
        method: "POST",
        authorization: "Bearer g0-access",
        key: "k-4",
        body: '{"newEmail":"new@example.com","currentPassword":"old password"}',
      },
      { url: "/api/v1/account/email-changes/confirm", method: "POST", authorization: "Bearer g0-access", key: "k-5", body: '{"challengeId":"c-1","code":"12345678"}' },
    ]);
  });

  it("a 401 on the recovery is the link's: no refresh, the session and the company kept", async () => {
    const { sent } = gateway();
    const api = await inNorthwind();
    answers["POST /auth/password-recovery/complete"] = () =>
      new Response(JSON.stringify({ type: "about:blank", title: "Invalid or expired token", status: 401, code: "AUTHENTICATION_REQUIRED", requestId: "rid-dead" }), {
        status: 401,
        headers: { "Content-Type": "application/problem+json" },
      });
    const error = await api.completePasswordRecovery("t".repeat(43), "a long new password", "k").catch((failure: unknown) => failure);
    expect(apiErrorFacts(error)).toMatchObject({ status: 401, requestId: "rid-dead", message: "Invalid or expired token" });
    expect(sent.some((request) => request.url.endsWith("/auth/web-sessions/refresh"))).toBe(false);
    expect(api.hasSession()).toBe(true);
    expect(api.currentWorkspace()?.tenantId).toBe(NORTHWIND);
  });

  it("proof on the wire: a password the server answers 401 after a good rotation stays the server's 401, and nobody is signed out", async () => {
    const { sent } = gateway();
    const api = await inNorthwind();
    const expired = vi.fn();
    api.onSessionExpired(expired);
    answers["PUT /account/password"] = () =>
      new Response(JSON.stringify({ title: "Wrong password", status: 401, code: "AUTHENTICATION_REQUIRED", requestId: "rid-401" }), {
        status: 401,
        headers: { "Content-Type": "application/problem+json" },
      });
    const error = await api.changeAccountPassword("typo", "a long new password", "k-p").catch((failure: unknown) => failure);
    expect(apiErrorFacts(error)).toMatchObject({ status: 401, requestId: "rid-401" });
    const puts = sent.filter((request) => request.url.endsWith("/account/password"));
    expect(puts.map((request) => [request.authorization, request.key])).toEqual([
      ["Bearer g0-access", "k-p"],
      ["Bearer g1-access", "k-p"],
    ]);
    expect(expired).not.toHaveBeenCalled();
    expect(api.hasSession()).toBe(true);
  });

  it("a Problem's violations and wait reach the screen from both implementations alike", async () => {
    gateway();
    answers["POST /account/email-changes/confirm"] = () =>
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Invalid request",
          status: 400,
          code: "VALIDATION_FAILED",
          requestId: "rid-v",
          violations: [{ field: "code", code: "INVALID", message: "The code must be 8 digits." }],
        }),
        { status: 400, headers: { "Content-Type": "application/problem+json" } },
      );
    answers["POST /auth/password-recovery"] = () =>
      new Response(JSON.stringify({ title: "Too many requests", status: 429, code: "RATE_LIMITED", requestId: "rid-429" }), {
        status: 429,
        headers: { "Content-Type": "application/problem+json", "Retry-After": "42" },
      });
    const rest = await inNorthwind();
    const restCode = await rest.confirmAccountEmailChange(MOCK_TENANT_IDS.globex, "1234", "k").catch((failure: unknown) => failure);
    const restWait = await rest.requestPasswordRecovery("anna@example.com", "k").catch((failure: unknown) => failure);
    vi.unstubAllGlobals();

    const local = new MemoryStorage();
    const mock = createCompaniesMockApi({ local, session: new MemoryStorage(), locks: createLocalLockManager(), events: null, latencyMs: 0, ownershipWaitMs: 25 });
    await mock.signIn({ email: "anna@example.com", password: "x" });
    const mockCode = await mock.confirmAccountEmailChange(MOCK_TENANT_IDS.globex, "1234", "k").catch((failure: unknown) => failure);
    local.setItem("taska.mockTenantHooks", JSON.stringify({ refuseNext: { requestPasswordRecovery: { status: 429, code: "RATE_LIMITED", retryAfterSeconds: 42 } } }));
    const mockWait = await mock.requestPasswordRecovery("anna@example.com", "k").catch((failure: unknown) => failure);

    const facts = (error: unknown) => ({
      status: apiErrorFacts(error).status,
      code: refusalCode(error),
      violations: refusalViolations(error).map(({ field, code }) => ({ field, code })),
      wait: refusalRetryAfter(error),
      id: typeof apiErrorFacts(error).requestId,
    });
    expect(facts(restCode)).toEqual({ status: 400, code: "VALIDATION_FAILED", violations: [{ field: "code", code: "INVALID" }], wait: null, id: "string" });
    expect(facts(mockCode)).toEqual(facts(restCode));
    expect(facts(restWait)).toEqual({ status: 429, code: "RATE_LIMITED", violations: [], wait: 42, id: "string" });
    expect(facts(mockWait)).toEqual(facts(restWait));
  });
});
