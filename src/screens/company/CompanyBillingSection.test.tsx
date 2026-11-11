import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { checkoutAttemptKey } from "../../api/checkoutAttempt";
import { companiesHarness } from "../../test/companiesHarness";
import { App } from "../App";
import { CompanyStateBlock } from "./CompanyStateBlock";
import { CreationPaySlot } from "./CreationPaySlot";

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
    /** TAS-515: the owner's subscription, read beside the list; a FREE company's by default, so no group. */
    subscription: null as null | Record<string, unknown>,
    autopayAnswer: null as null | (() => Promise<unknown>),
    autopaySent: [] as Array<{ version: string; key: string }>,
    /** TAS-514. */
    refunds: [] as Array<Record<string, unknown>>,
    targetSeconds: 86400 as number | null,
    document: null as null | (() => Promise<unknown>),
    /** TAS-516: the owner's disputes, read beside the list; none by default. */
    disputes: [] as Array<Record<string, unknown>>,
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
    getSubscription: async () => {
      state.calls.push("getSubscription");
      return state.subscription ?? { tenantId: "n", planVersionId: "free", version: "1", paidThrough: null, renewalCancelled: false, autopayState: "DISABLED", scheduledPlanVersionId: null, scheduledEffectiveAt: null };
    },
    setAutopayConsent: async (_tenantId: string, _consent: false, version: string, key: string) => {
      state.calls.push("setAutopayConsent");
      state.autopaySent.push({ version, key });
      if (state.autopayAnswer) return state.autopayAnswer();
      state.subscription = { ...(state.subscription ?? {}), autopayState: "DISABLED", version: "13" };
      return { state: "DISABLED" };
    },
    getInvoice: async (_tenantId: string, invoiceId: string) => {
      state.calls.push("getInvoice");
      return state.invoices.find((invoice) => invoice.id === invoiceId);
    },
    // TAS-514: the refunds beside the list, none by default; the durations of an open wire invoice.
    listRefunds: async () => {
      state.calls.push("listRefunds");
      return { items: state.refunds, nextCursor: null };
    },
    listDisputes: async () => {
      state.calls.push("listDisputes");
      return { items: state.disputes, nextCursor: null };
    },
    getTenantCapabilities: async () => {
      state.calls.push("getTenantCapabilities");
      return { tenantId: "n", wireReconciliationTargetSeconds: state.targetSeconds, expiresAt: null };
    },
    getInvoiceDocument: async () => {
      state.calls.push("getInvoiceDocument");
      if (state.document) return state.document();
      return { blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), fileName: null };
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
  wireInstructions: null,
  buyer: null,
  seller: null,
  lines: null,
  fxQuote: null,
  ...overrides,
});

/** A checkout as read: an open one carries its page (a stand-in that goes nowhere), any other none. */
const checkout = (checkoutState: string) => ({
  id: "co-1",
  invoiceId: "inv-renewal",
  state: checkoutState,
  expiresAt: null,
  redirect: checkoutState === "CREATED" || checkoutState === "PENDING" ? { go: () => {} } : null,
});

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
  state.subscription = null;
  state.autopayAnswer = null;
  state.autopaySent = [];
  state.refunds = [];
  state.targetSeconds = 86400;
  state.document = null;
  state.disputes = [];
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
    // The lead and «Invoices» stand above the skeleton already (NB3); the count comes with the list.
    await waitFor(() => expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Invoices2"));
    expect(screen.getByText("Invoices for Northwind and how they were paid.")).toBeInTheDocument();
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

describe("«Automatic payments» (TAS-515, art-director B8, decision 1)", () => {
  const paid = (autopayState: string, paidThrough: string | null = "2026-12-26T03:36:00Z") => ({
    tenantId: "n",
    planVersionId: "team",
    version: "12",
    paidThrough,
    renewalCancelled: false,
    autopayState,
    scheduledPlanVersionId: null,
    scheduledEffectiveAt: null,
  });
  const group = () => screen.getByRole("region", { name: "Automatic payments" });

  it("On, above «Invoices», with the lead naming both — and only «Turn off»: nothing turns them on", async () => {
    state.subscription = paid("CONSENTED");
    renderAt("/company/billing");
    expect(await screen.findByRole("heading", { level: 2, name: "Automatic payments" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Automatic payments", "Invoices2"]);
    expect(screen.getByText("Automatic payments and invoices for Northwind.")).toBeInTheDocument();
    expect(group()).toHaveTextContent("OnTaska takes Northwind’s payments automatically. You can still pay any invoice here yourself.");
    expect(within(group()).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Turn off automatic payments"]);
    expect(screen.queryByText(/Turn on/)).not.toBeInTheDocument();
  });

  it("Off says Taska can’t turn them on, with no button; Suspended offers «Turn off»; a state it does not know is drawn as it came", async () => {
    state.subscription = paid("DISABLED");
    const off = renderAt("/company/billing");
    // TAS-516 (T7): off until a new consent, which this build cannot take (A67).
    expect(
      await screen.findByText("You pay Northwind’s invoices here yourself. Automatic payments stay off until you set them up, which this version of Taska can’t do yet."),
    ).toBeInTheDocument();
    expect(within(group()).queryByRole("button")).not.toBeInTheDocument();
    off.unmount();
    state.subscription = paid("SUSPENDED", null);
    const suspended = renderAt("/company/billing");
    expect(await screen.findByText("Taska isn’t taking automatic payments for Northwind right now. You can pay its invoices here yourself.")).toBeInTheDocument();
    expect(within(group()).getByRole("button", { name: "Turn off automatic payments" })).toBeInTheDocument();
    suspended.unmount();
    state.subscription = paid("PAUSED_BY_BANK");
    renderAt("/company/billing");
    expect(await screen.findByText("PAUSED_BY_BANK")).toBeInTheDocument();
    expect(within(group()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("a FREE company with automatic payments off has no group, and the TAS-513 lead", async () => {
    renderAt("/company/billing");
    expect(await screen.findByRole("link", { name: "TSK-2026-01008" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Automatic payments" })).not.toBeInTheDocument();
    expect(screen.getByText("Invoices for Northwind and how they were paid.")).toBeInTheDocument();
  });

  it("«Turn off» asks first — «Keep them on» before the answer —, sends consent false with Subscription.version, then says it and focuses the heading", async () => {
    state.subscription = paid("CONSENTED");
    renderAt("/company/billing");
    fireEvent.click(await screen.findByRole("button", { name: "Turn off automatic payments" }));
    expect(screen.getByText(/^Automatic payments stop for Northwind, and you pay its invoices here yourself\. If Northwind isn’t paid for by Dec 26,/)).toHaveTextContent(
      /This version of Taska can’t turn them back on\.$/,
    );
    const keep = screen.getByRole("button", { name: "Keep them on" });
    expect(keep).toHaveFocus();
    const buttons = within(keep.parentElement as HTMLElement).getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Keep them on", "Turn off"]);
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(state.autopaySent).toHaveLength(1));
    expect(state.autopaySent[0].version).toBe("12");
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Automatic payments" })).toHaveFocus());
    expect(group()).toHaveTextContent(/^Automatic paymentsOff/);
    expect(screen.getByText("Automatic payments are off for Northwind.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  });

  it("an answer that never came: the same key and If-Match on the next press; a 412 a new one, after reading again", async () => {
    state.subscription = paid("CONSENTED");
    state.autopayAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
    renderAt("/company/billing");
    const open = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Turn off automatic payments" }));
      fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    };
    await open();
    const note = () => document.querySelector(".company-autopay .error-note");
    await waitFor(() => expect(note()).toHaveTextContent("Taska couldn’t confirm automatic payments were turned off. Press Turn off again to check."));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off automatic payments" })).toHaveFocus());
    state.subscription = { ...paid("CONSENTED"), version: "14" };
    await open();
    await waitFor(() => expect(state.autopaySent).toHaveLength(2));
    expect(state.autopaySent[1]).toEqual(state.autopaySent[0]);
    state.autopayAnswer = () => Promise.reject(Object.assign(new Error("stale"), { status: 412, code: "VERSION_CONFLICT", requestId: "rid-412", details: null, reasons: [] }));
    await open();
    await waitFor(() =>
      expect(note()).toHaveTextContent("Northwind’s plan details changed while you were deciding, so automatic payments weren’t turned off. Check them and try again."),
    );
    await waitFor(() => expect(state.calls.filter((call) => call === "getSubscription").length).toBeGreaterThan(1));
    state.autopayAnswer = null;
    await waitFor(() => expect(screen.getByRole("button", { name: "Turn off automatic payments" })).not.toHaveAttribute("aria-disabled"));
    await open();
    await waitFor(() => expect(state.autopaySent).toHaveLength(4));
    expect(state.autopaySent[3].key).not.toBe(state.autopaySent[2].key);
    expect(state.autopaySent[3].version).toBe("14");
  });

  it("a 412 whose re-read shows them off already is done: no note, the band closed, «already off», focus on the heading (blocker 5)", async () => {
    state.subscription = paid("CONSENTED");
    state.autopayAnswer = () => {
      state.subscription = { ...paid("DISABLED"), version: "13" };
      return Promise.reject(Object.assign(new Error("stale"), { status: 412, code: "VERSION_CONFLICT", requestId: "rid-412", details: null, reasons: [] }));
    };
    renderAt("/company/billing");
    fireEvent.click(await screen.findByRole("button", { name: "Turn off automatic payments" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Automatic payments" })).toHaveFocus());
    expect(screen.getByText("Automatic payments are already off for Northwind.")).toBeInTheDocument();
    expect(document.querySelector(".company-autopay .error-note")).toBeNull();
    expect(document.querySelector(".company-autopay-band")).toBeNull();
    expect(group()).toHaveTextContent(/^Automatic paymentsOff/);
  });

  it("any other refusal whose re-read takes «Turn off» away keeps its note, and focus goes to the heading", async () => {
    state.subscription = paid("SUSPENDED");
    state.autopayAnswer = () => {
      state.subscription = { ...paid("PAUSED_BY_BANK"), version: "13" };
      return Promise.reject(Object.assign(new Error("no"), { status: 409, code: "INVALID_STATE", requestId: "rid-409", details: null, reasons: [] }));
    };
    renderAt("/company/billing");
    fireEvent.click(await screen.findByRole("button", { name: "Turn off automatic payments" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Automatic payments" })).toHaveFocus());
    expect(document.querySelector(".company-autopay .error-note")).toHaveTextContent("Automatic payments weren’t turned off.");
    expect(within(group()).queryByRole("button", { name: "Turn off automatic payments" })).not.toBeInTheDocument();
  });

  it("a non-owner gets no group and no subscription read", async () => {
    state.me = "anna";
    state.subscription = paid("CONSENTED");
    renderAt("/company/billing");
    expect(await screen.findByText("Invoices and payments for Northwind are shown only to its owner.")).toBeInTheDocument();
    expect(screen.queryByText("Automatic payments")).not.toBeInTheDocument();
    expect(state.calls).not.toContain("getSubscription");
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

  it("a left attempt: the list shows the invoice's word and no Pay; the page's Status is the invoice's word too (blocker 3)", async () => {
    attempt({ leftAt: "2026-11-11T09:05:00Z" });
    state.checkout = async () => checkout("PENDING");
    const list = renderAt("/company/billing");
    const row = (await screen.findByRole("link", { name: "TSK-2026-01008" })).closest("li") as HTMLElement;
    expect(within(row).getAllByText("unpaid").length).toBeGreaterThan(0);
    expect(within(row).queryByText("confirming")).not.toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
    list.unmount();
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("You left the payment page."));
    expect(document.querySelector(".company-invoice-facts dd")).toHaveTextContent(/^Unpaid$/);
  });

  it("the number link lands on the invoice with focus on its heading (blocker 2)", async () => {
    renderAt("/company/billing");
    fireEvent.click(await screen.findByRole("link", { name: "TSK-2026-01008" }));
    const heading = await screen.findByRole("heading", { level: 1, name: /Invoice TSK-2026-01008/ });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("the row's Pay keeps its label in flight — aria-disabled, the hidden status says it (blocker 1)", async () => {
    state.createHangs = true;
    renderAt("/company/billing");
    const row = (await screen.findByRole("link", { name: "TSK-2026-01008" })).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(within(row).getByRole("button", { name: "Pay" })).toHaveAttribute("aria-disabled", "true"));
    expect(within(row).getByText("Opening the payment page.")).toHaveClass("visually-hidden");
    expect(screen.queryByText("Opening payment page")).not.toBeInTheDocument();
  });

  it("a paid invoice has no «Paid so far» or «Left to pay» (NB1); an open one reads no list (F3)", async () => {
    state.invoices[0] = invoice({ state: "PAID", allocated: state.EUR("2000"), remaining: state.EUR("0") });
    const paid = renderAt("/company/billing/inv-renewal");
    await screen.findByRole("heading", { level: 1, name: /Invoice TSK-2026-01008/ });
    await waitFor(() => expect(document.querySelectorAll(".company-invoice-facts dt").length).toBeGreaterThan(0));
    const labels = [...document.querySelectorAll(".company-invoice-facts dt")].map((dt) => dt.textContent);
    expect(labels).not.toContain("Paid so far");
    expect(labels).not.toContain("Left to pay");
    expect(state.calls).not.toContain("listInvoices");
    paid.unmount();
    state.invoices[0] = invoice({ state: "PARTIALLY_PAID", allocated: state.EUR("1200"), remaining: state.EUR("800") });
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect([...document.querySelectorAll(".company-invoice-facts dt")].map((dt) => dt.textContent)).toContain("Left to pay"));
    expect([...document.querySelectorAll(".company-invoice-facts dt")].map((dt) => dt.textContent)).toContain("Paid so far");
  });

  it("«Return to payment» only when the checkout read carried its page; a refused re-read is said with its id (F2)", async () => {
    attempt({ leftAt: "2026-11-11T09:05:00Z" });
    state.checkout = async () => ({ ...checkout("PENDING"), redirect: null });
    const bare = renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("You left the payment page."));
    expect(screen.queryByRole("button", { name: "Return to payment" })).not.toBeInTheDocument();
    bare.unmount();
    state.checkout = async () => checkout("PENDING");
    renderAt("/company/billing/inv-renewal");
    const again = await screen.findByRole("button", { name: "Return to payment" });
    state.checkout = () => Promise.reject(Object.assign(new Error("down"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-reopen", details: null, reasons: [] }));
    fireEvent.click(again);
    expect(await screen.findByRole("alert")).toHaveTextContent("Taska couldn’t reopen the payment page.");
    expect(screen.getByText("rid-reopen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to payment" })).not.toHaveAttribute("aria-disabled");
  });

  it("«Return to payment» finding another invoice's checkout takes the not-found path, opening nothing (F5)", async () => {
    attempt({ leftAt: "2026-11-11T09:05:00Z" });
    state.checkout = async () => checkout("PENDING");
    renderAt("/company/billing/inv-renewal");
    const again = await screen.findByRole("button", { name: "Return to payment" });
    state.checkout = async () => ({ ...checkout("PENDING"), invoiceId: "another-invoice" });
    fireEvent.click(again);
    await waitFor(() => expect(block()).toHaveTextContent("This payment wasn’t found in Northwind."));
    expect(window.localStorage.getItem(checkoutAttemptKey("tom", "n", "inv-renewal"))).toBeNull();
  });

  it("a checkout this company does not have: said, and nothing offered", async () => {
    attempt();
    state.checkout = () => Promise.reject(Object.assign(new Error("not found"), { status: 404, code: "RESOURCE_NOT_FOUND", requestId: "r", details: null, reasons: [] }));
    renderAt("/company/billing/inv-renewal");
    await waitFor(() => expect(block()).toHaveTextContent("This payment wasn’t found in Northwind."));
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
  });

  it("an expired invoice can no longer be paid, and names the invoice that replaced it — read from the list, with focus to land on its heading", async () => {
    state.invoices = [invoice({ state: "EXPIRED" }), invoice({ id: "inv-new", number: "TSK-2026-01010", replacesInvoiceId: "inv-renewal" })];
    renderAt("/company/billing/inv-renewal");
    expect(await screen.findByText("This invoice can no longer be paid.")).toBeInTheDocument();
    const replacement = await screen.findByRole("link", { name: "TSK-2026-01010" });
    expect(replacement).toHaveAttribute("href", "/company/billing/inv-new");
    expect(state.calls).toContain("listInvoices");
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    fireEvent.click(replacement);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Invoice TSK-2026-01010/ })).toHaveFocus());
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
    // TAS-515 (art-director B1): the owner can change the plan now, so the sentence ends with the removals.
    expect(screen.getByText("Everything in it can still be read, and admins can still remove members and revoke invitations.")).toBeInTheDocument();
    owner.unmount();
    render(
      <MemoryRouter>
        <CompanyStateBlock owner={false} restrictions={["PAYMENT_EXPIRED"]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("link", { name: "See Billing" })).not.toBeInTheDocument();
  });

  it("TAS-516 (B13): ends the owner's dispute line too — once per block, on the first line that earns it; never anybody else's", () => {
    const both = render(
      <MemoryRouter>
        <CompanyStateBlock owner restrictions={["PAYMENT_EXPIRED", "PAYMENT_DISPUTE"]} />
      </MemoryRouter>,
    );
    const lines = [...document.querySelectorAll(".company-general-state")].map((line) => line.textContent);
    expect(lines[0]).toBe("A payment is disputed. Nothing in it can be changed, and no automatic payments are taken. See Billing");
    expect(lines[1]).toBe("Its paid period has ended. Nothing in it can be changed until it’s paid for again. There’s no grace period, and it doesn’t move to a free plan on its own.");
    expect(screen.getAllByRole("link", { name: "See Billing" })).toHaveLength(1);
    both.unmount();
    const dispute = render(
      <MemoryRouter>
        <CompanyStateBlock owner restrictions={["PAYMENT_DISPUTE"]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "See Billing" })).toHaveAttribute("href", "/company/billing");
    dispute.unmount();
    render(
      <MemoryRouter>
        <CompanyStateBlock owner={false} restrictions={["PAYMENT_DISPUTE"]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/A payment is disputed\./).closest("p")).toHaveTextContent("A payment is disputed. Nothing in it can be changed.");
    expect(screen.queryByRole("link", { name: "See Billing" })).not.toBeInTheDocument();
  });
});

describe("TAS-514: refunds, the wire invoice and its document", () => {
  const BANK = { beneficiaryName: "Taska Mock S.L. (test only)", iban: "XX00MOCK0000000000000000", bic: "MOCKESM0XXX", bankName: "Mock Bank", reference: "TASKA-TSK-2026-01008" };
  const wireRenewal = () => invoice({ paymentMethod: "WIRE", wireInstructions: BANK, dueAt: "2099-12-04T09:00:00Z" });
  const refund = (overrides: Record<string, unknown> = {}) => ({
    id: "rf-1",
    tenantId: "n",
    kind: "UNALLOCATED_RETURN",
    state: "UNKNOWN",
    amount: state.EUR("500"),
    reasonCode: "EXCESS",
    sourceMethod: "WIRE",
    requestedAt: "2026-11-10T09:00:00Z",
    confirmedAt: null,
    feeBearer: "TASKA",
    sendDueAt: null,
    decidedAt: null,
    submittedAt: null,
    ...overrides,
  });

  it("«Refunds» after «Invoices», only when there is one: its reason, amount and marker — UNKNOWN is checked, never sent", async () => {
    renderAt("/company/billing");
    await screen.findByRole("link", { name: "TSK-2026-01008" });
    expect(screen.queryByRole("region", { name: /^Refunds/ })).not.toBeInTheDocument();
    expect(state.calls).toContain("listRefunds");
    state.refunds = [refund()];
    renderAt("/company/billing");
    const group = await screen.findByRole("region", { name: /^Refunds/ });
    expect(within(group).getByRole("heading")).toHaveTextContent("Refunds1");
    const row = group.querySelector(".company-refund-row") as HTMLElement;
    expect(row).toHaveTextContent("Overpayment");
    expect(row).toHaveTextContent("Bank transfer · Requested Nov 10 · Taska is checking whether it went through");
    expect(within(row).getAllByText("checking").length).toBeGreaterThan(0);
    expect(row).not.toHaveTextContent(/TSK-/);
    // Its history never says «sent» while Taska is checking; the fee's rule under it says how a refund goes back (T4).
    expect(row.querySelector(".company-refund-meta")).not.toHaveTextContent(/sent/i);
    expect(row.querySelector(".company-refund-consequence")).toHaveTextContent("Taska pays the bank fee, so the full amount is sent back.");
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });

  it("the refunds that failed to load: their note in their place, the page's one Try again under the first note", async () => {
    const original = fakeApi.listRefunds;
    let refusing = true;
    (fakeApi as unknown as Record<string, unknown>).listRefunds = async () => {
      if (refusing) throw Object.assign(new Error("down"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-refunds" });
      return { items: [refund({ state: "CONFIRMED", confirmedAt: "2026-11-12T09:00:00Z" })], nextCursor: null };
    };
    try {
      renderAt("/company/billing");
      // A 503 is retried once before it is said (`retryUnanswered`).
      expect(await screen.findByText("Refunds could not be loaded.", undefined, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "TSK-2026-01008" })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
      refusing = false;
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(await screen.findByRole("region", { name: /^Refunds/ })).toHaveTextContent(/Refunded Nov 12/);
    } finally {
      (fakeApi as unknown as Record<string, unknown>).listRefunds = original;
    }
  });

  it("a wire invoice: bank details, no Pay, the target in the note — and a refused copy selects the value and says how", async () => {
    state.invoices = [wireRenewal()];
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      renderAt("/company/billing/inv-renewal");
      const bank = await screen.findByRole("region", { name: "Bank transfer" });
      expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
      expect(block()).toHaveTextContent("Waiting for the bank transfer.");
      await waitFor(() => expect(bank).toHaveTextContent("within 24 hours of the money arriving"));
      expect(state.calls).toContain("getTenantCapabilities");
      const copy = within(bank).getByRole("button", { name: "Copy IBAN" });
      copy.focus();
      fireEvent.click(copy);
      await waitFor(() =>
        expect(bank.querySelector(".company-bank-copy-status")).toHaveTextContent("Couldn’t copy the IBAN automatically. It’s selected — press Ctrl+C or ⌘C to copy it."),
      );
      expect(writeText).toHaveBeenCalledWith("XX00MOCK0000000000000000");
      expect(window.getSelection()?.toString()).toBe("XX00 MOCK 0000 0000 0000 0000");
      expect(copy).toHaveFocus();
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }
  });

  it("the target omitted: the sentence without a number; Download refused: its words and id under the action row, focus kept", async () => {
    state.invoices = [wireRenewal()];
    state.targetSeconds = null;
    state.document = () => Promise.reject(Object.assign(new Error("no format"), { status: 503, code: "POLICY_NOT_CONFIGURED", requestId: "rid-doc" }));
    renderAt("/company/billing/inv-renewal");
    const bank = await screen.findByRole("region", { name: "Bank transfer" });
    await waitFor(() => expect(bank).toHaveTextContent("Taska matches bank transfers to invoices by hand once the money arrives."));
    expect(bank).not.toHaveTextContent(/hours?\b/);
    const download = screen.getByRole("button", { name: "Download PDF of invoice TSK-2026-01008" });
    download.focus();
    fireEvent.click(download);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invoice PDFs aren’t available for Northwind yet.");
    expect(alert.closest(".error-note")).toHaveTextContent("rid-doc");
    expect(download).toHaveFocus();
    expect(state.calls.filter((call) => call === "getInvoiceDocument")).toHaveLength(1);
  });
});

describe("TAS-516: disputes, refunds told step by step, and the dispute's line", () => {
  const dispute = (overrides: Record<string, unknown> = {}) => ({
    id: "dp-1",
    tenantId: "n",
    state: "OPEN",
    finalOutcome: null,
    openedAt: "2026-11-03T09:00:00Z",
    resolvedAt: null,
    ...overrides,
  });
  const lostInPart = (id: string, openedAt: string) =>
    dispute({ id, state: "LOST", finalOutcome: "LOST_PARTIAL_COVERAGE_REVOKED", openedAt, resolvedAt: "2026-11-08T09:00:00Z" });
  const disputes = () => screen.getByRole("region", { name: /^Disputes/ });
  const fullRefund = (overrides: Record<string, unknown> = {}) => ({
    id: "rf-full",
    tenantId: "n",
    kind: "SUBSCRIPTION_FULL",
    state: "REQUESTED",
    amount: state.EUR("2000"),
    reasonCode: "BILLING_ERROR",
    sourceMethod: "WIRE",
    requestedAt: "2026-11-10T09:00:00Z",
    confirmedAt: null,
    feeBearer: "TASKA",
    sendDueAt: null,
    decidedAt: null,
    submittedAt: null,
    ...overrides,
  });

  it("«Disputes» after Automatic payments and before Invoices, only with a row; each row its own state and nothing more", async () => {
    state.subscription = { tenantId: "n", planVersionId: "team", version: "12", paidThrough: "2026-12-26T03:36:00Z", renewalCancelled: false, autopayState: "DISABLED", scheduledPlanVersionId: null, scheduledEffectiveAt: null };
    const none = renderAt("/company/billing");
    await screen.findByRole("link", { name: "TSK-2026-01008" });
    expect(state.calls).toContain("listDisputes");
    expect(screen.queryByRole("region", { name: /^Disputes/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/disput/i)).not.toBeInTheDocument();
    none.unmount();
    state.disputes = [dispute({ id: "dp-won", state: "WON", finalOutcome: "WON", openedAt: "2026-10-01T09:00:00Z", resolvedAt: "2026-10-09T09:00:00Z" }), dispute()];
    state.refunds = [fullRefund()];
    renderAt("/company/billing");
    await screen.findByRole("region", { name: /^Disputes/ });
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Automatic payments", "Disputes2", "Invoices2", "Refunds1"]);
    const rows = [...disputes().querySelectorAll(".company-dispute-row")] as HTMLElement[];
    // Newest opened first.
    expect(rows[0]).toHaveTextContent("Disputed paymentOpened Nov 3");
    expect(rows[0]).toHaveTextContent("If the payment is reversed, even in part, the whole period it paid for is withdrawn.");
    expect(within(rows[0]).getAllByText("open").length).toBeGreaterThan(0);
    expect(rows[1]).toHaveTextContent("Opened Oct 1 · Closed Oct 9");
    expect(rows[1]).toHaveTextContent("What’s left of the period it paid for still counts. It isn’t extended for the time the dispute took.");
    expect(within(rows[1]).getAllByText("upheld").length).toBeGreaterThan(0);
    // No invoice, no amount, no link, no read-only, and nothing about a refund.
    expect(disputes()).not.toHaveTextContent(/TSK-|€|read-only|refund/i);
    expect(within(disputes()).queryByRole("link")).not.toBeInTheDocument();
    expect(within(disputes()).queryByRole("button")).not.toBeInTheDocument();
    // Dates in `<time>`, a row with a line 3 aligned to its first line (B6).
    expect(rows[0].querySelector("time")).toHaveAttribute("dateTime", "2026-11-03T09:00:00Z");
    expect(rows[0]).toHaveClass("has-line3");
  });

  it("a lost-in-part dispute under PAYMENT_EXPIRED: the new full payment and «See Plan» — once, on the first such row", async () => {
    state.restrictions = ["PAYMENT_EXPIRED"];
    state.disputes = [lostInPart("older", "2026-10-01T09:00:00Z"), lostInPart("newer", "2026-11-03T09:00:00Z")];
    renderAt("/company/billing");
    await screen.findByRole("region", { name: /^Disputes/ });
    const rows = [...disputes().querySelectorAll(".company-dispute-row")] as HTMLElement[];
    expect(rows[0]).toHaveTextContent(
      "The whole period it paid for was withdrawn — no part of it is kept. Nothing more is refunded for it. A new full payment is needed before anything in Northwind can be changed again. See Plan",
    );
    expect(rows[1]).toHaveTextContent("The whole period it paid for was withdrawn — no part of it is kept. Nothing more is refunded for it.");
    expect(rows[1]).not.toHaveTextContent(/new full payment/);
    const links = within(disputes()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["See Plan"]);
    expect(links[0]).toHaveAttribute("href", "/company/plan");
    expect(within(rows[0]).getAllByText("part reversed").length).toBeGreaterThan(0);
  });

  it("without PAYMENT_EXPIRED the lost-in-part row says no more than the loss — no sentence, no link", async () => {
    state.disputes = [lostInPart("dp", "2026-11-03T09:00:00Z")];
    renderAt("/company/billing");
    await screen.findByRole("region", { name: /^Disputes/ });
    expect(disputes()).toHaveTextContent("Nothing more is refunded for it.");
    expect(disputes()).not.toHaveTextContent(/new full payment/);
    expect(within(disputes()).queryByRole("link")).not.toBeInTheDocument();
  });

  it("the disputes that failed to load: their note in their place, the one Try again under it — the first note in the page's order", async () => {
    const original = { listDisputes: fakeApi.listDisputes, listInvoices: fakeApi.listInvoices };
    let refusing = true;
    const api = fakeApi as unknown as Record<string, unknown>;
    api.listDisputes = async () => {
      if (refusing) throw Object.assign(new Error("down"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-disputes" });
      return { items: [dispute()], nextCursor: null };
    };
    api.listInvoices = async () => {
      if (refusing) throw Object.assign(new Error("down"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-invoices" });
      return { items: state.invoices, nextCursor: null };
    };
    try {
      renderAt("/company/billing");
      const note = (await screen.findByText("Disputes could not be loaded.", undefined, { timeout: 4000 })).closest(".company-billing-failure") as HTMLElement;
      expect(note).toHaveTextContent("rid-disputes");
      expect(screen.getByText("Invoices could not be loaded.")).toBeInTheDocument();
      // One Try again, under the disputes' note — above the invoices' in the DOM.
      const again = screen.getAllByRole("button", { name: "Try again" });
      expect(again).toHaveLength(1);
      expect(note).toContainElement(again[0]);
      expect(note.compareDocumentPosition(screen.getByText("Invoices could not be loaded.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      refusing = false;
      fireEvent.click(again[0]);
      expect(await screen.findByRole("region", { name: /^Disputes/ })).toHaveTextContent("Opened Nov 3");
      expect(await screen.findByRole("link", { name: "TSK-2026-01008" })).toBeInTheDocument();
    } finally {
      Object.assign(api, original);
    }
  });

  it("a full refund told step by step: line 3 with what it does and the fee, the lead tied to the group, nothing arrived", async () => {
    state.refunds = [
      fullRefund({ id: "rf-done", state: "CONFIRMED", requestedAt: "2026-10-12T09:00:00Z", decidedAt: "2026-10-13T09:00:00Z", submittedAt: "2026-10-14T09:00:00Z", confirmedAt: "2026-10-18T09:00:00Z" }),
      fullRefund(),
    ];
    renderAt("/company/billing");
    const group = await screen.findByRole("region", { name: /^Refunds/ });
    const lead = group.querySelector(".company-refunds-lead") as HTMLElement;
    expect(group).toHaveAttribute("aria-describedby", lead.id);
    expect(lead).toHaveTextContent("Refunds go back to the account the money came from. The dates below are Taska’s — when the money shows in that account depends on the banks.");
    const rows = [...group.querySelectorAll(".company-refund-row")] as HTMLElement[];
    expect(rows[0]).toHaveTextContent("Bank transfer · Requested Nov 10");
    expect(rows[0]).toHaveTextContent(
      "If the refund goes through, the period this payment paid for ends and automatic payments turn off. Taska pays the bank fee, so the full amount is sent back.",
    );
    expect(rows[1]).toHaveTextContent("Bank transfer · Requested Oct 12 · Approved Oct 13 · Sent Oct 14 · Refunded Oct 18");
    expect(rows[1]).toHaveTextContent("The period this payment paid for no longer counts.");
    expect(rows[1]).not.toHaveTextContent(/fee/);
    // Each segment is whole; the dot stays on the line it closes.
    expect([...rows[1].querySelectorAll(".company-step")].map((step) => step.textContent)).toEqual([
      "Bank transfer ·",
      "Requested Oct 12 ·",
      "Approved Oct 13 ·",
      "Sent Oct 14 ·",
      "Refunded Oct 18",
    ]);
    for (const row of rows) {
      expect(row).toHaveClass("has-line3");
      expect(row).not.toHaveTextContent(/arriv|receiv|credit/i);
    }
  });

  it("a member who is not the owner sends no listDisputes", async () => {
    state.me = "anna";
    state.disputes = [dispute()];
    renderAt("/company/billing");
    expect(await screen.findByText("Invoices and payments for Northwind are shown only to its owner.")).toBeInTheDocument();
    expect(state.calls).not.toContain("listDisputes");
    expect(screen.queryByText(/disput/i)).not.toBeInTheDocument();
  });
});

describe("TAS-514 fix round 1", () => {
  const BANK = { beneficiaryName: "Taska Mock S.L. (test only)", iban: "XX00MOCK0000000000000000", bic: "MOCKESM0XXX", bankName: "Mock Bank", reference: "TASKA-TSK-2026-01008" };
  const wireRenewal = (overrides: Record<string, unknown> = {}) =>
    invoice({ paymentMethod: "WIRE", wireInstructions: BANK, dueAt: "2099-12-04T09:00:00Z", ...overrides });
  const fact = (label: string) =>
    [...document.querySelectorAll(".company-invoice-facts > div")].find((row) => row.querySelector("dt")?.textContent === label)?.querySelector("dd") ?? null;

  /** The not-yet-open card's slot, alone, as the setup card mounts it for the owner. */
  function renderSlot(stalled: boolean, onCheckAgain = vi.fn()) {
    const onPaid = vi.fn();
    render(
      <CreationPaySlot
        company="Acme Wire"
        companyId="n"
        creationDeadline="2099-12-11T09:00:00Z"
        factId="fact"
        onCheckAgain={onCheckAgain}
        onPaid={onPaid}
        stalled={stalled}
        userId="tom"
      />,
      { wrapper: companiesHarness({ companyId: "n", path: "/projects" }).wrapper },
    );
    return { onPaid, onCheckAgain };
  }

  it("a PAID wire first invoice on the not-yet-open card: «matched», opening — no slot line, amount, PDF, bank details or note", async () => {
    state.invoices = [wireRenewal({ id: "inv-first", number: "TSK-2026-01009", purpose: "INITIAL", state: "PAID", allocated: state.EUR("2000"), remaining: state.EUR("0") })];
    state.refunds = [
      {
        id: "rf-late",
        tenantId: "n",
        kind: "UNALLOCATED_RETURN",
        state: "REQUESTED",
        amount: state.EUR("2000"),
        reasonCode: "LATE_FIRST_PAYMENT",
        sourceMethod: "WIRE",
        requestedAt: "2026-11-10T09:00:00Z",
        confirmedAt: null,
        feeBearer: "TASKA",
        sendDueAt: null,
        decidedAt: null,
      },
    ];
    const { onPaid } = renderSlot(false);
    await waitFor(() =>
      expect(block()).toHaveTextContent(
        "Your bank transfer has been matched. Taska is opening Acme Wire. This page opens it when it’s ready — don’t send the transfer again.",
      ),
    );
    expect(onPaid).toHaveBeenCalled();
    expect(block()).not.toHaveTextContent(/payment provider|Confirming/);
    // The late money's line stays above it.
    expect(await screen.findByText("The €20.00 that arrived after an earlier invoice was due is to be refunded to the account it came from.")).toBeInTheDocument();
    expect(screen.queryByText(/Invoice TSK-2026-01009/)).not.toBeInTheDocument();
    expect(screen.queryByText(/€0\.00/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download PDF/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Bank transfer" })).not.toBeInTheDocument();
    expect(screen.queryByText(/matches bank transfers/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
  });

  it("…and once the card's poll has stopped: «hasn’t opened yet» and «Check again», which reads the company again", async () => {
    state.invoices = [wireRenewal({ id: "inv-first", purpose: "INITIAL", state: "PAID", allocated: state.EUR("2000"), remaining: state.EUR("0") })];
    const { onCheckAgain } = renderSlot(true);
    await waitFor(() =>
      expect(block()).toHaveTextContent("Your bank transfer has been matched. Acme Wire hasn’t opened yet. Check again in a few minutes — don’t send the transfer again."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Download PDF/ })).not.toBeInTheDocument();
  });

  it("an open wire first invoice still draws its card form", async () => {
    state.invoices = [wireRenewal({ id: "inv-first", number: "TSK-2026-01009", purpose: "INITIAL" })];
    renderSlot(false);
    expect(await screen.findByRole("region", { name: "Bank transfer" })).toBeInTheDocument();
    expect(screen.getByText("Invoice TSK-2026-01009 · €20.00 · Bank transfer")).toBeInTheDocument();
  });

  it("an expired wire invoice with money to go back: no «Left to pay», and Received without its second line", async () => {
    state.invoices = [wireRenewal({ state: "EXPIRED", matchedUnallocated: state.EUR("1200"), remaining: state.EUR("800") })];
    renderAt("/company/billing/inv-renewal");
    expect(await screen.findByText(/that arrived for it is to be refunded/)).toHaveTextContent(
      "This invoice can no longer be paid. The €12.00 that arrived for it is to be refunded.",
    );
    expect(fact("Received")).toHaveTextContent(/^€12\.00$/);
    expect(fact("Left to pay")).toBeNull();
    expect(screen.queryByRole("region", { name: "Bank transfer" })).not.toBeInTheDocument();
  });

  it("an open wire invoice with all of it matched: «all of it has arrived», no bank details, Received without «Counts only…»", async () => {
    state.invoices = [wireRenewal({ matchedUnallocated: state.EUR("2000"), remaining: state.EUR("0") })];
    renderAt("/company/billing/inv-renewal");
    await waitFor(() =>
      expect(block()).toHaveTextContent(
        "All of the bank transfer has arrived. Taska hasn’t applied it to this invoice yet, so the invoice isn’t marked as paid — don’t send the transfer again.",
      ),
    );
    expect(fact("Received")).toHaveTextContent(/^€20\.00$/);
    expect(screen.queryByRole("region", { name: "Bank transfer" })).not.toBeInTheDocument();
  });

  it("a part-paid wire renewal: Received with its line, Left to pay — and no third sentence in the note", async () => {
    state.invoices = [wireRenewal({ state: "PARTIALLY_PAID", matchedUnallocated: state.EUR("1200"), remaining: state.EUR("800") })];
    renderAt("/company/billing/inv-renewal");
    const bank = await screen.findByRole("region", { name: "Bank transfer" });
    await waitFor(() => expect(bank).toHaveTextContent("within 24 hours of the money arriving"));
    expect(bank).not.toHaveTextContent(/still renews/);
    expect(fact("Received")).toHaveTextContent("€12.00Counts only once all €20.00 has arrived.");
    expect(fact("Left to pay")).toHaveTextContent("€8.00");
  });

  it("Items (G3): no group when the answer carried no lines; «lists no items» only for an empty list", async () => {
    state.invoices = [invoice({ lines: null })];
    renderAt("/company/billing/inv-renewal");
    await screen.findByRole("button", { name: "Pay €20.00" });
    expect(screen.queryByRole("region", { name: "Items" })).not.toBeInTheDocument();
    state.invoices = [invoice({ id: "inv-empty", lines: [] })];
    renderAt("/company/billing/inv-empty");
    expect(await screen.findByText("This invoice lists no items.")).toBeInTheDocument();
  });
});
