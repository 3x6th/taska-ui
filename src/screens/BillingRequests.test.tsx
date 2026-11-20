import { render, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { taskaApi } from "../api/client";
import { companiesHarness } from "../test/companiesHarness";
import { CompanySetupScreen } from "./CompanySetupScreen";
import { CompanyBillingSection } from "./company/CompanyBillingSection";
import { CompanyInvoiceSection } from "./company/CompanyInvoiceSection";

/**
 * What Company › Billing and the never-opened card cost on the wire (TAS-513,
 * api-contract-guard F9) — `ScreenRequests.test.tsx`'s method for the
 * companies build: the real `RestTaskaApi` with the B2B session layer over a
 * stubbed `fetch`, so every count is a request that would reach the gateway.
 * Its own file because `ScreenRequests.test.tsx` mocks the client as today's
 * build, which sends none of these.
 *
 * The guard's table: the list `getTenant ∥ me → listInvoices`; the invoice
 * `getTenant ∥ me → getInvoice`, with `listInvoices` only for an EXPIRED or
 * VOID one (F3); the card `getTenant → listInvoices` (F4, F7) — no `getInvoice`
 * without a payment out. The catalogue (`GET /billing/plans`, public) names the
 * invoice's plan.
 */

const ANNA = "6d774efa-57d8-4ae0-a27e-2984d1dfbbf6";
const NORTHWIND = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b01";
const STARK = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b08";
const INVOICE = "4b8e2a1c-6d3f-4e5a-9b7c-1a2b3c4d5e08";

vi.mock("../api/client", async () => {
  const { RestTaskaApi } = await import("../api/rest/RestTaskaApi");
  const { MemoryStorage: Storage } = await import("../test/memoryStorage");
  const { createLocalLockManager } = await import("../api/webSession");
  return {
    taskaApi: new RestTaskaApi("/api/v1", {
      tenancy: true,
      local: new Storage(),
      session: new Storage(),
      locks: createLocalLockManager(),
      ownershipWaitMs: 25,
      events: null,
    }),
  };
});

const EUR = (amountMinor: string) => ({ amountMinor, currency: "EUR", exponent: 2 });
const server = { invoiceState: "OPEN", tenantId: NORTHWIND, lifecycle: "ACTIVE" };

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
const invoice = () => ({
  id: INVOICE,
  tenantId: server.tenantId,
  number: "TSK-2026-01008",
  purpose: server.tenantId === STARK ? "INITIAL" : "RENEWAL",
  state: server.invoiceState,
  planVersionId: "plan-team",
  total: EUR("2000"),
  allocated: EUR("0"),
  remaining: EUR("2000"),
  issuedAt: "2026-11-10T09:00:00Z",
  dueAt: "2099-01-02T09:00:00Z",
  paymentMethod: "PSP",
  version: "1",
  matchedUnallocated: EUR("0"),
});
const tenant = () => ({
  id: server.tenantId,
  name: server.tenantId === STARK ? "Stark Industries" : "Northwind",
  ownerId: ANNA,
  lifecycle: server.lifecycle,
  restrictions: server.lifecycle === "AWAITING_PAYMENT" ? ["PENDING_FIRST_PAYMENT"] : [],
  createdAt: "2026-05-01T09:00:00Z",
  ...(server.lifecycle === "AWAITING_PAYMENT" ? { creationDeadline: "2099-12-04T14:32:00Z" } : {}),
  version: "3",
});

/** Every request, in the order it left, with when it left and when it was answered. */
const log: Array<{ route: string; started: number; answered: number }> = [];
let tick = 0;

function stubGateway() {
  let minted = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = url.replace(/^\/api\/v1/, "");
      const entry = { route: `${method} ${path}`, started: (tick += 1), answered: Number.POSITIVE_INFINITY };
      log.push(entry);
      // An answer is a later tick than every request that left before it.
      await Promise.resolve();
      const answer = (() => {
        if (path === "/auth/web-sessions") return json(200, session("account-session", "g0"));
        if (path === "/auth/tenant-sessions") {
          minted += 1;
          return json(201, session(`ts-${minted}`, `t${minted}`, JSON.parse(String(init.body)).tenantId));
        }
        if (path === "/users/me") return json(200, { id: ANNA, email: "anna@example.com", displayName: "Anna Ivanova", status: "ACTIVE", globalRole: "USER" });
        if (path.startsWith("/billing/plans")) return json(200, { items: [] });
        if (path.startsWith(`/tenants/${server.tenantId}/billing/invoices?`)) return json(200, { items: [invoice()] });
        if (path === `/tenants/${server.tenantId}/billing/invoices/${INVOICE}`) return json(200, invoice());
        if (path === `/tenants/${server.tenantId}`) return json(200, tenant());
        if (path.startsWith("/tenants")) return json(200, { items: [tenant()] });
        return json(404, { code: "NOT_FOUND", message: `No route ${method} ${path}` });
      })();
      entry.answered = (tick += 1);
      return answer;
    }),
  );
}

/** The routes a screen sent, from `from` on, with the session routes left out. */
const sent = (from: number) =>
  log.slice(from).filter((entry) => !entry.route.includes("/auth/") && !entry.route.startsWith("GET /tenants?") && entry.route !== "GET /tenants");
const one = (entries: typeof log, route: string) => {
  const found = entries.filter((entry) => entry.route === route);
  expect(found, route).toHaveLength(1);
  return found[0];
};

async function enter(tenantId: string, lifecycle: string, invoiceState = "OPEN") {
  server.tenantId = tenantId;
  server.lifecycle = lifecycle;
  server.invoiceState = invoiceState;
  if (!taskaApi.hasSession()) await taskaApi.signIn({ email: "anna@example.com", password: "x" });
  await taskaApi.enterCompany(tenantId);
  return log.length;
}

beforeAll(() => stubGateway());
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  window.localStorage.clear();
});

const tenantRoute = (tenantId: string) => `GET /tenants/${tenantId}`;
const invoicesRoute = (tenantId: string) => `GET /tenants/${tenantId}/billing/invoices?limit=100`;
const invoiceRoute = (tenantId: string) => `GET /tenants/${tenantId}/billing/invoices/${INVOICE}`;

describe("the request budget of Billing and the never-opened card (F9)", () => {
  it("the list: getTenant ∥ me, then listInvoices — and nothing else of the company's", async () => {
    const from = await enter(NORTHWIND, "ACTIVE");
    const { wrapper } = companiesHarness({ companyId: NORTHWIND, path: "/company/billing" });
    const view = render(<CompanyBillingSection />, { wrapper });
    await screen.findByRole("link", { name: "TSK-2026-01008" });
    const routes = sent(from);
    expect(routes.map((entry) => entry.route).sort()).toEqual(["GET /users/me", invoicesRoute(NORTHWIND), tenantRoute(NORTHWIND)].sort());
    const list = one(routes, invoicesRoute(NORTHWIND));
    expect(list.started).toBeGreaterThan(one(routes, tenantRoute(NORTHWIND)).answered);
    expect(list.started).toBeGreaterThan(one(routes, "GET /users/me").answered);
    view.unmount();
  });

  it("the invoice: getTenant ∥ me, then getInvoice and the public catalogue — no list for an open one", async () => {
    const from = await enter(NORTHWIND, "ACTIVE");
    const { wrapper } = companiesHarness({ companyId: NORTHWIND, path: `/company/billing/${INVOICE}` });
    const view = render(
      <Routes>
        <Route path="/company/billing/:invoiceId" element={<CompanyInvoiceSection />} />
      </Routes>,
      { wrapper },
    );
    await screen.findByRole("button", { name: "Pay €20.00" });
    const routes = sent(from);
    expect(routes.map((entry) => entry.route).filter((route) => !route.startsWith("GET /billing/plans")).sort()).toEqual(
      ["GET /users/me", invoiceRoute(NORTHWIND), tenantRoute(NORTHWIND)].sort(),
    );
    expect(one(routes, invoiceRoute(NORTHWIND)).started).toBeGreaterThan(one(routes, tenantRoute(NORTHWIND)).answered);
    view.unmount();
  });

  it("an EXPIRED invoice adds the list, after it — to find what replaced it", async () => {
    const from = await enter(NORTHWIND, "ACTIVE", "EXPIRED");
    const { wrapper } = companiesHarness({ companyId: NORTHWIND, path: `/company/billing/${INVOICE}` });
    const view = render(
      <Routes>
        <Route path="/company/billing/:invoiceId" element={<CompanyInvoiceSection />} />
      </Routes>,
      { wrapper },
    );
    await screen.findByText("This invoice can no longer be paid.");
    await waitFor(() => expect(sent(from).map((entry) => entry.route)).toContain(invoicesRoute(NORTHWIND)));
    const routes = sent(from);
    expect(routes.map((entry) => entry.route).filter((route) => !route.startsWith("GET /billing/plans")).sort()).toEqual(
      ["GET /users/me", invoiceRoute(NORTHWIND), invoicesRoute(NORTHWIND), tenantRoute(NORTHWIND)].sort(),
    );
    expect(one(routes, invoicesRoute(NORTHWIND)).started).toBeGreaterThan(one(routes, invoiceRoute(NORTHWIND)).answered);
    view.unmount();
  });

  it("the never-opened card: getTenant, then listInvoices — no getInvoice without a payment out", async () => {
    const from = await enter(STARK, "AWAITING_PAYMENT");
    const { wrapper } = companiesHarness({ companyId: STARK, path: "/projects" });
    const view = render(
      <CompanySetupScreen companyId={STARK} onOpened={() => {}} pending={null} row={null} session="open" theme="light" toggleTheme={() => {}} />,
      { wrapper },
    );
    await screen.findByRole("button", { name: "Pay €20.00" });
    const routes = sent(from);
    expect(routes.map((entry) => entry.route).sort()).toEqual(["GET /users/me", invoicesRoute(STARK), tenantRoute(STARK)].sort());
    expect(one(routes, invoicesRoute(STARK)).started).toBeGreaterThan(one(routes, tenantRoute(STARK)).answered);
    view.unmount();
  });
});

