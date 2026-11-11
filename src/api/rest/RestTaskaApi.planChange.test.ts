import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../test/memoryStorage";
import { UnreadableAnswerError } from "../billing";
import { TenancyUnavailableError, WorkspaceClosedError, apiErrorFacts, refusalCode } from "../errors";
import { MOCK_TENANT_IDS } from "../mock/MockTenantServer";
import type { WorkspaceClosedEvent } from "../TaskaApi";
import { ForeignCompanyAnswerError } from "../tenants";
import { createLocalLockManager } from "../webSession";
import { RestTaskaApi } from "./RestTaskaApi";

/*
 * The plan change, renewal and automatic payments on the wire (TAS-515,
 * api-contract-guard's pre-build ruling §1–§2): the exact routes with the
 * company session; `If-Match: "{Subscription.version}"` and the caller's
 * `Idempotency-Key` on all four; the bodies field by field in the blueprint's
 * order — the same bytes on a retry —; `consent: false` only; an answer naming
 * another company, or not an object, no answer about the command; a refusal
 * that closes nothing; and no request for another company or in today's build.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = MOCK_TENANT_IDS.northwind;
const GLOBEX = MOCK_TENANT_IDS.globex;
const PLAN = "7d2c4e1a-5b3f-4a6c-9e8d-0f1a2b3c4d04";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, code: string) =>
  new Response(JSON.stringify({ type: "about:blank", title: "the server's words", status, code, requestId: `rid-${code}`, reasons: [] }), {
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
const subscription = (overrides: Record<string, unknown> = {}) => ({
  tenantId: NORTHWIND,
  planVersionId: "plan-team",
  version: "8",
  paidThrough: "2026-12-20T09:00:00Z",
  renewalCancelled: false,
  autopayState: "CONSENTED",
  ...overrides,
});

interface Sent {
  url: string;
  method: string;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  ifMatch: string | undefined;
  body: string | undefined;
}

let answers: Record<string, () => Response> = {};

function gateway() {
  const sent: Sent[] = [];
  let minted = 0;
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers as Record<string, string> | undefined) ?? {};
    sent.push({
      url,
      method,
      authorization: headers.Authorization,
      idempotencyKey: headers["Idempotency-Key"],
      ifMatch: headers["If-Match"],
      body: init.body === undefined ? undefined : String(init.body),
    });
    const path = url.replace(/^\/api\/v1/, "");
    const override = answers[`${method} ${path}`];
    if (override) return override();
    if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
    }
    if (path === `/tenants/${NORTHWIND}/billing/plan-changes`) {
      return json(200, { subscription: subscription({ version: "9" }), effect: "AFTER_PAYMENT", invoiceId: "inv-1", operationId: "op-1" });
    }
    if (path === `/tenants/${NORTHWIND}/billing/renewal-cancellation`) return json(200, subscription({ renewalCancelled: method === "PUT", version: "9" }));
    if (path === `/tenants/${NORTHWIND}/billing/autopay`) return json(200, { id: "mandate-1", ownerId: ANNA, state: "DISABLED", version: "41" });
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
  api.onWorkspaceClosed((event) => closed.push(event));
  return { api, closed };
}

const billing = (sent: Sent[]) => sent.filter((request) => request.url.includes("/billing/"));
const input = { planVersionId: PLAN, currency: "EUR", paymentMethod: "PSP" } as const;

beforeEach(() => {
  answers = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("plan change, renewal and automatic payments on the wire (TAS-515)", () => {
  it("today's build refuses all four without a request", async () => {
    const { fetch } = gateway();
    const api = new RestTaskaApi("/api/v1");
    for (const call of [
      () => api.changeSubscriptionPlan(NORTHWIND, input, "8", crypto.randomUUID()),
      () => api.cancelSubscriptionRenewal(NORTHWIND, "8", crypto.randomUUID()),
      () => api.resumeSubscriptionRenewal(NORTHWIND, "8", crypto.randomUUID()),
      () => api.setAutopayConsent(NORTHWIND, false, "8", crypto.randomUUID()),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the exact routes and bodies, each with the company session, the key and If-Match — the same bytes on a retry", async () => {
    const { sent } = gateway();
    const { api } = await inNorthwind();
    const key = crypto.randomUUID();
    const answer = await api.changeSubscriptionPlan(NORTHWIND, input, "8", key);
    await api.changeSubscriptionPlan(NORTHWIND, input, "8", key);
    await api.cancelSubscriptionRenewal(NORTHWIND, "8", key);
    await api.resumeSubscriptionRenewal(NORTHWIND, "8", key);
    await api.setAutopayConsent(NORTHWIND, false, "8", key);
    const writes = billing(sent);
    expect(writes.map((request) => `${request.method} ${request.url}`)).toEqual([
      `POST /api/v1/tenants/${NORTHWIND}/billing/plan-changes`,
      `POST /api/v1/tenants/${NORTHWIND}/billing/plan-changes`,
      `PUT /api/v1/tenants/${NORTHWIND}/billing/renewal-cancellation`,
      `DELETE /api/v1/tenants/${NORTHWIND}/billing/renewal-cancellation`,
      `PUT /api/v1/tenants/${NORTHWIND}/billing/autopay`,
    ]);
    expect(writes.map((request) => request.body)).toEqual([
      `{"planVersionId":"${PLAN}","currency":"EUR","paymentMethod":"PSP","confirmed":true}`,
      `{"planVersionId":"${PLAN}","currency":"EUR","paymentMethod":"PSP","confirmed":true}`,
      '{"confirmed":true}',
      undefined,
      '{"consent":false,"confirmed":true}',
    ]);
    expect(writes.every((request) => request.authorization === "Bearer t1-access")).toBe(true);
    expect(writes.every((request) => request.idempotencyKey === key)).toBe(true);
    expect(writes.every((request) => request.ifMatch === '"8"')).toBe(true);
    // The answer, narrowed — its subscription for its company only, never anybody's next If-Match.
    expect(answer).toMatchObject({ effect: "AFTER_PAYMENT", invoiceId: "inv-1", operationId: "op-1", effectiveAt: null });
  });

  it("the mandate answer is its state only — never a version anybody could take for the subscription's", async () => {
    gateway();
    const { api } = await inNorthwind();
    expect(await api.setAutopayConsent(NORTHWIND, false, "8", crypto.randomUUID())).toEqual({ state: "DISABLED" });
  });

  it("an answer naming another company, or not an object, is no answer about the command — a failure without a status", async () => {
    gateway();
    const { api } = await inNorthwind();
    answers[`POST /tenants/${NORTHWIND}/billing/plan-changes`] = () => json(200, { subscription: subscription({ tenantId: GLOBEX }), effect: "IMMEDIATE" });
    await expect(api.changeSubscriptionPlan(NORTHWIND, input, "8", crypto.randomUUID())).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    answers[`PUT /tenants/${NORTHWIND}/billing/renewal-cancellation`] = () => json(200, subscription({ tenantId: GLOBEX }));
    await expect(api.cancelSubscriptionRenewal(NORTHWIND, "8", crypto.randomUUID())).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    for (const route of [
      `POST /tenants/${NORTHWIND}/billing/plan-changes`,
      `PUT /tenants/${NORTHWIND}/billing/renewal-cancellation`,
      `DELETE /tenants/${NORTHWIND}/billing/renewal-cancellation`,
      `PUT /tenants/${NORTHWIND}/billing/autopay`,
    ]) {
      answers[route] = () => json(200, "accepted");
    }
    const unreadable = [
      await api.changeSubscriptionPlan(NORTHWIND, input, "8", crypto.randomUUID()).catch((caught: unknown) => caught),
      await api.cancelSubscriptionRenewal(NORTHWIND, "8", crypto.randomUUID()).catch((caught: unknown) => caught),
      await api.resumeSubscriptionRenewal(NORTHWIND, "8", crypto.randomUUID()).catch((caught: unknown) => caught),
      await api.setAutopayConsent(NORTHWIND, false, "8", crypto.randomUUID()).catch((caught: unknown) => caught),
    ];
    for (const error of unreadable) {
      expect(error).toBeInstanceOf(UnreadableAnswerError);
      expect(apiErrorFacts(error)).toMatchObject({ status: null, code: null, requestId: null, message: null });
    }
  });

  it("a refusal is its own error and closes nothing; another company is refused without a request", async () => {
    const { sent } = gateway();
    const { api, closed } = await inNorthwind();
    answers[`POST /tenants/${NORTHWIND}/billing/plan-changes`] = () => problem(409, "FREE_ELIGIBILITY_USED");
    const refused = await api.changeSubscriptionPlan(NORTHWIND, input, "8", crypto.randomUUID()).catch((caught: unknown) => caught);
    expect(refusalCode(refused)).toBe("FREE_ELIGIBILITY_USED");
    expect(apiErrorFacts(refused).requestId).toBe("rid-FREE_ELIGIBILITY_USED");
    answers[`PUT /tenants/${NORTHWIND}/billing/autopay`] = () => problem(412, "VERSION_CONFLICT");
    expect(apiErrorFacts(await api.setAutopayConsent(NORTHWIND, false, "8", crypto.randomUUID()).catch((caught: unknown) => caught)).status).toBe(412);
    answers[`POST /tenants/${NORTHWIND}/billing/plan-changes`] = () => problem(404, "RESOURCE_NOT_FOUND");
    expect(refusalCode(await api.changeSubscriptionPlan(NORTHWIND, input, "8", crypto.randomUUID()).catch((caught: unknown) => caught))).toBe(
      "RESOURCE_NOT_FOUND",
    );
    expect(closed).toEqual([]);
    expect(api.currentWorkspace()?.tenantId).toBe(NORTHWIND);
    const before = billing(sent).length;
    await expect(api.changeSubscriptionPlan(GLOBEX, input, "8", crypto.randomUUID())).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(api.setAutopayConsent(GLOBEX, false, "8", crypto.randomUUID())).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(billing(sent).length).toBe(before);
  });
});
