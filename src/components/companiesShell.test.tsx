import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi, Workspace } from "../api/TaskaApi";
import type { User } from "../domain/types";
import { NotFoundScreen } from "../screens/NotFoundScreen";
import { companiesHarness } from "../test/companiesHarness";
import { UserProfileMenu } from "./UserProfileMenu";

/*
 * The shared shell in the companies build (TAS-500): the profile menu's B2B
 * rows (DESIGN.md §4.16) and the not-found screen's way out (§4.18).
 */

const { fakeApi, state } = vi.hoisted(() => {
  const state = { tenants: [] as unknown[], workspace: null as Workspace | null };
  const api = {
    listTenants: async () => ({ items: state.tenants, nextCursor: null }),
    currentWorkspace: () => state.workspace,
    onWorkspaceChange: () => () => {},
    getMeta: async () => ({ issueTypes: null, priorities: null, linkTypes: null, notificationTypes: null, userStatuses: null }),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (id: string, name: string) => ({
  id,
  name,
  ownerId: "o",
  lifecycle: "ACTIVE",
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
  it("goes to the company's projects inside a company", () => {
    const { wrapper } = companiesHarness({ companyId: "n", path: "/nope" });
    render(<NotFoundScreen />, { wrapper });
    expect(screen.getByRole("link", { name: "Go to projects" })).toHaveAttribute("href", "/projects");
  });

  it("offers Choose a company to a tab without one", () => {
    const { wrapper } = companiesHarness({ companyId: null, path: "/nope" });
    render(<NotFoundScreen />, { wrapper });
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
  });

  it("says the link may be in another company when it came without one and the reader has two", async () => {
    const { wrapper } = companiesHarness({ companyId: "n", path: "/browse/WEB-12", state: { withoutCompany: true } });
    render(<NotFoundScreen />, { wrapper });
    expect(await screen.findByText("If it’s in another company, choose that company and open the link again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose a company" })).toHaveAttribute("href", "/companies");
    expect(screen.getByRole("link", { name: "Go to projects" })).toBeInTheDocument();
  });
});
