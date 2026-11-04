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
    holdMe: false,
    planReads: 0,
  };
  const api = {
    listTenants: async () => {
      if (state.refusal) throw state.refusal;
      return { items: state.tenants, nextCursor: null };
    },
    getCurrentUser: async () => {
      if (state.holdMe) await new Promise(() => {});
      return { id: "anna", email: "anna@example.com", displayName: "Anna", status: "ACTIVE" };
    },
    currentWorkspace: () => state.workspace,
    onWorkspaceChange: () => () => {},
    listBillingPlans: async () => {
      state.planReads += 1;
      return { items: [], nextCursor: null };
    },
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
  state.holdMe = false;
  state.planReads = 0;
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

  it("keeps the «Signed in as» line's place from the first frame, so the card does not jump", async () => {
    state.holdMe = true;
    state.tenants = [tenant("n", "Northwind")];
    const { wrapper } = companiesHarness({ path: "/companies" });
    const { container } = render(<CompaniesScreen {...props} />, { wrapper });
    await screen.findByRole("list", { name: "Companies" });
    const line = container.querySelector(".companies-signed-in");
    expect(line).not.toBeNull();
    expect(line).toHaveAttribute("aria-hidden", "true");
    expect(line?.textContent).toBe("\u00a0");
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
    expect(
      screen.getByText("Work in Taska happens inside a company. Create one, or ask a company admin to invite you."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Companies" })).not.toBeInTheDocument();
    // TAS-501: the card's primary, and the catalogue read ahead for it.
    const create = screen.getByRole("link", { name: "Create a company" });
    expect(create).toHaveAttribute("href", "/companies/new");
    expect(create).toHaveClass("primary-button");
    await waitFor(() => expect(state.planReads).toBe(1));
  });

  it("offers «Create a company» as a row under the list, outside it, when there is a working company (TAS-501)", async () => {
    state.tenants = [tenant("n", "Northwind"), tenant("m", "Massive Dynamic", "AUTO_CLOSED")];
    const { wrapper, go } = companiesHarness({ path: "/companies" });
    render(<CompaniesScreen {...props} />, { wrapper });
    const list = await screen.findByRole("list", { name: "Companies" });
    expect(within(list).getAllByRole("link")).toHaveLength(2);
    const create = screen.getByRole("link", { name: "Create a company" });
    expect(list).not.toContainElement(create);
    expect(create).toHaveClass("company-create-row");
    expect(create).not.toHaveClass("primary-button");
    // Tab: the rows, then Create a company, then Log out.
    const order = [...document.querySelectorAll("a, button")].map((node) => node.textContent);
    expect(order.indexOf("Create a company")).toBeGreaterThan(order.findIndex((text) => text?.startsWith("Massive Dynamic")));
    expect(order.indexOf("Log out")).toBeGreaterThan(order.indexOf("Create a company"));
    fireEvent.click(create);
    expect(go).toHaveBeenCalledWith("/companies/new", { state: undefined });
  });

  it("with no working company — only closed ones — «Create a company» is the card's primary (TAS-501)", async () => {
    state.tenants = [tenant("w", "Wayne Enterprises", "OWNER_CANCELLED"), tenant("m", "Massive Dynamic", "AUTO_CLOSED")];
    const { wrapper } = companiesHarness({ path: "/companies" });
    render(<CompaniesScreen {...props} />, { wrapper });
    const list = await screen.findByRole("list", { name: "Companies" });
    expect(within(list).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Massive DynamicClosed",
      "Wayne EnterprisesCancelled",
    ]);
    expect(screen.getByRole("link", { name: "Create a company" })).toHaveClass("primary-button");
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
    // A company that has never opened continues in this card (TAS-501, §3).
    expect(go).toHaveBeenCalledWith("/c/g/projects", { state: { continuedShell: true } });
  });
});
