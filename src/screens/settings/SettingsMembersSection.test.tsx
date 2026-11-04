import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import type { Invitation, Membership } from "../../api/tenantMembers";
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
  };
  const api = {
    getCurrentUser: async () => ({ id: state.me, email: `${state.me}@example.com`, displayName: state.me, status: "ACTIVE" }),
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
      return { items: state.invitations, nextCursor: null };
    },
    getTenantQuotas: async () => {
      state.calls.push("quotas");
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

function renderSection() {
  const harness = companiesHarness({ companyId: COMPANY, path: "/settings/members" });
  render(<SettingsMembersSection />, { wrapper: harness.wrapper });
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
