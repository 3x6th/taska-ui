import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { companiesHarness } from "../../test/companiesHarness";
import { CompanyPlanSection } from "./CompanyPlanSection";

/*
 * Company › Plan (DESIGN.md §4.40, TAS-512) against a fake API:
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
    /** Every read waits behind it while it is set: «Try again» held in flight. */
    gate: null as Promise<void> | null,
    /** The subscription answers 403 OWNER_REQUIRED, and the company is this person's from then on (TAS-504 G6). */
    ownerRequired: null as string | null,
    /** Refusals by read, so a failure that stays carries a request id of its own. */
    refused: {} as Record<string, number>,
    /** TAS-515: what a renewal command answers. */
    renewalAnswer: (() => Promise.resolve({})) as () => Promise<unknown>,
  };
  // A definite refusal: an answer that never came would be retried once (`retryUnanswered`).
  const refuse = (name: string, code = "SCOPE_DENIED") => {
    const count = (state.refused[name] ?? 0) + 1;
    state.refused[name] = count;
    const requestId = count === 1 ? `rid-${name}` : `rid-${name}-${count}`;
    return Object.assign(new Error("the server's words"), { status: 403, code, requestId, details: null, reasons: [] });
  };
  const read = async <T,>(name: string, answer: () => T): Promise<T> => {
    state.calls.push(name);
    if (state.gate) await state.gate;
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
    getSubscription: () =>
      read("subscription", () => {
        if (state.ownerRequired === null) return { ...state.subscription };
        state.owner = state.ownerRequired;
        throw refuse("subscription", "OWNER_REQUIRED");
      }),
    listBillingPlans: () =>
      read("plans", () => ({
        items: [
          { id: "free", kind: "FREE", code: "free", name: "Free", version: "1", price: { amountMinor: "0", currency: "EUR", exponent: 2 }, period: "NONE", limits: [], state: "PUBLISHED" },
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
    // TAS-515: the renewal commands, answered by the test.
    cancelSubscriptionRenewal: () => state.renewalAnswer(),
    resumeSubscriptionRenewal: () => state.renewalAnswer(),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

function renderPlan(options: { strict?: boolean; before?: (harness: ReturnType<typeof companiesHarness>) => void } = {}) {
  const harness = companiesHarness({ companyId: UMBRELLA, path: "/company/plan" });
  options.before?.(harness);
  const page = (
    <div className="settings-area">
      <h1 className="area-section-title" tabIndex={-1}>
        Plan
      </h1>
      <CompanyPlanSection />
    </div>
  );
  // StrictMode around the whole tree, as main.tsx has it: React 19 rehearses
  // the effects of a subtree only when the boundary is at or above what the
  // commit placed, so one nested inside the wrapper rehearses nothing.
  const Wrapper = harness.wrapper;
  const view = options.strict
    ? render(
        <StrictMode>
          <Wrapper>{page}</Wrapper>
        </StrictMode>,
      )
    : render(page, { wrapper: Wrapper });
  return { ...harness, unmount: view.unmount };
}

const ready = () => screen.findByText(/^The plan \S.* is on and what it uses\./);
const labels = () => screen.queryAllByText(/./, { selector: "dt" }).map((node) => node.textContent);
const dd = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
const IN_A_MONTH = new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();

beforeEach(() => {
  state.me = "tom";
  state.owner = "tom";
  state.restrictions = [];
  state.renewalAnswer = () => Promise.resolve({});
  state.calls = [];
  state.entitlementPlan = "team-1";
  state.fail = new Set();
  state.reentered = 0;
  state.gate = null;
  state.ownerRequired = null;
  state.refused = {};
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
  it("the owner: plan, price, paid until, automatic payments and the scheduled change — five reads", async () => {
    renderPlan();
    expect(await ready()).toHaveTextContent("The plan Umbrella is on and what it uses.");
    expect(labels()).toEqual(["Plan", "Price", "Paid until", "Automatic payments", "Scheduled change", "Projects", "Seats", "Storage", "Issues per project"]);
    expect(dd("Plan")).toHaveTextContent("Team · version 1");
    expect(dd("Price")).toHaveTextContent("€15 a month");
    expect(dd("Paid until").querySelector("time")).toHaveAttribute("dateTime", IN_A_MONTH);
    expect(dd("Automatic payments")).toHaveTextContent("On");
    // TAS-515 (B6, B10): the owner's own NEXT_PERIOD choice — its line, then «From {date} · {limits}», one colon fewer.
    expect(dd("Scheduled change")).toHaveTextContent(
      /^Team · version 2, €20 a monthFrom [A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d\d:\d\d · 5 projects · 50 seatsIt starts only if it’s paid for by then\. If it isn’t, Umbrella becomes read-only on that date\.$/,
    );
    // Two lines of the rule, each its own note (art-director blocker 2).
    expect(dd("Scheduled change").querySelectorAll(".company-plan-note")).toHaveLength(2);
    expect(dd("Scheduled change").querySelector("time")).toHaveAttribute("dateTime", IN_A_MONTH);
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
    // A change is scheduled: read-only comes with the last paid period (art-director blocker 4).
    expect(dd("Renewal")).toHaveTextContent("When its last paid period ends, Umbrella becomes read-only. It doesn’t move to a free plan on its own.");
    expect(dd("Scheduled change")).toHaveTextContent(/^The plan changes from [A-Z][a-z]{2} \d{1,2}, (\d{4}, )?\d\d:\d\d\.It starts only if it’s paid for by then\./);
  });

  it("TAS-515 F6: no Renewal row without a paid period — a company moved to Free never shows the old one as kept", async () => {
    state.entitlementPlan = "free";
    state.subscription = { ...state.subscription, planVersionId: "free", paidThrough: null, renewalCancelled: true, scheduledPlanVersionId: null, scheduledEffectiveAt: null };
    renderPlan();
    await ready();
    expect(labels()).toEqual(["Plan", "Projects", "Seats", "Storage", "Issues per project"]);
  });

  it("TAS-515: past an unpaid boundary the scheduled plan stays without its date; under PAYMENT_EXPIRED the Renewal row has no second line", async () => {
    state.restrictions = ["PAYMENT_EXPIRED"];
    state.subscription = { ...state.subscription, renewalCancelled: true, scheduledEffectiveAt: null };
    renderPlan();
    await ready();
    expect(dd("Scheduled change")).toHaveTextContent("Team · version 2, €20 a monthIts start date passed before it was paid for.");
    expect(dd("Renewal")).toHaveTextContent(/^Cancelled$/);
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
    expect(screen.queryByText(/^The plan \S.* is on and what it uses\./)).toBeNull();
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

/** Holds every read behind a gate until the returned release is called. */
const hold = () => {
  let release!: () => void;
  state.gate = new Promise<void>((resolve) => {
    release = () => {
      state.gate = null;
      resolve();
    };
  });
  return release;
};
const box = (text: string) => screen.getByText(text).closest(".error-note");

describe("«Try again» in flight (build review: art-director B1, release-reviewer M-1)", () => {
  it("two reads fail and the first heals: no skeleton in flight, both boxes with their ids, the button aria-disabled with focus — then focus follows it to its new place", async () => {
    state.fail = new Set(["entitlement", "quotas"]);
    renderPlan();
    await ready();
    const before = labels();
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    const usageBox = box("Usage could not be loaded.");

    state.calls = [];
    state.fail = new Set(["quotas"]);
    const release = hold();
    // Two presses in one task, before React has drawn the flight: one re-read each.
    act(() => {
      button.click();
      button.click();
    });
    await waitFor(() => expect([...state.calls].sort()).toEqual(["entitlement", "quotas"]));

    // In flight the page stays as it was: never the skeleton again (TanStack puts
    // a failed read without data back to `pending`), every failed read's box with
    // its error and request id, the rows that had arrived, and the button.
    expect(document.querySelector(".company-plan-loading")).toBeNull();
    expect(screen.getByText("This company’s plan could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("Usage could not be loaded.")).toBeInTheDocument();
    expect(screen.getByText("rid-entitlement")).toBeInTheDocument();
    expect(screen.getByText("rid-quotas")).toBeInTheDocument();
    expect(labels()).toEqual(before);
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent(/^Try again$/);
    expect(button).toHaveFocus();
    // A press in flight asks nothing more.
    fireEvent.click(button);
    expect(state.calls).toHaveLength(2);

    await act(async () => release());
    // The plan's rows arrive; Usage's failure stays, its box remounted with the new id …
    await waitFor(() => expect(dd("Plan")).toHaveTextContent("Team · version 1"));
    expect(screen.queryByText("This company’s plan could not be loaded.")).toBeNull();
    expect(box("Usage could not be loaded.")).not.toBe(usageBox);
    expect(screen.getByText("rid-quotas-2")).toBeInTheDocument();
    // … and «Try again» now stands under it, with focus.
    const moved = screen.getByRole("button", { name: "Try again" });
    expect(moved).not.toBe(button);
    expect(moved.closest(".company-plan-failure")).toContainElement(box("Usage could not be loaded.") as HTMLElement);
    await waitFor(() => expect(moved).toHaveFocus());
    expect(moved).not.toHaveAttribute("aria-disabled");

    // All healed: the page is whole, focus on the heading.
    state.fail = new Set();
    fireEvent.click(moved);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(dd("Seats")).toHaveTextContent("4 in use · 25 allowed");
  });

  it("the first failure stays: its box remounts in place and focus stays on the same «Try again»", async () => {
    state.fail = new Set(["entitlement", "quotas"]);
    renderPlan();
    await ready();
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();
    const planBox = box("This company’s plan could not be loaded.");

    state.fail = new Set(["entitlement"]);
    const release = hold();
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    expect(document.querySelector(".company-plan-loading")).toBeNull();
    expect(screen.getByText("Usage could not be loaded.")).toBeInTheDocument();
    expect(button).toHaveFocus();

    await act(async () => release());
    await waitFor(() => expect(dd("Seats")).toHaveTextContent("4 in use · 25 allowed"));
    expect(box("This company’s plan could not be loaded.")).not.toBe(planBox);
    expect(screen.getByText("rid-entitlement-2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBe(button);
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("aria-disabled");
  });
});

describe("403 OWNER_REQUIRED on the subscription (TAS-504 G6, release-reviewer L-3)", () => {
  it("another owner now: the company is read again and the tab re-enters it", async () => {
    state.ownerRequired = "priya";
    renderPlan();
    await waitFor(() => expect(state.reentered).toBe(1));
    expect(state.calls.filter((call) => call === "tenant")).toHaveLength(2);
  });

  it("the reader is still its owner: the company is read again, and nothing re-enters", async () => {
    state.ownerRequired = "tom";
    renderPlan();
    await waitFor(() => expect(state.calls.filter((call) => call === "tenant")).toHaveLength(2));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(state.reentered).toBe(0);
  });
});

describe("the boundary's timers (release-reviewer L-4)", () => {
  /** The indexes of the `setTimeout` calls that wait for the instant 5 s ahead. */
  const boundaryCall = (timeouts: { mock: { calls: readonly (readonly unknown[])[] } }) =>
    timeouts.mock.calls.flatMap(([, ms], index) => (typeof ms === "number" && ms > 3_000 && ms <= 5_000 ? [index] : []));

  it("under StrictMode, with the subscription cached at mount, the instant is still waited for", async () => {
    const soon = new Date(Date.now() + 5_000).toISOString();
    state.subscription = { ...state.subscription, paidThrough: soon, scheduledEffectiveAt: soon };
    const timeouts = vi.spyOn(window, "setTimeout");
    const cleared = vi.spyOn(window, "clearTimeout");
    renderPlan({
      strict: true,
      before: ({ client }) => {
        // Everything the owner's page decides on is there at its first render, so
        // the timer is set up in the commit StrictMode rehearses.
        client.setQueryData(["me"], { id: "tom", email: "tom@example.com", displayName: "tom", status: "ACTIVE" });
        client.setQueryData(["tenant", UMBRELLA], {
          id: UMBRELLA,
          name: "Umbrella",
          ownerId: "tom",
          lifecycle: "ACTIVE",
          restrictions: [],
          createdAt: null,
          creationDeadline: null,
          version: "3",
        });
        client.setQueryData(["company-subscription"], { ...state.subscription });
      },
    });
    await ready();
    const ids = boundaryCall(timeouts).map((index) => timeouts.mock.results[index].value as number);
    const live = ids.filter((id) => !cleared.mock.calls.some(([cancelled]) => cancelled === id));
    expect(live).toHaveLength(1);
  });

  it("an unmount clears the instant's re-read and the one 60 s later", async () => {
    const soon = new Date(Date.now() + 5_000).toISOString();
    state.subscription = { ...state.subscription, paidThrough: soon, scheduledEffectiveAt: soon };
    const timeouts = vi.spyOn(window, "setTimeout");
    const cleared = vi.spyOn(window, "clearTimeout");
    const view = renderPlan();
    await ready();
    const [index] = boundaryCall(timeouts);
    expect(index).toBeDefined();
    const first = timeouts.mock.results[index].value as number;
    await act(async () => (timeouts.mock.calls[index][0] as () => void)());
    const againIndex = timeouts.mock.calls.findIndex(([, ms]) => ms === 60_000);
    expect(againIndex).toBeGreaterThanOrEqual(0);
    const again = timeouts.mock.results[againIndex].value as number;
    view.unmount();
    const ids = cleared.mock.calls.map(([id]) => id);
    expect(ids).toContain(first);
    expect(ids).toContain(again);
  });
});

describe("TAS-515: a renewal refusal whose re-read changed the row (art-director blocker 5, NB7)", () => {
  const stale = () => Object.assign(new Error("stale"), { status: 412, code: "VERSION_CONFLICT", requestId: "rid-412", details: null, reasons: [] });

  beforeEach(() => {
    state.subscription = { ...state.subscription, scheduledPlanVersionId: null, scheduledEffectiveAt: null };
  });

  it("a 412 on cancel whose re-read shows it cancelled already: said as done, no note, focus on «Resume renewal»", async () => {
    state.renewalAnswer = () => {
      state.subscription = { ...state.subscription, renewalCancelled: true, version: "3" };
      return Promise.reject(stale());
    };
    renderPlan();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Cancel renewal" }));
    const band = document.querySelector(".company-plan-band") as HTMLElement;
    fireEvent.click(within(band).getByRole("button", { name: "Cancel renewal" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Resume renewal" })).toHaveFocus());
    expect(screen.getByText("Umbrella’s renewal is already cancelled.")).toBeInTheDocument();
    expect(document.querySelector(".company-plan-zone .error-note")).toBeNull();
  });

  it("a refusal whose re-read leaves no renewal button keeps its note, and focus goes to «Change plan»", async () => {
    state.subscription = { ...state.subscription, renewalCancelled: true };
    state.renewalAnswer = () => {
      state.restrictions = ["PAYMENT_EXPIRED"];
      return Promise.reject(Object.assign(new Error("no"), { status: 409, code: "INVALID_STATE", requestId: "rid-409", details: null, reasons: [] }));
    };
    renderPlan();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Resume renewal" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Change plan" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Resume renewal" })).toBeNull();
    expect(document.querySelector(".company-plan-zone .error-note")).toHaveTextContent("Renewal wasn’t resumed.");
  });

  it("with a change scheduled, cancelling says read-only comes with the last paid period (blocker 4)", async () => {
    state.subscription = { ...state.subscription, scheduledPlanVersionId: "team-2", scheduledEffectiveAt: IN_A_MONTH };
    renderPlan();
    await ready();
    expect(screen.getByText(/^Cancelling renewal keeps Umbrella on Team until .+\. It becomes read-only when its last paid period ends\.$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel renewal" }));
    expect(document.querySelector(".company-plan-band")).toHaveTextContent(
      /^Umbrella stays on Team until .+\. When its last paid period ends, it becomes read-only: everything can still be read/,
    );
  });
});
