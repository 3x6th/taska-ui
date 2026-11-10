import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { checkoutAttemptKey } from "../api/checkoutAttempt";
import { companiesHarness } from "../test/companiesHarness";
import { BillingReturnScreen } from "./BillingReturnScreen";

/*
 * The way back from the payment page (TAS-513): only records the server
 * answered with a checkout are routed (release-reviewer N5); an account that
 * cannot be read is said, with the way on (N6); a CREATION record of a company
 * that has opened is spent on the way in (B1).
 */

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    me: null as null | (() => Promise<unknown>),
    tenants: [] as unknown[],
    workspace: null as unknown,
  };
  const api = {
    getCurrentUser: () => (state.me ? state.me() : Promise.resolve({ id: "tom", email: "tom@example.com", displayName: "Tom", status: "ACTIVE" })),
    listTenants: async () => ({ items: state.tenants, nextCursor: null }),
    settleWorkspace: async () => state.workspace,
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (id: string, name: string, lifecycle = "ACTIVE") => ({ id, name, ownerId: "tom", lifecycle, restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "1" });
const record = (tenantId: string, invoiceId: string, extra: Record<string, unknown> = {}) =>
  window.localStorage.setItem(
    checkoutAttemptKey("tom", tenantId, invoiceId),
    JSON.stringify({ v: 1, userId: "tom", tenantId, invoiceId, key: "k", returnTarget: "BILLING", startedAt: "2026-11-11T09:00:00Z", ...extra }),
  );

function renderReturn(path = "/billing/return") {
  const harness = companiesHarness({ companyId: null, path });
  render(<BillingReturnScreen cancel={path === "/billing/cancel"} theme="light" toggleTheme={() => {}} />, { wrapper: harness.wrapper });
  return harness;
}

beforeEach(() => {
  state.me = null;
  state.tenants = [tenant("u", "Umbrella")];
  state.workspace = null;
});

afterEach(() => window.localStorage.clear());

describe("routing by the records (N5)", () => {
  it("a record whose answer never came is not a payment to come back from — and the cancel address leaves it unmarked", async () => {
    record("u", "inv-1");
    renderReturn("/billing/cancel");
    expect(await screen.findByText("We can’t find a payment started in this browser — open Billing to see its state.")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(checkoutAttemptKey("tom", "u", "inv-1")) ?? "{}").leftAt).toBeUndefined();
  });

  it("one with a checkout is routed — the other, without one, does not make a choice of two", async () => {
    record("u", "inv-1");
    record("u", "inv-2", { checkoutId: "co-2", startedAt: "2026-11-11T08:00:00Z" });
    const { go } = renderReturn();
    await waitFor(() => expect(go).toHaveBeenCalledWith("/c/u/company/billing/inv-2", { replace: true, state: { checkoutReturn: true } }));
  });

  it("a CREATION record of a company that has opened is spent on the way in (B1)", async () => {
    record("u", "inv-initial", { checkoutId: "co", returnTarget: "CREATION" });
    const { go } = renderReturn();
    await waitFor(() => expect(go).toHaveBeenCalledWith("/c/u/projects", { replace: true, state: { checkoutReturn: true } }));
    expect(window.localStorage.getItem(checkoutAttemptKey("tom", "u", "inv-initial"))).toBeNull();
  });
});

describe("the account unreadable (N6)", () => {
  const refused = () => Promise.reject(Object.assign(new Error("down"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-me", details: null, reasons: [] }));

  it("says so with the id, and offers Billing when there is one company to point at", async () => {
    state.me = refused;
    renderReturn();
    expect(await screen.findByText("Taska couldn’t check this payment.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText("rid-me")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Open Billing" })).toHaveAttribute("href", "/c/u/company/billing"));
    expect(screen.getByRole("heading", { level: 1, name: "Payment" })).toHaveFocus();
  });

  it("with several companies, «All companies»", async () => {
    state.me = refused;
    state.tenants = [tenant("u", "Umbrella"), tenant("g", "Globex")];
    renderReturn();
    expect(await screen.findByText("Taska couldn’t check this payment.", {}, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "All companies" })).toHaveAttribute("href", "/companies"));
    expect(screen.queryByRole("link", { name: "Open Billing" })).not.toBeInTheDocument();
  });
});
