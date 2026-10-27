import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRow, AdminRowsQuery } from "../../domain/types";
import type { InviteUserInput, TaskaApi } from "../../api/TaskaApi";
import { MOCK_INVITE_TOKENS, MockTaskaApi } from "../../api/mock/MockTaskaApi";
import { ApiError } from "../../api/rest/RestTaskaApi";
import { AdminUsersSection } from "./AdminUsersSection";

/**
 * The Users section (TAS-186). Its list is a read of `auth.users` and its two
 * buttons are the only writes in the administration area, so what these pin is
 * the pair of rules that follow from that: the section draws whatever status a
 * row carries without assuming it is one of three, and it never claims a change
 * the server has not confirmed.
 *
 * The writes go to a **real `MockTaskaApi`** rather than to a stub, so the
 * refusals here are the mock's own reproduction of the backend's rules — the
 * last-active-admin guard in particular is exercised end to end rather than
 * asserted against a fake that was told to fail. Only the shapes the mock cannot
 * produce are supplied on top — a row with an unrecognised status, and the
 * gateway's own transport failures.
 */
const { fakeApi, useMock, setExtraRows, setWriteFailure, setRowsFailure, holdRows, releaseRows } = vi.hoisted(() => {
  const state: {
    mock?: TaskaApi;
    extraRows: AdminRow[];
    writeFailure?: Error;
    rowsFailure?: Error;
    gate?: Promise<void>;
    release?: () => void;
  } = { extraRows: [] };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getCurrentUser: () => state.mock!.getCurrentUser(),
    getMeta: () => state.mock!.getMeta(),
    listAdminRows: async (query: AdminRowsQuery) => {
      if (state.gate) await state.gate;
      if (state.rowsFailure) throw state.rowsFailure;
      const page = await state.mock!.listAdminRows(query);
      return {
        ...page,
        rows: [...page.rows, ...state.extraRows],
        pagination: { ...page.pagination, totalRows: page.pagination.totalRows + state.extraRows.length },
      };
    },
    blockUser: (userId: string, reason: string) =>
      state.writeFailure ? Promise.reject(state.writeFailure) : state.mock!.blockUser(userId, reason),
    unblockUser: (userId: string, reason: string) =>
      state.writeFailure ? Promise.reject(state.writeFailure) : state.mock!.unblockUser(userId, reason),
    resetCredentialLockout: (userId: string, reason: string) =>
      state.writeFailure ? Promise.reject(state.writeFailure) : state.mock!.resetCredentialLockout(userId, reason),
    inviteUser: (input: InviteUserInput) =>
      state.writeFailure ? Promise.reject(state.writeFailure) : state.mock!.inviteUser(input),
    updateUserDisplayName: (userId: string, displayName: string) =>
      state.writeFailure ? Promise.reject(state.writeFailure) : state.mock!.updateUserDisplayName(userId, displayName),
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    useMock: (mock: TaskaApi) => {
      state.mock = mock;
      state.extraRows = [];
      state.writeFailure = undefined;
      state.rowsFailure = undefined;
      state.gate = undefined;
      state.release = undefined;
    },
    setExtraRows: (rows: AdminRow[]) => {
      state.extraRows = rows;
    },
    setWriteFailure: (failure: Error) => {
      state.writeFailure = failure;
    },
    setRowsFailure: (failure: Error) => {
      state.rowsFailure = failure;
    },
    holdRows: () => {
      state.gate = new Promise<void>((resolve) => {
        state.release = resolve;
      });
    },
    releaseRows: () => {
      state.release?.();
      state.gate = undefined;
      state.release = undefined;
    },
  };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

/** Returns the client, so a test can stand in for the refetch a window focus would cause. */
function renderSection(at = "/admin/users") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <AdminUsersSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** The row a person's name is in, which is what every assertion here is scoped to. */
const rowFor = (name: string) => screen.getByRole("cell", { name: new RegExp(name) }).closest("tr")!;

describe("the admin Users section", () => {
  /** The same instance the component talks to, for the tests that change the world behind its back. */
  let mock: MockTaskaApi;

  beforeEach(async () => {
    window.localStorage.clear();
    mock = new MockTaskaApi();
    // Mark is the seed's only GLOBAL_ADMIN, which is also what makes the
    // last-active-admin refusal reachable below.
    await mock.login({ email: "mark@example.com", password: "mock-accepts-anything" });
    useMock(mock);
  });

  /** The key of a seeded account, read out of the same table the section reads. */
  const idOf = async (email: string) => {
    const { rows } = await mock.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
    return String(rows.find((row) => row.email === email)!.id);
  };

  it("names its columns and offers the actions each status allows", async () => {
    renderSection();

    expect(await screen.findByRole("columnheader", { name: "person" })).toBeVisible();
    // Four: person, global role, status and the action. No login — the account
    // has none (TAS-388), and a column of dashes is not a removal (§5.8).
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "person",
      "global role",
      "status",
      "Action",
    ]);
    expect(screen.queryByRole("columnheader", { name: "login" })).not.toBeInTheDocument();
    // No sortable header and no filter: the gateway states neither for this
    // table, so offering either would send a request it refuses (§5.8).
    expect(
      within(screen.getByRole("table")).queryAllByRole("button", { name: /^(id|person|global role|status)/ }),
    ).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();

    // One account of each status, from the seed rather than from a fixture.
    expect(within(rowFor("Anna Ivanova")).getByText("Active")).toBeVisible();
    expect(within(rowFor("Anna Ivanova")).getByRole("button", { name: "Block Anna Ivanova" })).toBeVisible();
    expect(within(rowFor("Leo Fischer")).getByText("Invited")).toBeVisible();
    // INVITED carries two (§5.8): Resend invite, then Block — and after both,
    // in every keyed row, the rename pencil (TAS-425), so the pencils stand in
    // one column.
    expect(within(rowFor("Leo Fischer")).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Resend invite to Leo Fischer",
      "Block Leo Fischer",
      "Rename Leo Fischer",
    ]);
    expect(within(rowFor("Anna Ivanova")).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Block Anna Ivanova",
      "Rename Anna Ivanova",
    ]);
    expect(within(rowFor("Nina Kowal")).getByText("Blocked")).toBeVisible();
    expect(within(rowFor("Nina Kowal")).getByRole("button", { name: "Unblock Nina Kowal" })).toBeVisible();
    // The role reads as a word rather than as the wire value.
    expect(within(rowFor("Mark Lee")).getByText("Global admin")).toBeVisible();
  });

  it("prints a status it has never heard of and offers nothing to do with it", async () => {
    setExtraRows([
      {
        id: "9d0c2f11-0000-4000-8000-000000000009",
        email: "quinn@example.com",
        display_name: "Quinn Ash",
        status: "QUARANTINED",
        global_role: "USER",
      },
      // A row the table gave no key for: nothing to put in the path, so no
      // action — and it must not throw on the way to deciding that.
      { email: "keyless@example.com", display_name: "No Key", status: "ACTIVE", global_role: "USER" },
    ]);
    renderSection();

    expect(await screen.findByText("QUARANTINED")).toBeVisible();
    // No status write for a status nobody can name — but a name is not a
    // status, and the server renames any account (TAS-425).
    expect(within(rowFor("Quinn Ash")).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Rename Quinn Ash",
    ]);
    expect(within(rowFor("No Key")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("draws each status with the device DESIGN.md gives it, and an unknown one with none", async () => {
    // The pill is the only place in this section where colour carries meaning,
    // and §5.8 assigns the devices rather than the hues: fill for BLOCKED, a
    // dashed edge for INVITED, a solid --danger edge for LOCKED, nothing for
    // ACTIVE and nothing for a value this build cannot interpret. Pinning the
    // class is how a fourth device gets noticed if someone adds one.
    setExtraRows([
      {
        id: "9d0c2f11-0000-4000-8000-00000000000a",
        email: "quinn@example.com",
        display_name: "Quinn Ash",
        status: "QUARANTINED",
        global_role: "USER",
      },
    ]);
    renderSection();
    await screen.findByText("QUARANTINED");

    const pillFor = (name: string, label: string) => within(rowFor(name)).getByText(label);
    expect(pillFor("Anna Ivanova", "Active").className).toBe("admin-pill");
    expect(pillFor("Leo Fischer", "Invited").className).toBe("admin-pill admin-status-invited");
    expect(pillFor("Nina Kowal", "Blocked").className).toBe("admin-pill admin-status-blocked");
    expect(pillFor("Omar Haddad", "Locked").className).toBe("admin-pill admin-status-locked");
    expect(pillFor("Quinn Ash", "QUARANTINED").className).toBe("admin-pill");
  });

  it("keeps the confirmation off until a reason is typed, and says why", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Anna Ivanova" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Anna Ivanova" });
    const confirm = within(dialog).getByRole("button", { name: "Block" });
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(/A reason is required/)).toBeVisible();

    // Whitespace is blank to the server's `@NotBlank`, so it is blank here too:
    // the 400 must never be spent at the boundary.
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Left the company" } });
    expect(confirm).toBeEnabled();
    // The hint stops explaining and starts counting.
    expect(within(dialog).getByText("534 of 550 characters left")).toBeVisible();

    // And it counts the same value the guard reads and the request carries: a
    // trailing space is not a character anybody spent, and a counter one short
    // of the guard is a counter describing a different rule.
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Left the company " } });
    expect(within(dialog).getByText("534 of 550 characters left")).toBeVisible();
  });

  it("names the transition, and the consequence peculiar to an invited account", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Leo Fischer" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Leo Fischer" });
    expect(within(dialog).getByText("INVITED → BLOCKED")).toBeVisible();
    expect(within(dialog).getByText(/the invitation is not restored/i)).toBeVisible();
    expect(within(dialog).getByText("leo@example.com")).toBeVisible();
  });

  it("spans an empty list across every column the header has", async () => {
    // The colSpan and the header come from one constant, so dropping a column
    // cannot leave the message one cell short (§5.8).
    const { meta } = await mock.listAdminRows({ service: "auth", table: "users" });
    vi.spyOn(mock, "listAdminRows").mockResolvedValue({
      rows: [],
      pagination: { currentPage: 1, pageSize: 20, totalRows: 0, totalPages: 1, hasNext: false, hasPrev: false },
      meta,
    });
    renderSection();

    const empty = await screen.findByText("This gateway lists no accounts.");
    expect(empty).toHaveAttribute("colspan", String(screen.getAllByRole("columnheader").length));
    expect(empty).toHaveAttribute("colspan", "4");
  });

  it("names the account by its name and email, with no handle under them (TAS-389)", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Ivy Chen" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Ivy Chen" });
    const target = dialog.querySelector<HTMLElement>(".admin-write-target")!;
    expect([...target.querySelectorAll("p")].map((line) => line.textContent)).toEqual([
      "Ivy Chen",
      "ivy@example.com",
      "INVITED → BLOCKEDfrom Invited to Blocked",
    ]);
    expect(target).not.toHaveTextContent("@ivy");
    expect(target).not.toHaveTextContent("invited_");
    expect(within(target).getByText("Ivy Chen")).not.toHaveClass("admin-write-target-id");
  });

  it("falls back from the name to the email, then to the key, which is then set as a key", async () => {
    setExtraRows([
      // No display name: the address is the name, said once.
      { id: "9d0c2f11-0000-4000-8000-00000000000b", email: "nameless@example.com", status: "ACTIVE", global_role: "USER" },
      // Neither: the key is all there is to name the account by.
      { id: "9d0c2f11-0000-4000-8000-00000000000c", status: "ACTIVE", global_role: "USER" },
    ]);
    renderSection();
    await screen.findByText("nameless@example.com");

    // The table's own person cell: the address on the name's line, no second line.
    const nameless = rowFor("nameless@example.com");
    expect(within(nameless).getByText("nameless@example.com")).toHaveClass("admin-user-name");
    expect(within(nameless).getByText("nameless@example.com")).not.toHaveClass("admin-cell-mono");
    expect(nameless.querySelector(".admin-user-email")).toBeNull();

    // A named row keeps the UI font; only a label that is the row's key is set
    // as a key, in the table as in the dialog.
    const named = within(rowFor("Anna Ivanova")).getByText("Anna Ivanova");
    expect(named).toHaveClass("admin-user-name");
    expect(named).not.toHaveClass("admin-cell-mono");
    const rowKey = "9d0c2f11-0000-4000-8000-00000000000c";
    expect(within(rowFor(rowKey)).getByText(rowKey)).toHaveClass("admin-user-name", "admin-cell-mono");

    fireEvent.click(within(nameless).getByRole("button", { name: "Block nameless@example.com" }));
    let dialog = await screen.findByRole("dialog", { name: "Block nameless@example.com" });
    let target = dialog.querySelector<HTMLElement>(".admin-write-target")!;
    expect(target.querySelectorAll(".admin-write-target-line")).toHaveLength(0);
    expect(within(target).getByText("nameless@example.com")).not.toHaveClass("admin-write-target-id");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    const key = "9d0c2f11-0000-4000-8000-00000000000c";
    fireEvent.click(screen.getByRole("button", { name: `Block ${key}` }));
    dialog = await screen.findByRole("dialog", { name: `Block ${key}` });
    target = dialog.querySelector<HTMLElement>(".admin-write-target")!;
    // Mono and free to wrap, because it is a machine value and not a name.
    expect(within(target).getByText(key)).toHaveClass("admin-write-target-name", "admin-write-target-id");
    expect(target.querySelectorAll(".admin-write-target-line")).toHaveLength(0);
  });

  it("says when the account being blocked is the one you are signed in as", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Mark Lee" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Mark Lee" });
    // Stated, never prohibited on the client: the server owns the only rule
    // there is, and it is the last-active-admin one.
    expect(within(dialog).getByText(/account you are signed in as/i)).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Block" })).toBeInTheDocument();
  });

  it("takes the status the server named, marks the row and says so in words", async () => {
    renderSection();
    const trigger = await screen.findByRole("button", { name: "Unblock Nina Kowal" });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Unblock Nina Kowal" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Back from leave" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unblock" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const row = rowFor("Nina Kowal");
    // ACTIVE because that is what the *server* answered, not because the client
    // decided what unblocking does.
    expect(within(row).getByText("Active")).toBeVisible();
    expect(row).toHaveClass("is-changed");
    // There is no toast in this product (§5.6), so the only thing a screen
    // reader would otherwise get is silence.
    // One of two standing regions since TAS-204: this one, and the line that
    // reports invitations.
    expect(screen.getByText("Nina Kowal is now active.")).toHaveAttribute("role", "status");
    // And the row now offers the other action — with focus on it, because the
    // dialog that had it is gone. jsdom has no `:focus-visible`, so the ring
    // itself is a browser check; this is the half that can be asserted here.
    const back = within(row).getByRole("button", { name: "Block Nina Kowal" });
    expect(back).toBeVisible();
    expect(back).toHaveFocus();
  });

  it("offers the lockout reset on a locked account, and says what it does and does not touch", async () => {
    renderSection();

    await screen.findByRole("table");
    const row = rowFor("Omar Haddad");
    expect(within(row).getByText("Locked")).toBeVisible();
    // Not Block, which the server refuses from LOCKED, and not nothing, which
    // is what this row offered before the route existed.
    fireEvent.click(within(row).getByRole("button", { name: "Reset lockout for Omar Haddad" }));

    const dialog = await screen.findByRole("dialog", { name: "Reset lockout for Omar Haddad" });
    expect(within(dialog).getByText("LOCKED → ACTIVE")).toBeVisible();
    // The two things an admin will otherwise assume, and both are wrong: that
    // somebody blocked this account, and that this hands out a new password.
    expect(within(dialog).getByText(/locked itself after too many failed sign-ins/i)).toBeVisible();
    expect(within(dialog).getByText(/change the password/i)).toBeVisible();

    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Called in, identity confirmed" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset lockout" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const after = rowFor("Omar Haddad");
    expect(within(after).getByText("Active")).toBeVisible();
    // One of two standing regions since TAS-204: this one, and the line that
    // reports invitations.
    expect(screen.getByText("Omar Haddad is now active.")).toHaveAttribute("role", "status");
    // And the row now offers what an active account offers.
    expect(within(after).getByRole("button", { name: "Block Omar Haddad" })).toBeVisible();
  });

  it("keeps the lockout dialog open on the server's not-locked refusal, which arrives as a 400", async () => {
    // The refusal this section is careful about for the third write:
    // `FAILED_PRECONDITION` on **400**, told from a plainly bad request by its
    // code alone. Supplied here because the mock cannot produce it against a
    // row that is genuinely locked.
    setWriteFailure(new ApiError("User is not in LOCKED status", "FAILED_PRECONDITION", 400, "req-7"));
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "Reset lockout for Omar Haddad" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset lockout for Omar Haddad" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Worth a try" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset lockout" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/a lockout can only be reset while the account is locked/i);
    expect(alert).toHaveTextContent("User is not in LOCKED status");
    expect(dialog).toBeInTheDocument();
    expect(within(rowFor("Omar Haddad")).getByText("Locked")).toBeVisible();
  });

  it("lets go of the row once the list has caught up, so a later change is not painted over", async () => {
    const client = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Anna Ivanova" }));
    const dialog = await screen.findByRole("dialog", { name: "Block Anna Ivanova" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Left the company" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(within(rowFor("Anna Ivanova")).getByText("Blocked")).toBeVisible());

    // Somebody else, through some other window, puts the account back. The
    // section learns about it the next time the list is read — a window focus,
    // a page change — and it must believe the list rather than the answer it
    // was given to a write two refetches ago.
    await act(async () => {
      await mock.unblockUser(await idOf("anna@example.com"), "Reinstated by another admin");
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["admin", "users"] });
    });

    await waitFor(() => expect(within(rowFor("Anna Ivanova")).getByText("Active")).toBeVisible());
    // And the action follows the status: an Unblock here is a button the
    // gateway would refuse.
    const row = rowFor("Anna Ivanova");
    expect(within(row).getByRole("button", { name: "Block Anna Ivanova" })).toBeVisible();
    expect(within(row).queryByRole("button", { name: /^Unblock/ })).not.toBeInTheDocument();
  });

  it("keeps the server's answer when the refetch that should have confirmed it fails", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Anna Ivanova" }));
    const dialog = await screen.findByRole("dialog", { name: "Block Anna Ivanova" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Left the company" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));
    // Break the list read while the write is still in flight, so the refetch
    // the section fires on success is the one that fails.
    setRowsFailure(new ApiError("Internal error", "INTERNAL", 500));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // react-query keeps the last rows it managed to read, and those are the
    // *pre-write* ones. Dropping the server's answer here — which is what
    // clearing on "the invalidation settled" would do — would snap the row back
    // to the status the write had just replaced.
    const row = rowFor("Anna Ivanova");
    expect(within(row).getByText("Blocked")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Unblock Anna Ivanova" })).toBeVisible();
  });

  it("reads the last-active-admin refusal as a conflict even though it is a 400", async () => {
    // The gateway does not give the two refusals one status: the transition
    // guard is ABORTED → 409, and this one is FAILED_PRECONDITION → 400
    // (`RestErrorMapper.mapGrpcCodeToHttpStatus`, backend at `01a5af4`).
    // So on REST it is the *code* that carries this sentence, and a cleanup
    // that trimmed `isConflict` to the status alone would drop the single most
    // important refusal in this feature into "rejected request".
    setWriteFailure(new ApiError("Cannot block the last active global admin", "FAILED_PRECONDITION", 400));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Sofia Reyes" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Sofia Reyes" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Testing the guard" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/would not make this change/i);
    expect(alert).not.toHaveTextContent(/would not accept this request/i);
  });

  it("keeps the dialog open on the last-active-admin refusal, in the server's own words", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Mark Lee" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Mark Lee" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Testing the guard" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));

    const alert = await within(dialog).findByRole("alert");
    // A conflict, not "could not be reached" and not "rejected request": the
    // server read this and refused it on a count no client holds.
    expect(alert).toHaveTextContent(/would not make this change/i);
    expect(alert).toHaveTextContent("Cannot block the last active global admin");
    // Still open, and the row behind it did not move.
    expect(screen.getByRole("dialog", { name: "Block Mark Lee" })).toBeVisible();
    expect(within(rowFor("Mark Lee")).getByText("Active")).toBeVisible();
  });

  it("words a 404 as a refusal and offers the request id, with no story link left to follow", async () => {
    // Until TAS-196 this shape — a 404 carrying Spring's static-resource
    // message — had a sentence of its own and a link to the backend story that
    // would deploy the route. PR #146 deployed all three, so the branch is gone:
    // a 404 from these routes is a statement about the account, and the dialog
    // must not send the reader to Jira over one.
    setWriteFailure(
      new ApiError(
        "No static resource api/v1/admin/users/1/block for request 'POST /api/v1/admin/users/1/block'.",
        "NOT_FOUND",
        404,
        "req-77",
      ),
    );
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Anna Ivanova" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Anna Ivanova" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Left the company" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Block" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/refused this/i);
    expect(alert).not.toHaveTextContent(/does not serve/i);
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
    // The request id earns its space in this area (§5.8).
    expect(within(alert).getByRole("button", { name: /Copy request id req-77/ })).toBeVisible();
  });

  it("closes on Escape and puts focus back on the button that opened it", async () => {
    renderSection();
    const trigger = await screen.findByRole("button", { name: "Block Anna Ivanova" });
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  // `Esc` is `Modal`'s since TAS-397 (§4.11): a reason being written is
  // text-work, and holds the dialog with the text and the focus in place.
  it("stays open on Escape while the reason holds text", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Anna Ivanova" }));
    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByLabelText("Reason");
    fireEvent.change(reason, { target: { value: "Left the company" } });
    reason.focus();

    fireEvent.keyDown(reason, { key: "Escape" });

    expect(dialog).toBeInTheDocument();
    expect(reason).toHaveFocus();
    expect(reason).toHaveValue("Left the company");
  });

  // …and wherever focus is in the dialog (art-director, TAS-209): Cancel
  // holds the reason too, and pressing it is how the reader discards it.
  it("stays open on Escape from Cancel while the reason holds text", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Anna Ivanova" }));
    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByLabelText("Reason");
    fireEvent.change(reason, { target: { value: "Left the company" } });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    cancel.focus();

    fireEvent.keyDown(cancel, { key: "Escape" });

    expect(dialog).toBeInTheDocument();
    expect(cancel).toHaveFocus();
    expect(reason).toHaveValue("Left the company");

    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says it is loading before it says anything else", async () => {
    holdRows();
    renderSection();

    expect(screen.getByRole("status")).toHaveTextContent("Loading accounts…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    releaseRows();
    expect(await screen.findByRole("table")).toBeVisible();
  });

  it("answers a failed read with the section's error taxonomy, not with an empty table", async () => {
    setRowsFailure(new ApiError("Forbidden", "PERMISSION_DENIED", 403));
    renderSection();

    expect(await screen.findByRole("alert")).toHaveTextContent(/refused this/i);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

/**
 * Inviting (TAS-204, DESIGN.md §5.8), against the real mock — whose answers are
 * `AdminInviteUserServiceImpl`'s: 201 for a new address, 200 with or without a
 * new link for an invited one, 409 for an account, 429 inside a minute.
 */
describe("the admin Users section, inviting", () => {
  let mock: MockTaskaApi;

  beforeEach(async () => {
    window.localStorage.clear();
    mock = new MockTaskaApi();
    await mock.login({ email: "mark@example.com", password: "mock-accepts-anything" });
    useMock(mock);
  });

  const UNTIL = /(it|the link) works until [A-Z][a-z]{2} \d{1,2}, \d{2}:\d{2} UTC\.$/;
  const statusLine = () => document.querySelector(".admin-users-status")!;

  async function openInvite() {
    renderSection();
    const trigger = await screen.findByRole("button", { name: "Invite user" });
    fireEvent.click(trigger);
    return { trigger, dialog: await screen.findByRole("dialog", { name: "Invite user" }) };
  }

  it("keeps an empty address off the wire, and says why under the field", async () => {
    const { dialog } = await openInvite();
    const send = within(dialog).getByRole("button", { name: "Send invitation" });

    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(send).toHaveAccessibleDescription("Enter an email address.");
    expect(within(dialog).getByLabelText("Email")).toHaveFocus();
    expect(within(dialog).getByText(/doesn’t add them to any project/)).toBeVisible();
  });

  it("invites a new address: the dialog closes, focus returns, the line says queued with the deadline in UTC", async () => {
    const { trigger, dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "  New.Person@Example.com " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(statusLine()).toHaveAttribute("role", "status");
    expect(statusLine()).toHaveTextContent(/^new\.person@example\.com is invited\. The email is queued for sending;/);
    expect(statusLine()).toHaveTextContent(UNTIL);
    expect(statusLine().textContent).not.toMatch(/\b(sent|delivered)\b/);
    expect(trigger).toHaveFocus();
    // The list is read again, and the new account is in it, marked.
    const row = await waitFor(() => rowFor("new.person"));
    expect(row).toHaveClass("is-changed");
  });

  it("keeps the dialog for an invitation whose link still works, and sends a new one only when asked", async () => {
    const { dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "leo@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    const standing = await within(dialog).findByText(/^leo@example\.com is already invited and their link still works until/);
    expect(standing).toHaveAttribute("role", "status");
    expect(standing).toHaveTextContent(/so no email was sent\. If they lost it, send a new link — the old one will stop working\.$/);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Send new link" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(statusLine()).toHaveTextContent(/^A new invitation link for leo@example\.com is queued;/);
    // Leo's emailed link is the one the new one replaced.
    await expect(mock.acceptInvitation({ token: MOCK_INVITE_TOKENS.leo, newPassword: "Correct-horse-1" })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("says an expired invitation was re-issued", async () => {
    const { dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "ivy@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(statusLine()).toHaveTextContent(/^ivy@example\.com was already invited but did not have a working link, so a new one is queued;/);
  });

  it("refuses an address that already has an account, with the server's words under the sentence", async () => {
    const { dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "anna@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This email already belongs to a Taska account, so there is nothing to invite.",
    );
    expect(within(dialog).getByText("An account with this email already exists")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "Invite user" })).toBeVisible();
  });

  it("states the 429's wait from details, with no countdown", async () => {
    const { dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "fresh@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Invite user" }));
    const again = await screen.findByRole("dialog", { name: "Invite user" });
    fireEvent.change(within(again).getByLabelText("Email"), { target: { value: "fresh@example.com" } });
    fireEvent.click(within(again).getByRole("button", { name: "Send invitation" }));
    fireEvent.click(await within(again).findByRole("button", { name: "Send new link" }));

    expect(await within(again).findByRole("alert")).toHaveTextContent(
      /^An invitation to fresh@example\.com was sent less than a minute ago\. Try again in \d+ seconds\.$/,
    );
  });

  it("prints a 400 in the server's own words and leaves the field as typed", async () => {
    const { dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "not-an-address" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "A valid email address is required (maximum 320 characters)",
    );
    expect(within(dialog).getByLabelText("Email")).toHaveValue("not-an-address");
  });

  it("asks before resending from a row, then says the new link is queued and gives focus back to the row", async () => {
    renderSection();
    const resend = await screen.findByRole("button", { name: "Resend invite to Leo Fischer" });
    fireEvent.click(resend);
    const dialog = await screen.findByRole("dialog", { name: "Resend invitation" });

    expect(within(dialog).getByText("A new link is emailed to leo@example.com. The link sent earlier stops working.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send new link" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(statusLine()).toHaveTextContent(/^A new invitation link for Leo Fischer is queued;/);
    expect(statusLine()).toHaveTextContent(UNTIL);
    expect(resend).toHaveFocus();
    expect(rowFor("Leo Fischer")).toHaveClass("is-changed");
  });

  it("says an account that stopped waiting for activation has nothing to resend, and reads the list again", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Resend invite to Leo Fischer" }));
    const dialog = await screen.findByRole("dialog", { name: "Resend invitation" });
    // Leo activates behind the section's back, between the list and the press.
    await mock.acceptInvitation({ token: MOCK_INVITE_TOKENS.leo, newPassword: "Correct-horse-1" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Send new link" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Leo Fischer’s account is no longer waiting for activation, so there is nothing to resend.",
    );
    await waitFor(() =>
      expect(within(rowFor("Leo Fischer")).queryByRole("button", { name: "Resend invite to Leo Fischer" })).toBeNull(),
    );
  });

  it("after that 409 keeps Send new link focused and steadily unavailable, and closing gives focus to what the row still offers", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Resend invite to Leo Fischer" }));
    const dialog = await screen.findByRole("dialog", { name: "Resend invitation" });
    await mock.acceptInvitation({ token: MOCK_INVITE_TOKENS.leo, newPassword: "Correct-horse-1" });
    const invites = vi.spyOn(fakeApi, "inviteUser");

    const send = within(dialog).getByRole("button", { name: "Send new link" });
    send.focus();
    fireEvent.click(send);
    await within(dialog).findByRole("alert");
    expect(invites).toHaveBeenCalledTimes(1);

    // §4.1's steady kind of `aria-disabled`: still there, still focused, and
    // neither a press nor Cmd/Ctrl+Enter sends the same 409 again.
    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(send).toHaveClass("is-spent");
    expect(send).toHaveFocus();
    fireEvent.click(send);
    fireEvent.keyDown(document, { key: "Enter", metaKey: true });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    // Settled first: a request these presses had started would reach the API
    // only after react-query's own microtasks, and asserting before them would
    // pass whether or not one went out (release-reviewer F2).
    await act(async () => {});
    expect(invites).toHaveBeenCalledTimes(1);
    expect(send).toHaveFocus();
    invites.mockRestore();

    // Leo is ACTIVE now, so his row offers Block — where focus goes on close.
    await waitFor(() =>
      expect(within(rowFor("Leo Fischer")).queryByRole("button", { name: "Resend invite to Leo Fischer" })).toBeNull(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowFor("Leo Fischer")).getByRole("button", { name: "Block Leo Fischer" })).toHaveFocus();
  });

  it("gives focus to the section's heading when the row is gone after that 409", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <section className="area-section">
            <h1 className="area-section-title" tabIndex={-1}>
              Administration › Users
            </h1>
            <AdminUsersSection />
          </section>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Resend invite to Leo Fischer" }));
    const dialog = await screen.findByRole("dialog", { name: "Resend invitation" });
    await mock.acceptInvitation({ token: MOCK_INVITE_TOKENS.leo, newPassword: "Correct-horse-1" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send new link" }));
    await within(dialog).findByRole("alert");
    // The row leaves the table altogether — taken by a page change, say.
    rowFor("Leo Fischer").remove();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Administration › Users" })).toHaveFocus();
  });

  it("keeps the dialog open and says so in the taxonomy's words when the API cannot be reached", async () => {
    setWriteFailure(new TypeError("Failed to fetch"));
    const { dialog } = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "someone@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/^The admin API could not be reached/);
    // Nothing answered, so nothing is quoted as the server's: "Failed to
    // fetch" is the browser's.
    expect(within(dialog).queryByText("Failed to fetch")).not.toBeInTheDocument();
  });
});

/**
 * Renaming (TAS-425, DESIGN.md §5.8 «Users: переименование»), against the
 * real mock as the status writes are: the rename is auth-service's rule there,
 * and only the gateway's transport failures are supplied on top.
 */
describe("the admin Users section, renaming", () => {
  let mock: MockTaskaApi;

  beforeEach(async () => {
    window.localStorage.clear();
    mock = new MockTaskaApi();
    await mock.login({ email: "mark@example.com", password: "mock-accepts-anything" });
    useMock(mock);
  });

  const openRename = async (person: string) => {
    const trigger = await screen.findByRole("button", { name: `Rename ${person}` });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Rename user" });
    return { trigger, dialog, field: within(dialog).getByLabelText("Name") as HTMLInputElement };
  };

  it("asks in a dialog that names the person, with the name in the field and the caret at its end", async () => {
    renderSection();
    const { trigger, dialog, field } = await openRename("Nina Kowal");

    expect(trigger).toHaveAttribute("title", "Rename");
    expect(within(dialog).getByText("nina@example.com")).toBeVisible();
    expect(field).toHaveValue("Nina Kowal");
    await waitFor(() => expect(field).toHaveFocus());
    expect(field.selectionStart).toBe("Nina Kowal".length);
    expect(field).not.toHaveAttribute("maxlength");
    // No reason field: the server writes the audit row itself.
    expect(within(dialog).queryByLabelText("Reason")).not.toBeInTheDocument();
  });

  it("holds Rename while the name has a reason against it, and says the reason under the field", async () => {
    renderSection();
    const { dialog, field } = await openRename("Nina Kowal");
    const rename = within(dialog).getByRole("button", { name: "Rename" });

    fireEvent.change(field, { target: { value: "  " } });
    expect(field).toHaveAccessibleDescription("Enter a name.");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(rename).toHaveAttribute("aria-disabled", "true");
    expect(rename).toHaveClass("is-unavailable");
    fireEvent.click(rename);
    fireEvent.change(field, { target: { value: "x".repeat(130) } });
    expect(field).toHaveAccessibleDescription("Use at most 128 characters. This name has 130.");
    expect(await mock.listAdminRows({ service: "auth", table: "users", pageSize: 100 })).toMatchObject({
      rows: expect.arrayContaining([expect.objectContaining({ display_name: "Nina Kowal" })]),
    });
  });

  it("closes without a request when the name did not change", async () => {
    const spy = vi.spyOn(fakeApi, "updateUserDisplayName");
    renderSection();
    const { trigger, dialog, field } = await openRename("Nina Kowal");
    fireEvent.change(field, { target: { value: " Nina Kowal " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(spy).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    spy.mockRestore();
  });

  it("takes the name the server answered with, marks the row, says so, and gives focus back to the row's pencil", async () => {
    const queryClient = renderSection();
    // Reads elsewhere that name people, cached from an earlier visit.
    queryClient.setQueryData(["members", "p-1"], []);
    queryClient.setQueryData(["project-context", "p-1"], {});
    queryClient.setQueryData(["user-directory", "nin"], { items: [], hasMore: false });
    const { dialog, field } = await openRename("Nina Kowal");
    fireEvent.change(field, { target: { value: "  Nina Kay  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const row = rowFor("Nina Kay");
    expect(row).toHaveClass("is-changed");
    // Named as the row named them before, then as the server does now.
    expect(screen.getByText("Nina Kowal is now named Nina Kay.")).toHaveAttribute("role", "status");
    // Any status: Nina is BLOCKED, and stays so.
    expect(within(row).getByText("Blocked")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Rename Nina Kay" })).toHaveFocus();
    // Every other read that names people is marked to be asked again — no
    // read of its own here, since none of them is on screen.
    for (const key of [["members", "p-1"], ["project-context", "p-1"], ["user-directory", "nin"]]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    // And the list re-read says the same as the bridge did.
    await waitFor(() => expect(within(rowFor("Nina Kay")).getByText("Blocked")).toBeVisible());
    expect(screen.queryByText("Nina Kowal")).not.toBeInTheDocument();
  });

  it("renaming yourself puts the name in the cached account at once, and reads it again", async () => {
    const queryClient = renderSection();
    await screen.findByRole("button", { name: "Rename Mark Lee" });
    await waitFor(() => expect(queryClient.getQueryData(["me"])).toMatchObject({ displayName: "Mark Lee" }));
    const { dialog, field } = await openRename("Mark Lee");
    fireEvent.change(field, { target: { value: "Mark Lin" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(queryClient.getQueryData(["me"])).toMatchObject({ displayName: "Mark Lin" }));
    expect(screen.getByText("Mark Lee is now named Mark Lin.")).toBeInTheDocument();
  });

  it("keeps the dialog open on a refusal, in the taxonomy's words, and points at the field for a name refusal", async () => {
    setWriteFailure(
      new ApiError(
        "Display name must contain 1 to 128 characters and no control characters or line breaks",
        "INVALID_ARGUMENT",
        400,
        "req-name",
        undefined,
        { reason: "DISPLAY_NAME_INVALID" },
      ),
    );
    renderSection();
    const { dialog, field } = await openRename("Nina Kowal");
    fireEvent.change(field, { target: { value: "Nina K." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/^The gateway would not accept this request/);
    expect(alert).toHaveTextContent("Display name must contain 1 to 128 characters");
    expect(within(alert).getByRole("button", { name: /Copy request id req-name/ })).toBeVisible();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveValue("Nina K.");
  });

  it.each([
    [new ApiError("Global admin role is required", "PERMISSION_DENIED", 403), /^The server refused this/],
    [new ApiError("User not found", "NOT_FOUND", 404), /^The server refused this/],
    [new ApiError("Internal error", "INTERNAL", 500), /^The gateway failed while renaming this account/],
    [new TypeError("Failed to fetch"), /^The admin API could not be reached, so this name may or may not have changed/],
  ])("words %s in the rename's sentence", async (failure, sentence) => {
    setWriteFailure(failure);
    renderSection();
    const { dialog, field } = await openRename("Nina Kowal");
    fireEvent.change(field, { target: { value: "Nina K." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(sentence);
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("closes on Escape whatever the field holds, focus back on the pencil", async () => {
    renderSection();
    const { trigger, field } = await openRename("Nina Kowal");
    fireEvent.change(field, { target: { value: "Something else" } });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
