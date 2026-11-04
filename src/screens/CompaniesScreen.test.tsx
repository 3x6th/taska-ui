import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi, Workspace } from "../api/TaskaApi";
import { companiesHarness } from "../test/companiesHarness";
import { CompaniesScreen } from "./CompaniesScreen";

/*
 * DESIGN.md §4.33 «Выбор компании» (TAS-500) against a fake API: the order,
 * the words of each row, the current company, the empty list, a failed read,
 * and where focus goes.
 */

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    tenants: [] as unknown[],
    refusal: null as Error | null,
    workspace: null as Workspace | null,
  };
  const api = {
    listTenants: async () => {
      if (state.refusal) throw state.refusal;
      return { items: state.tenants, nextCursor: null };
    },
    getCurrentUser: async () => ({ id: "anna", email: "anna@example.com", displayName: "Anna", status: "ACTIVE" }),
    currentWorkspace: () => state.workspace,
    onWorkspaceChange: () => () => {},
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (id: string, name: string, lifecycle = "ACTIVE", restrictions: string[] = [], ownerId = "someone") => ({
  id,
  name,
  ownerId,
  lifecycle,
  restrictions,
  createdAt: "2026-05-01T09:00:00Z",
  version: "1",
});

const props = { theme: "light" as const, toggleTheme: () => {}, onLogout: vi.fn(), logoutPending: false };

beforeEach(() => {
  state.tenants = [];
  state.refusal = null;
  state.workspace = null;
});

describe("Choose a company", () => {
  it("lists every company as a link — the working first, then the closed, by name — with its state and Owner", async () => {
    state.tenants = [
      tenant("m", "Massive Dynamic", "AUTO_CLOSED"),
      tenant("n", "Northwind", "ACTIVE", [], "anna"),
      tenant("i", "Initech", "ACTIVE", ["OWNER_PAUSE"]),
      tenant("h", "Hooli", "ACTIVE", ["PLATFORM_BLOCK"]),
    ];
    state.workspace = { tenantId: "n", tenantName: "Northwind", tenantSessionId: "s" };
    const { wrapper } = companiesHarness({ path: "/companies" });
    render(<CompaniesScreen {...props} />, { wrapper });

    const list = await screen.findByRole("list", { name: "Companies" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual([
      "HooliBlocked by Taska",
      "InitechPaused by its owner",
      "NorthwindOwner",
      "Massive DynamicClosed",
    ]);
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      "/c/h/projects",
      "/c/i/projects",
      "/c/n/projects",
      "/c/m/projects",
    ]);
    // The tab's company is marked, and is still a link.
    expect(rows[2]).toHaveAttribute("aria-current", "true");
    expect(rows[3]).toHaveClass("is-closed");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Choose a company");
    expect(await screen.findByText("Signed in as anna@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    // First screen of the tab: focus is not moved.
    expect(screen.getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it("opens a remembered address in the chosen company, and says so", async () => {
    state.tenants = [tenant("n", "Northwind"), tenant("g", "Globex")];
    const { wrapper } = companiesHarness({ path: "/companies", state: { from: "/browse/WEB-12", focusHeading: true } });
    render(<CompaniesScreen {...props} />, { wrapper });
    expect(await screen.findByRole("link", { name: /Northwind/ })).toHaveAttribute("href", "/c/n/browse/WEB-12");
    expect(screen.getByText("Choose a company to open the link.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("says plainly that there is no company yet", async () => {
    const { wrapper } = companiesHarness({ path: "/companies" });
    render(<CompaniesScreen {...props} />, { wrapper });
    expect(await screen.findByRole("heading", { level: 1, name: "You’re not in a company yet" })).toBeInTheDocument();
    expect(screen.getByText("Work in Taska happens inside a company. Ask a company admin to invite you.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Companies" })).not.toBeInTheDocument();
  });

  it("a failed read is a refusal with the server's words and a retry — never «no companies»", async () => {
    state.refusal = Object.assign(new Error("Dependency unavailable"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-1" });
    const { wrapper } = companiesHarness({ path: "/companies", state: { afterSignIn: true } });
    render(<CompaniesScreen {...props} />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your companies could not be loaded.");
    expect(screen.getByText("Dependency unavailable")).toBeInTheDocument();
    expect(screen.getByText("rid-1")).toBeInTheDocument();
    expect(screen.queryByText(/not in a company/)).not.toBeInTheDocument();
    state.refusal = null;
    state.tenants = [tenant("n", "Northwind")];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Northwind/ })).toBeInTheDocument());
  });

  it("a plain click on a row enters the company through the address; a modifier leaves it to the browser", async () => {
    state.tenants = [tenant("n", "Northwind"), tenant("g", "Globex")];
    const { wrapper, go } = companiesHarness({ path: "/companies" });
    render(<CompaniesScreen {...props} />, { wrapper });
    const row = await screen.findByRole("link", { name: /Globex/ });
    fireEvent.click(row, { metaKey: true });
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(go).toHaveBeenCalledWith("/c/g/projects", { state: undefined });
  });
});
