import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { companiesHarness } from "../test/companiesHarness";
import { CompanySwitcher } from "./CompanySwitcher";

/* DESIGN.md §4.34 (TAS-500): the trigger, the first group's rows, and a write in flight. */

const { fakeApi, state } = vi.hoisted(() => {
  const state = { tenants: [] as unknown[] };
  const api = {
    listTenants: async () => ({ items: state.tenants, nextCursor: null }),
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
    listBillingPlans: async () => ({ items: [], nextCursor: null }),
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (id: string, name: string, lifecycle = "ACTIVE", restrictions: string[] = []) => ({
  id,
  name,
  ownerId: "o",
  lifecycle,
  restrictions,
  createdAt: "2026-05-01T09:00:00Z",
  version: "1",
});

beforeEach(() => {
  state.tenants = [
    tenant("n", "Northwind"),
    tenant("g", "Globex"),
    tenant("i", "Initech", "ACTIVE", ["OWNER_PAUSE"]),
    tenant("m", "Massive Dynamic", "AUTO_CLOSED"),
  ];
});

describe("the company switcher", () => {
  it("names the tab's company and lists the first group, current one marked, with one state word", async () => {
    const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
    render(<CompanySwitcher />, { wrapper });
    const trigger = await screen.findByRole("button", { name: "Northwind, switch company" });
    expect(trigger).toHaveAttribute("title", "Northwind");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Companies" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const rows = within(dialog).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual(["Globex", "InitechPaused", "Northwind", "All companies", "Create a company"]);
    expect(rows[2]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveAttribute("href", "/c/g/projects");
    expect(rows[3]).toHaveAttribute("href", "/companies");
    expect(rows[4]).toHaveAttribute("href", "/companies/new");
  });

  it("«Create a company» under «All companies» carries the tab's address, and a write in flight does not hold it (TAS-501)", async () => {
    const { wrapper, go, client } = companiesHarness({ companyId: "n", path: "/projects/p1/board" });
    render(<CompanySwitcher />, { wrapper });
    void client.getMutationCache().build(client, { mutationFn: () => new Promise(() => {}) }).execute(undefined);
    fireEvent.click(await screen.findByRole("button", { name: "Northwind, switch company" }));
    const create = within(screen.getByRole("dialog", { name: "Companies" })).getByRole("link", { name: "Create a company" });
    expect(create).not.toHaveAttribute("aria-disabled");
    fireEvent.click(create);
    expect(go).toHaveBeenCalledWith("/companies/new", { state: { from: "/c/n/projects/p1/board" } });
  });

  it("switches by the address on a plain click and closes; keeps the other companies waiting while this tab writes", async () => {
    const { wrapper, go, client } = companiesHarness({ companyId: "n", path: "/projects" });
    render(<CompanySwitcher />, { wrapper });
    fireEvent.click(await screen.findByRole("button", { name: "Northwind, switch company" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Companies" })).getByRole("link", { name: "Globex" }));
    expect(go).toHaveBeenCalledWith("/c/g/projects", { state: undefined });
    expect(screen.queryByRole("dialog", { name: "Companies" })).not.toBeInTheDocument();

    // A write in flight in this tab.
    void client.getMutationCache().build(client, { mutationFn: () => new Promise(() => {}) }).execute(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Northwind, switch company" }));
    const dialog = await screen.findByRole("dialog", { name: "Companies" });
    expect(within(dialog).getByRole("link", { name: "Globex" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("link", { name: "Initech" })).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByRole("link", { name: "Northwind" })).not.toHaveAttribute("aria-disabled");
    go.mockClear();
    fireEvent.click(within(dialog).getByRole("link", { name: "Globex" }));
    expect(go).not.toHaveBeenCalled();
  });

  it("draws a skeleton while the name is not known, and «Company» when the list could not be read", async () => {
    state.tenants = [];
    const { wrapper } = companiesHarness({ companyId: "unknown", path: "/projects" });
    render(<CompanySwitcher />, { wrapper });
    const trigger = screen.getByRole("button", { name: "Company, switch company" });
    expect(trigger).toBeDisabled();
    expect(trigger.querySelector(".value-skeleton")).not.toBeNull();
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveTextContent("Company");
    expect(trigger.querySelector(".company-switcher-name.is-unknown")).not.toBeNull();
  });
});
