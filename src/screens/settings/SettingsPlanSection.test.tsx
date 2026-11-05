import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { companiesHarness } from "../../test/companiesHarness";
import { SettingsPlanSection } from "./SettingsPlanSection";

/*
 * Settings › Plan (DESIGN.md §4.40, TAS-512) against a fake API:
 * owner-only rows and no subscription read for anybody else (api-contract-
 * guard B1, art-director B4), the one usage template (B3), loading (B9), each
 * failed read on its own with one «Try again» (B8, B9), the plan not in the
 * catalogue, the shared restriction block (B5), and the boundary re-read (B4).
 */

const UMBRELLA = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    me: "tom",
    owner: "tom",
    restrictions: [] as string[],
    calls: [] as string[],
    entitlementPlan: "team-1",
    subscription: {} as Record<string, unknown>,
    fail: new Set<string>(),
    reentered: 0,
  };
  // A definite refusal: an answer that never came would be retried once (`retryUnanswered`).
  const refuse = (name: string) => Object.assign(new Error("the server's words"), { status: 403, code: "SCOPE_DENIED", requestId: `rid-${name}`, details: null, reasons: [] });
  const read = async <T,>(name: string, answer: () => T): Promise<T> => {
    state.calls.push(name);
    if (state.fail.has(name)) throw refuse(name);
    return answer();
  };
  const api = {
    getCurrentUser: async () => ({ id: state.me, email: `${state.me}@example.com`, displayName: state.me, status: "ACTIVE" }),
    listTenants: async () => ({
      items: [{ id: UMBRELLA, name: "Umbrella", ownerId: state.owner, lifecycle: "ACTIVE", restrictions: state.restrictions, createdAt: null, creationDeadline: null, version: "3" }],
      nextCursor: null,
    }),
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
    getTenant: () =>
      read("tenant", () => ({ id: UMBRELLA, name: "Umbrella", ownerId: state.owner, lifecycle: "ACTIVE", restrictions: state.restrictions, createdAt: null, creationDeadline: null, version: "3" })),
    getEntitlement: () =>
      read("entitlement", () => ({ tenantId: UMBRELLA, version: "1", planVersionId: state.entitlementPlan, limits: [{ kind: "TASK_LIFETIME", limit: null, unlimited: true }] })),
    getTenantQuotas: () =>
      read("quotas", () => ({
        tenantId: UMBRELLA,
        version: "1",
        quotas: [
          { kind: "SEAT", used: "3", reserved: "1", limit: "25", unlimited: false },
          { kind: "PROJECT", used: "1", reserved: "0", limit: "3", unlimited: false },
          { kind: "STORAGE_BYTES", used: "0", reserved: "0", limit: "2000000000", unlimited: false },
        ],
        asOf: null,
      })),
    getSubscription: () => read("subscription", () => ({ ...state.subscription })),
    listBillingPlans: () =>
      read("plans", () => ({
        items: [
          { id: "free", code: "free", name: "Free", version: "1", price: { amountMinor: "0", currency: "EUR", exponent: 2 }, period: "NONE", limits: [], state: "PUBLISHED" },
          { id: "team-1", code: "team", name: "Team", version: "1", price: { amountMinor: "1500", currency: "EUR", exponent: 2 }, period: "CALENDAR_MONTH", limits: [], state: "RETIRED" },
          {
            id: "team-2",
            code: "team",
            name: "Team",
            version: "2",
            price: { amountMinor: "2000", currency: "EUR", exponent: 2 },
            period: "CALENDAR_MONTH",
            limits: [
              { kind: "PROJECT", limit: "5", unlimited: false },
              { kind: "SEAT", limit: "50", unlimited: false },
            ],
            state: "PUBLISHED",
          },
        ],
        nextCursor: null,
      })),
    reenterCompany: async () => {
      state.reentered += 1;
    },
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

function renderPlan() {
  const harness = companiesHarness({ companyId: UMBRELLA, path: "/settings/plan" });
  render(
    <div className="settings-area">
      <h1 className="area-section-title" tabIndex={-1}>
        Plan
      </h1>
      <SettingsPlanSection />
    </div>,
    { wrapper: harness.wrapper },
  );
  return harness;
}

const ready = () => screen.findByText(/^The plan /);
const labels = () => screen.queryAllByText(/./, { selector: "dt" }).map((node) => node.textContent);
const dd = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
const IN_A_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

beforeEach(() => {
  state.me = "tom";
  state.owner = "tom";
  state.restrictions = [];
  state.calls = [];
  state.entitlementPlan = "team-1";
  state.fail = new Set();
  state.reentered = 0;
  state.subscription = {
    tenantId: UMBRELLA,
    planVersionId: "team-1",
    version: "2",
    paidThrough: IN_A_MONTH,
    autopayState: "CONSENTED",
    renewalCancelled: false,
    scheduledPlanVersionId: "team-2",
    scheduledEffectiveAt: IN_A_MONTH,
  };
});
afterEach(() => vi.restoreAllMocks());

describe("who sees what (B1, art-director B4)", () => {
  it("the owner: plan, price, paid until, automatic payments and the announced change — five reads", async () => {
    renderPlan();
    expect(await ready()).toHaveTextContent("The plan Umbrella is on and what it uses.");
    expect(labels()).toEqual(["Plan", "Price", "Paid until", "Automatic payments", "Announced change", "Projects", "Seats", "Storage", "Issues per project"]);
    expect(dd("Plan")).toHaveTextContent("Team · version 1");
    expect(dd("Price")).toHaveTextContent("€15 a month");
    expect(dd("Paid until").querySelector("time")).toHaveAttribute("dateTime", IN_A_MONTH);
    expect(dd("Automatic payments")).toHaveTextContent("On");
    expect(dd("Announced change")).toHaveTextContent(/^From [A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d\d:\d\d: Team · version 2, €20 a month/);
    // The only place limits come from the catalogue, labelled as announced.
    expect(dd("Announced change")).toHaveTextContent("5 projects · 50 seats");
    expect(state.calls.sort()).toEqual(["entitlement", "plans", "quotas", "subscription", "tenant"]);
  });

  it("a non-owner admin and a member: name, limits and usage — no price, payments or announced terms, and no subscription read", async () => {
    for (const me of ["priya", "anna"]) {
      state.me = me;
      state.calls = [];
      const view = renderPlan();
      expect(await ready()).toHaveTextContent("The plan Umbrella is on and what it uses. Its price and payments are shown only to its owner.");
      expect(labels()).toEqual(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
      expect(screen.queryByText(/€/)).toBeNull();
      expect(state.calls).not.toContain("subscription");
      expect(state.calls.sort()).toEqual(["entitlement", "plans", "quotas", "tenant"]);
      view.client.clear();
      document.body.innerHTML = "";
    }
  });

  it("a FREE owner has nothing of the owner's to draw: no price, no paid until, no announced change", async () => {
    state.entitlementPlan = "free";
    state.subscription = {
      tenantId: UMBRELLA,
      planVersionId: "free",
      version: "1",
      paidThrough: null,
      renewalCancelled: false,
      autopayState: "DISABLED",
      scheduledPlanVersionId: null,
      scheduledEffectiveAt: null,
    };
    renderPlan();
    await ready();
    expect(labels()).toEqual(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
    expect(dd("Plan")).toHaveTextContent("Free · version 1");
    expect(screen.queryByText("Free", { selector: "dd" })).toBeNull();
  });

  it("a cancelled renewal says the rule; a plan the catalogue does not list says so, never «Free»", async () => {
    state.subscription = { ...state.subscription, renewalCancelled: true, scheduledPlanVersionId: "gone", scheduledEffectiveAt: IN_A_MONTH };
    state.entitlementPlan = "retired-elsewhere";
    renderPlan();
    await ready();
    expect(dd("Plan")).toHaveTextContent("This plan isn’t in Taska’s plan list.");
    expect(labels()).not.toContain("Price");
    expect(dd("Renewal")).toHaveTextContent("Cancelled");
    expect(dd("Renewal")).toHaveTextContent("When the paid period ends, Umbrella becomes read-only. It doesn’t move to a free plan on its own.");
    expect(dd("Announced change")).toHaveTextContent(/, the plan changes\.$/);
  });
});

describe("Usage (art-director B3)", () => {
  it("one template, tabular, with the rule lines — and «No limit» for an unlimited task limit", async () => {
    renderPlan();
    await ready();
    expect(screen.getByRole("heading", { level: 2, name: "Usage" })).toBeInTheDocument();
    expect(dd("Projects")).toHaveTextContent("1 used · 3 allowedArchived projects count too.");
    expect(dd("Seats")).toHaveTextContent("4 in use · 25 allowedSuspended members and pending invitations hold seats too.");
    expect(dd("Storage")).toHaveTextContent("0 B used · 2 GB allowed");
    expect(dd("Issues per project")).toHaveTextContent("No limit");
  });
});

describe("the state block (art-director B5)", () => {
  it("OVER_QUOTA: the fact, its explanation, and what still works — General's component and words", async () => {
    state.me = "priya";
    state.restrictions = ["OVER_QUOTA"];
    renderPlan();
    await ready();
    expect(screen.getByText("It’s over its plan’s limits.").parentElement).toHaveTextContent(
      "It’s over its plan’s limits. Nothing in it can be changed until it’s back within them.",
    );
    expect(
      screen.getByText("Everything in it can still be read, admins can still remove members and revoke invitations, and you can still leave it."),
    ).toBeInTheDocument();
  });
});

describe("loading and failed reads (B8, art-director B9)", () => {
  it("waits for every read: five bars and a hidden «Loading plan», no lead", async () => {
    renderPlan();
    expect(screen.getByRole("status")).toHaveTextContent("Loading plan");
    expect(document.querySelectorAll(".company-plan-loading .value-skeleton")).toHaveLength(10);
    expect(screen.queryByText(/^The plan /)).toBeNull();
    await ready();
  });

  it("each read its own box where its rows would be — the others drawn; never Free, unlimited or 0", async () => {
    state.fail = new Set(["entitlement", "subscription", "quotas"]);
    renderPlan();
    await ready();
    expect(screen.getByText("This company’s plan could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Payment details could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Usage could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("rid-entitlement")).toBeInTheDocument();
    expect(labels()).toEqual([]);
    expect(screen.queryByText(/Free|unlimited|No limit/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
  });

  it("the catalogue and the company failing: no plan name or price, no announced change; the state's own box", async () => {
    state.fail = new Set(["plans", "tenant"]);
    renderPlan();
    await ready();
    expect(screen.getByText("Plan details could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("This company’s state could not be loaded.")).toBeInTheDocument();
    expect(labels()).toEqual(["Paid until", "Automatic payments", "Projects", "Seats", "Storage", "Issues per project"]);
  });

  it("«Try again» re-reads only what failed; the answers drawn, focus on the heading", async () => {
    state.fail = new Set(["quotas"]);
    renderPlan();
    await ready();
    state.calls = [];
    state.fail = new Set();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(dd("Seats")).toHaveTextContent("4 in use · 25 allowed"));
    expect(state.calls).toEqual(["quotas"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a failed background re-read keeps the values under one notice", async () => {
    const { client } = renderPlan();
    await ready();
    state.fail = new Set(["entitlement"]);
    await act(async () => {
      await client.refetchQueries({ queryKey: ["company-entitlement"] }).catch(() => undefined);
    });
    expect(await screen.findByText("The plan could not be refreshed. The last loaded details are shown.")).toBeInTheDocument();
    expect(dd("Plan")).toHaveTextContent("Team · version 1");
  });
});

describe("the boundary re-read (B4)", () => {
  it("once when the clock passes the paid-through, again 60 s later, then never", async () => {
    const soon = new Date(Date.now() + 5_000).toISOString();
    state.subscription = { ...state.subscription, paidThrough: soon, scheduledEffectiveAt: soon };
    const timeouts = vi.spyOn(window, "setTimeout");
    renderPlan();
    await ready();
    const first = timeouts.mock.calls.find(([, ms]) => typeof ms === "number" && ms > 3_000 && ms <= 5_000);
    expect(first).toBeDefined();
    state.calls = [];
    await act(async () => (first?.[0] as () => void)());
    await waitFor(() => expect(state.calls.sort()).toEqual(["entitlement", "quotas", "subscription", "tenant"]));
    const again = timeouts.mock.calls.find(([, ms]) => ms === 60_000);
    expect(again).toBeDefined();
    state.calls = [];
    const scheduled = timeouts.mock.calls.length;
    await act(async () => (again?.[0] as () => void)());
    await waitFor(() => expect(state.calls.sort()).toEqual(["entitlement", "quotas", "subscription", "tenant"]));
    // The instant has passed: no third re-read is set up.
    expect(timeouts.mock.calls.slice(scheduled).some(([, ms]) => ms === 60_000 || (typeof ms === "number" && ms > 3_000 && ms <= 5_000))).toBe(false);
    expect(within(document.body).queryByText("Try again")).toBeNull();
  });
});
