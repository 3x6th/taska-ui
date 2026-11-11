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
    /** TAS-515: the owner's subscription, read beside the list; a FREE company's by default, so no group. */
    subscription: null as null | Record<string, unknown>,
    autopayAnswer: null as null | (() => Promise<unknown>),
    autopaySent: [] as Array<{ version: string; key: string }>,
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
    expect(await screen.findByText("You pay Northwind’s invoices here yourself. This version of Taska can’t turn automatic payments on.")).toBeInTheDocument();
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
});
