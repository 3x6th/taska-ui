import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { Tenant } from "../api/tenants";
import { TENANT_CREATION_KEY } from "../api/tenantCreation";
import { TENANTS_QUERY_KEY } from "../lib/companies";
import { companiesHarness } from "../test/companiesHarness";
import { CompanySetupScreen } from "./CompanySetupScreen";

/*
 * DESIGN.md §4.37 «Компания до открытия» (TAS-501) against a fake API: the
 * words of each state, the owner's Cancel creation behind its question, the
 * provisioning read that hands the address to the shell, and the closed
 * creation's new attempt.
 */

const ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    tenant: null as unknown,
    operation: null as unknown,
    reads: [] as string[],
    cancel: null as null | (() => Promise<unknown>),
    cancels: [] as unknown[][],
    me: "tom",
  };
  const api = {
    getCurrentUser: async () => ({ id: state.me, email: `${state.me}@example.com`, displayName: state.me, status: "ACTIVE" }),
    listTenants: async () => {
      state.reads.push("list");
      return { items: state.tenant ? [state.tenant] : [], nextCursor: null };
    },
    getTenant: async () => {
      state.reads.push("tenant");
      return state.tenant;
    },
    getTenantOperation: async () => {
      state.reads.push("operation");
      return state.operation;
    },
    cancelTenantCreation: (...args: unknown[]) => {
      state.cancels.push(args);
      return state.cancel ? state.cancel() : new Promise(() => {});
    },
    listBillingPlans: async () => ({ items: [], nextCursor: null }),
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const tenant = (overrides: Partial<Tenant> = {}): Tenant => ({
  id: ID,
  name: "Stark Industries",
  ownerId: "tom",
  lifecycle: "AWAITING_PAYMENT",
  restrictions: ["PENDING_FIRST_PAYMENT"],
  createdAt: "2026-10-15T09:00:00Z",
  creationDeadline: "2099-12-04T14:32:00Z",
  version: "3",
  ...overrides,
});

const refusal = (status: number, code: string) =>
  Object.assign(new Error("server words"), { status, code, requestId: `rid-${code}`, details: null, reasons: [] });

beforeEach(() => {
  window.sessionStorage.clear();
  state.tenant = tenant();
  state.operation = null;
  state.reads = [];
  state.cancel = null;
  state.cancels = [];
  state.me = "tom";
});

function renderCard(
  options: { row?: Tenant | null; session?: "open" | "entering" | "none"; routeState?: unknown; mayOpen?: boolean } = {},
) {
  const harness = companiesHarness({ companyId: ID, path: "/projects", state: options.routeState });
  const onOpened = vi.fn();
  const view = render(
    <CompanySetupScreen
      companyId={ID}
      mayOpen={options.mayOpen}
      onOpened={onOpened}
      pending={null}
      row={options.row === undefined ? tenant() : options.row}
      session={options.session ?? "open"}
      theme="light"
      toggleTheme={() => {}}
    />,
    { wrapper: harness.wrapper },
  );
  return { ...harness, onOpened, unmount: view.unmount };
}

const RECORD = { v: 1, userId: "tom", key: "k", name: "Acme", planVersionId: "p", sentAt: "x", tenantId: ID, operationId: "op-1" };

describe("awaiting the first payment", () => {
  it("reads the company on arrival, dates the deadline as sent, and opens nothing", async () => {
    renderCard();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Stark IndustriesAwaiting first payment");
    // The first screen of a tab takes no focus.
    expect(heading).not.toHaveFocus();
    await waitFor(() => expect(state.reads).toContain("tenant"));
    const time = document.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2099-12-04T14:32:00Z");
    expect(time?.parentElement?.textContent).toMatch(/^Its projects and invitations open once the first payment is confirmed\. If it isn’t paid by Dec 4, 2099, \d\d:32, it closes automatically\.$/);
    expect(screen.getByText("This version of Taska can’t take payments yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All companies" })).toHaveAttribute("href", "/companies");
  });

  it("the owner cancels behind §4.22's strip — «Keep it» first, Esc closes it — and the card follows the answer", async () => {
    state.cancel = () => Promise.resolve(tenant({ lifecycle: "OWNER_CANCELLED", version: "4" }));
    const { client } = renderCard({ routeState: { continuedShell: true } });
    const heading = screen.getByRole("heading", { level: 1 });
    // Arrived from inside the app: the heading takes focus.
    expect(heading).toHaveFocus();
    const trigger = await screen.findByRole("button", { name: "Cancel creation" });
    expect(screen.getByText("Cancelling closes this company before it opens.")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("This company will be cancelled and can’t be reopened.")).toBeInTheDocument();
    const keep = screen.getByRole("button", { name: "Keep it" });
    expect(keep).toHaveFocus();
    fireEvent.keyDown(keep, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Keep it" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    const strip = document.querySelector(".company-cancel-confirm") as HTMLElement;
    fireEvent.click(within(strip).getByRole("button", { name: "Cancel creation" }));
    await waitFor(() => expect(heading).toHaveTextContent("Stark IndustriesCancelled"));
    expect(state.cancels).toHaveLength(1);
    const [id, version, key] = state.cancels[0] as string[];
    expect([id, version]).toEqual([ID, "3"]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(heading).toHaveFocus();
    expect(screen.getByText("It was cancelled before its first payment, so it never opened.")).toBeInTheDocument();
    expect(client.getQueryData<Tenant[]>(TENANTS_QUERY_KEY)?.[0]).toMatchObject({ lifecycle: "OWNER_CANCELLED" });
    // The new attempt starts from here, and comes back here on Cancel.
    expect(screen.getByRole("link", { name: "Create a company" })).toHaveAttribute("href", "/companies/new");
  });

  it("a refused cancel closes the strip onto its trigger, says why, and reads the company again", async () => {
    state.cancel = () => Promise.reject(refusal(412, "VERSION_CONFLICT"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel creation" }));
    const reads = state.reads.length;
    fireEvent.click(within(document.querySelector(".company-cancel-confirm") as HTMLElement).getByRole("button", { name: "Cancel creation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This company changed while you were deciding, so it was not cancelled. Check it and try again.",
    );
    expect(screen.getByText("rid-VERSION_CONFLICT")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep it" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel creation" })).toHaveFocus();
    await waitFor(() => expect(state.reads.length).toBeGreaterThan(reads));
  });

  it("offers Cancel creation only with the company's session — without it the request would be refused (release-reviewer N1)", async () => {
    renderCard({ session: "none" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stark IndustriesAwaiting first payment");
    await waitFor(() => expect(state.reads).toContain("list"));
    expect(screen.queryByRole("button", { name: "Cancel creation" })).not.toBeInTheDocument();
    expect(state.reads).not.toContain("tenant");
  });

  it("an unknown cancel outcome keeps the request: the next press repeats its key and version; a definitive one ends it", async () => {
    let answers = [() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.reject(refusal(409, "PAYMENT_PENDING"))];
    state.cancel = () => (answers.shift() ?? (() => new Promise(() => {})))();
    renderCard();
    const press = async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Cancel creation" }));
      fireEvent.click(within(document.querySelector(".company-cancel-confirm") as HTMLElement).getByRole("button", { name: "Cancel creation" }));
    };
    await press();
    expect(await screen.findByRole("alert")).toHaveTextContent("This company was not cancelled.");
    // Meanwhile the company moved on a version; the repeat is the request first sent.
    state.tenant = tenant({ version: "4" });
    await waitFor(() => expect(state.reads.filter((read) => read === "tenant").length).toBeGreaterThan(1));
    await press();
    expect(await screen.findByRole("alert")).toHaveTextContent("This company can’t be cancelled while a payment is being processed.");
    await press();
    await waitFor(() => expect(state.cancels).toHaveLength(3));
    const [first, second, third] = state.cancels as string[][];
    expect(second).toEqual(first);
    expect(first[1]).toBe("3");
    expect(third[2]).not.toBe(first[2]);
    expect(third[1]).toBe("4");
    answers = [];
  });

  it("is the owner's alone: a member sees no Cancel creation", async () => {
    state.me = "sofia";
    renderCard();
    await waitFor(() => expect(state.reads).toContain("tenant"));
    expect(screen.queryByRole("button", { name: "Cancel creation" })).not.toBeInTheDocument();
  });
});

describe("being set up", () => {
  it("polls the creation's operation from 1 s on, reads the company at its end, and hands the address to the shell", async () => {
    window.sessionStorage.setItem(
      TENANT_CREATION_KEY,
      JSON.stringify({ v: 1, userId: "tom", key: "k", name: "Acme", planVersionId: "p", sentAt: "x", tenantId: ID, operationId: "op-1" }),
    );
    const provisioning = tenant({ name: "Acme", lifecycle: "PROVISIONING", restrictions: [], creationDeadline: null });
    state.tenant = provisioning;
    state.operation = { id: "op-1", type: "TENANT_PROVISION", state: "SUCCEEDED", createdAt: "x", updatedAt: "y", tenantId: ID };
    const { onOpened } = renderCard({ row: provisioning });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AcmeBeing set up");
    expect(screen.getByRole("status")).toHaveTextContent("Taska is setting it up. This page opens it when it’s ready.");
    // Not before the first tick.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.reads.filter((read) => read === "operation")).toHaveLength(0);
    state.tenant = tenant({ name: "Acme", lifecycle: "ACTIVE", restrictions: [], creationDeadline: null });
    await waitFor(() => expect(onOpened).toHaveBeenCalled(), { timeout: 3000 });
    expect(state.reads.filter((read) => read === "operation")).toHaveLength(1);
    expect(window.sessionStorage.getItem(TENANT_CREATION_KEY)).toBeNull();
  });

  it("a failed setup says so with the failure code and the operation's id — never a working company", async () => {
    window.sessionStorage.setItem(
      TENANT_CREATION_KEY,
      JSON.stringify({ v: 1, userId: "tom", key: "k", name: "Acme", planVersionId: "p", sentAt: "x", tenantId: ID, operationId: "op-1" }),
    );
    const provisioning = tenant({ name: "Acme", lifecycle: "PROVISIONING", restrictions: [], creationDeadline: null });
    state.tenant = provisioning;
    state.operation = { id: "op-1", type: "TENANT_PROVISION", state: "FAILED", createdAt: "x", updatedAt: "y", failureCode: "DEPENDENCY_UNAVAILABLE" };
    const { onOpened } = renderCard({ row: provisioning });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AcmeSetup failed"), { timeout: 3000 });
    expect(screen.getByText("Taska couldn’t set up this company.")).toBeInTheDocument();
    expect(screen.getByText("DEPENDENCY_UNAVAILABLE · operation op-1")).toBeInTheDocument();
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("a failed setup is not forgotten: the record stays while it is PROVISIONING, and a reload reads the operation again (release-reviewer N2)", async () => {
    window.sessionStorage.setItem(TENANT_CREATION_KEY, JSON.stringify(RECORD));
    const provisioning = tenant({ name: "Acme", lifecycle: "PROVISIONING", restrictions: [], creationDeadline: null });
    state.tenant = provisioning;
    state.operation = { id: "op-1", type: "TENANT_PROVISION", state: "FAILED", createdAt: "x", updatedAt: "y", failureCode: "DEPENDENCY_UNAVAILABLE" };
    const first = renderCard({ row: provisioning });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AcmeSetup failed"), { timeout: 3000 });
    // The company was read again after the end of the operation, and is still PROVISIONING.
    await waitFor(() => expect(state.reads.filter((read) => read === "tenant").length).toBeGreaterThan(1));
    expect(JSON.parse(window.sessionStorage.getItem(TENANT_CREATION_KEY) as string)).toMatchObject({ operationId: "op-1" });
    first.unmount();
    // A reload: the operation is read again, and the card says what it said.
    state.reads = [];
    renderCard({ row: provisioning });
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AcmeSetup failed"), { timeout: 3000 });
    expect(state.reads).toContain("operation");
  });
});

describe("after a hand-over that bounced", () => {
  it("never prints a raw state such as «ACTIVE» on the card (release-reviewer)", async () => {
    state.tenant = tenant({ lifecycle: "ACTIVE", restrictions: [], creationDeadline: null });
    const { onOpened } = renderCard({ mayOpen: false });
    await waitFor(() => expect(state.reads).toContain("tenant"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Stark Industries$/));
    expect(onOpened).not.toHaveBeenCalled();
  });
});

describe("a closed creation", () => {
  it("without a session the list is read again on arrival; the text never denies reopening; a new attempt starts empty", async () => {
    const closed = tenant({ lifecycle: "AUTO_CLOSED", creationDeadline: "2026-06-05T09:00:00Z" });
    state.tenant = closed;
    const { go } = renderCard({ row: closed, session: "none" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stark IndustriesClosed");
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-06-05T09:00:00Z");
    expect(document.querySelector("time")?.parentElement?.textContent).toMatch(
      /^Its first payment wasn’t confirmed by Jun \d, (2026, )?\d\d:\d\d, so it closed without opening\. If it was paid in time, it reopens once Taska confirms the payment\.$/,
    );
    expect(screen.queryByText(/can no longer/)).not.toBeInTheDocument();
    await waitFor(() => expect(state.reads).toContain("list"));
    expect(state.reads).not.toContain("tenant");
    // A return to the tab fires visibilitychange and focus: one read of the list, not two.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const before = state.reads.filter((read) => read === "list").length;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(state.reads.filter((read) => read === "list").length).toBe(before + 1);
    const create = screen.getByRole("link", { name: "Create a company" });
    expect(create).toHaveClass("primary-button");
    fireEvent.click(create);
    expect(go).toHaveBeenCalledWith("/companies/new", { state: { from: `/c/${ID}/projects`, continuedShell: true } });
  });
});
