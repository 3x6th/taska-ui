import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi, Workspace, WorkspacePendingEvent } from "../api/TaskaApi";
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
    closed: [] as unknown[],
  };
  const api = {
    enterCompany: (tenantId: string) => {
      state.order.push(`enter ${tenantId}`);
      return new Promise(() => {});
    },
    onWorkspaceClosed: () => () => {},
    onWorkspacePending: (listener: (event: WorkspacePendingEvent) => void) => {
      state.pending.add(listener);
      return () => state.pending.delete(listener);
    },
    getCurrentUser: async () => ({ id: "o", email: "o@example.com", displayName: "O", status: "ACTIVE" }),
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
