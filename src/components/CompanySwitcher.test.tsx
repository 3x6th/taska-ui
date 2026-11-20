import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import { companiesHarness } from "../test/companiesHarness";
import { CompanySwitcher } from "./CompanySwitcher";

/* DESIGN.md §4.34 (TAS-500): the trigger, the first group's rows, a write in flight, and «Manage company» (TAS-522). */

const { fakeApi, state } = vi.hoisted(() => {
  const state = { tenants: [] as unknown[], listFails: false };
  const api = {
    listTenants: async () => {
      if (state.listFails) throw Object.assign(new Error("Unavailable"), { status: 503, code: "DEPENDENCY_UNAVAILABLE", requestId: "rid-list" });
      return { items: state.tenants, nextCursor: null };
    },
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
  state.listFails = false;
  state.tenants = [
    tenant("n", "Northwind"),
    tenant("g", "Globex"),
    tenant("i", "Initech", "ACTIVE", ["OWNER_PAUSE"]),
    tenant("m", "Massive Dynamic", "AUTO_CLOSED"),
  ];
});

describe("the state marker (TAS-512, §4.34)", () => {
  it("a paused, blocked or read-only company carries one word after its name and in its accessible name; nothing is disabled", async () => {
    for (const [restrictions, word] of [
      [["OWNER_PAUSE"], "paused"],
      [["PLATFORM_BLOCK", "OWNER_PAUSE"], "blocked"],
      [["OVER_QUOTA"], "read-only"],
    ] as const) {
      state.tenants = [tenant("n", "Northwind", "ACTIVE", [...restrictions]), tenant("g", "Globex", "ACTIVE", ["PAYMENT_EXPIRED"])];
      const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
      const { unmount } = render(<CompanySwitcher />, { wrapper });
      const trigger = await screen.findByRole("button", { name: `Northwind, ${word}, switch company` });
      expect(trigger).not.toBeDisabled();
      expect(trigger.querySelector(".company-marker")).toHaveTextContent(word);
      fireEvent.click(trigger);
      // The other company's row: §4.34's one right slot, «Read-only» for any financial one.
      expect(within(screen.getByRole("dialog", { name: "Companies" })).getByRole("link", { name: /^Globex/ })).toHaveTextContent("GlobexRead-only");
      unmount();
    }
  });

  it("the company as the tab last read it wins over an older list row; an unknown code gives none", async () => {
    state.tenants = [tenant("n", "Northwind", "ACTIVE", ["MYSTERY"])];
    const { wrapper, client } = companiesHarness({ companyId: "n", path: "/projects" });
    render(<CompanySwitcher />, { wrapper });
    expect(await screen.findByRole("button", { name: "Northwind, switch company" })).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(["tenants"])).toBeTruthy());
    client.setQueryData(["tenant", "n"], { ...tenant("n", "Northwind", "ACTIVE", ["PAYMENT_DISPUTE"]), creationDeadline: null, ownerId: "o" });
    expect(await screen.findByRole("button", { name: "Northwind, read-only, switch company" })).toBeInTheDocument();
  });
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
    expect(rows.map((row) => row.textContent)).toEqual([
      "Globex",
      "InitechPaused",
      "Northwind",
      "Manage company",
      "All companies",
      "Create a company",
    ]);
    expect(rows[2]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveAttribute("href", "/c/g/projects");
    expect(rows[3]).toHaveAttribute("href", "/company");
    expect(rows[4]).toHaveAttribute("href", "/companies");
    expect(rows[5]).toHaveAttribute("href", "/companies/new");
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

/** Where the router is, and whether the entry asked for the heading's focus. */
function Whereabouts() {
  const location = useLocation();
  const asked = (location.state as { focusHeading?: unknown } | null)?.focusHeading === true;
  return <p data-testid="whereabouts">{`${location.pathname}${asked ? " · focus the heading" : ""}`}</p>;
}

describe("«Manage company» (TAS-522, §4.34)", () => {
  const openPopover = async () => {
    // The trigger is disabled until the tab's company is named (§4.34).
    fireEvent.click(await screen.findByRole("button", { name: "Northwind, switch company" }));
    return screen.getByRole("dialog", { name: "Companies" });
  };
  const manage = (dialog: HTMLElement) => within(dialog).getByRole("link", { name: "Manage company" });

  it("is the footer's first row, above All companies: Settings2, a router link to the tab's zone, for any role", async () => {
    // Anna owns none of these: the row is every member's (§5.10 «Доступ»).
    const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
    render(<CompanySwitcher />, { wrapper });
    const dialog = await openPopover();
    const footer = dialog.querySelector(".company-switcher-footer") as HTMLElement;
    expect(within(footer).getAllByRole("link").map((link) => link.textContent)).toEqual(["Manage company", "All companies", "Create a company"]);
    const link = manage(dialog);
    expect(link).toHaveClass("user-profile-link");
    expect(link).toHaveAttribute("href", "/company");
    expect(link).not.toHaveAttribute("aria-current");
    const icon = link.querySelector("svg");
    expect(icon).toHaveClass("lucide-settings-2");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("is the current page on /company and anywhere inside it, and nowhere else", async () => {
    for (const [path, current] of [
      ["/company", true],
      ["/company/general", true],
      ["/company/plan", true],
      ["/settings/profile", false],
      ["/projects", false],
    ] as const) {
      const { wrapper } = companiesHarness({ companyId: "n", path });
      const view = render(<CompanySwitcher />, { wrapper });
      const link = manage(await openPopover());
      if (current) expect(link).toHaveAttribute("aria-current", "page");
      else expect(link).not.toHaveAttribute("aria-current");
      view.unmount();
    }
  });

  it("a plain click closes the popover in the same frame and pushes the zone asking for its heading — not `go`, not the trigger", async () => {
    const { wrapper, go } = companiesHarness({ companyId: "n", path: "/projects" });
    render(
      <>
        <CompanySwitcher />
        <Whereabouts />
      </>,
      { wrapper },
    );
    const dialog = await openPopover();
    fireEvent.click(manage(dialog));
    expect(screen.queryByRole("dialog", { name: "Companies" })).not.toBeInTheDocument();
    expect(screen.getByTestId("whereabouts")).toHaveTextContent("/company · focus the heading");
    expect(go).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Northwind, switch company" })).not.toHaveFocus();
  });

  it("a modified click leaves this tab where it is and the popover open, for the new tab to take (§4.16)", async () => {
    const { wrapper, go } = companiesHarness({ companyId: "n", path: "/projects" });
    render(
      <>
        <CompanySwitcher />
        <Whereabouts />
      </>,
      { wrapper },
    );
    const dialog = await openPopover();
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
      fireEvent.click(manage(dialog), modifier);
      expect(screen.getByRole("dialog", { name: "Companies" })).toBeInTheDocument();
      expect(screen.getByTestId("whereabouts")).toHaveTextContent(/^\/projects$/);
    }
    expect(go).not.toHaveBeenCalled();
  });

  it("does not change while this tab writes: it stays in the company (§4.34)", async () => {
    const { wrapper, client } = companiesHarness({ companyId: "n", path: "/projects" });
    render(
      <>
        <CompanySwitcher />
        <Whereabouts />
      </>,
      { wrapper },
    );
    void client.getMutationCache().build(client, { mutationFn: () => new Promise(() => {}) }).execute(undefined);
    const dialog = await openPopover();
    await waitFor(() => expect(within(dialog).getByRole("link", { name: "Globex" })).toHaveAttribute("aria-disabled", "true"));
    const link = manage(dialog);
    expect(link).not.toHaveAttribute("aria-disabled");
    expect(link).toHaveAttribute("href", "/company");
    fireEvent.click(link);
    expect(screen.getByTestId("whereabouts")).toHaveTextContent("/company · focus the heading");
  });

  it("is drawn when the list of companies could not be read — it needs nothing of the list", async () => {
    state.listFails = true;
    const { wrapper } = companiesHarness({ companyId: "n", path: "/projects" });
    render(<CompanySwitcher />, { wrapper });
    const trigger = screen.getByRole("button", { name: "Company, switch company" });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Companies" });
    expect(within(dialog).getByText("Your companies could not be loaded.")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("link").map((link) => link.textContent)).toEqual(["Manage company", "All companies", "Create a company"]);
    expect(manage(dialog)).toHaveAttribute("href", "/company");
  });
});
