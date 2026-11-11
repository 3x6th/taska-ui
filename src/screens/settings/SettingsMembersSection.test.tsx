import { notifyManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import type { Invitation, Membership } from "../../api/tenantMembers";
import { CompanyGate } from "../../components/CompanyGate";
import { companiesHarness } from "../../test/companiesHarness";
import { SettingsMembersSection } from "./SettingsMembersSection";

/*
 * Settings › Members (DESIGN.md §4.38, TAS-502) against a fake API: controls
 * gated by the reader's own row (api-contract-guard B3, B8; art-director B5),
 * no optimism (B2, art-director B7), the reader's own change re-entering the
 * company (ruling 3), refusals by Problem.code, and the strips' true sentences
 * (art-director B6).
 */

const COMPANY = "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04";

const { fakeApi, state } = vi.hoisted(() => {
  const state = {
    me: "tom",
    members: [] as unknown[],
    invitations: [] as unknown[],
    calls: [] as string[],
    writes: [] as unknown[][],
    role: null as null | ((...args: unknown[]) => Promise<unknown>),
    membersRead: null as null | (() => Promise<unknown>),
    reentered: 0,
    meRead: null as null | (() => Promise<unknown>),
    leave: [] as Array<() => Promise<unknown>>,
    leaveKeys: [] as string[],
    removal: null as null | (() => Promise<unknown>),
    operation: [] as Array<() => Promise<unknown>>,
    operationAt: [] as number[],
    invitationsAt: [] as number[],
    quotasAt: [] as number[],
  };
  const api = {
    getCurrentUser: async () =>
      state.meRead
        ? state.meRead()
        : { id: state.me, email: `${state.me}@example.com`, displayName: state.me, status: "ACTIVE", color: "#f59e0b" },
    listTenants: async () => ({
      items: [{ id: "0b6f3c1e-4a2d-4e8b-9c7f-1d2e3f4a5b04", name: "Umbrella", ownerId: "tom", lifecycle: "ACTIVE", restrictions: [], createdAt: null, creationDeadline: null, version: "1" }],
      nextCursor: null,
    }),
    currentWorkspace: () => null,
    onWorkspaceChange: () => () => {},
    listTenantMembers: async () => {
      state.calls.push("members");
      if (state.membersRead) return state.membersRead();
      return { items: state.members, nextCursor: null };
    },
    listTenantInvitations: async () => {
      state.calls.push("invitations");
      state.invitationsAt.push(Date.now());
      return { items: state.invitations, nextCursor: null };
    },
    getTenantQuotas: async () => {
      state.calls.push("quotas");
      state.quotasAt.push(Date.now());
      return { tenantId: null, version: "1", quotas: [{ kind: "SEAT", used: "3", reserved: "1", limit: "50", unlimited: false }], asOf: null };
    },
    setTenantMemberRole: (...args: unknown[]) => {
      state.writes.push(["role", ...args]);
      return state.role ? state.role(...args) : Promise.resolve({});
    },
    setTenantMemberState: (...args: unknown[]) => {
      state.writes.push(["state", ...args]);
      return Promise.resolve({});
    },
    reenterCompany: async () => {
      state.reentered += 1;
    },
    leaveTenant: (_tenantId: string, key: string) => {
      state.leaveKeys.push(key);
      const next = state.leave.shift();
      return next ? next() : Promise.resolve({ id: "op-leave", state: "SUCCEEDED" });
    },
    removeTenantMember: (...args: unknown[]) => {
      state.writes.push(["remove", ...args]);
      return state.removal ? state.removal() : Promise.resolve({ id: "op-1", state: "SUCCEEDED" });
    },
    getTenantOperation: () => {
      state.operationAt.push(Date.now());
      const next = state.operation.shift();
      return next ? next() : Promise.resolve({ id: "op-1", state: "RUNNING" });
    },
    listProjects: async () => [],
  };
  return { fakeApi: api as unknown as TaskaApi, state };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const member = (userId: string, name: string, overrides: Partial<Membership> = {}): Membership => ({
  id: `m-${userId}`,
  tenantId: COMPANY,
  userId,
  role: "MEMBER",
  state: "ACTIVE",
  isOwner: false,
  displayName: name,
  email: `${userId}@example.com`,
  avatarPath: null,
  version: "1",
  deleted: false,
  ...overrides,
});

const umbrella = () => [
  member("tom", "Tom Becker", { role: "TENANT_ADMIN", isOwner: true }),
  member("priya", "Priya Nair", { role: "TENANT_ADMIN", version: "3" }),
  member("anna", "Anna Ivanova", { state: "SUSPENDED", version: "2" }),
  member("sofia", "Sofia Reyes"),
];

const lena: Invitation = {
  id: "inv-lena",
  tenantId: COMPANY,
  email: "lena@example.com",
  role: "MEMBER",
  state: "PENDING",
  expiresAt: "2099-11-12T10:00:00Z",
  createdBy: "priya",
  projectGrants: [],
  version: "1",
};

const refusal = (status: number, code: string) =>
  Object.assign(new Error("server words"), { status, code, requestId: `rid-${code}`, details: null, reasons: [] });

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** The section under the area's heading, which several hand-overs put focus on. */
function renderSection() {
  const harness = companiesHarness({ companyId: COMPANY, path: "/settings/members" });
  render(
    <div className="settings-area">
      <h1 className="area-section-title" tabIndex={-1}>
        Members
      </h1>
      <SettingsMembersSection />
    </div>,
    { wrapper: harness.wrapper },
  );
  return harness;
}

const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const status = () =>
  [...document.querySelectorAll('.company-members > [role="status"]')].map((node) => node.textContent ?? "").join("");

beforeEach(() => {
  state.me = "tom";
  state.members = umbrella();
  state.invitations = [lena];
  state.calls = [];
  state.writes = [];
  state.role = null;
  state.membersRead = null;
  state.reentered = 0;
  state.meRead = null;
  state.leave = [];
  state.leaveKeys = [];
  state.removal = null;
  state.operation = [];
  state.operationAt = [];
  state.invitationsAt = [];
  state.quotasAt = [];
});

afterEach(() => {
  vi.useRealTimers();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  Reflect.deleteProperty(document, "hidden");
});

describe("gating by the reader's own row (B8)", () => {
  it("a member sees the directory with role words only — no invitations read, no seats read, no controls", async () => {
    state.me = "sofia";
    renderSection();
    expect(await screen.findByText("Everyone in Umbrella. Only its admins can invite people or change members.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite a member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Suspend|Reactivate|Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Pending invitations")).not.toBeInTheDocument();
    expect(screen.queryByText(/seats in use/)).not.toBeInTheDocument();
    expect(within(rowOf("Tom Becker")).getByText("Owner")).toBeInTheDocument();
    // The empty slots are not drawn for a reader without controls.
    expect(rowOf("Priya Nair").querySelector(".company-member-action")).toBeNull();
    expect(screen.getByRole("button", { name: "Leave company" })).toBeInTheDocument();
    expect(state.calls).toEqual(["members"]);
  });

  it("an admin: the owner's row offers nothing, a suspended row its role as a word, Reactivate and Remove; invitations and seats are read", async () => {
    renderSection();
    expect(await screen.findByText("Everyone in Umbrella, and the people invited to join.")).toBeInTheDocument();
    const owner = rowOf("Tom Becker");
    expect(within(owner).queryByRole("combobox")).toBeNull();
    expect(within(owner).queryAllByRole("button")).toEqual([]);
    expect(within(owner).getByText("Owner")).toBeInTheDocument();
    expect(owner.querySelector(".company-member-action")).toHaveAttribute("aria-hidden", "true");
    const suspended = rowOf("Anna Ivanova");
    expect(within(suspended).queryByRole("combobox")).toBeNull();
    expect(within(suspended).getByRole("button", { name: "Reactivate Anna Ivanova" })).toBeInTheDocument();
    expect(within(suspended).getByRole("button", { name: "Remove Anna Ivanova from Umbrella" })).toBeInTheDocument();
    expect(within(suspended).getByText("Suspended")).toBeInTheDocument();
    expect(within(rowOf("Priya Nair")).getByRole("combobox", { name: "Role of Priya Nair" })).toHaveValue("TENANT_ADMIN");
    expect(await screen.findByText("4 of 50 seats in use · 1 held by an invitation")).toBeInTheDocument();
    expect(screen.getByText("lena@example.com")).toBeInTheDocument();
    expect(screen.getByText("You own Umbrella, so you can’t leave it.")).toBeInTheDocument();
    expect(state.calls).toEqual(expect.arrayContaining(["members", "invitations", "quotas"]));
  });

  it("an admin's own row offers the role only, and no admin count is ever taken", async () => {
    state.me = "priya";
    renderSection();
    const own = await screen.findByText("Priya Nair");
    const row = own.closest("li") as HTMLElement;
    expect(within(row).getByText("(you)")).toBeInTheDocument();
    expect(within(row).getByRole("combobox", { name: "Role of Priya Nair" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Suspend|Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Leave company" })).toBeInTheDocument();
  });

  it("without the reader's own row nothing is offered, and one line says why", async () => {
    state.me = "stranger";
    renderSection();
    expect(await screen.findByText("Taska couldn’t check what you can change here, so changes aren’t offered.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(state.calls).toEqual(["members"]);
  });
});

/**
 * A deleted account's membership (TAS-529, art-director §5 and B6,
 * api-contract-guard N1): drawn as the server listed it, as «Deleted user» on
 * the neutral circle, with nothing to act on and never an address, after
 * every named row — and the invitation it sent says «a deleted user».
 */
describe("a deleted account's row", () => {
  it("is «Deleted user» with its role word only, after every other member; «Suspended» alone when suspended", async () => {
    state.members = [
      member("zz-gone", "ignored", { displayName: null, email: null, deleted: true }),
      ...umbrella(),
      member("aa-gone", "ignored", { displayName: null, email: null, deleted: true, state: "SUSPENDED", role: "TENANT_ADMIN" }),
    ];
    state.invitations = [{ ...lena, createdBy: "zz-gone" }];
    renderSection();
    expect(await screen.findByText("Everyone in Umbrella, and the people invited to join.")).toBeInTheDocument();

    const keys = [...document.querySelectorAll(".company-member-row:not(.is-invitation)")].map((row) => row.getAttribute("data-row-key"));
    expect(keys.slice(-2)).toEqual(["member:aa-gone", "member:zz-gone"]);
    for (const userId of ["aa-gone", "zz-gone"]) {
      const row = document.querySelector(`[data-row-key="member:${userId}"]`) as HTMLElement;
      const name = row.querySelector(".company-member-name") as HTMLElement;
      expect(name).toHaveTextContent(/^Deleted user$/);
      expect(name).toHaveClass("person-deleted");
      expect(name).toHaveAttribute("title", "Deleted user");
      const circle = row.querySelector(".avatar") as HTMLElement;
      expect(circle).toHaveClass("avatar-deleted");
      expect(circle).toHaveAttribute("title", "Deleted user");
      expect(circle.getAttribute("style")).toBeNull();
      expect(within(row).queryAllByRole("button")).toEqual([]);
      expect(within(row).queryByRole("combobox")).toBeNull();
      expect(row.querySelector(".company-member-action")).toHaveAttribute("aria-hidden", "true");
      expect(row.querySelector(".company-member-destructive")).toHaveAttribute("aria-hidden", "true");
    }
    const active = document.querySelector('[data-row-key="member:zz-gone"]') as HTMLElement;
    expect(active.querySelector(".company-member-line")).toHaveTextContent(/^$/);
    expect(within(active).getByText("Member")).toBeInTheDocument();
    const suspended = document.querySelector('[data-row-key="member:aa-gone"]') as HTMLElement;
    expect(suspended.querySelector(".company-member-line")).toHaveTextContent(/^Suspended$/);
    expect(within(suspended).getByText("Admin")).toBeInTheDocument();

    expect(await screen.findByText(/^Invited by a deleted user · Expires /)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("zz-gone@example.com");
  });
});

describe("no optimism (B2): the row changes only after the server and the re-read", () => {
  it("a promotion is in flight with the requested role shown, and the list is the server's after the re-read", async () => {
    const write = gate<unknown>();
    state.role = () => write.promise;
    renderSection();
    const select = await screen.findByRole("combobox", { name: "Role of Sofia Reyes" });
    fireEvent.change(select, { target: { value: "TENANT_ADMIN" } });
    expect(select).toHaveValue("TENANT_ADMIN");
    expect(select).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(state.writes).toHaveLength(1));
    const [, tenantId, userId, role, version, key] = state.writes[0] as string[];
    expect([tenantId, userId, role, version]).toEqual([COMPANY, "sofia", "TENANT_ADMIN", "1"]);
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    // The answer carries no profile and is never put into the row: the re-read is held.
    const reread = gate<unknown>();
    state.membersRead = () => reread.promise;
    write.resolve({ userId: "sofia", role: "TENANT_ADMIN", version: "2" });
    await waitFor(() => expect(state.calls.filter((call) => call === "members")).toHaveLength(2));
    expect(select).toHaveAttribute("aria-disabled", "true");
    expect(status()).toBe("");
    state.members = umbrella().map((row) => (row.userId === "sofia" ? { ...row, role: "TENANT_ADMIN", version: "2" } : row));
    reread.resolve({ items: state.members, nextCursor: null });
    await waitFor(() => expect(select).not.toHaveAttribute("aria-disabled"));
    expect(select).toHaveValue("TENANT_ADMIN");
    expect(status()).toBe("Sofia Reyes is now an Admin.");
  });

  it("a refusal says the server's answer by its code, returns the select to the server's role and re-reads", async () => {
    state.role = () => Promise.reject(refusal(409, "LAST_ADMIN"));
    renderSection();
    const select = await screen.findByRole("combobox", { name: "Role of Priya Nair" });
    fireEvent.change(select, { target: { value: "MEMBER" } });
    // A demotion asks first; the select holds «Member» while it does.
    expect(select).toHaveValue("MEMBER");
    const strip = document.querySelector(".company-member-confirm") as HTMLElement;
    expect(within(strip).getByText(/Priya Nair will be a Member and keep only the projects they were added to\. The invitation they sent is revoked\./)).toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(strip).getByRole("button", { name: "Make Member" }));
    const note = await waitFor(() => {
      const found = rowOf("Priya Nair").querySelector<HTMLElement>(".error-note");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(note).toHaveTextContent("Priya Nair is the only active admin, so their role did not change.");
    expect(note).toHaveTextContent("rid-LAST_ADMIN");
    // Said once by the section's status; the box itself is not live.
    expect(status()).toBe("Priya Nair is the only active admin, so their role did not change.");
    expect(select).toHaveValue("TENANT_ADMIN");
    expect(select).toHaveFocus();
    expect(document.querySelector(".company-member-confirm")).toBeNull();
    await waitFor(() => expect(state.calls.filter((call) => call === "members").length).toBeGreaterThanOrEqual(2));
  });

  it("Esc closes the strip and gives the role back; an answer that never came is retried with the same key", async () => {
    let attempts = 0;
    state.role = () => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(refusal(503, "DEPENDENCY_UNAVAILABLE")) : Promise.resolve({});
    };
    renderSection();
    const select = await screen.findByRole("combobox", { name: "Role of Priya Nair" });
    fireEvent.change(select, { target: { value: "MEMBER" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Escape" });
    expect(document.querySelector(".company-member-confirm")).toBeNull();
    expect(select).toHaveValue("TENANT_ADMIN");
    expect(select).toHaveFocus();
    expect(state.writes).toEqual([]);

    const sofia = await screen.findByRole("combobox", { name: "Role of Sofia Reyes" });
    fireEvent.change(sofia, { target: { value: "TENANT_ADMIN" } });
    await waitFor(() =>
      expect(rowOf("Sofia Reyes").querySelector(".error-note")).toHaveTextContent(
        "Taska couldn’t confirm the change. The list shows what Taska has now.",
      ),
    );
    await waitFor(() => expect(sofia).not.toHaveAttribute("aria-disabled"));
    fireEvent.change(sofia, { target: { value: "TENANT_ADMIN" } });
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1][5]).toBe(state.writes[0][5]);
  });

  it("the reader's own demotion asks in the first person and re-enters the company on the 200", async () => {
    state.me = "priya";
    renderSection();
    const select = await screen.findByRole("combobox", { name: "Role of Priya Nair" });
    fireEvent.change(select, { target: { value: "MEMBER" } });
    const strip = document.querySelector(".company-member-confirm") as HTMLElement;
    expect(strip).toHaveTextContent(
      "You’ll be a Member and keep only the projects you were added to. You won’t be able to manage members or make yourself an admin again. The invitation you sent is revoked.",
    );
    fireEvent.click(within(strip).getByRole("button", { name: "Make me a Member" }));
    await waitFor(() => expect(state.reentered).toBe(1));
    // No notice of its own: the new context is the answer.
    expect(status()).not.toMatch(/is now/);
  });

  it("Suspend asks with the true sentence, and Reactivate does not ask", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Suspend Sofia Reyes" }));
    expect(document.querySelector(".company-member-confirm")).toHaveTextContent(
      "Sofia Reyes loses access to Umbrella at once but keeps their seat. If you reactivate them later, they come back as a Member, without their projects.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reactivate Anna Ivanova" }));
    await waitFor(() => expect(state.writes.map((write) => [write[0], write[3]])).toEqual([["state", "ACTIVE"]]));
  });
});

describe("the page waits for the reader's own row (art-director X1)", () => {
  it("with the profile still out and the members answered: the skeleton only — no lead, no groups, no Leave", async () => {
    const me = gate<unknown>();
    state.meRead = () => me.promise;
    renderSection();
    await waitFor(() => expect(state.calls).toContain("members"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Loading members")).toBeInTheDocument();
    expect(document.querySelectorAll(".company-member-skeleton")).toHaveLength(3);
    expect(screen.queryByText(/^Everyone in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn’t check/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave company" })).not.toBeInTheDocument();
    expect(screen.queryByText("Tom Becker")).not.toBeInTheDocument();
    me.resolve({ id: "tom", email: "tom@example.com", displayName: "tom", status: "ACTIVE", color: "#f59e0b" });
    expect(await screen.findByText("Everyone in Umbrella, and the people invited to join.")).toBeInTheDocument();
    expect(screen.queryByText("Loading members")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Members 4" })).toBeInTheDocument();
  });

  it("the reader's own circle wears their colour from /users/me; everybody else's is from their id (X3)", async () => {
    renderSection();
    const own = (await screen.findByText("Tom Becker")).closest("li")?.querySelector(".avatar") as HTMLElement;
    expect(own.style.backgroundColor).toBe("rgb(245, 158, 11)");
    const other = rowOf("Priya Nair").querySelector(".avatar") as HTMLElement;
    expect(other.style.backgroundColor).not.toBe("rgb(245, 158, 11)");
  });

  it("a failed read, then «Try again» that answers: focus to the heading (N-a)", async () => {
    let first = true;
    state.membersRead = () => {
      if (first) {
        first = false;
        return Promise.reject(Object.assign(new Error("server words"), { status: 403, code: "SCOPE_DENIED", requestId: "rid", details: null, reasons: [] }));
      }
      return Promise.resolve({ items: state.members, nextCursor: null });
    };
    renderSection();
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByRole("button", { name: "Leave company" })).not.toBeInTheDocument();
    retry.focus();
    fireEvent.click(retry);
    await screen.findByText("Tom Becker");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveFocus());
  });
});

describe("leaving (api-contract-guard B-1, B6)", () => {
  it("an answer that never came re-reads nothing and says so; the next press goes with the same key, and its «left» lands on the picker", async () => {
    state.me = "sofia";
    state.leave = [() => Promise.reject(new TypeError("Failed to fetch")), () => Promise.resolve(null)];
    const { go } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Leave company" }));
    const strip = document.querySelector(".company-leave-confirm") as HTMLElement;
    const before = state.calls.length;
    fireEvent.click(within(strip).getByRole("button", { name: "Leave company" }));
    await waitFor(() =>
      expect(document.querySelector(".company-leave .error-note")).toHaveTextContent(
        "Taska couldn’t confirm that you left Umbrella. Press Leave company again to check.",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.calls.slice(before)).toEqual([]);
    expect(screen.getByRole("button", { name: "Leave company" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Leave company" }));
    fireEvent.click(within(document.querySelector(".company-leave-confirm") as HTMLElement).getByRole("button", { name: "Leave company" }));
    // `null` is the session layer's «you already left» — the same success (M37).
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(state.leaveKeys).toHaveLength(2);
    expect(state.leaveKeys[1]).toBe(state.leaveKeys[0]);
    expect(go).toHaveBeenCalledWith("/companies", { replace: true, state: { focusHeading: true, left: { name: "Umbrella" } } });
  });

  it("a 401 on the leave is unanswered too: the same key next time, «couldn't confirm», no re-read (release-reviewer N3)", async () => {
    state.me = "sofia";
    state.leave = [
      () => Promise.reject(Object.assign(new Error("w"), { status: 401, code: "TOKEN_REVOKED", requestId: "rid", details: null, reasons: [] })),
      () => Promise.resolve(null),
    ];
    const { go } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Leave company" }));
    const before = state.calls.length;
    fireEvent.click(within(document.querySelector(".company-leave-confirm") as HTMLElement).getByRole("button", { name: "Leave company" }));
    await waitFor(() =>
      expect(document.querySelector(".company-leave .error-note")).toHaveTextContent(
        "Taska couldn’t confirm that you left Umbrella. Press Leave company again to check.",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.calls.slice(before)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Leave company" }));
    fireEvent.click(within(document.querySelector(".company-leave-confirm") as HTMLElement).getByRole("button", { name: "Leave company" }));
    await waitFor(() => expect(go).toHaveBeenCalled());
    expect(state.leaveKeys[1]).toBe(state.leaveKeys[0]);
  });

  it("a definite refusal re-reads and takes a new key next time", async () => {
    state.me = "sofia";
    state.leave = [
      () => Promise.reject(Object.assign(new Error("w"), { status: 409, code: "LAST_ADMIN", requestId: "rid", details: null, reasons: [] })),
    ];
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Leave company" }));
    const before = state.calls.filter((call) => call === "members").length;
    fireEvent.click(within(document.querySelector(".company-leave-confirm") as HTMLElement).getByRole("button", { name: "Leave company" }));
    expect(await screen.findByText("You’re the only active admin, so you didn’t leave Umbrella.", { selector: ".error-note-sentence" })).toBeInTheDocument();
    await waitFor(() => expect(state.calls.filter((call) => call === "members").length).toBeGreaterThan(before));
    fireEvent.click(screen.getByRole("button", { name: "Leave company" }));
    fireEvent.click(within(document.querySelector(".company-leave-confirm") as HTMLElement).getByRole("button", { name: "Leave company" }));
    await waitFor(() => expect(state.leaveKeys).toHaveLength(2));
    expect(state.leaveKeys[1]).not.toBe(state.leaveKeys[0]);
  });
});

describe("a version If-Match cannot carry is re-read, never sent (M38)", () => {
  it("re-reads the list instead of writing", async () => {
    state.members = umbrella().map((row) => (row.userId === "sofia" ? { ...row, version: null } : row));
    renderSection();
    const select = await screen.findByRole("combobox", { name: "Role of Sofia Reyes" });
    const before = state.calls.filter((call) => call === "members").length;
    fireEvent.change(select, { target: { value: "TENANT_ADMIN" } });
    await waitFor(() => expect(state.calls.filter((call) => call === "members").length).toBe(before + 1));
    expect(state.writes).toEqual([]);
  });
});

describe("a removal's operation (§4.38)", () => {
  /** Sofia's removal, stopped on MANUAL_REVIEW with «Check again» — focused, as a reader leaves it before pressing. */
  async function stoppedRemoval() {
    state.removal = () => Promise.resolve({ id: "op-1", state: "MANUAL_REVIEW" });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Sofia Reyes from Umbrella" }));
    fireEvent.click(within(document.querySelector(".company-member-confirm") as HTMLElement).getByRole("button", { name: "Remove" }));
    const check = await screen.findByRole("button", { name: "Check again" });
    check.focus();
    return check;
  }

  it("a MANUAL_REVIEW stop shows «Check again» with the operation id; SUCCEEDED on it hands focus on before the row goes (X2)", async () => {
    const check = await stoppedRemoval();
    expect(rowOf("Sofia Reyes")).toHaveTextContent("Being removed");
    expect(rowOf("Sofia Reyes")).toHaveTextContent("MANUAL_REVIEW · operation op-1");
    state.operation = [() => Promise.resolve({ id: "op-1", state: "SUCCEEDED" })];
    // The re-read is held: the row is still drawn, «Check again» gone, and focus already handed on.
    const reread = gate<unknown>();
    state.membersRead = () => reread.promise;
    fireEvent.click(check);
    // After Sofia comes Tom, the owner, with no control: the row before her, Priya's, takes focus.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Role of Priya Nair" })).toHaveFocus());
    expect(screen.getByText("Sofia Reyes")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    state.members = umbrella().filter((row) => row.userId !== "sofia");
    reread.resolve({ items: state.members, nextCursor: null });
    await waitFor(() => expect(screen.queryByText("Sofia Reyes")).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Role of Priya Nair" })).toHaveFocus();
    expect(status()).toBe("Sofia Reyes was removed from Umbrella. Their seat is free.");
  });

  it("FAILED on «Check again» brings the row's controls back with focus on its Remove (X2)", async () => {
    const check = await stoppedRemoval();
    state.operation = [() => Promise.resolve({ id: "op-1", state: "FAILED", failureCode: "DEPENDENCY_UNAVAILABLE" })];
    fireEvent.click(check);
    const remove = await screen.findByRole("button", { name: "Remove Sofia Reyes from Umbrella" });
    await waitFor(() => expect(remove).toHaveFocus());
    expect(rowOf("Sofia Reyes").querySelector(".error-note")).toHaveTextContent("Sofia Reyes was not removed.");
    expect(rowOf("Sofia Reyes").querySelector(".error-note")).toHaveTextContent("DEPENDENCY_UNAVAILABLE · operation op-1");
  });

  it("an operation still under way on «Check again» resumes polling and hands focus on — never to <body> (X2)", async () => {
    const check = await stoppedRemoval();
    state.operation = [() => Promise.resolve({ id: "op-1", state: "RUNNING" })];
    fireEvent.click(check);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument());
    // After Sofia comes Tom, the owner, with no control: the row before her, Priya's, takes focus.
    expect(screen.getByRole("combobox", { name: "Role of Priya Nair" })).toHaveFocus();
    expect(rowOf("Sofia Reyes")).toHaveTextContent("Being removed");
  });

  it("pressing «Check again» twice sends one read (release-reviewer L-c)", async () => {
    const check = await stoppedRemoval();
    const held = gate<unknown>();
    state.operation = [() => held.promise];
    fireEvent.click(check);
    fireEvent.click(check);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.operationAt).toHaveLength(1);
    held.resolve({ id: "op-1", state: "MANUAL_REVIEW" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument());
  });

  it("reads on 1, 2, 4, 8 s then every 10 s, one at a time, paused in a hidden tab, and stops at 2 minutes with «Check again»", async () => {
    notifyManager.setScheduler((callback) => queueMicrotask(callback));
    state.removal = () => Promise.resolve({ id: "op-1", state: "PENDING" });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Remove Sofia Reyes from Umbrella" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const start = Date.now();
    fireEvent.click(within(document.querySelector(".company-member-confirm") as HTMLElement).getByRole("button", { name: "Remove" }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(rowOf("Sofia Reyes")).toHaveTextContent("Being removed");
    for (const total of [1000, 3000, 7000, 15_000, 25_000, 35_000]) {
      await act(() => vi.advanceTimersByTimeAsync(total - (Date.now() - start)));
    }
    expect(state.operationAt.map((at) => at - start)).toEqual([1000, 3000, 7000, 15_000, 25_000, 35_000]);

    // One read at a time: back in the tab while one is out asks nothing more.
    const held = gate<unknown>();
    state.operation = [() => held.promise];
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(state.operationAt).toHaveLength(7);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(state.operationAt).toHaveLength(7);
    held.resolve({ id: "op-1", state: "RUNNING" });
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Hidden: the tick asks nothing, and coming back asks at once.
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(state.operationAt).toHaveLength(7);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(state.operationAt).toHaveLength(8);

    await act(() => vi.advanceTimersByTimeAsync(2 * 60_000));
    const reads = state.operationAt.length;
    expect(Date.now() - start).toBeGreaterThanOrEqual(2 * 60_000);
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(state.operationAt).toHaveLength(reads);
  });
});

describe("an invitation's expiry on an open page (§4.38 «Истечение»)", () => {
  it("re-reads the invitations and the seats once at expiresAt, once more 60 s later, then never", async () => {
    notifyManager.setScheduler((callback) => queueMicrotask(callback));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const start = Date.now();
    state.invitations = [{ ...lena, expiresAt: new Date(start + 5000).toISOString() }];
    renderSection();
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText("lena@example.com")).toBeInTheDocument();
    const first = { invitations: state.invitationsAt.length, quotas: state.quotasAt.length };
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(state.invitationsAt.length).toBe(first.invitations + 1);
    expect(state.quotasAt.length).toBe(first.quotas + 1);
    // Still PENDING by the server's word: the row says it is releasing its seat, and is never marked EXPIRED here.
    expect(rowOf("lena@example.com")).toHaveTextContent("Expired · releasing its seat");
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(state.invitationsAt.length).toBe(first.invitations + 2);
    expect(state.quotasAt.length).toBe(first.quotas + 2);
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(state.invitationsAt.length).toBe(first.invitations + 2);
  });
});

describe("small rules (fix round 2)", () => {
  it("a list that did not end is not read again (api-contract-guard note 4)", async () => {
    const { retryUnanswered } = await import("./companyMembersQuery");
    const { UnendedListError } = await import("../../api/tenantMembers");
    expect(retryUnanswered(0, new UnendedListError())).toBe(false);
    expect(retryUnanswered(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(retryUnanswered(1, new TypeError("Failed to fetch"))).toBe(false);
  });

  it("the invite modal brings a refusal that appears into view", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    Object.assign(fakeApi, {
      createTenantInvitation: () =>
        Promise.reject(Object.assign(new Error("w"), { status: 409, code: "INVALID_STATE", requestId: "rid", details: null, reasons: [] })),
    });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Invite a member" }));
    const dialog = screen.getByRole("dialog", { name: "Invite a member" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "sofia@example.com" } });
    scroll.mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("sofia@example.com is already a member of Umbrella, so no invitation was created.");
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: "nearest" }));
    expect(scroll.mock.contexts.some((node) => (node as Element).classList.contains("error-note"))).toBe(true);
    scroll.mockRestore();
  });
});

describe("a refused invitation reads the seats once (TAS-512, api-contract-guard N2)", () => {
  it("QUOTA_EXCEEDED: the gate's one re-read of the snapshot, and none of the dialog's own", async () => {
    Object.assign(fakeApi, {
      // The company gate around the section, as the app has it: its session never needs to settle here.
      enterCompany: () => new Promise(() => {}),
      onWorkspaceClosed: () => () => {},
      onWorkspaceLeft: () => () => {},
      onWorkspaceRestricted: () => () => {},
      onWorkspacePending: () => () => {},
      createTenantInvitation: () => Promise.reject(refusal(422, "QUOTA_EXCEEDED")),
    });
    const harness = companiesHarness({ companyId: COMPANY, path: "/settings/members" });
    render(
      <Routes>
        <Route element={<CompanyGate logoutPending={false} onLogout={() => {}} theme="light" toggleTheme={() => {}} />}>
          <Route
            path="/settings/members"
            element={
              <div className="settings-area">
                <h1 className="area-section-title" tabIndex={-1}>
                  Members
                </h1>
                <SettingsMembersSection />
              </div>
            }
          />
        </Route>
      </Routes>,
      { wrapper: harness.wrapper },
    );
    fireEvent.click(await screen.findByRole("button", { name: "Invite a member" }));
    const dialog = screen.getByRole("dialog", { name: "Invite a member" });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "nina@example.com" } });
    await waitFor(() => expect(state.quotasAt.length).toBeGreaterThan(0));
    const before = state.quotasAt.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await within(dialog).findByRole("alert");
    await waitFor(() => expect(state.quotasAt.length).toBe(before + 1));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(state.quotasAt.length).toBe(before + 1);
  });
});
