import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRow, AdminRowsQuery } from "../../domain/types";
import type { TaskaApi } from "../../api/TaskaApi";
import { MockTaskaApi } from "../../api/mock/MockTaskaApi";
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
 * asserted against a fake that was told to fail. Only the two shapes the mock
 * cannot produce are supplied on top: a row with an unrecognised status, and a
 * gateway that has not deployed the route.
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
  const idOf = async (login: string) => {
    const { rows } = await mock.listAdminRows({ service: "auth", table: "users", pageSize: 100 });
    return String(rows.find((row) => row.login === login)!.id);
  };

  it("names its columns and offers exactly one action per account", async () => {
    renderSection();

    expect(await screen.findByRole("columnheader", { name: "person" })).toBeVisible();
    for (const column of ["login", "global role", "status"]) {
      expect(screen.getByRole("columnheader", { name: column })).toBeVisible();
    }
    // No sortable header and no filter: the gateway states neither for this
    // table, so offering either would send a request it refuses (§5.8).
    expect(within(screen.getByRole("table")).queryAllByRole("button", { name: /^(id|login|status)/ })).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Filter" })).not.toBeInTheDocument();

    // One account of each status, from the seed rather than from a fixture.
    expect(within(rowFor("Anna Ivanova")).getByText("Active")).toBeVisible();
    expect(within(rowFor("Anna Ivanova")).getByRole("button", { name: "Block Anna Ivanova" })).toBeVisible();
    expect(within(rowFor("Leo Fischer")).getByText("Invited")).toBeVisible();
    expect(within(rowFor("Leo Fischer")).getByRole("button", { name: "Block Leo Fischer" })).toBeVisible();
    expect(within(rowFor("Nina Kowal")).getByText("Blocked")).toBeVisible();
    expect(within(rowFor("Nina Kowal")).getByRole("button", { name: "Unblock Nina Kowal" })).toBeVisible();
    // The role reads as a word rather than as the wire value.
    expect(within(rowFor("Mark Lee")).getByText("Global admin")).toBeVisible();
  });

  it("prints a status it has never heard of and offers nothing to do with it", async () => {
    setExtraRows([
      {
        id: "9d0c2f11-0000-4000-8000-000000000009",
        login: "quinn",
        email: "quinn@example.com",
        display_name: "Quinn Ash",
        status: "QUARANTINED",
        global_role: "USER",
      },
      // A row the table gave no key for: nothing to put in the path, so no
      // action — and it must not throw on the way to deciding that.
      { login: "keyless", display_name: "No Key", status: "ACTIVE", global_role: "USER" },
    ]);
    renderSection();

    expect(await screen.findByText("QUARANTINED")).toBeVisible();
    expect(within(rowFor("Quinn Ash")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(rowFor("No Key")).queryByRole("button")).not.toBeInTheDocument();
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
    expect(within(dialog).getByText(/characters left/)).toBeVisible();
  });

  it("names the transition, and the consequence peculiar to an invited account", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Block Leo Fischer" }));

    const dialog = await screen.findByRole("dialog", { name: "Block Leo Fischer" });
    expect(within(dialog).getByText("INVITED → BLOCKED")).toBeVisible();
    expect(within(dialog).getByText(/the invitation is not restored/i)).toBeVisible();
    expect(within(dialog).getByText("leo@example.com")).toBeVisible();
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
    expect(screen.getByRole("status")).toHaveTextContent("Nina Kowal is now active.");
    // And the row now offers the other action.
    expect(within(row).getByRole("button", { name: "Block Nina Kowal" })).toBeVisible();
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
      await mock.unblockUser(await idOf("anna"), "Reinstated by another admin");
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
    // (`RestErrorMapper.mapGrpcCodeToHttpStatus`, backend `feature/TAS-107`).
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

  it("reads an undeployed route as a missing deployment rather than a missing user", async () => {
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
    expect(alert).toHaveTextContent(/does not serve blocking and unblocking yet/i);
    expect(within(alert).getByRole("link", { name: "TAS-107" })).toBeVisible();
    expect(alert).not.toHaveTextContent(/refused this/i);
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
