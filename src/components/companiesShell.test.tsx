import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi, Workspace, WorkspaceLeftEvent, WorkspacePendingEvent, WorkspaceRestrictedEvent } from "../api/TaskaApi";
import type { User } from "../domain/types";
import { Route, Routes } from "react-router-dom";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { CompanyGate } from "./CompanyGate";
import { companiesHarness } from "../test/companiesHarness";
import { UserProfileMenu } from "./UserProfileMenu";

/*
 * The shared shell in the companies build (TAS-500): the profile menu's B2B
 * rows (DESIGN.md §4.16) and the not-found screen's way out (§4.18).
 */

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    tenants: [] as unknown[],
    workspace: null as Workspace | null,
    order: [] as string[],
    pending: new Set<(event: WorkspacePendingEvent) => void>(),
    left: new Set<(event: WorkspaceLeftEvent) => void>(),
    restricted: new Set<(event: WorkspaceRestrictedEvent) => void>(),
    me: "o",
    closed: [] as unknown[],
    enterError: null as Error | null,
  };
  const api = {
    enterCompany: (tenantId: string) => {
      state.order.push(`enter ${tenantId}`);
      return state.enterError ? Promise.reject(state.enterError) : new Promise(() => {});
    },
    onWorkspaceClosed: () => () => {},
    onWorkspaceLeft: (listener: (event: WorkspaceLeftEvent) => void) => {
      state.left.add(listener);
      return () => state.left.delete(listener);
    },
    onWorkspacePending: (listener: (event: WorkspacePendingEvent) => void) => {
      state.pending.add(listener);
      return () => state.pending.delete(listener);
    },
    onWorkspaceRestricted: (listener: (event: WorkspaceRestrictedEvent) => void) => {
      state.restricted.add(listener);
      return () => state.restricted.delete(listener);
    },
    getCurrentUser: async () => ({ id: state.me, email: `${state.me}@example.com`, displayName: "O", status: "ACTIVE" }),
    getTenant: () => new Promise(() => {}),
    listBillingPlans: async () => ({ items: [], nextCursor: null }),
    listTenants: async () => ({ items: state.tenants, nextCursor: null }),
    currentWorkspace: () => state.workspace,
    onWorkspaceChange: () => () => {},
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (id: string, name: string, lifecycle = "ACTIVE") => ({
  id,
  name,
  ownerId: "o",
  lifecycle,
  restrictions: [],
  createdAt: "2026-05-01T09:00:00Z",
  version: "1",
});

const mark: User = {
  id: "mark",
  email: "mark@example.com",
  displayName: "Mark Lee",
  status: "ACTIVE",
  globalRole: "GLOBAL_ADMIN",
} as User;

beforeEach(() => {
  state.tenants = [tenant("n", "Northwind"), tenant("g", "Globex")];
  state.workspace = null;
  state.order = [];
  state.pending.clear();
  state.left.clear();
  state.restricted.clear();
  state.me = "o";
  state.enterError = null;
});

describe("a company the reader turns out to have left (TAS-502, api-contract-guard B-1)", () => {
  it("goes to the picker with «You left {Company}» and refreshes the list; another company's word is not this tab's", async () => {
    const { wrapper, go, client } = companiesHarness({ companyId: "n", path: "/projects" });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <Routes>
        <Route element={<CompanyGate logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />}>
          <Route path="/projects" element={<p>page</p>} />
        </Route>
      </Routes>,
      { wrapper },
    );
    await screen.findByText("page");
    act(() => {
      for (const listener of state.left) listener({ tenantId: "g", tenantName: "Globex" });
    });
    expect(go).not.toHaveBeenCalled();
    act(() => {
      for (const listener of state.left) listener({ tenantId: "n", tenantName: "Northwind" });
    });
    expect(go).toHaveBeenCalledWith("/companies", { replace: true, state: { focusHeading: true, left: { name: "Northwind" } } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tenants"] });
    // Nothing of §4.35 or §4.18 is drawn for it.
    expect(screen.queryByRole("heading", { name: /no longer have access|Page not found/ })).not.toBeInTheDocument();
  });
});

describe("the company gate (release-reviewer H1)", () => {
  it("renders nothing of the company before its switch has begun, so no render-time request is the previous company's", async () => {
    function Probe() {
      state.order.push("render the page");
      return <p>page</p>;
    }
    const { wrapper } = companiesHarness({ companyId: "g", path: "/projects" });
    render(
      <Routes>
        <Route element={<CompanyGate logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />}>
          <Route path="/projects" element={<Probe />} />
        </Route>
      </Routes>,
      { wrapper },
    );
    // The list first (TAS-501): whether this is the app shell at all is its row's to say.
    expect(await screen.findByText("page")).toBeInTheDocument();
    expect(state.order[0]).toBe("enter g");
    expect(state.order.indexOf("render the page")).toBeGreaterThan(0);
  });
});

describe("a company that has never opened (TAS-501, DESIGN.md §4.37)", () => {
  const gate = () => (
    <Routes>
      <Route element={<CompanyGate logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />}>
        <Route path="/projects" element={<p>page</p>} />
        <Route path="/settings/profile" element={<p>settings</p>} />
      </Route>
    </Routes>
  );

  it("draws its card instead of the app shell on any path under the prefix — and enters it, so its session is there", async () => {
    state.tenants = [tenant("s", "Stark Industries", "AWAITING_PAYMENT")];
    const { wrapper } = companiesHarness({ companyId: "s", path: "/settings/profile" });
    render(gate(), { wrapper });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Stark IndustriesAwaiting first payment");
    expect(screen.queryByText("settings")).not.toBeInTheDocument();
    expect(state.order).toEqual(["enter s"]);
  });

  it("an entry that got no answer (or a 5xx, 408, 429) is «could not be opened» with Try again — not the card without a session (release-reviewer N1)", async () => {
    for (const failure of [
      new TypeError("Failed to fetch"),
      Object.assign(new Error("Unavailable"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-503", details: null }),
      Object.assign(new Error("Slow down"), { status: 429, code: "RATE_LIMITED", requestId: "rid-429", details: null }),
    ]) {
      state.enterError = failure;
      state.tenants = [tenant("s", "Stark Industries", "AWAITING_PAYMENT")];
      const { wrapper } = companiesHarness({ companyId: "s", path: "/projects" });
      const view = render(gate(), { wrapper });
      expect(await screen.findByRole("heading", { level: 1, name: "Stark Industries could not be opened" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel creation" })).not.toBeInTheDocument();
      view.unmount();
    }
    // A refusal that is an answer about the company — a closed creation's 409 — is the card, without a session.
    state.enterError = Object.assign(new Error("The company is closed"), { status: 409, code: "INVALID_STATE", requestId: "rid-409", details: null });
    state.tenants = [tenant("m", "Massive Dynamic", "AUTO_CLOSED")];
    const { wrapper } = companiesHarness({ companyId: "m", path: "/projects" });
    render(gate(), { wrapper });
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Massive DynamicClosed");
  });

  it("a content read refused for the first payment swaps the page for the card, without closing the company", async () => {
    state.tenants = [tenant("n", "Northwind")];
    const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
    render(gate(), { wrapper });
    expect(await screen.findByText("page")).toBeInTheDocument();
    act(() => {
      for (const listener of state.pending) {
        listener({ tenantId: "n", code: "CAPABILITY_DISABLED", reasons: ["PENDING_FIRST_PAYMENT"], requestId: "rid" });
      }
    });
    expect(screen.queryByText("page")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("NorthwindAwaiting first payment");
    expect(screen.queryByText(/is paused|could not be opened|no longer have access/)).not.toBeInTheDocument();
  });

  it("on a tab's first screen draws nothing of the company until the list says what it is", async () => {
    let answer!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      answer = resolve;
    });
    const list = fakeApi.listTenants;
    (fakeApi as unknown as { listTenants: unknown }).listTenants = () => held;
    try {
      const { wrapper } = companiesHarness({ companyId: "p", path: "/projects" });
      render(gate(), { wrapper });
      await act(async () => {});
      expect(screen.queryByText("page")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Opening Taska");
      await act(async () => answer({ items: [tenant("p", "Pending Co", "PROVISIONING")], nextCursor: null }));
      expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Pending CoBeing set up");
      expect(screen.queryByText("page")).not.toBeInTheDocument();
    } finally {
      (fakeApi as unknown as { listTenants: unknown }).listTenants = list;
    }
  });
});

describe("a paused or blocked company keeps its session (TAS-504, api-contract-guard B2, §4.35)", () => {
  const gate = () => (
    <Routes>
      <Route element={<CompanyGate logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />}>
        <Route path="/projects" element={<p>page</p>} />
        <Route path="/browse/:issueKey" element={<p>issue</p>} />
        <Route path="/settings/company" element={<p>company settings</p>} />
      </Route>
    </Routes>
  );
  const restrict = (reasons: string[], restricted = true, tenantId = "n") =>
    act(() => {
      for (const listener of state.restricted) listener({ tenantId, restricted, reasons, requestId: "rid" });
    });

  it("replaces the content routes with the member's statement — Choose a company and Log out — and lifts it on the word", async () => {
    state.me = "member";
    state.tenants = [tenant("n", "Northwind")];
    const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
    render(gate(), { wrapper });
    expect(await screen.findByText("page")).toBeInTheDocument();
    restrict(["OWNER_PAUSE"], true, "g");
    expect(screen.getByText("page")).toBeInTheDocument();
    restrict(["OWNER_PAUSE"]);
    const heading = await screen.findByRole("heading", { level: 1, name: "Northwind is paused" });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Its owner has paused it, so its projects can’t be opened right now.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a company" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open company settings" })).not.toBeInTheDocument();
    expect(screen.queryByText("page")).not.toBeInTheDocument();
    restrict([], false);
    expect(await screen.findByText("page")).toBeInTheDocument();
  });

  it("the owner: their own words, Open company settings first and Choose a company — Settings is never replaced", async () => {
    state.tenants = [tenant("n", "Northwind")];
    const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
    render(gate(), { wrapper });
    await screen.findByText("page");
    restrict(["OWNER_PAUSE"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Northwind is paused" })).toBeInTheDocument();
    expect(screen.getByText("Its projects can’t be opened while it’s paused. You can resume it in its settings.")).toBeInTheDocument();
    const links = screen.getAllByRole("link").map((node) => node.textContent);
    expect(links).toEqual(["Open company settings", "Choose a company"]);
    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Open company settings" }));
    expect(await screen.findByText("company settings")).toBeInTheDocument();
  });

  it("both reasons say the block's line; /browse is a content route too", async () => {
    state.tenants = [tenant("n", "Northwind")];
    const { wrapper } = companiesHarness({ companyId: "n", path: "/browse/TAS-1" });
    render(gate(), { wrapper });
    await screen.findByText("issue");
    restrict(["OWNER_PAUSE", "PLATFORM_BLOCK"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Northwind is blocked" })).toBeInTheDocument();
    expect(
      screen.getByText("Taska has blocked this company, so its projects can’t be opened right now. Only Taska can lift the block."),
    ).toBeInTheDocument();
  });

  it("on Settings nothing is replaced", async () => {
    state.tenants = [tenant("n", "Northwind")];
    const { wrapper } = companiesHarness({ companyId: "n", path: "/settings/company" });
    render(gate(), { wrapper });
    await screen.findByText("company settings");
    restrict(["PLATFORM_BLOCK"]);
    await act(async () => {});
    expect(screen.getByText("company settings")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /blocked/ })).not.toBeInTheDocument();
  });
});

describe("the profile menu in the companies build", () => {
  it("names the tab's company first, calls the account's role «Taska role», offers Switch company and no Administration", async () => {
    const { wrapper, go } = companiesHarness({ companyId: "n", path: "/projects" });
    render(<UserProfileMenu onLogout={() => {}} user={mark} />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open profile for Mark Lee" }));
    const terms = screen.getAllByRole("term").map((node) => node.textContent);
    expect(terms).toEqual(["Company", "Status", "Taska role"]);
    expect(await screen.findByText("Northwind")).toHaveClass("user-profile-company");
    const actions = screen.getAllByRole("link").map((node) => node.textContent);
    expect(actions).toEqual(["Switch company", "Settings"]);
    fireEvent.click(screen.getByRole("link", { name: "Switch company" }));
    expect(go).toHaveBeenCalledWith("/companies", { state: { focusHeading: true } });
    expect(screen.queryByRole("dialog", { name: "Current user profile" })).not.toBeInTheDocument();
  });

  it("has no Company pair in a tab without a company", () => {
    const { wrapper } = companiesHarness({ companyId: null, path: "/companies" });
    render(<UserProfileMenu onLogout={() => {}} user={mark} />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Open profile for Mark Lee" }));
    expect(screen.queryByText("Company")).not.toBeInTheDocument();
  });
});

describe("Page not found in the companies build", () => {
  it("goes to the company's projects inside a company the tab holds", () => {
    state.workspace = { tenantId: "n", tenantName: "Northwind", tenantSessionId: "s" };
    const { wrapper } = companiesHarness({ companyId: "n", path: "/nope" });
    render(<NotFoundScreen />, { wrapper });
    expect(screen.getByRole("link", { name: "Go to projects" })).toHaveAttribute("href", "/projects");
  });

  it("after a link into a company the tab does not hold, never points back into it (N1)", () => {
    // The address names a foreign company; the tab holds none — the picker.
    const { wrapper } = companiesHarness({ companyId: "foreign", path: "/projects" });
    const { unmount } = render(<NotFoundScreen />, { wrapper });
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
    expect(screen.queryByRole("link", { name: "Go to projects" })).not.toBeInTheDocument();
    unmount();
    // The tab holds another company: that company's projects, not the foreign one's.
    state.workspace = { tenantId: "n", tenantName: "Northwind", tenantSessionId: "s" };
    const other = companiesHarness({ companyId: "foreign", path: "/projects" });
    render(<NotFoundScreen />, { wrapper: other.wrapper });
    expect(screen.getByRole("link", { name: "Go to projects" })).toHaveAttribute("href", "/c/n/projects");
  });

  it("offers Choose a company to a tab without one", () => {
    const { wrapper } = companiesHarness({ companyId: null, path: "/nope" });
    render(<NotFoundScreen />, { wrapper });
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
  });

  it("says the link may be in another company when it came without one and the reader has two", async () => {
    state.workspace = { tenantId: "n", tenantName: "Northwind", tenantSessionId: "s" };
    const { wrapper } = companiesHarness({ companyId: "n", path: "/browse/WEB-12", state: { withoutCompany: true } });
    render(<NotFoundScreen />, { wrapper });
    expect(await screen.findByText("If it’s in another company, choose that company and open the link again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
    expect(screen.getByRole("link", { name: "Go to projects" })).toBeInTheDocument();
  });
});
