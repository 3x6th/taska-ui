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
 * The invoices and the hosted checkout on the wire (TAS-513, api-contract-guard
 * §1): the exact routes with the company session, the checkout body exactly
 * `{returnTarget, confirmed: true}` with the caller's `Idempotency-Key` — the
 * same bytes on a retry —, only an `https:` page address kept, an answer about
 * another company, invoice or checkout a failed read, a refusal that closes
 * nothing, and no request at all for another company or in today's build.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = MOCK_TENANT_IDS.northwind;
const GLOBEX = MOCK_TENANT_IDS.globex;
const INVOICE = "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e08";
const CHECKOUT = "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
const SECRET = "https://checkout.psp.example/c/pay/cs_test_secret";

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

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: INVOICE,
  tenantId: NORTHWIND,
  number: "TSK-2026-01008",
  purpose: "RENEWAL",
  state: "OPEN",
  planVersionId: "plan-team",
  total: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  allocated: { amountMinor: "0", currency: "EUR", exponent: 2 },
  remaining: { amountMinor: "2000", currency: "EUR", exponent: 2 },
  issuedAt: "2026-11-10T09:00:00Z",
  dueAt: "2027-01-02T09:00:00Z",
  paymentMethod: "PSP",
  version: "1",
  matchedUnallocated: { amountMinor: "0", currency: "EUR", exponent: 2 },
  ...overrides,
});

interface Sent {
  url: string;
  method: string;
  authorization: string | undefined;
  idempotencyKey: string | undefined;
  body: string | undefined;
  accept?: string | undefined;
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
      body: init.body === undefined ? undefined : String(init.body),
      accept: headers.Accept,
    });
    const path = url.replace(/^\/api\/v1/, "");
    const override = answers[`${method} ${path}`];
    if (override) return override();
    if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
    if (path === "/auth/tenant-sessions") {
      minted += 1;
      return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
    }
    if (path.startsWith("/auth/tenant-sessions/")) return new Response(null, { status: 204 });
    if (path.startsWith(`/tenants/${NORTHWIND}/billing/invoices?`)) return json(200, { items: [invoice()], nextCursor: "next-page" });
    if (path === `/tenants/${NORTHWIND}/billing/invoices/${INVOICE}`) return json(200, invoice());
    if (path === `/tenants/${NORTHWIND}/billing/invoices/${INVOICE}/document`) {
      return new Response("%PDF-1.4 mock", { status: 200, headers: { "Content-Type": "application/pdf" } });
    }
    if (path.startsWith(`/tenants/${NORTHWIND}/billing/refunds?`)) {
      return json(200, { items: [{ id: "rf-1", tenantId: NORTHWIND, paymentId: "p", kind: "UNALLOCATED_RETURN", state: "REQUESTED", amount: { amountMinor: "500", currency: "EUR", exponent: 2 }, reasonCode: "EXCESS", sourceMethod: "WIRE", requestedAt: "2026-11-10T09:00:00Z", version: "1" }] });
    }
    if (path === `/tenants/${NORTHWIND}/capabilities`) {
      return json(200, { tenantId: NORTHWIND, actorUserId: ANNA, durationsSeconds: { WIRE_RECONCILIATION_TARGET_SECONDS: 86400, UNPAID_CREATION_WINDOW_SECONDS: 2592000 }, expiresAt: "2026-11-11T09:00:30Z", items: [] });
    }
    if (path === `/tenants/${NORTHWIND}/billing/invoices/${INVOICE}/checkout`) {
      return json(201, { id: CHECKOUT, invoiceId: INVOICE, state: "CREATED", redirectUrl: SECRET, expiresAt: "2026-11-11T10:30:00Z" });
    }
    if (path === `/tenants/${NORTHWIND}/billing/checkout/${CHECKOUT}`) return json(200, { id: CHECKOUT, invoiceId: INVOICE, state: "PENDING", redirectUrl: SECRET });
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
  api.onWorkspaceClosed((event) => closed.push(event));
  return { api, closed };
}

const billing = (sent: Sent[]) => sent.filter((request) => request.url.includes("/billing/"));

beforeEach(() => {
  answers = {};
});
afterEach(() => vi.unstubAllGlobals());

describe("invoices and checkout on the wire (TAS-513)", () => {
  it("today's build refuses all four without a request", async () => {
    const { fetch } = gateway();
    const api = new RestTaskaApi("/api/v1");
    for (const call of [
      () => api.listInvoices(NORTHWIND),
      () => api.getInvoice(NORTHWIND, INVOICE),
      () => api.createCheckout(NORTHWIND, INVOICE, "BILLING", crypto.randomUUID()),
      () => api.getCheckout(NORTHWIND, CHECKOUT),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the exact routes, each with the tab's company session; the checkout body is exactly {returnTarget, confirmed: true} with the key", async () => {
    const { sent } = gateway();
    const { api } = await inNorthwind();
    const key = crypto.randomUUID();
    const page = await api.listInvoices(NORTHWIND, { cursor: "c1", limit: 100 });
    expect(page.nextCursor).toBe("next-page");
    await api.getInvoice(NORTHWIND, INVOICE);
    await api.createCheckout(NORTHWIND, INVOICE, "CREATION", key);
    await api.createCheckout(NORTHWIND, INVOICE, "CREATION", key);
    await api.getCheckout(NORTHWIND, CHECKOUT);
    const reads = billing(sent);
    expect(reads.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET /api/v1/tenants/${NORTHWIND}/billing/invoices?cursor=c1&limit=100`,
      `GET /api/v1/tenants/${NORTHWIND}/billing/invoices/${INVOICE}`,
      `POST /api/v1/tenants/${NORTHWIND}/billing/invoices/${INVOICE}/checkout`,
      `POST /api/v1/tenants/${NORTHWIND}/billing/invoices/${INVOICE}/checkout`,
      `GET /api/v1/tenants/${NORTHWIND}/billing/checkout/${CHECKOUT}`,
    ]);
    expect(reads.every((request) => request.authorization === "Bearer t1-access")).toBe(true);
    const posts = reads.filter((request) => request.method === "POST");
    expect(posts.map((request) => request.body)).toEqual(['{"returnTarget":"CREATION","confirmed":true}', '{"returnTarget":"CREATION","confirmed":true}']);
    expect(posts.map((request) => request.idempotencyKey)).toEqual([key, key]);
  });

  it("keeps the https page address only inside the redirect — a plain-http one is dropped", async () => {
    gateway();
    const { api } = await inNorthwind();
    const checkout = await api.createCheckout(NORTHWIND, INVOICE, "BILLING", crypto.randomUUID());
    expect(JSON.stringify(checkout)).not.toContain("cs_test_secret");
    const assign = vi.fn();
    checkout.redirect?.go({ assign });
    expect(assign).toHaveBeenCalledWith(SECRET);
    answers[`GET /tenants/${NORTHWIND}/billing/checkout/${CHECKOUT}`] = () =>
      json(200, { id: CHECKOUT, invoiceId: INVOICE, state: "PENDING", redirectUrl: "http://checkout.psp.example/pay" });
    expect((await api.getCheckout(NORTHWIND, CHECKOUT)).redirect).toBeNull();
  });

  it("an answer about another company, invoice or checkout is a failed read", async () => {
    gateway();
    const { api } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/billing/invoices/${INVOICE}`] = () => json(200, invoice({ tenantId: GLOBEX }));
    await expect(api.getInvoice(NORTHWIND, INVOICE)).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    answers[`GET /tenants/${NORTHWIND}/billing/invoices/${INVOICE}`] = () => json(200, invoice({ id: "another" }));
    await expect(api.getInvoice(NORTHWIND, INVOICE)).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    answers[`GET /tenants/${NORTHWIND}/billing/invoices?limit=50`] = () => json(200, { items: [invoice(), invoice({ id: "x", tenantId: GLOBEX })] });
    await expect(api.listInvoices(NORTHWIND, { limit: 50 })).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    answers[`POST /tenants/${NORTHWIND}/billing/invoices/${INVOICE}/checkout`] = () => json(201, { id: CHECKOUT, invoiceId: "another", state: "CREATED" });
    await expect(api.createCheckout(NORTHWIND, INVOICE, "BILLING", crypto.randomUUID())).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    // One that names no invoice is no answer about this payment either (F6) — a failure without a status, so the key is kept.
    answers[`POST /tenants/${NORTHWIND}/billing/invoices/${INVOICE}/checkout`] = () => json(201, { id: CHECKOUT, state: "CREATED", redirectUrl: SECRET });
    const unbound = await api.createCheckout(NORTHWIND, INVOICE, "BILLING", crypto.randomUUID()).catch((caught: unknown) => caught);
    expect(unbound).toBeInstanceOf(ForeignCompanyAnswerError);
    expect(apiErrorFacts(unbound).status).toBeNull();
    answers[`GET /tenants/${NORTHWIND}/billing/checkout/${CHECKOUT}`] = () => json(200, { id: "another", invoiceId: INVOICE, state: "PENDING" });
    await expect(api.getCheckout(NORTHWIND, CHECKOUT)).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
  });

  it("a refusal is its own error and closes nothing; another company is refused without a request", async () => {
    const { sent } = gateway();
    const { api, closed } = await inNorthwind();
    answers[`POST /tenants/${NORTHWIND}/billing/invoices/${INVOICE}/checkout`] = () => problem(503, "POLICY_NOT_CONFIGURED");
    const error = await api.createCheckout(NORTHWIND, INVOICE, "BILLING", crypto.randomUUID()).catch((caught: unknown) => caught);
    expect(refusalCode(error)).toBe("POLICY_NOT_CONFIGURED");
    expect(apiErrorFacts(error).requestId).toBe("rid-POLICY_NOT_CONFIGURED");
    answers[`GET /tenants/${NORTHWIND}/billing/invoices/${INVOICE}`] = () => problem(403, "OWNER_REQUIRED");
    expect(refusalCode(await api.getInvoice(NORTHWIND, INVOICE).catch((caught: unknown) => caught))).toBe("OWNER_REQUIRED");
    expect(closed).toEqual([]);
    expect(api.currentWorkspace()?.tenantId).toBe(NORTHWIND);
    const before = billing(sent).length;
    await expect(api.listInvoices(GLOBEX)).rejects.toBeInstanceOf(WorkspaceClosedError);
    await expect(api.getCheckout(GLOBEX, CHECKOUT)).rejects.toBeInstanceOf(WorkspaceClosedError);
    expect(billing(sent).length).toBe(before);
  });
});

describe("the document, the refunds and the durations on the wire (TAS-514)", () => {
  const DOCUMENT = `/tenants/${NORTHWIND}/billing/invoices/${INVOICE}/document`;

  it("today's build refuses all three without a request", async () => {
    const { fetch } = gateway();
    const api = new RestTaskaApi("/api/v1");
    for (const call of [() => api.getInvoiceDocument(NORTHWIND, INVOICE), () => api.listRefunds(NORTHWIND), () => api.getTenantCapabilities(NORTHWIND)]) {
      await expect(call()).rejects.toBeInstanceOf(TenancyUnavailableError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the exact routes with the tab's company session; the document asks for a PDF first, by GET, the token never in the address", async () => {
    const { sent } = gateway();
    const { api } = await inNorthwind();
    const document = await api.getInvoiceDocument(NORTHWIND, INVOICE);
    expect(await document.blob.text()).toBe("%PDF-1.4 mock");
    // No disposition the browser could read (A79): the screen names the file itself.
    expect(document.fileName).toBeNull();
    const refunds = await api.listRefunds(NORTHWIND, { limit: 100 });
    expect(refunds.items.map((refund) => [refund.reasonCode, refund.state])).toEqual([["EXCESS", "REQUESTED"]]);
    expect(await api.getTenantCapabilities(NORTHWIND)).toEqual({ tenantId: NORTHWIND, wireReconciliationTargetSeconds: 86400, expiresAt: "2026-11-11T09:00:30Z" });
    const reads = sent.filter((request) => request.url.includes(NORTHWIND) && !request.url.endsWith(NORTHWIND));
    expect(reads.map((request) => `${request.method} ${request.url}`)).toEqual([
      `GET /api/v1${DOCUMENT}`,
      `GET /api/v1/tenants/${NORTHWIND}/billing/refunds?limit=100`,
      `GET /api/v1/tenants/${NORTHWIND}/capabilities`,
    ]);
    expect(reads.every((request) => request.authorization === "Bearer t1-access")).toBe(true);
    expect(reads[0].accept).toBe("application/pdf, application/problem+json, application/json");
    expect(reads[0].url).not.toContain("access");
  });

  it("a readable Content-Disposition names the file, sanitised; a 2xx that is not a PDF is no document", async () => {
    gateway();
    const { api } = await inNorthwind();
    answers[`GET ${DOCUMENT}`] = () =>
      new Response("%PDF", { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="../TSK-2026-01008.pdf"' } });
    expect((await api.getInvoiceDocument(NORTHWIND, INVOICE)).fileName).toBe("TSK-2026-01008.pdf");
    answers[`GET ${DOCUMENT}`] = () => new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } });
    const unreadable = await api.getInvoiceDocument(NORTHWIND, INVOICE).catch((caught: unknown) => caught);
    expect(unreadable).toBeInstanceOf(UnreadableAnswerError);
    expect(apiErrorFacts(unreadable).status).toBeNull();
  });

  it("a refusal is the gateway's, with its request id, and closes nothing; another company is refused without a request", async () => {
    const { sent } = gateway();
    const { api, closed } = await inNorthwind();
    answers[`GET ${DOCUMENT}`] = () => problem(503, "POLICY_NOT_CONFIGURED");
    const refused = await api.getInvoiceDocument(NORTHWIND, INVOICE).catch((caught: unknown) => caught);
    expect(refusalCode(refused)).toBe("POLICY_NOT_CONFIGURED");
    expect(apiErrorFacts(refused).requestId).toBe("rid-POLICY_NOT_CONFIGURED");
    answers[`GET /tenants/${NORTHWIND}/billing/refunds?limit=100`] = () => problem(403, "OWNER_REQUIRED");
    expect(refusalCode(await api.listRefunds(NORTHWIND, { limit: 100 }).catch((caught: unknown) => caught))).toBe("OWNER_REQUIRED");
    expect(closed).toEqual([]);
    const before = sent.length;
    for (const call of [() => api.getInvoiceDocument(GLOBEX, INVOICE), () => api.listRefunds(GLOBEX), () => api.getTenantCapabilities(GLOBEX)]) {
      await expect(call()).rejects.toBeInstanceOf(WorkspaceClosedError);
    }
    expect(sent.length).toBe(before);
  });

  it("an answer about another company is a failed read; a capabilities body that is not an object is no answer", async () => {
    gateway();
    const { api } = await inNorthwind();
    answers[`GET /tenants/${NORTHWIND}/billing/refunds?limit=100`] = () => json(200, { items: [{ id: "rf-x", tenantId: GLOBEX }] });
    await expect(api.listRefunds(NORTHWIND, { limit: 100 })).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    answers[`GET /tenants/${NORTHWIND}/capabilities`] = () => json(200, { tenantId: GLOBEX, durationsSeconds: {} });
    await expect(api.getTenantCapabilities(NORTHWIND)).rejects.toBeInstanceOf(ForeignCompanyAnswerError);
    answers[`GET /tenants/${NORTHWIND}/capabilities`] = () => json(200, ["not", "an", "object"]);
    await expect(api.getTenantCapabilities(NORTHWIND)).rejects.toBeInstanceOf(UnreadableAnswerError);
  });

  it("the whole invoice: its snapshots and a WIRE invoice's bank details, as sent", async () => {
    gateway();
    const { api } = await inNorthwind();
    const bank = { beneficiaryName: "Taska Mock S.L. (test only)", iban: "XX00MOCK0000000000000000", bic: "MOCKESM0XXX", bankName: "Mock Bank", reference: "TASKA-1" };
    answers[`GET /tenants/${NORTHWIND}/billing/invoices/${INVOICE}`] = () =>
      json(200, invoice({ paymentMethod: "WIRE", wireInstructions: bank, buyer: { kind: "BUSINESS", name: "Northwind", email: "b@x.example", address: { country: "ES", postalCode: "1", city: "M", line1: "L" } } }));
    const detail = await api.getInvoice(NORTHWIND, INVOICE);
    expect(detail.wireInstructions).toEqual(bank);
    expect(detail.buyer?.name).toBe("Northwind");
    expect(detail.lines).toBeNull();
  });
});
