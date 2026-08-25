import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { taskaApi } from "../../api/client";
import type { UserStatus } from "../../domain/types";
import { AdminError } from "./AdminError";
import { AdminPager } from "./AdminPager";
import { AdminUserActionModal } from "./AdminUserActionModal";
import { readViewState } from "./urlState";
import {
  actionFor,
  actionLabels,
  globalRoleLabel,
  hasKey,
  personLabel,
  readUserRow,
  USERS_SERVICE,
  USERS_TABLE,
  userStatusLabel,
  type AdminUserRow,
  type AdminUserTarget,
  type UserAction,
} from "./users";

const PAGE_SIZE = 20;

/** How long a changed row stays marked, matching the copy confirmation (§5.8). */
const FLASH_MS = 2000;

/**
 * The Users section (DESIGN.md §5.8) — the accounts of the whole instance, and
 * the one place in this area that writes.
 *
 * The list is not an endpoint of its own: it is `auth.users` read through the
 * generic `GET /readonly/{service}/{table}`, with the columns *named* rather
 * than rendered whole. That is what separates this section from Data, which
 * draws whatever the catalog describes.
 *
 * **No filter chip and no sortable header**, and that is a measurement rather
 * than a simplification: on the deployed gateway this table answers with
 * `meta.filterableColumns` and `meta.sortableColumns` both empty
 * (2026-08-25), so either control would send a request the gateway refuses.
 * If a future catalog marks them, the section can grow them then.
 */
export function AdminUsersSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  // Page is the only view state this section has, and it lives in the URL like
  // every other selection in this area (§5.8). Read through the Data section's
  // reader so the clamping is one rule; written bare, because a `sort` or a
  // `filter` in the address here would describe controls the section does not
  // offer.
  const page = readViewState(searchParams).page;
  const setPage = (next: number) => {
    setSearchParams(next > 1 ? { page: String(next) } : {}, { replace: true });
  };

  // Cached under the same key `AdminScreen` uses, so this costs no request: the
  // area has already asked who is signed in in order to decide whether to draw
  // itself at all.
  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => taskaApi.getCurrentUser() });
  const rowsQuery = useQuery({
    queryKey: ["admin", "users", page],
    queryFn: () =>
      taskaApi.listAdminRows({ service: USERS_SERVICE, table: USERS_TABLE, page, pageSize: PAGE_SIZE }),
    // Paging otherwise swaps the whole table for a message and the row someone
    // was reading jumps as it comes back.
    placeholderData: (previous) => previous,
  });

  const [pending, setPending] = useState<{ user: AdminUserTarget; action: UserAction } | null>(null);
  /**
   * What the server said the last change was, and the age of the rows it was
   * said about. It is not an optimistic update: it is applied *after* a 200 and
   * it carries the status the server named, not the one that was asked for.
   *
   * `listedAt` is what makes it expire. It is `dataUpdatedAt` of the rows on
   * screen at the moment of the write, so this only overrides a list that
   * *predates* the change — the instant a successful refetch lands, the list is
   * newer and the override retires on its own. Without that, a change made by
   * somebody else afterwards would be painted over forever: the server would
   * say `ACTIVE` and the row would still read `Blocked`, offering an Unblock
   * the gateway refuses.
   *
   * Expiring on the *data* rather than on the invalidation settling is also
   * what protects the other end. A refetch that fails leaves the pre-write rows
   * in the cache, and clearing on settle would snap the row back to the status
   * the write had just replaced — so `dataUpdatedAt` does not move, and the
   * override survives exactly as long as the stale list it is correcting.
   */
  const [changed, setChanged] = useState<{ userId: string; status: UserStatus; listedAt: number } | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  /**
   * Mounted from the first render with an empty string rather than appearing
   * together with its text: a live region that arrives at the same moment as
   * its content depends on the screen reader's timing (§7).
   */
  const [announcement, setAnnouncement] = useState("");
  // The button the dialog was opened from, so focus goes back to it on close
  // (§7). `isConnected` because a row can be gone by then — a refetch that
  // dropped it, or a page change underneath.
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (flashed === null) return;
    const timer = window.setTimeout(() => setFlashed(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashed]);

  const closeDialog = () => {
    setPending(null);
    if (trigger.current?.isConnected) trigger.current.focus();
  };

  const rows = rowsQuery.data;

  if (rowsQuery.isPending) {
    return (
      <p className="admin-note" role="status">
        Loading accounts…
      </p>
    );
  }

  // Only when there is nothing to fall back on: react-query keeps the previous
  // page when a background refetch fails, and replacing a working list with an
  // alert because a window-focus refresh lost the network is a worse answer
  // than the slightly stale table already on screen.
  if (rowsQuery.isError && rows === undefined) {
    return <AdminError error={rowsQuery.error} onRetry={() => void rowsQuery.refetch()} />;
  }

  // A page past the end — a stale link, a hand-edited address, a table that has
  // shrunk since. `totalPages >= 1` for the reason the Data section records: an
  // empty table can legally answer `totalPages: 0`, and without the guard the
  // redirect resolves to the address it is already on and loops.
  if (rows && rows.pagination.totalPages >= 1 && page > rows.pagination.totalPages) {
    const last = rows.pagination.totalPages;
    return <Navigate replace to={last > 1 ? `/admin/users?page=${last}` : "/admin/users"} />;
  }

  const people = (rows?.rows ?? []).map(readUserRow);
  // Retired the moment the list on screen is newer than the change — see
  // `changed`. Derived rather than cleared in an effect: one rule, read where
  // it is used, instead of a second mechanism racing the first.
  const override = changed !== null && rowsQuery.dataUpdatedAt <= changed.listedAt ? changed : null;
  // The server's answer to the last change wins over a row the list has not
  // caught up with yet.
  const withChange = (user: AdminUserRow): AdminUserRow =>
    override && override.userId === user.id ? { ...user, status: override.status } : user;

  return (
    <div aria-busy={rowsQuery.isFetching} className="admin-plane admin-users-plane">
      <div className="admin-plane-head">
        {/* The table these accounts are read from, said once. The section is
            named "Users" in the heading above; this says where that comes
            from, which is the question an admin asks next. */}
        <h2 className="admin-table-name">
          {USERS_SERVICE}.{USERS_TABLE}
        </h2>
        {rows ? (
          <p className="admin-count">
            {rows.pagination.totalRows} {rows.pagination.totalRows === 1 ? "account" : "accounts"}
          </p>
        ) : null}
      </div>

      {/* There is no toast in this product (§5.6 records the gap), so a change
          is confirmed by the row itself: the pill takes the status the server
          named, the row is marked for two seconds, and this says it in words
          for a reader who sees neither. */}
      <p className="visually-hidden" role="status">
        {announcement}
      </p>

      {/* Focusable and named like every other table in this area (§7): with no
          sortable header there is nothing tabbable inside it, and without this
          it cannot be scrolled sideways from the keyboard at all in Safari or
          Firefox. */}
      <div
        aria-label={`${USERS_SERVICE}.${USERS_TABLE} accounts`}
        className="admin-table-scroll"
        role="region"
        tabIndex={0}
      >
        <table aria-label={`${USERS_SERVICE}.${USERS_TABLE}`} className="admin-table admin-users-table">
          <thead>
            <tr>
              {/* Named columns, not the catalog's own — this section knows what
                  it is looking at. No header is a button: the gateway states no
                  sortable column for this table (§5.8). */}
              <th scope="col">person</th>
              <th scope="col">login</th>
              <th scope="col">global role</th>
              <th scope="col">status</th>
              {/* Empty to the eye, named for a screen reader: a visible header
                  over the buttons would caption the one column that is not
                  data. */}
              <th className="admin-users-action-head" scope="col">
                <span className="visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                {/* `aria-live`, not `role="status"`: the role would replace the
                    cell role, and in table-navigation mode the message would
                    stop being part of the grid it is explaining. */}
                <td aria-live="polite" className="admin-empty-cell" colSpan={5}>
                  This gateway lists no accounts.
                </td>
              </tr>
            ) : null}
            {people.map((row, index) => {
              const user = withChange(row);
              const action = actionFor(user);
              const name = personLabel(user);
              // `flashed !== null` first, and it is not redundant: a row the
              // table gave no key for has `id === null`, and `null === null`
              // would mark every one of them the moment nothing is marked.
              const marked = flashed !== null && flashed === user.id;
              return (
                <tr className={marked ? "is-changed" : undefined} key={user.id ?? index}>
                  <td>
                    <span className="admin-user-name">{name}</span>
                    {/* Only when it adds something: an account with no display
                        name is already named by its address one line up. */}
                    {user.email && user.email !== name ? (
                      <span className="admin-user-email">{user.email}</span>
                    ) : null}
                  </td>
                  {/* The three value cells share one shape: the section's dash
                      for an absent value, kept pale, and the value otherwise. */}
                  <td className={user.login === null ? "admin-cell-mono admin-cell-null" : "admin-cell-mono"}>
                    {user.login ?? "—"}
                  </td>
                  <td className={user.globalRole === null ? "admin-cell-null" : undefined}>
                    {user.globalRole === null ? (
                      "—"
                    ) : (
                      <span className="admin-pill">{globalRoleLabel(user.globalRole)}</span>
                    )}
                  </td>
                  <td className={user.status === null ? "admin-cell-null" : undefined}>
                    {user.status === null ? "—" : <StatusPill status={user.status} />}
                  </td>
                  <td className="admin-users-action-cell">
                    {/* One button or none. A status this build does not
                        recognise prints verbatim and offers nothing (TAS-173):
                        the server decides which transitions are legal, and a
                        button that is certain to be refused is worse than no
                        button. Hiding it is not the permission — the server is
                        (§5.7). */}
                    {action && hasKey(user) ? (
                      <button
                        // "Block Nina Kowal", not "Block": seven buttons in a
                        // list all called Block are seven buttons a screen
                        // reader cannot tell apart. The visible word is
                        // contained in the name, as WCAG 2.5.3 requires.
                        aria-label={`${actionLabels[action]} ${name}`}
                        // The product's secondary button (§4.1), sized down for
                        // this table rather than rebuilt: border, surface,
                        // radius and hover all come from `.secondary-button`,
                        // and `.admin-user-action` only changes the three
                        // things the row's density decides.
                        className="secondary-button admin-user-action"
                        onClick={(event) => {
                          trigger.current = event.currentTarget;
                          setPending({ user, action });
                        }}
                        type="button"
                      >
                        {actionLabels[action]}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows ? <AdminPager onPage={setPage} pagination={rows.pagination} /> : null}
      </div>

      {pending ? (
        <AdminUserActionModal
          action={pending.action}
          currentUserId={meQuery.data?.id}
          onClose={closeDialog}
          onDone={(change) => {
            // The age of the rows this change is being said about, captured
            // before the refetch below can move it.
            setChanged({
              userId: pending.user.id,
              status: change.currentStatus,
              listedAt: rowsQuery.dataUpdatedAt,
            });
            setFlashed(pending.user.id);
            setAnnouncement(
              `${personLabel(pending.user)} is now ${userStatusLabel(change.currentStatus).toLowerCase()}.`,
            );
            closeDialog();
            // The server's answer paints the row; the list is still what the
            // section believes, so it is asked again.
            void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
          }}
          user={pending.user}
        />
      ) : null}
    </div>
  );
}

/**
 * The account's status as a §4.5 pill, sized for §5.8's table rather than for
 * the product's cards.
 *
 * Colour carries meaning here and decorates nothing (§1): `BLOCKED` is the only
 * state that is a problem, so it is the only one tinted. `ACTIVE` is the normal
 * state and stays quiet, and `INVITED` is told apart by a dashed edge rather
 * than by a second colour — the same "not there yet" the unassigned avatar
 * wears (§4.4). A value this build has never seen prints verbatim in the quiet
 * pill: it is a value, and the raw string is the whole message.
 */
function StatusPill({ status }: { status: string }) {
  // Only the two states that are drawn differently carry a modifier. `ACTIVE`
  // and a value this build does not recognise both wear the quiet pill, so
  // neither needs one.
  const modifier =
    status === "BLOCKED" ? " admin-status-blocked" : status === "INVITED" ? " admin-status-invited" : "";
  return <span className={`admin-pill${modifier}`}>{userStatusLabel(status)}</span>;
}
