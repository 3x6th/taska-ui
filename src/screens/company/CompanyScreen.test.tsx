import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import { companiesHarness } from "../../test/companiesHarness";
import { App } from "../App";

/**
 * The Company zone as the app routes it (TAS-522, DESIGN.md §5.10): the area,
 * its three sections and the redirect into General, the old Settings
 * addresses that lead here, «Manage company» landing on the heading, an
 * address without a company, and the build without the flag. Against `App`
 * itself, so the routes under test are the ones that ship.
 *
 * Only the zone's shell is under test: every read a section's body makes and
 * this fake does not name waits forever, so the bodies stay in their loading
 * state — their behaviour is pinned in their own files.
 */
const { fakeApi } = vi.hoisted(() => {
  const workspace = { tenantId: "n", tenantName: "Northwind", tenantSessionId: "s-n" };
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
    // Anna owns neither: the zone is every member's (§5.10 «Доступ»).
    listTenants: async () => ({
      items: [
        { id: "n", name: "Northwind", ownerId: "priya", lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "1" },
        { id: "g", name: "Globex", ownerId: "priya", lifecycle: "ACTIVE", restrictions: [], createdAt: "2026-05-01T09:00:00Z", version: "1" },
      ],
      nextCursor: null,
    }),
    listBillingPlans: async () => ({ items: [], nextCursor: null }),
    getCurrentUser: async () => ({
      id: "anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE",
      globalRole: "USER",
      avatarUrl: null,
      avatarUnavailable: false,
    }),
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0, unreadCount: 0 }),
  };
  const api = new Proxy(known, {
    get: (target, key) => {
      if (typeof key !== "string" || key in target) return target[key as string];
      // `then` stays undefined, so nothing mistakes the API for a promise.
      if (key === "then") return undefined;
      return () => new Promise(() => {});
    },
  });
  return { fakeApi: api as unknown as TaskaApi };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

/** Where the router is — path, query and hash — how it got there, and whether the entry asks for the heading. */
function Whereabouts() {
  const location = useLocation();
  const type = useNavigationType();
  const asked = (location.state as { focusHeading?: unknown } | null)?.focusHeading === true;
  return (
    <p data-focus-heading={asked} data-navigation={type} data-testid="whereabouts">
      {`${location.pathname}${location.search}${location.hash}`}
    </p>
  );
}

/** The app inside Northwind's prefix, at `path`. */
const renderInCompany = (path: string, state?: unknown) => {
  const harness = companiesHarness({ companyId: "n", path, state });
  render(
    <>
      <App />
      <Whereabouts />
    </>,
    { wrapper: harness.wrapper },
  );
  return harness;
};

const whereabouts = () => screen.getByTestId("whereabouts");
const zoneRail = () => screen.getByRole("navigation", { name: "Company" });

afterEach(() => {
  document.title = "";
  window.localStorage.clear();
});

describe("the Company zone (TAS-522, §5.10)", () => {
  it("opens General from /company, in the shared area recipe: the rail «Company», the crumb, the bar's theme toggle", async () => {
    renderInCompany("/company");

    await waitFor(() => expect(whereabouts()).toHaveTextContent(/^\/company\/general$/));
    expect(whereabouts()).toHaveAttribute("data-navigation", "REPLACE");
    const heading = await screen.findByRole("heading", { level: 1, name: /Company.*General/ });
    expect(heading.querySelector(".area-crumb")).toHaveTextContent("Company ›");
    // Not on arrival by address: nothing asked for it (§5.10 «Шапка»).
    expect(heading).not.toHaveFocus();
    const rail = zoneRail();
    expect(within(rail).getAllByRole("link").map((link) => link.textContent)).toEqual(["General", "Members", "Plan", "Back to projects"]);
    expect(within(rail).getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(within(rail).getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/projects");
    // The app shell's own bar, with the theme toggle, as on Settings — and no read-only marker.
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();
    expect(document.querySelector(".admin-readonly")).toBeNull();
    // Settings' insets are the zone's: the same class (§5.10 «Шапка»).
    expect(heading.closest(".area")).toHaveClass("settings-area");
    await waitFor(() => expect(document.title).toBe("Northwind — Taska"));
  });

  it("names Members and Plan by their own addresses, the rail marking each", async () => {
    for (const [path, label] of [
      ["/company/members", "Members"],
      ["/company/plan", "Plan"],
    ] as const) {
      const view = render(
        <>
          <App />
          <Whereabouts />
        </>,
        { wrapper: companiesHarness({ companyId: "n", path }).wrapper },
      );
      expect(await screen.findByRole("heading", { level: 1, name: new RegExp(`Company.*${label}`) })).toBeInTheDocument();
      expect(within(zoneRail()).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
      expect(within(zoneRail()).getByRole("link", { name: "General" })).not.toHaveAttribute("aria-current");
      view.unmount();
    }
  });

  it("carries the router state through /company → General: an arrival that asks for the heading gets it", async () => {
    renderInCompany("/company", { focusHeading: true });

    await waitFor(() => expect(whereabouts()).toHaveTextContent(/^\/company\/general$/));
    expect(whereabouts()).toHaveAttribute("data-focus-heading", "true");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Company.*General/ })).toHaveFocus());
  });

  it("answers an address inside /company that is no section with Page not found", async () => {
    renderInCompany("/company/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Company" })).not.toBeInTheDocument();
  });

  it("replaces each old Settings address with the zone's, keeping its query and hash (AC3)", async () => {
    for (const [from, to] of [
      ["/settings/company", "/company/general"],
      ["/settings/members", "/company/members"],
      ["/settings/plan", "/company/plan"],
    ] as const) {
      const view = render(
        <>
          <App />
          <Whereabouts />
        </>,
        { wrapper: companiesHarness({ companyId: "n", path: `${from}?tab=x#seats` }).wrapper },
      );
      await waitFor(() => expect(whereabouts()).toHaveTextContent(new RegExp(`^${to}\\?tab=x#seats$`)));
      expect(whereabouts()).toHaveAttribute("data-navigation", "REPLACE");
      expect(await screen.findByRole("navigation", { name: "Company" })).toBeInTheDocument();
      // Nothing of Settings was drawn for it.
      expect(screen.queryByRole("navigation", { name: "Settings" })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("leaves Settings with the reader's four sections and no «Company» group (B2)", async () => {
    renderInCompany("/settings/profile");

    const rail = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(rail).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "My profile",
      "Access tokens",
      "Connected apps",
      "Appearance",
      "Back to projects",
    ]);
    expect(within(rail).queryByRole("group")).not.toBeInTheDocument();
    expect(rail.querySelector(".area-rail-group, .area-rail-group-label")).toBeNull();
  });
});

describe("«Manage company» into the zone (TAS-522, §4.34, B4)", () => {
  const manage = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Northwind, switch company" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Companies" })).getByRole("link", { name: "Manage company" }));
  };

  it("from Settings: the popover closes, the zone opens on General and its heading takes focus", async () => {
    renderInCompany("/settings/profile");
    await manage();

    expect(screen.queryByRole("dialog", { name: "Companies" })).not.toBeInTheDocument();
    await waitFor(() => expect(whereabouts()).toHaveTextContent(/^\/company\/general$/));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Company.*General/ })).toHaveFocus());
    // Pushed, then the index replaced: Back returns to Settings (§4.34).
    expect(whereabouts()).toHaveAttribute("data-navigation", "REPLACE");
  });

  it("with the zone already on screen — on General itself, where no section changes — the heading still takes focus", async () => {
    for (const path of ["/company/general", "/company/plan"]) {
      const view = render(
        <>
          <App />
          <Whereabouts />
        </>,
        { wrapper: companiesHarness({ companyId: "n", path }).wrapper },
      );
      const heading = await screen.findByRole("heading", { level: 1, name: /Company/ });
      expect(heading).not.toHaveFocus();
      await manage();
      await waitFor(() => expect(whereabouts()).toHaveTextContent(/^\/company\/general$/));
      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: /Company.*General/ })).toHaveFocus());
      expect(document.activeElement).not.toBe(document.body);
      view.unmount();
    }
  });
});

describe("an address without a company (§5.1, §5.10)", () => {
  it("opens /company/members in the tab's company, query kept", async () => {
    const { go, wrapper } = companiesHarness({ companyId: null, path: "/company/members?x=1" });
    render(<App />, { wrapper });
    await waitFor(() => expect(go).toHaveBeenCalledWith("/c/n/company/members?x=1", { replace: true, state: { withoutCompany: true } }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
  });
});

describe("the build without the flag (AC4, §5.10 «Без флага»)", () => {
  it("has no /company: Page not found, and the old Settings addresses were never routes", async () => {
    for (const path of ["/company", "/company/general", "/company/members", "/settings/company"]) {
      const view = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={[path]}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Company" })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
