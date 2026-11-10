import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { checkoutAttemptKey } from "../../api/checkoutAttempt";
import { companiesHarness } from "../../test/companiesHarness";
import { App } from "../App";
import { CompanyStateBlock } from "./CompanyStateBlock";

/*
 * Company › Billing as the app routes it (TAS-513, art-director B1, B3–B7,
 * B9; api-contract-guard §7): the rail item for the owner only, the list and
 * its Pay, the non-owner's one line with no billing request at all — and the
 * invoice's state block for each answer an unresolved payment can get.
 */

const { fakeApi, state } = vi.hoisted(() => {
  const EUR = (amountMinor: string) => ({ amountMinor, currency: "EUR", exponent: 2 });
  const state = {
    me: "tom",
    calls: [] as string[],
    invoices: [] as Array<Record<string, unknown>>,
    checkout: null as null | (() => Promise<unknown>),
    restrictions: [] as string[],
    createHangs: false,
    EUR,
  };
  const workspace = { tenantId: "n", tenantName: "Northwind", tenantSessionId: "s-n" };
  const tenant = () => ({ id: "n", name: "Northwind", ownerId: "tom", lifecycle: "ACTIVE", restrictions: state.restrictions, createdAt: "2026-05-01T09:00:00Z", version: "1" });
  const known: Record<string, unknown> = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    enterCompany: async () => undefined,
    settleWorkspace: async () => workspace,
    lastCompanyHint: () => null,
    currentWorkspace: () => workspace,
    onWorkspaceChange: () => () => {},
    onWorkspaceClosed: () => () => {},
    onWorkspaceLeft: () => () => {},
    onWorkspacePending: () => () => {},
    onWorkspaceRestricted: () => () => {},
    listTenants: async () => ({ items: [tenant()], nextCursor: null }),
    getTenant: async () => tenant(),
    listBillingPlans: async () => ({ items: [], nextCursor: null }),
    getCurrentUser: async () => ({ id: state.me, email: `${state.me}@example.com`, displayName: state.me, status: "ACTIVE", globalRole: "USER", avatarUrl: null, avatarUnavailable: false }),
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0, unreadCount: 0 }),
    listInvoices: async () => {
      state.calls.push("listInvoices");
      return { items: state.invoices, nextCursor: null };
    },
    getInvoice: async (_tenantId: string, invoiceId: string) => {
      state.calls.push("getInvoice");
      return state.invoices.find((invoice) => invoice.id === invoiceId);
    },
    getCheckout: () => {
      state.calls.push("getCheckout");
      return state.checkout ? state.checkout() : new Promise(() => {});
    },
    // The page address stays the provider's: a stand-in that goes nowhere, so the press stays in flight.
    createCheckout: async (_tenantId: string, invoiceId: string) => {
      state.calls.push("createCheckout");
      if (state.createHangs) return new Promise(() => {});
      return { id: "co-1", invoiceId, state: "CREATED", expiresAt: null, redirect: { go: () => {} } };
    },
  };
  const api = new Proxy(known, {
    get: (target, key) => {
      if (typeof key !== "string" || key in target) return target[key as string];
      if (key === "then") return undefined;
      return () => new Promise(() => {});
    },
  });
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: "inv-renewal",
  tenantId: "n",
  number: "TSK-2026-01008",
  purpose: "RENEWAL",
  state: "OPEN",
  planVersionId: "p",
  total: state.EUR("2000"),
  allocated: state.EUR("0"),
  remaining: state.EUR("2000"),
  matchedUnallocated: null,
  issuedAt: "2026-11-10T09:00:00Z",
  dueAt: "2026-12-04T09:00:00Z",
  paymentMethod: "PSP",
  version: "1",
  replacesInvoiceId: null,
  ...overrides,
});

const checkout = (checkoutState: string) => ({ id: "co-1", invoiceId: "inv-renewal", state: checkoutState, expiresAt: null, redirect: null });

/** An unresolved attempt of the renewal, as the Pay press leaves it. */
function attempt(extra: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    checkoutAttemptKey("tom", "n", "inv-renewal"),
    JSON.stringify({ v: 1, userId: "tom", tenantId: "n", invoiceId: "inv-renewal", key: "k", returnTarget: "BILLING", startedAt: "2026-11-11T09:00:00Z", checkoutId: "co-1", ...extra }),
  );
}

const renderAt = (path: string) => render(<App />, { wrapper: companiesHarness({ companyId: "n", path }).wrapper });
const rail = () => screen.getByRole("navigation", { name: "Company" });
const block = () => document.querySelector(".company-payment-state") as HTMLElement;

beforeEach(() => {
  state.me = "tom";
  state.calls = [];
  state.invoices = [invoice(), invoice({ id: "inv-initial", number: "TSK-2026-01002", purpose: "INITIAL", state: "PAID", issuedAt: "2026-05-04T09:00:00Z", allocated: state.EUR("2000"), remaining: state.EUR("0") })];
  state.checkout = null;
  state.restrictions = [];
  state.createHangs = false;
});

afterEach(() => {
  window.localStorage.clear();
  document.title = "";
});

describe("the rail and who sees Billing (B1, §7)", () => {
  it("the owner has Billing fourth in the rail and its list: newest first, the marker's words, Pay on the open one", async () => {
    renderAt("/company/billing");
    await waitFor(() => expect(within(rail()).getAllByRole("link").map((link) => link.textContent)).toEqual(["General", "Members", "Plan", "Billing", "Back to projects"]));
    expect(within(rail()).getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Invoices for Northwind and how they were paid.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Invoices2");
    const rows = screen.getAllByRole("listitem").filter((item) => item.classList.contains("company-invoice-row"));
    expect(rows.map((row) => within(row).getByRole("link").textContent)).toEqual(["TSK-2026-01008", "TSK-2026-01002"]);
    expect(rows[0]).toHaveTextContent(/Renewal · Due Dec 4/);
    expect(within(rows[0]).getByText("€20.00")).toBeInTheDocument();
    expect(within(rows[0]).getAllByText("unpaid").length).toBeGreaterThan(0);
    expect(within(rows[0]).getByRole("button", { name: "Pay" })).toHaveClass("primary-button");
    expect(within(rows[1]).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rows[1]).getAllByText("paid").length).toBeGreaterThan(0);
  });

  it("an unresolved attempt reads «confirming» and takes Pay away", async () => {
    attempt();
    renderAt("/company/billing");
    const row = (await screen.findByRole("link", { name: "TSK-2026-01008" })).closest("li") as HTMLElement;
    expect(within(row).getAllByText("confirming").length).toBeGreaterThan(0);
    expect(within(row).queryByRole("button", { name: "Pay" })).not.toBeInTheDocument();
  });

  it("a record of an invoice the list reads PAID: «paid», never «confirming» — and the list closes it (B1)", async () => {
    attempt();
    state.invoices[0] = invoice({ state: "PAID", allocated: state.EUR("2000"), remaining: state.EUR("0") });
    renderAt("/company/billing");
    const row = (await screen.findByRole("link", { name: "TSK-2026-01008" })).closest("li") as HTMLElement;
    expect(within(row).getAllByText("paid").length).toBeGreaterThan(0);
    expect(within(row).queryByText("confirming")).not.toBeInTheDocument();
    await waitFor(() => expect(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal"))).toBeNull());
  });

  it("a member who is not the owner has no Billing in the rail, gets one line at its address, and no billing request goes out", async () => {
    state.me = "anna";
    renderAt("/company/billing");
    expect(await screen.findByText("Invoices and payments for Northwind are shown only to its owner.")).toBeInTheDocument();
    expect(within(rail()).getAllByRole("link").map((link) => link.textContent)).toEqual(["General", "Members", "Plan", "Back to projects"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Company ›\s*Billing/);
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(screen.getAllByText("Invoices and payments for Northwind are shown only to its owner.")).toHaveLength(2));
    expect(state.calls).toEqual([]);
  });
});

describe("the invoice and its payment's state (B5–B7)", () => {
  it("names the invoice in the heading and draws its facts, with «Pay €20.00»", async () => {
    renderAt("/company/billing/inv-renewal");
    const heading = await screen.findByRole("heading", { level: 1, name: /Company.*Billing.*Invoice TSK-2026-01008/ });
    expect(heading).toHaveTextContent("Company › Billing ›Invoice TSK-2026-01008");
    expect(screen.getByRole("button", { name: "Pay €20.00" })).toHaveClass("primary-button");
    const labels = [...document.querySelectorAll(".company-invoice-facts dt")].map((dt) => dt.textContent);
    expect(labels).toEqual(["Status", "Amount", "For", "Issued", "Due", "Payment"]);
    expect(block()).toHaveAttribute("role", "status");
    expect(block()).toBeEmptyDOMElement();
  });

  it("a SUCCEEDED checkout with the invoice still OPEN is «Confirming» — no Pay, no «Paid»", async () => {
    attempt();
    state.checkout = async () => checkout("SUCCEEDED");
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("Confirming the payment."));
    await waitFor(() => expect(state.calls).toContain("getCheckout"));
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    expect(block()).not.toHaveTextContent("Paid");
  });

  it("the invoice PAID is «Paid.» — and closes the record", async () => {
    attempt();
    state.checkout = async () => checkout("SUCCEEDED");
    state.invoices[0] = invoice({ state: "PAID", allocated: state.EUR("2000"), remaining: state.EUR("0") });
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("Paid. Invoice TSK-2026-01008 is paid in full."));
    expect(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal"))).toBeNull();
  });

  it("FAILED says so and offers Pay again; the record is closed", async () => {
    attempt();
    state.checkout = async () => checkout("FAILED");
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("The payment didn’t go through. The invoice is still unpaid."));
    expect(await screen.findByRole("button", { name: "Pay €20.00" })).toBeInTheDocument();
    expect(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal"))).toBeNull();
  });

  it("UNKNOWN offers no Pay and keeps the record", async () => {
    attempt();
    state.checkout = async () => checkout("UNKNOWN");
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("We’re confirming this payment with the bank."));
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal"))).not.toBeNull();
  });

  it("back through the cancel address: «You left the payment page.» and «Return to payment», no Pay", async () => {
    attempt({ leftAt: "2026-11-11T09:05:00Z" });
    state.checkout = async () => checkout("PENDING");
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("You left the payment page. The invoice is still unpaid."));
    expect(await screen.findByRole("button", { name: "Return to payment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it("Back from the provider out of the back/forward cache: the attempt reads as left, focus on «Return to payment» (N3)", async () => {
    state.checkout = async () => checkout("PENDING");
    renderAt("/company/billing/inv-renewal");
    const pay = await screen.findByRole("button", { name: "Pay €20.00" });
    fireEvent.click(pay);
    await waitFor(() => expect(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal"))).toContain('"checkoutId":"co-1"'));
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    await waitFor(() => expect(block()).toHaveTextContent("You left the payment page. The invoice is still unpaid."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Return to payment" })).toHaveFocus());
    expect(JSON.parse(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal")) ?? "{}").leftAt).toEqual(expect.any(String));
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it("Back before any checkout was recorded: Pay at rest again, with focus (N3)", async () => {
    state.createHangs = true;
    renderAt("/company/billing/inv-renewal");
    const pay = await screen.findByRole("button", { name: "Pay €20.00" });
    // The press went out and nothing came back: the record has no checkout.
    fireEvent.click(pay);
    expect(await screen.findByRole("button", { name: "Opening payment page" })).toBeInTheDocument();
    document.body.focus();
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    expect(await screen.findByRole("button", { name: "Pay €20.00" })).toHaveFocus();
    expect(JSON.parse(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal")) ?? "{}").leftAt).toBeUndefined();
    expect(block()).toBeEmptyDOMElement();
  });

  it("a checkout this company does not have: said, and nothing offered", async () => {
    attempt();
    state.checkout = () => Promise.reject(Object.assign(new Error("not found"), { status: 404, code: "RESOURCE_NOT_FOUND", requestId: "r", details: null, reasons: [] }));
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("This payment wasn’t found in Northwind."));
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it("an expired invoice can no longer be paid, and names the invoice that replaced it", async () => {
    state.invoices = [invoice({ state: "EXPIRED" }), invoice({ id: "inv-new", number: "TSK-2026-01010", replacesInvoiceId: "inv-renewal" })];
    renderAt("/company/billing/inv-renewal");
    expect(await screen.findByText("This invoice can no longer be paid.")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "TSK-2026-01010" })).toHaveAttribute("href", "/company/billing/inv-new");
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
  });
});

describe("«See Billing» (B2c)", () => {
  it("ends the owner's ended-period line, as a link to Billing; nobody else's", () => {
    const owner = render(
      <MemoryRouter>
        <CompanyStateBlock owner restrictions={["PAYMENT_EXPIRED"]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "See Billing" })).toHaveAttribute("href", "/company/billing");
    expect(screen.getByText(/This version of Taska can’t change plans yet\.$/)).toBeInTheDocument();
    owner.unmount();
    render(
      <MemoryRouter>
        <CompanyStateBlock owner={false} restrictions={["PAYMENT_EXPIRED"]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "See Billing" })).not.toBeInTheDocument();
  });
});
