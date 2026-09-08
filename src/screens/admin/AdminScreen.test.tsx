import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { TaskaApi } from "../../api/TaskaApi";
import type { AdminRowQuery, AdminRowsQuery, User } from "../../domain/types";
import { App } from "../App";

/**
 * `/admin` decides what to render from an asynchronous answer, which is the
 * whole risk: a user who is not a GLOBAL_ADMIN must get the not-found screen
 * (DESIGN.md §4.18), and nobody — admin included — may see it flash while
 * `GET /users/me` is still in flight. Both need a `me` that can be held open on
 * demand, so this runs the real routes against a fake `TaskaApi` rather than
 * rendering the screen in isolation.
 *
 * Since TAS-159 the area is a shell with sections and the selection lives in
 * the URL, so the routes are not an implementation detail of these tests — they
 * are part of what is under test.
 */
/** The secret the console must never print, in any state. */
const SECRET = "$2b$10$never-render-me";

const {
  fakeApi,
  setCurrentUser,
  failMe,
  holdMe,
  releaseMe,
  holdRows,
  releaseRows,
  failCatalog,
  serveCatalog,
  failRows,
  failRow,
  failSummary,
  holdSummary,
  releaseSummary,
  failRetry,
  lastRetry,
  summaryReads,
  setRetryStatus,
  setRetryMovesRow,
  holdRetry,
  releaseRetry,
  setMetaMismatch,
  lastRowsQuery,
} = vi.hoisted(() => {
  const SECRET_VALUE = "$2b$10$never-render-me";
  const state: {
    user?: User;
    failure?: Error;
    gate?: Promise<void>;
    release?: () => void;
    rowsGate?: Promise<void>;
    rowsRelease?: () => void;
    catalogFailure?: Error;
    catalogOverride?: typeof catalog;
    rowsFailure?: Error;
    rowFailure?: Error;
    summaryFailure?: Error;
    summaryReads?: number;
    summaryGate?: Promise<void>;
    summaryRelease?: () => void;
    retryFailure?: Error;
    retryStatus?: string;
    retryMovesRow?: boolean;
    movedStatuses?: Record<string, string>;
    retryGate?: Promise<void>;
    retryRelease?: () => void;
    retryCall?: { service: string; eventId: string; reason: string };
    metaMismatch?: boolean;
    rowsQuery?: AdminRowsQuery;
  } = {};

  // Two tables that differ in exactly the way that matters: one has a column
  // the catalog marks sensitive, the other has none.
  //
  // The types are spelled the way `information_schema` spells them, because
  // that is what the gateway forwards and what the console classifies columns
  // by — and the two primary keys differ on purpose: `auth.users` is keyed by a
  // uuid, which the gateway can address, and `admin.audit_log` is not.
  const catalog = {
    services: [
      {
        name: "auth",
        databaseAlias: "taska_auth",
        tables: [
          {
            name: "users",
            primaryKey: "id",
            columns: [
              { name: "id", type: "uuid", sensitive: false },
              { name: "email", type: "character varying", sensitive: false },
              // One column per masking treatment the gateway applies (TAS-104):
              // `password_hash` arrives unmasked here on purpose — that is the
              // gateway forgetting to mask, and it must still not reach the
              // screen — `recovery_email` is partially masked and is meant to
              // be read, and `token_hash` is hidden, so no row carries the key
              // at all while the catalog still names the column.
              { name: "password_hash", type: "character varying", sensitive: true },
              { name: "recovery_email", type: "character varying", sensitive: true },
              { name: "token_hash", type: "character varying", sensitive: true },
              { name: "failed_logins", type: "integer", sensitive: false },
              // Every class the filter form draws a different control for:
              // text, number, boolean, timestamp — and `id`, a type the gateway
              // does not classify at all, which keeps the free field.
              { name: "email_verified", type: "boolean", sensitive: false },
              { name: "created_at", type: "timestamp with time zone", sensitive: false },
            ],
          },
        ],
      },
      {
        name: "issue",
        databaseAlias: "taska_issue",
        // Empty, so the fake answers `totalPages: 0` for it.
        tables: [{ name: "empty_table", primaryKey: "id", columns: [{ name: "id", type: "uuid", sensitive: false }] }],
      },
      {
        name: "admin",
        databaseAlias: "taska_admin",
        tables: [
          {
            name: "audit_log",
            primaryKey: "id",
            columns: [
              // A readable code, not a uuid: the gateway parses the row id in
              // the path as a UUID, so these rows cannot be opened at all.
              { name: "id", type: "character varying", sensitive: false },
              { name: "action", type: "character varying", sensitive: false },
            ],
          },
        ],
      },
    ],
  };

  const rowsByTable: Record<string, { columns: string[]; rows: Record<string, unknown>[] }> = {
    "auth.users": {
      columns: [
        "id",
        "email",
        "password_hash",
        "recovery_email",
        "token_hash",
        "failed_logins",
        "email_verified",
        "created_at",
      ],
      rows: [
        {
          id: "u1",
          email: "anna@example.com",
          password_hash: SECRET_VALUE,
          recovery_email: "a**************m",
          // `token_hash` is absent, not null: a hidden column is deleted from
          // the row, which is the only way the console can tell it apart from
          // a column that is simply empty.
          failed_logins: 2,
          email_verified: true,
          created_at: null,
        },
      ],
    },
    // Three rows against a page size of 2, so this table genuinely has a second
    // page — the tests about paging and about a page past the end both need one
    // that exists.
    "issue.empty_table": { columns: ["id"], rows: [] },
    "admin.audit_log": {
      columns: ["id", "action"],
      rows: [
        { id: "a1", action: "TABLE_READ" },
        { id: "a2", action: "TABLE_READ" },
        { id: "a3", action: "TABLE_READ" },
      ],
    },
  };

  /**
   * The Events summary, shaped for the three things the Problems view decides
   * on its own: a zero beside a non-zero in the matrix, a status the build has
   * never heard of (which must render as itself and take nothing down), and a
   * list the server cut short.
   */
  const summary = {
    // Deliberately not in alphabetical order: the gateway collects these per
    // service concurrently and the response order is unspecified, so the matrix
    // has to impose one of its own or its rows would shuffle between refetches.
    counts: [
      { serviceKey: "issue", overdueNewCount: 0, stuckProcessingCount: 0, failedCount: 0 },
      { serviceKey: "auth", overdueNewCount: 0, stuckProcessingCount: 1, failedCount: 2 },
    ],
    events: [
      {
        id: "e1",
        aggregateType: "User",
        aggregateId: "u1",
        eventType: "user.registered",
        payload: '{"userId":"u1"}',
        status: "FAILED",
        createdAt: "2026-08-20T09:00:00Z",
        publishedAt: null,
        attempts: 5,
        lastErrorMessage: "Topic taska.auth.events not present in metadata after 60000 ms",
        processingStartedAt: "2026-08-20T09:01:00Z",
        requestId: null,
        serviceKey: "auth",
        reason: "Event processing failed",
      },
      {
        id: "e2",
        aggregateType: "User",
        aggregateId: "u1",
        eventType: "user.role_changed",
        payload: "{}",
        status: "QUARANTINED",
        createdAt: "2026-08-20T10:00:00Z",
        publishedAt: null,
        attempts: 0,
        lastErrorMessage: null,
        processingStartedAt: null,
        requestId: null,
        serviceKey: "auth",
        reason: "Something this build has never been told about",
      },
    ],
    notAllShown: true,
  };

  const api = {
    hasSession: () => true,
    onSessionExpired: () => () => {},
    getCurrentUser: async () => {
      if (state.gate) await state.gate;
      if (state.failure) throw state.failure;
      if (!state.user) throw new Error("the test did not say who is signed in");
      return state.user;
    },
    listProjects: async () => [],
    listNotifications: async () => ({ items: [], pageSize: 20, offset: 0 }),
    getAdminCatalog: async () => {
      if (state.catalogFailure) throw state.catalogFailure;
      return state.catalogOverride ?? catalog;
    },
    listAdminRows: async (query: AdminRowsQuery) => {
      state.rowsQuery = query;
      if (state.rowsGate) await state.rowsGate;
      if (state.rowsFailure) throw state.rowsFailure;
      const key = `${query.service}.${query.table}`;
      const table = rowsByTable[key] ?? { columns: [], rows: [] };
      if (state.metaMismatch) {
        // A response whose meta names a table the catalog does not describe.
        // Nothing in the contract obliges the two endpoints to spell a service
        // the same way, and this is the join the masking depends on.
        return {
          rows: rowsByTable["auth.users"].rows,
          pagination: { currentPage: 1, pageSize: 20, totalRows: 1, totalPages: 1, hasNext: false, hasPrev: false },
          meta: {
            service: "auth-service",
            table: "users",
            columns: rowsByTable["auth.users"].columns,
            sortableColumns: [],
            filterableColumns: [],
          },
        };
      }
      // Paginated for real rather than always claiming a single page. A fake
      // that reports `totalPages: 1` whatever it was asked for cannot show the
      // difference between a page that exists and one past the end, which is
      // exactly the case the screen has to handle. `pageSize` is small so a
      // seed of a few rows still produces more than one page.
      // No `Math.max(1, …)` here, deliberately. The mock clamps an empty table
      // to one page, and this fake used to copy that — which made
      // `totalPages: 0` unreachable in the tests even though the contract types
      // the field as a bare integer with no minimum and `ceil(0 / pageSize)` is
      // what a server would answer. A blank admin plane shipped through that
      // gap once; the fake now speaks the contract's shape, not the mock's.
      const pageSize = 2;
      const totalPages = Math.ceil(table.rows.length / pageSize);
      const currentPage = Math.min(Math.max(1, query.page ?? 1), Math.max(1, totalPages));
      const start = (currentPage - 1) * pageSize;
      return {
        rows: table.rows.slice(start, start + pageSize),
        pagination: {
          currentPage,
          pageSize,
          totalRows: table.rows.length,
          totalPages,
          hasNext: currentPage < totalPages,
          hasPrev: currentPage > 1,
        },
        meta: {
          service: query.service,
          table: query.table,
          columns: table.columns,
          sortableColumns: table.columns,
          filterableColumns: table.columns,
        },
      };
    },
    getAdminRow: async (query: AdminRowQuery) => {
      if (state.rowFailure) throw state.rowFailure;
      const table = rowsByTable[`${query.service}.${query.table}`];
      const row = table?.rows.find((candidate) => String(candidate.id) === query.id);
      if (!row) {
        // The shape a missing row arrives in from both implementations: a 404
        // from REST, a NOT_FOUND code from the mock.
        throw Object.assign(new Error("Row not found"), { status: 404, code: "NOT_FOUND" });
      }
      return row;
    },
    getProblematicOutboxSummary: async () => {
      // Counted, not just served: a refetch is invisible against a static
      // summary, and two of this section's rules — the write asks the list
      // again, and so does a dialog dismissed over a write in flight — are
      // *only* observable as another read. Counted when the read goes out and
      // gated after, so a held summary still proves the refetch was asked for.
      state.summaryReads = (state.summaryReads ?? 0) + 1;
      if (state.summaryGate) await state.summaryGate;
      if (state.summaryFailure) throw state.summaryFailure;
      const moved = state.movedStatuses;
      if (!moved) return summary;
      // A retry that actually moved a row, the way `MockTaskaApi` does: the
      // event stays in the list — an old `NEW` row is still overdue — and it is
      // the *status* that changes underneath it. See `setRetryMovesRow`.
      return {
        ...summary,
        events: summary.events.map((event) => {
          const status = moved[event.id];
          return status ? { ...event, status } : event;
        }),
      };
    },
    retryOutboxEvent: async (service: string, eventId: string, reason: string) => {
      state.retryCall = { service, eventId, reason };
      if (state.retryGate) await state.retryGate;
      if (state.retryFailure) throw state.retryFailure;
      if (state.retryMovesRow) {
        state.movedStatuses = { ...(state.movedStatuses ?? {}), [eventId]: state.retryStatus ?? "NEW" };
      }
      // What the server answers: the state read back off the row, with the
      // attempt count unchanged — the retry does not reset it. `NEW` is what
      // this endpoint answers today, and `setRetryStatus` is how a test says
      // "and if it ever answered something else" — the screen quotes the field
      // rather than repeating the word.
      const event = summary.events.find((candidate) => candidate.id === eventId);
      return { eventId, status: state.retryStatus ?? "NEW", attempts: event?.attempts ?? null };
    },
  };

  return {
    fakeApi: api as unknown as TaskaApi,
    setCurrentUser: (user: User) => {
      state.user = user;
      state.failure = undefined;
    },
    holdRows: () => {
      state.rowsGate = new Promise<void>((resolve) => {
        state.rowsRelease = resolve;
      });
    },
    releaseRows: () => {
      state.rowsRelease?.();
      state.rowsGate = undefined;
      state.rowsRelease = undefined;
    },
    failCatalog: (failure?: Error) => {
      state.catalogFailure = failure;
    },
    /** Serve a different catalog, for the shapes the seed cannot express. */
    serveCatalog: (replacement?: typeof catalog) => {
      state.catalogOverride = replacement;
    },
    /**
     * Fail the *rows* request, which every error test used to leave untested —
     * they all failed the catalog instead. That gap is what let the rows error
     * path rot: `placeholderData` keeps the previous table's rows forever, so
     * the guard could never fire again and a failed table said nothing at all.
     */
    failRows: (failure?: Error) => {
      state.rowsFailure = failure;
    },
    /** Fail the *single row* request, which is a different endpoint and a different card state. */
    failRow: (failure?: Error) => {
      state.rowFailure = failure;
    },
    /** Fail the Events summary read. */
    failSummary: (failure?: Error) => {
      state.summaryFailure = failure;
    },
    /**
     * Keep the Problems summary pending until `releaseSummary()`.
     *
     * The window it opens is the one a write cannot avoid: the answer to the
     * retry has arrived and the read it set off has not, so the row on screen is
     * still the one from before the write. In production that window is a whole
     * round trip, and what an operator does inside it is the difference between
     * a focus rescue and a focus steal.
     */
    holdSummary: () => {
      state.summaryGate = new Promise<void>((resolve) => {
        state.summaryRelease = resolve;
      });
    },
    releaseSummary: () => {
      state.summaryRelease?.();
      state.summaryGate = undefined;
      state.summaryRelease = undefined;
    },
    /**
     * Fail the Events retry write, which keeps its dialog open with the answer.
     * Also forgets the last call: this is the per-test reset for that endpoint,
     * and a recorded call surviving into the next test would let an assertion
     * that nothing was written pass on the previous test's evidence.
     */
    failRetry: (failure?: Error) => {
      state.retryFailure = failure;
      state.retryCall = undefined;
    },
    /** What the last retry actually asked the server for. */
    lastRetry: () => state.retryCall,
    /** How many times the Problems summary has been read, refetches included. */
    summaryReads: () => state.summaryReads ?? 0,
    /**
     * What the retry endpoint answers as the row's new state. `NEW` unless a
     * test says otherwise — the point of the knob is that the screen has to
     * quote this and not the word `NEW`.
     */
    setRetryStatus: (status?: string) => {
      state.retryStatus = status;
    },
    /**
     * Whether a successful retry **changes the row the next read returns**, as
     * `MockTaskaApi` does: it sets `status` to `NEW` synchronously and the
     * summary is derived from those rows, so the refetch a retry sets off comes
     * back with a row `canRetryOutboxEvent` refuses — and the Retry button that
     * opened the dialog is removed.
     *
     * Off by default, and that default is load-bearing rather than laziness: a
     * static summary is what lets the successful path assert that focus moves to
     * the list *unconditionally*, with the trigger still on screen. A rule that
     * only fires when the button happens to have gone is a rule nobody can read
     * off the code.
     *
     * On, it is the one thing that makes the removal — and so the focus loss
     * that follows it — reachable from a test at all. An earlier backlog line
     * called that loss unreproducible on a mock; `MockTaskaApi` reproduces it
     * in full, and this fake had simply never been asked to.
     */
    setRetryMovesRow: (on: boolean) => {
      state.retryMovesRow = on;
      state.movedStatuses = undefined;
    },
    /** Keep the retry pending until `releaseRetry()`, the only way to observe a dismissal over one. */
    holdRetry: () => {
      state.retryGate = new Promise<void>((resolve) => {
        state.retryRelease = resolve;
      });
    },
    releaseRetry: () => {
      state.retryRelease?.();
      state.retryGate = undefined;
      state.retryRelease = undefined;
    },
    setMetaMismatch: (on: boolean) => {
      state.metaMismatch = on;
    },
    /** What the last rows request actually asked the server for. */
    lastRowsQuery: () => state.rowsQuery,
    // `GET /users/me` failing with something that is not a 401: a 5xx, a
    // network drop, a CORS refusal — none of which end the session, so the
    // screen is left deciding with no role in hand.
    failMe: () => {
      state.user = undefined;
      state.failure = new Error("the profile request failed");
    },
    // Keeps `me` pending until `releaseMe()`, which is the only way to observe
    // what the screen renders before it settles.
    holdMe: () => {
      state.gate = new Promise<void>((resolve) => {
        state.release = resolve;
      });
    },
    releaseMe: () => {
      state.release?.();
      state.gate = undefined;
      state.release = undefined;
    },
  };
});

vi.mock("../../api/client", () => ({ taskaApi: fakeApi }));

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  login: "anna",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

/** Reads the address back out of the router, which is where the selection lives. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

/**
 * A router-level navigation the test can trigger after the app has settled —
 * the equivalent of pasting a link into the address bar of a tab that is
 * already on another table. `history.pushState` would not do: the router would
 * not hear it, and the bug this exists for only appears when the previous
 * table's rows are still in the query cache as placeholder data.
 */
function Jump() {
  const navigate = useNavigate();
  const [to, setTo] = useState("");
  return (
    <>
      <input aria-label="jump target" onChange={(event) => setTo(event.target.value)} value={to} />
      <button onClick={() => navigate(to)} type="button">
        jump
      </button>
    </>
  );
}

function renderAdmin(at = "/admin") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <App />
        <LocationProbe />
        <Jump />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const currentLocation = () => screen.getByTestId("location").textContent;

/**
 * One macrotask. `await act(async () => …)` drains microtasks, which is enough
 * for anything that hangs off a resolved promise — but query-core delivers
 * observer notifications through `setTimeout(…, 0)`, so a state a component
 * only learns about that way (a mutation going pending, most of all) is not on
 * screen until a timer has fired.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const admin: User = { ...anna, globalRole: "GLOBAL_ADMIN" };

describe("/admin", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    setMetaMismatch(false);
    setCurrentUser(anna);
    window.localStorage.clear();
  });

  it("opens the area for a global admin, on the Data section", async () => {
    setCurrentUser(admin);
    renderAdmin();

    // The heading is the section's, because /admin is an area rather than a
    // screen (§5.8) — and a bare /admin resolves into a real address.
    expect(await screen.findByRole("heading", { level: 1, name: /Administration.*Data/ })).toBeVisible();
    // The substitution of the catalog's first table is visible in the address
    // rather than silent, which is why it can only be asserted once the catalog
    // has answered.
    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();
    expect(currentLocation()).toBe("/admin/data/auth/users");
    // The same app shell as the project list, profile menu included.
    expect(screen.getByLabelText("Open profile for Anna Ivanova")).toBeVisible();
    // The way out lives in the rail now, not under the content.
    const rail = screen.getByRole("navigation", { name: "Administration" });
    expect(within(rail).getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/projects");
  });

  it("draws every section, including the ones with no endpoints yet", async () => {
    setCurrentUser(admin);
    renderAdmin();

    const rail = await screen.findByRole("navigation", { name: "Administration" });
    for (const label of ["Data", "Events", "Users", "Audit"]) {
      expect(within(rail).getByRole("link", { name: label })).toBeVisible();
    }
  });

  it("answers a plain user exactly as an unknown URL does", async () => {
    setCurrentUser({ ...anna, globalRole: "USER" });
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    // Nothing of the area leaks: not its rail, not its sections.
    expect(screen.queryByRole("navigation", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("answers a plain user the same way deep inside the area", async () => {
    setCurrentUser({ ...anna, globalRole: "USER" });
    renderAdmin("/admin/data/auth/users");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("treats an account with no stated role as not an admin", async () => {
    setCurrentUser(anna);
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  // A failed `me` reaches the screen as no data, exactly like a plain user, and
  // is answered the same way on purpose: the screen never learned that this
  // account is an admin, and an error state here would confirm the area exists
  // to someone who may not be allowed to know (§4.18). The server stays the
  // authority either way.
  it("answers a profile that failed to load as not an admin", async () => {
    failMe();
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("shows nothing at all until the profile answers, rather than flashing not found", async () => {
    setCurrentUser(admin);
    holdMe();
    renderAdmin();

    // Several turns of the microtask queue: enough for react-query to have
    // resolved anything that was resolvable, and the answer still is not here.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Administration.*Data/ })).not.toBeInTheDocument();

    await act(async () => {
      releaseMe();
    });

    expect(await screen.findByRole("heading", { name: /Administration.*Data/ })).toBeVisible();
  });

  it("does not flash not found on the way to answering a plain user", async () => {
    setCurrentUser({ ...anna, globalRole: "USER" });
    holdMe();
    renderAdmin();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();

    await act(async () => {
      releaseMe();
    });

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  // An address inside the area that is not a section is still an unknown
  // address, and gets the same answer as any other one — not an admin shell
  // wrapped around an empty body.
  it("answers an unknown section as an unknown URL", async () => {
    setCurrentUser(admin);
    renderAdmin("/admin/nothing-here");

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Administration" })).not.toBeInTheDocument();
  });
});

/**
 * The sections that have no endpoints yet (§4.19). They are drawn on purpose:
 * the shape of the area is itself information, and the key of the story that
 * will fill a section is useful to exactly the person reading this screen.
 */
describe("/admin sections under construction", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("stands in for Audit", async () => {
    renderAdmin("/admin/audit");

    expect(await screen.findByRole("heading", { name: "Audit — under construction" })).toBeVisible();
    expect(screen.getByRole("link", { name: "TAS-160" })).toBeVisible();
  });

  // Users left this list with TAS-186, the same way Events left it with
  // TAS-167: the placeholder has to be *gone* rather than merely unreachable,
  // because `sections.ts` states no stories for it and the route table builds
  // the placeholder routes from exactly that field.
  it("no longer stands in for Users", async () => {
    renderAdmin("/admin/users");

    expect(await screen.findByRole("heading", { level: 1, name: /Administration.*Users/ })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /under construction/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "TAS-107" })).not.toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "status" })).toBeVisible();
  });

  // Events left this list with TAS-167, and the placeholder has to be gone
  // rather than merely unreachable: `sections.ts` states no stories for it, and
  // the route table builds the placeholder routes from exactly that field.
  it("no longer stands in for Events", async () => {
    renderAdmin("/admin/events");

    expect(await screen.findByRole("heading", { level: 1, name: /Administration.*Events/ })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /under construction/ })).not.toBeInTheDocument();
    const views = screen.getByRole("navigation", { name: "Events views" });
    expect(within(views).getByRole("link", { name: "Problems" })).toHaveAttribute("aria-current", "page");
    expect(within(views).getByRole("link", { name: "Outbox" })).toHaveAttribute("href", "/admin/events/outbox");
  });

  // The section body is replaced under a keyboard that stayed in the rail, and
  // a screen reader is told nothing at all unless focus moves (§7).
  it("moves focus to the heading of the section it navigated to", async () => {
    renderAdmin("/admin/data/auth/users");
    const rail = await screen.findByRole("navigation", { name: "Administration" });

    fireEvent.click(within(rail).getByRole("link", { name: "Audit" }));

    const heading = await screen.findByRole("heading", { level: 1, name: /Administration.*Audit/ });
    expect(heading).toHaveFocus();
  });
});

/**
 * The console itself (TAS-155, restructured by TAS-159). Read-only in the
 * strong sense: the one thing it must never do is print a value the catalog
 * marked sensitive, in any state — including the moment between one table and
 * the next.
 */
describe("/admin console", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("opens on the first table in the catalog rather than an empty frame", async () => {
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();
  });

  it("never prints a column the catalog marked sensitive", async () => {
    renderAdmin();

    // The column exists and is named; only its values are withheld.
    expect(await screen.findByRole("columnheader", { name: /password_hash/ })).toBeVisible();
    expect(screen.getAllByText("hidden").length).toBeGreaterThan(0);
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  /**
   * The gateway masks server-side now (TAS-104) and does it three ways, so
   * "sensitive" stopped meaning one thing on screen. A partial mask is a value
   * — it answers which mailbox a row belongs to — and the console printing a
   * lock over it threw away the entire reason the backend was asked for a
   * partial mask rather than a full one.
   */
  it("prints a partial mask rather than hiding it", async () => {
    renderAdmin();

    expect(await screen.findByRole("cell", { name: "a**************m" })).toBeVisible();
  });

  // What keeps the printed stars from reading as the stored value: the lock
  // moves to the column, where it is said once instead of on every row.
  it("marks a masked column in its header, and only a masked one", async () => {
    renderAdmin();

    expect(await screen.findByRole("columnheader", { name: "recovery_email, masked column" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "password_hash, masked column" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "email" })).toBeVisible();
  });

  // A hidden column arrives as a header with nothing behind it. The cell has to
  // say the server withheld it, or an admin reads it as an empty value and goes
  // looking for a bug in the data.
  it("withholds a column the gateway removed from the row entirely", async () => {
    renderAdmin();
    const row = (await screen.findByRole("cell", { name: "u1" })).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    const columns = screen.getAllByRole("columnheader").map((header) => header.textContent ?? "");

    const tokenCell = cells[columns.findIndex((name) => name.startsWith("token_hash"))];
    expect(within(tokenCell).getByText("hidden")).toBeVisible();
  });

  // The dash that stands in for an absent value is chrome, not data, and §5.8
  // gives it `--fg-3` in the table exactly as on the card. It rendered at full
  // `--fg` weight in the table and pale on the card — the same `null` in two
  // colours one click apart.
  it("marks an absent value in the table so it is drawn as the card draws it", async () => {
    renderAdmin("/admin/data/auth/users");
    const row = (await screen.findByRole("cell", { name: "u1" })).closest("tr")!;
    const cells = within(row).getAllByRole("cell");

    // created_at is null in the seed; email is not.
    expect(cells[cells.length - 2]).toHaveTextContent("—");
    expect(cells[cells.length - 2]).toHaveClass("admin-cell-null");
    expect(within(row).getByRole("cell", { name: "anna@example.com" })).not.toHaveClass("admin-cell-null");
    // The masked cell is not "absent" — it has a value, and saying otherwise
    // would leak the difference between an empty secret and a set one.
    for (const withheld of within(row).getAllByText("hidden")) {
      expect(withheld.closest("td")).not.toHaveClass("admin-cell-null");
    }
  });

  // Not the only way out — the rail has "Back to projects" at its foot — but it
  // is the one every reader tries first, and the top of the page had nothing
  // clickable on it at all.
  it("goes back to the projects from the logo", async () => {
    renderAdmin();

    const home = await screen.findByRole("link", { name: "Taska — all projects" });
    expect(home).toHaveAttribute("href", "/projects");
  });

  // The mirror of the fail-closed test below. `sensitive` is optional in the
  // contract and a missing flag reads as `true`, so a gateway that stops
  // sending it produces a *successful* read in which every column is locked —
  // key included — with no sort, no filter form and no row links. Silently,
  // that is indistinguishable from a table which really is all secret.
  it("says so when every column of a table comes back sensitive", async () => {
    const allSecret = {
      services: [
        {
          name: "auth",
          databaseAlias: "taska_auth",
          tables: [
            {
              name: "users",
              primaryKey: "id",
              columns: [
                { name: "id", type: "uuid", sensitive: true },
                { name: "email", type: "character varying", sensitive: true },
              ],
            },
          ],
        },
      ],
    };
    serveCatalog(allSecret);
    renderAdmin("/admin/data/auth/users");

    expect(await screen.findByRole("alert")).toHaveTextContent(/marks every column/i);
  });

  it("names the scroll container so it can be reached and scrolled from the keyboard", async () => {
    renderAdmin();

    const region = await screen.findByRole("region", { name: "auth.users rows" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  /**
   * The regression this pins was real and browser-confirmed: while a new table
   * loaded, react-query's `placeholderData` still held the previous table's
   * rows, but the masking rules were being read from the newly *selected*
   * table. Switching from a table with a secret column to one without therefore
   * rendered the old rows under the new rules and printed the hash in clear.
   * Everything drawn now comes from the response's own `meta`, so the rows and
   * the rules can never disagree — including now that the selection comes from
   * the URL rather than from component state.
   */
  it("keeps the previous table's rows masked while the next table loads", async () => {
    renderAdmin();
    // Wait for the rows themselves, not just the caption: the caption renders
    // from the selection before any data has arrived.
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();
    expect(screen.getAllByText("hidden").length).toBeGreaterThan(0);

    holdRows();
    fireEvent.click(screen.getByRole("link", { name: "audit_log" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mid-switch: the old rows are still on screen, still masked, and still
    // captioned with the table they actually belong to.
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getAllByText("hidden").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "auth.users" })).toBeVisible();

    await act(async () => {
      releaseRows();
    });

    expect(await screen.findByRole("heading", { name: "admin.audit_log" })).toBeVisible();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("says the admin API could not be reached instead of showing an empty console", async () => {
    failCatalog(new Error("readonly is not deployed here"));
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached|would not serve/i);
    // The area still frames itself and still offers the way out.
    expect(screen.getByRole("heading", { level: 1, name: /Administration.*Data/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to projects" })).toBeVisible();
  });
});

/**
 * The selection lives in the URL (§5.8), which is the point of the whole
 * restructure: an admin's link to a table has to open the same rows for the
 * next admin and survive a reload.
 */
describe("/admin console selection in the URL", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("opens the table, page and filter a copied link names", async () => {
    renderAdmin("/admin/data/admin/audit_log?page=2&sort=id&order=desc&filter=action:contains:TABLE");

    expect(await screen.findByRole("heading", { name: "admin.audit_log" })).toBeVisible();
    // Not just on screen: the query the server was asked carries all of it.
    expect(lastRowsQuery()).toMatchObject({
      service: "admin",
      table: "audit_log",
      page: 2,
      sort: "id",
      order: "desc",
      filters: [{ column: "action", operator: "contains", value: "TABLE" }],
    });
    // And the applied filter is stated on screen, not only in the address.
    expect(screen.getByRole("button", { name: "Remove filter on action" })).toBeVisible();
  });

  // Hiding the sort button and leaving the column out of the filter list only
  // binds people who use the controls. The address bar is the other door, and
  // it went straight to the gateway: ordering by a hidden column leaks its
  // order, and filtering on it turns the table into a match oracle for the
  // value the console just refused to print.
  it("refuses a sort the address asks for on a column the catalog hides", async () => {
    renderAdmin("/admin/data/auth/users?sort=password_hash&order=desc");

    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();
    expect(lastRowsQuery()?.sort).toBeUndefined();
    expect(lastRowsQuery()?.order).toBeUndefined();
  });

  it("refuses a filter the address asks for on a column the catalog hides", async () => {
    renderAdmin("/admin/data/auth/users?filter=password_hash:contains:mock3");

    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();
    expect(lastRowsQuery()?.filters).toBeUndefined();
    // And the chip does not claim a filter is applied when none was sent.
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
  });

  // The clamp above reads the pagination of the rows *on screen*, and during a
  // switch those are still the previous table's — kept there by
  // `placeholderData`. Comparing against them sent a link to a page that
  // genuinely exists back to the single-page table the reader was leaving,
  // named from the wrong meta. A cold mount cannot catch it: the placeholder
  // has to be warm, so this test opens one table first.
  it("opens a deep link to another table's real page instead of bouncing back", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();

    // The link the reader was sent carries a page that exists in the table it
    // names, and nothing about the table they happened to be on.
    fireEvent.change(screen.getByLabelText("jump target"), {
      target: { value: "/admin/data/admin/audit_log?page=2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "jump" }));

    expect(await screen.findByRole("heading", { name: "admin.audit_log" })).toBeVisible();
    // The address is left exactly as it was pasted — page 2 exists in this
    // table — and the request went to that table's second page, not back to
    // the single-page table the reader was on.
    expect(screen.getByTestId("location").textContent).toBe("/admin/data/admin/audit_log?page=2");
    expect(lastRowsQuery()).toMatchObject({ service: "admin", table: "audit_log", page: 2 });
  });

  it("says so when the rows fail after another table has already loaded", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();

    // `placeholderData` keeps the loaded rows, so this is the state where the
    // screen used to leave the previous table on screen and say nothing.
    failRows(new Error("the gateway refused this table"));
    fireEvent.click(screen.getByRole("link", { name: "audit_log" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached|refused/i);
    expect(screen.queryByRole("cell", { name: "u1" })).toBeNull();
  });

  // `totalPages: 0` is what a gateway answers for an empty table — the contract
  // types the field as a bare integer with no minimum. Every page number
  // exceeds 0, so a clamp that does not exclude it redirects to page 0, which
  // `writeViewState` omits, which makes the target the address already open:
  // <Navigate> on every render and a blank plane that never errors, so nothing
  // reports it.
  it("still draws the console when the server says the table has no pages", async () => {
    renderAdmin("/admin/data/issue/empty_table");

    expect(await screen.findByRole("heading", { name: "issue.empty_table" })).toBeVisible();
    expect(screen.getByRole("link", { name: "users" })).toBeVisible();
    expect(screen.getByText("This table is empty.")).toBeVisible();
    // Not "Page 1 of 0", which reads as a fault rather than as an answer.
    expect(screen.getByText("Page 1 of 1")).toBeVisible();
  });

  it("lands on the last page when the address names one past the end", async () => {
    renderAdmin("/admin/data/admin/audit_log?page=999");

    expect(await screen.findByRole("heading", { name: "admin.audit_log" })).toBeVisible();
    // The rows are the last page's, and the pager is still there to move with —
    // not "This table is empty" and no way back.
    expect(lastRowsQuery()?.page).toBe(2);
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("writes the chosen table into the address, without the previous table's query", async () => {
    renderAdmin("/admin/data/auth/users?page=3&filter=email:contains:anna");
    expect(await screen.findByRole("heading", { name: "auth.users" })).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "audit_log" }));

    expect(currentLocation()).toBe("/admin/data/admin/audit_log");
  });

  it("writes an applied filter into the address", async () => {
    renderAdmin("/admin/data/admin/audit_log");
    expect(await screen.findByRole("cell", { name: "a1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "action" } });
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "contains" } });
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "TABLE_READ" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(currentLocation()).toBe("/admin/data/admin/audit_log?filter=action%3Acontains%3ATABLE_READ");
  });

  // Removing the filter unmounts the cross that was clicked; without the
  // hand-off the keyboard would be dropped on <body> (§7).
  it("keeps the keyboard on the filter control after the filter is removed", async () => {
    renderAdmin("/admin/data/admin/audit_log?filter=action:contains:TABLE_READ");
    const remove = await screen.findByRole("button", { name: "Remove filter on action" });

    fireEvent.click(remove);

    expect(currentLocation()).toBe("/admin/data/admin/audit_log");
    expect(screen.getByRole("button", { name: "Filter" })).toHaveFocus();
  });

  // The gateway validates the operator against the column's type and answers
  // 400, so an operator offered on the wrong column is not a bad suggestion —
  // it is a request that cannot succeed, and the reader cannot tell why.
  it("offers the operators the column's type allows, and no others", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    // Text: equality and substring, no range.
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });
    expect(screen.getByRole("option", { name: "contains" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "from" })).not.toBeInTheDocument();

    // Temporal: equality and range, no substring.
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "created_at" } });
    expect(screen.getByRole("option", { name: "from" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "to" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "contains" })).not.toBeInTheDocument();

    // Numeric: range too — `from`/`to` are not a timestamp-only pair any more.
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "failed_logins" } });
    expect(screen.getByRole("option", { name: "from" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "contains" })).not.toBeInTheDocument();

    // Unknown to the gateway's type list: equality alone, failing towards the
    // filter that cannot be refused — and a single legal operator is stated
    // rather than put in a dropdown that cannot change it (§5.8).
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "id" } });
    expect(screen.queryByLabelText("Match")).toBeNull();
    expect(screen.queryByRole("option", { name: "from" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "contains" })).not.toBeInTheDocument();
  });

  // A dropdown holding one option is a control that cannot change anything, and
  // uuid, inet and boolean columns all have exactly one legal operator.
  it("states the match instead of offering a select when only one operator is legal", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email_verified" } });

    // No control — but the operator is still on screen, and it is still what
    // gets applied.
    expect(screen.queryByLabelText("Match")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Match" })).toBeNull();
    expect(screen.getByText("Match")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastRowsQuery()?.filters?.[0]).toMatchObject({ column: "email_verified", operator: "equals" });

    // And a column with a real choice gets the select back.
    fireEvent.click(screen.getByRole("button", { name: "email_verified is true" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });
    expect(screen.getByLabelText("Match")).toBeVisible();
  });

  // A stranded operator leaves the select showing a blank — its option is gone
  // — and applies a filter the gateway refuses.
  it("resets an operator the newly chosen column cannot take", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "contains" } });
    expect(screen.getByLabelText("Match")).toHaveValue("contains");

    // `contains` is text-only, and a timestamp column is not text.
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "created_at" } });
    expect(screen.getByLabelText("Match")).toHaveValue("equals");

    // The same in the other direction: a range operator on a text column.
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "created_at" } });
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "from" } });
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });
    expect(screen.getByLabelText("Match")).toHaveValue("equals");

    // And through a column that has no select at all: the stranded operator
    // still lands on `equals`, which is what a later column with a select shows.
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "contains" } });
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "id" } });
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });
    expect(screen.getByLabelText("Match")).toHaveValue("equals");
  });

  // A timestamp is parsed strictly server-side, so the form owns the format
  // (§5.8): the field is a picker and what leaves it is a full ISO-8601 moment.
  //
  // The digits are the whole point. Every timestamp this section prints is the
  // server's raw UTC string, so the picker is read as UTC — and this test is
  // meaningless at TZ=UTC alone. Run it under a non-UTC zone too
  // (`TZ=Europe/Moscow npx vitest run`): reading the field as local wall time
  // passes at UTC and is three hours wrong in Moscow, which is exactly how it
  // shipped.
  it("sends the digits that were typed, as UTC and without milliseconds", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "created_at" } });
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "from" } });
    // The field says which clock it is on, because the column beside it does
    // not: `2026-09-10T08:00:00Z`.
    const value = screen.getByLabelText("Value UTC");
    expect(value).toHaveAttribute("type", "datetime-local");

    fireEvent.change(value, { target: { value: "2026-09-10T08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const sent = lastRowsQuery()?.filters?.[0];
    expect(sent?.column).toBe("created_at");
    expect(sent?.operator).toBe("from");
    // Not "an instant with an offset" — *these* digits, and no `.000`.
    expect(sent?.value).toBe("2026-09-10T08:00:00Z");
  });

  it("shows the same digits on the chip and back in the picker", async () => {
    renderAdmin("/admin/data/auth/users?filter=created_at:from:2026-09-10T08:00:00Z");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    // One filter, one spelling: the chip says what the wire says.
    const chip = screen.getByRole("button", { name: "created_at from 2026-09-10T08:00:00Z" });
    // Truncated by width, so the whole value has to survive in `title` as well
    // as in the accessible name (§5.8).
    expect(chip).toHaveAttribute("title", "created_at from 2026-09-10T08:00:00Z");

    fireEvent.click(chip);

    // And the picker reopens on the digits the chip is showing, not on those
    // digits moved by the reader's offset.
    expect(screen.getByLabelText("Value UTC")).toHaveValue("2026-09-10T08:00");

    // Re-applying an untouched filter changes nothing about it.
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastRowsQuery()?.filters?.[0].value).toBe("2026-09-10T08:00:00Z");
  });

  it("keeps a text filter's plain field", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });

    expect(screen.getByLabelText("Value")).toHaveAttribute("type", "text");
    // A type the gateway does not parse takes the string as written, so it
    // keeps the free field too.
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "id" } });
    expect(screen.getByLabelText("Value")).toHaveAttribute("type", "text");
  });

  // The gateway parses the value against the column's type — `new BigDecimal`
  // for a number, `true`/`false` for a boolean — and answers 400 for anything
  // else. A free field for either is a 400 the reader was given no help
  // avoiding, and it is what makes the rejected-request screen reachable from
  // the ordinary form (§5.8).
  it("gives a numeric column a numeric field", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "failed_logins" } });

    const value = screen.getByLabelText("Value");
    expect(value).toHaveAttribute("type", "number");
    // `numeric(10,2)` is a numeric column too, and the default step of 1 would
    // call its values invalid.
    expect(value).toHaveAttribute("step", "any");

    fireEvent.change(value, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastRowsQuery()?.filters?.[0]).toMatchObject({ column: "failed_logins", value: "12" });
  });

  it("gives a boolean column a true/false choice rather than a text field", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email_verified" } });

    const value = screen.getByLabelText("Value");
    expect(value.tagName).toBe("SELECT");
    expect(within(value as HTMLSelectElement).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "true",
      "false",
    ]);

    fireEvent.change(value, { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(lastRowsQuery()?.filters?.[0]).toMatchObject({ column: "email_verified", value: "false" });
  });

  // §5.8: a blank filter is not applied and creates no chip. The picker makes
  // "open it, pick nothing, Apply" an easy gesture, and the API layer drops an
  // empty value from the request — so the chip claimed a filter that had never
  // been sent, over a table nothing had narrowed.
  it("applies nothing and shows no chip when the value is left blank", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "created_at" } });
    fireEvent.change(screen.getByLabelText("Match"), { target: { value: "from" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
    expect(currentLocation()).toBe("/admin/data/auth/users");
    expect(lastRowsQuery()?.filters).toBeUndefined();
    // And the empty-result copy does not blame a filter that was never applied.
    expect(screen.queryByText("No rows match this filter.")).toBeNull();
  });

  it("drops an applied filter when its value is cleared", async () => {
    renderAdmin("/admin/data/auth/users?filter=email:contains:anna");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /email contains anna/ }));
    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(currentLocation()).toBe("/admin/data/auth/users");
    expect(screen.queryByRole("button", { name: /Remove filter/ })).toBeNull();
  });
});

/**
 * A row is an address of its own (§5.8) — but only where the gateway can
 * actually take it: `GET /readonly/{service}/{table}/{id}` types the id as a
 * UUID, so a table keyed by a code has no addressable rows at all and must not
 * offer a link that is certain to be refused.
 */
describe("/admin console, opening one row", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    failRow(undefined);
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("links a row when the catalog says the key is a uuid", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    expect(screen.getByRole("link", { name: "Open row u1" })).toHaveAttribute("href", "/admin/data/auth/users/u1");
  });

  it("does not link a row the gateway could not address", async () => {
    renderAdmin("/admin/data/admin/audit_log");
    expect(await screen.findByRole("cell", { name: "a1" })).toBeVisible();

    // Not styled-as-disabled, not a link that 400s: no link at all.
    expect(screen.queryByRole("link", { name: /Open row/ })).toBeNull();
  });

  it("carries the table's page and filter into the row address and back out again", async () => {
    renderAdmin("/admin/data/auth/users?filter=email:contains:anna");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: "Open row u1" }));

    expect(currentLocation()).toBe("/admin/data/auth/users/u1?filter=email%3Acontains%3Aanna");
    // Back from a row read on page 7 of a filtered table has to be page 7 of
    // that filter, not the top of an unfiltered one.
    //
    // "Back to …", not the table's name alone: the chevron is aria-hidden, so
    // the bare name made this link sound exactly like the heading below it
    // (§5.8). The visible text is still just the name.
    const back = await screen.findByRole("link", { name: "Back to auth.users" });
    expect(back).toHaveTextContent("auth.users");
    expect(screen.queryByRole("link", { name: "auth.users" })).toBeNull();
    fireEvent.click(back);
    expect(currentLocation()).toBe("/admin/data/auth/users?filter=email%3Acontains%3Aanna");
  });

  it("shows the row's fields, in full, with the section around it intact", async () => {
    renderAdmin("/admin/data/auth/users/u1");

    expect(await screen.findByRole("heading", { level: 2, name: "auth.users" })).toBeVisible();
    // Label and value as a pair, and the value is not shortened.
    const email = screen.getByText("email");
    expect(email.tagName).toBe("DT");
    expect(email.nextElementSibling).toHaveTextContent("anna@example.com");
    // A null column is a dash, not the word "null" and not an empty gap.
    expect(screen.getByText("created_at").nextElementSibling).toHaveTextContent("—");
    // The key in full, and copyable — this is where a reader comes for it.
    expect(screen.getByRole("button", { name: "Copy u1" })).toBeVisible();
    // The rail and the catalog column stay: the reader has not left the table.
    expect(screen.getByRole("navigation", { name: "Administration" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Tables" })).toBeVisible();
    // And the table itself is gone, rather than sitting under the card.
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("never prints a sensitive column on the card either", async () => {
    renderAdmin("/admin/data/auth/users/u1");

    // The column is named — the card must not misrepresent the row's shape —
    // and only its value is withheld.
    expect(await screen.findByText("password_hash")).toBeVisible();
    expect(screen.getAllByText("hidden").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  // ⌘/Ctrl for a new tab, Shift for a new window: the gestures that keep the
  // table open while a row is read. Routing in-app anyway took them away, and
  // the link in the last cell is a real link that already does all of it.
  it("leaves a modified click to the browser instead of navigating in-app", async () => {
    renderAdmin("/admin/data/auth/users");
    const cell = await screen.findByRole("cell", { name: "anna@example.com" });

    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) {
      fireEvent.click(cell, { [modifier]: true });
      expect(currentLocation()).toBe("/admin/data/auth/users");
    }

    // A plain click still opens the row: this is about the modifier, not about
    // taking the row's own click away.
    fireEvent.click(cell);
    expect(currentLocation()).toBe("/admin/data/auth/users/u1");
  });

  it("says the row is missing rather than answering with the not-found screen", async () => {
    renderAdmin("/admin/data/auth/users/nobody");

    // §4.18 is for an address that does not exist. This one does — the section,
    // the service and the table are all real — and only the row is absent.
    expect(await screen.findByText(/No row with this key in auth.users/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Page not found" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Tables" })).toBeVisible();
    // The way back out is still there, and still says it is the way back.
    expect(screen.getByRole("link", { name: "Back to auth.users" })).toBeVisible();
  });

  it("tells a server fault on the row apart from a missing row", async () => {
    failRow(Object.assign(new Error("Internal error"), { status: 500, requestId: "c85c0694" }));
    renderAdmin("/admin/data/auth/users/u1");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/fault on the server/i);
    expect(alert).toHaveTextContent("c85c0694");
    expect(screen.queryByText(/No row with this key/)).toBeNull();
  });
});

/**
 * Masking is a *join*: the rows response says which table it is, the catalog
 * says which of that table's columns are secret. Nothing in the contract
 * obliges the two endpoints to spell a service the same way, and neither has
 * ever answered this repository. If that join misses, "no columns are
 * sensitive" is indistinguishable on screen from a genuinely harmless table —
 * so it must fail closed rather than guess.
 */
describe("/admin console, when the catalog and the rows disagree", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("refuses to render rows it cannot check for sensitive columns", async () => {
    setMetaMismatch(true);
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent(/catalog does not describe/i);
    // The whole point: the secret is not on screen, and no table is either.
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // The area still frames itself and still offers the way out.
    expect(screen.getByRole("heading", { level: 1, name: /Administration.*Data/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to projects" })).toBeVisible();
  });
});

/**
 * Observed on the deployed gateway, 2026-08-06: the catalog loads and the rows
 * call answers 500 with a request id. Those three cases read very differently
 * to the person looking at them, so the copy has to tell them apart — calling a
 * server fault "could not be reached" sends the one reader who can act looking
 * at their own network.
 */
describe("/admin console error copy", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    // The fake's failures are module state and outlive a test, so each of these
    // starts from "nothing is failing" and breaks exactly one call.
    failCatalog(undefined);
    serveCatalog(undefined);
    failRows(undefined);
    failRow(undefined);
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("names a server fault as the server's, and shows the id that identifies it", async () => {
    const boom = Object.assign(new Error("Internal error"), { status: 500, requestId: "c85c0694-7909-4a8a" });
    failCatalog(boom);
    renderAdmin();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/fault on the server/i);
    expect(alert).toHaveTextContent("c85c0694-7909-4a8a");
    expect(alert).not.toHaveTextContent(/could not be reached/i);
  });

  it("copies the request id to the clipboard when it is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    failCatalog(Object.assign(new Error("Internal error"), { status: 500, requestId: "c85c0694-7909-4a8a" }));
    renderAdmin();

    const copy = await screen.findByRole("button", { name: "Copy request id c85c0694-7909-4a8a" });
    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith("c85c0694-7909-4a8a");
    expect(await screen.findByText("Copied")).toBeVisible();
  });

  it("keeps 'could not be reached' for a failure that never got a response", async () => {
    failCatalog(new Error("Failed to fetch"));
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be reached/i);
  });

  /**
   * Since TAS-103 the gateway validates the filter's operator and its value
   * against the column's type, so a 400 is the designed answer to bad input
   * rather than a rarity. Calling it "could not be reached" tells an admin who
   * mistyped a number that the infrastructure is down — a false claim, and one
   * that gets escalated as an outage. The screen made this exact mistake once
   * with 5xx already (docs/ai/API-DIVERGENCE.md).
   */
  it("names a rejected request as rejected, not as an unreachable API", async () => {
    failRows(
      Object.assign(new Error("Invalid filter value for column failed_logins"), {
        status: 400,
        requestId: "8f21ab0c",
      }),
    );
    renderAdmin("/admin/data/auth/users");

    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent(/could not be reached/i);
    expect(alert).toHaveTextContent(/would not accept this request/i);
    // The server's own line stays: it names the column and the problem, and it
    // is the only part that says what to change.
    expect(alert).toHaveTextContent("Invalid filter value for column failed_logins");
    expect(alert).toHaveTextContent("8f21ab0c");
  });

  // The mock carries a code where REST carries a status (src/api/errors.ts), and
  // both have to reach the same sentence or the two modes stop matching on
  // screen. This is the shape the mock answers a row id the gateway would not
  // parse with.
  it("says the same for the mock's own rejection, which carries no status", async () => {
    failRow(Object.assign(new Error("Row id AUD-1 is not a UUID"), { code: "INVALID_ARGUMENT" }));
    renderAdmin("/admin/data/auth/users/AUD-1");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/would not accept this request/i);
    expect(alert).not.toHaveTextContent(/could not be reached/i);
  });

  it("names a refusal as being about the account or the table", async () => {
    failCatalog(Object.assign(new Error("Forbidden"), { status: 403 }));
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent(/refused this/i);
  });
});

/**
 * The Events section's Problems view (TAS-167). Three of its decisions are made
 * from the response alone and cannot be reached from the mock-backed e2e suite,
 * which only ever gets a well-formed summary from a gateway that has the
 * endpoint: a zero next to a non-zero, a `status` this build has never heard of,
 * and the deployed gateway's own way of saying it does not serve this yet.
 */
describe("/admin/events problems", () => {
  beforeEach(() => {
    releaseMe();
    failCatalog(undefined);
    serveCatalog(undefined);
    failSummary(undefined);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("draws the counts per service, with zero told apart from a count", async () => {
    renderAdmin("/admin/events");

    const matrix = await screen.findByRole("table", { name: "Problem counts by service" });
    // The categories are columns and the services are rows, so a service is a
    // row header rather than a cell — which is what lets a screen reader say
    // "auth, Failed, 2" instead of reading three unlabelled numbers.
    expect(within(matrix).getByRole("rowheader", { name: "auth" })).toBeVisible();
    expect(within(matrix).getByRole("columnheader", { name: "Stuck processing" })).toBeVisible();

    const zero = within(matrix).getAllByRole("cell", { name: "0" })[0];
    const counted = within(matrix).getByRole("cell", { name: "2" });
    // Told apart by weight and colour, never by a red or a green: a 2 under
    // Failed is already the message (§1).
    expect(zero.className).toContain("is-zero");
    expect(counted.className).not.toContain("is-zero");
  });

  // The response arrives with `issue` before `auth`. Nothing in the contract
  // fixes that order — the backend counts each service concurrently — so the
  // matrix sorts by service key itself. A presentation sort, and pointedly not
  // one the events list gets: there the order *is* the endpoint's semantics.
  it("puts the matrix rows in a fixed order the response does not promise", async () => {
    renderAdmin("/admin/events");

    const matrix = await screen.findByRole("table", { name: "Problem counts by service" });
    expect(within(matrix).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["auth", "issue"]);
  });

  it("says the list was cut short, without calling it an error", async () => {
    renderAdmin("/admin/events");

    expect(await screen.findByText(/Showing the oldest 2 events/)).toBeVisible();
    // A statement about this response, not a failure: an alert here would send
    // the reader looking for something to fix in the UI.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a status it has never seen without a category and without falling over", async () => {
    renderAdmin("/admin/events");

    const list = await screen.findByRole("table", { name: "Problematic events, oldest first" });
    // The raw value survives in its own column …
    expect(within(list).getByRole("cell", { name: "QUARANTINED" })).toBeVisible();
    // … and the known one is still categorised beside it, so the unknown row
    // cost the rest of the table nothing.
    expect(within(list).getByRole("cell", { name: /^Failed,/ })).toBeVisible();
    expect(within(list).getAllByRole("link", { name: /^Open event / })).toHaveLength(2);
  });

  // The server's sentence is the one field of the summary with nowhere else to
  // go: it is not a table column, so the event card cannot show it, and a
  // column of its own would restate the category in more words. It rides on the
  // category cell instead (§5.8).
  it("carries the server's reason on the category cell, in title and in the accessible name", async () => {
    renderAdmin("/admin/events");

    const list = await screen.findByRole("table", { name: "Problematic events, oldest first" });
    // The visible word is still the derived category; the sentence is only in
    // the accessible name, which is why it reads as two things rather than one.
    const categorised = within(list).getByRole("cell", { name: "Failed, Event processing failed" });
    expect(categorised.querySelector("[aria-hidden=true]")).toHaveTextContent("Failed");
    expect(categorised).toHaveAttribute("title", "Event processing failed");

    // And a status with no category keeps the sentence, which is the case where
    // it is the only explanation of why the row is in this list at all.
    const uncategorised = within(list).getByRole("cell", {
      name: /Something this build has never been told about/,
    });
    expect(uncategorised).toHaveAttribute("title", "Something this build has never been told about");
  });

  /**
   * Until TAS-194 there was a case here for a sixth reading of this failure:
   * the deployed gateway did not have the summary's path, took `outbox` for a
   * service key and answered `400 INVALID_ARGUMENT "Unknown service: outbox"`,
   * which the view drew as a quiet "not deployed yet" note linking to TAS-105.
   * That gateway stopped existing on 2026-08-27 and the note came out with this
   * story. What is pinned now is that the same shape gets the ordinary taxonomy
   * — the guarantee the deleted branch was carved out of.
   */
  it("treats a rejection from the summary as a rejection, with nothing carved out of it", async () => {
    failSummary(Object.assign(new Error("Unknown service: outbox"), { code: "INVALID_ARGUMENT", status: 400 }));
    renderAdmin("/admin/events");

    expect(await screen.findByRole("alert")).toHaveTextContent(/would not accept this request/i);
    expect(screen.queryByText(/does not serve the problems summary yet/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "TAS-105" })).not.toBeInTheDocument();
  });
});

/**
 * Retrying a stuck outbox event (TAS-194) — the Events section's one write, and
 * the second write in the whole product.
 *
 * The fake's summary carries exactly the two rows this needs: a `FAILED` event
 * on `auth`, which may be retried, and one whose status this build has never
 * heard of, which may not. Everything below is about the difference between
 * those two and about what the dialog does with an answer.
 */
describe("admin events, retrying an event", () => {
  beforeEach(() => {
    setCurrentUser(admin);
    failSummary(undefined);
    releaseSummary();
    failRetry(undefined);
    setRetryStatus(undefined);
    setRetryMovesRow(false);
    releaseRetry();
  });

  const openDialog = async () => {
    renderAdmin("/admin/events");
    const button = await screen.findByRole("button", { name: "Retry event e1" });
    fireEvent.click(button);
    return button;
  };

  /**
   * One button or none, the Users section's rule. `e2` carries `QUARANTINED`:
   * the server would refuse it, and a control certain to be refused is worse
   * than no control (TAS-173, DESIGN.md §5.8).
   */
  it("offers a retry on the failed event and nothing on the one it cannot read", async () => {
    renderAdmin("/admin/events");

    expect(await screen.findByRole("button", { name: "Retry event e1" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Retry event e2" })).not.toBeInTheDocument();
    // Both rows still open, so the absent button costs the row nothing else.
    expect(screen.getAllByRole("link", { name: /^Open event / })).toHaveLength(2);
  });

  /**
   * The dialog says what will happen before it asks. Three facts the reader
   * cannot get anywhere else: which event, what it becomes, and that the attempt
   * count is *not* reset — the one thing about this endpoint an operator is
   * most likely to assume and be wrong about.
   */
  it("names the event, the transition and what the retry does not change", async () => {
    await openDialog();

    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    expect(within(dialog).getByText("user.registered")).toBeVisible();
    expect(within(dialog).getByText("auth.outbox_events")).toBeVisible();
    expect(within(dialog).getByText("e1")).toBeVisible();
    expect(within(dialog).getByText("FAILED → NEW")).toBeVisible();
    expect(within(dialog).getByText(/attempt count is/i)).toHaveTextContent(/not.*reset/i);
  });

  /**
   * The reason is required and never reaches the wire blank: the server answers
   * 400 for it and both implementations refuse it first, so the only place it
   * can be discovered is the dialog. The explanation lives beside the field
   * because a disabled button cannot take focus and its title would never be
   * read.
   */
  it("keeps the button off until a reason is typed, and says why beside the field", async () => {
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    const confirm = within(dialog).getByRole("button", { name: "Retry" });
    const field = within(dialog).getByLabelText("Reason");

    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText(/A reason is required/)).toBeVisible();

    // Whitespace is blank, exactly as the server reads it.
    fireEvent.change(field, { target: { value: "   " } });
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: "Kafka is back" } });
    expect(confirm).toBeEnabled();
    // And the same line becomes the countdown — to *this* route's 1000, not the
    // admin user writes' 550.
    expect(within(dialog).getByText("987 of 1000 characters left")).toBeVisible();
  });

  it("sends the trimmed reason, closes, marks the row and says so in words", async () => {
    const trigger = await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "  Kafka is back  " } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });

    expect(lastRetry()).toEqual({ service: "auth", eventId: "e1", reason: "Kafka is back" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    /**
     * Focus lands on the list's own region rather than on the trigger, and that
     * is the one place this differs from the Users dialog. A successful retry
     * removes the control that opened it — the server answers `NEW`, and this
     * list offers no retry on a `NEW` row — so returning to the trigger drops
     * focus on `<body>` and the next Tab restarts at the top of the document.
     * Measured in Chromium before this assertion existed.
     */
    expect(screen.getByRole("region", { name: "Problematic events" })).toHaveFocus();
    // Unconditionally, not as a fallback — this fake serves one static summary,
    // so the trigger survives here where against a real summary it would not.
    // The choice is the point: a rule that only fires when the button happens to
    // be gone is a rule nobody can read off the code.
    expect(trigger.isConnected).toBe(true);
    // The server's own word for the new state, in the section's live region —
    // there is no toast in this product (§5.6).
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
    expect(document.querySelector("tr.is-changed")).not.toBeNull();
  });

  /**
   * The confirmation quotes the server's own word for the new state. It is
   * `NEW` today and this asserts that it is not *hardcoded* to be: the fake
   * answers something else here, and the sentence has to follow it. Without
   * this the whole suite passes with the literal in place of the field, which
   * is exactly the mutation a backend that grew another state would ship into.
   */
  it("says the status the server answered, not the one it usually answers", async () => {
    setRetryStatus("REQUEUED");
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Kafka is back" } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now REQUEUED.");
  });

  /**
   * Dismissing over a retry still in flight. The request is not cancelled and
   * nobody is left watching it, so the one thing that must not happen is the
   * list going on showing a row the server may already have moved. Leaving asks
   * the list again — and `Esc` keeps working and Cancel stays enabled, which is
   * why the fix is a read rather than a trap.
   */
  it("asks the list again when it is dismissed over a retry still in flight", async () => {
    holdRetry();
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Kafka is back" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
      // A whole macrotask, not just the microtasks `act` drains: query-core
      // delivers observer notifications through `setTimeout(…, 0)`, so without
      // this the mutation is in flight and the button has not heard about it.
      await settle();
    });
    // In flight: the write went out and no answer has come back.
    expect(lastRetry()).toEqual({ service: "auth", eventId: "e1", reason: "Kafka is back" });
    expect(within(dialog).getByRole("button", { name: "Retrying…" })).toBeDisabled();

    const readsBeforeDismissal = summaryReads();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
      await settle();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The one assertion this test exists for: dismissal over a write in flight
    // asks the list again, so the row cannot be left showing a state the server
    // may already have changed.
    expect(summaryReads()).toBe(readsBeforeDismissal + 1);

    // And the answer that arrives afterwards still lands: react-query keeps a
    // mutation once its observer is gone, so the confirmation is late rather
    // than lost. Asserted because it is what makes the invalidation above a
    // guarantee instead of a coincidence — it holds for a *failed* answer too,
    // where nothing else would have asked the list anything.
    await act(async () => {
      releaseRetry();
      await settle();
    });
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
  });

  /**
   * Leaves a retry in flight, which is the only state in which a dismissal has
   * anything to do. Shared by the two tests below it because they differ in
   * exactly one line — which control dismisses — and that one line is the whole
   * reason both exist.
   */
  const startPendingRetry = async () => {
    holdRetry();
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Kafka is back" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
      // The macrotask query-core notifies observers on; see the test above.
      await settle();
    });
    expect(within(dialog).getByRole("button", { name: "Retrying…" })).toBeDisabled();
    return dialog;
  };

  /**
   * The same dismissal through the header's ✕, which is a different route into
   * it: `Esc` and Cancel are wired in this component, and ✕ and the backdrop
   * are `Modal`'s own controls, reached only through the handler this dialog
   * hands it.
   *
   * Written because that is the seam a simplification breaks in silence. With
   * `Modal`'s `onClose` given `onClose` instead of `dismiss` — the shape this
   * dialog started with — `Esc` and Cancel go on asking the list again and
   * these two stop, and every test above still passes. What is lost is the
   * whole point of the invalidation: the row goes on showing a state the server
   * may already have left, with nobody watching the write that changed it.
   */
  it("asks the list again when the header's close button dismisses a retry in flight", async () => {
    const dialog = await startPendingRetry();

    const readsBeforeDismissal = summaryReads();
    await act(async () => {
      // Named by its `title`, which is `Modal`'s only name for it — and exactly
      // the string the backdrop's own name is not, so this matches one button.
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await settle();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(summaryReads()).toBe(readsBeforeDismissal + 1);

    // And the late answer still lands, as it does after `Esc`: the request was
    // never cancelled, so the dismissal is what has to keep the list honest in
    // the meantime.
    await act(async () => {
      releaseRetry();
      await settle();
    });
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
  });

  /**
   * And the fourth route the docblock names. It is a real `<button>` in the
   * layer above the dialog rather than a click handler on a div, so it is as
   * reachable from a test as it is from a keyboard.
   */
  it("asks the list again when the backdrop dismisses a retry in flight", async () => {
    await startPendingRetry();

    const readsBeforeDismissal = summaryReads();
    await act(async () => {
      // Outside the dialog element, hence `screen` rather than `within`.
      fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
      await settle();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(summaryReads()).toBe(readsBeforeDismissal + 1);

    await act(async () => {
      releaseRetry();
      await settle();
    });
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
  });

  /**
   * The other half of that dismissal, and the negative the successful path's
   * assertions cannot state: a confirmation that arrives when nobody is waiting
   * for it announces, and does not reach for focus.
   *
   * A retry answered while the dialog is open moves focus to the list region,
   * because the trigger it would otherwise return to is removed by the refetch.
   * Run that same move seconds after Cancel and it is a focus steal — defensible
   * only if the operator is still sitting on the screen doing nothing, which is
   * the assumption every focus steal is built on. So the two paths are told
   * apart (`OutboxRetryArrival`) and only this one withholds the move.
   *
   * Everything else the answer does is unchanged, and asserted here rather than
   * assumed: it is the announcement that carries the result on this path, and it
   * is the invalidation that keeps the row from going on showing a state the
   * server has already left.
   */
  it("announces the late answer without taking focus back from wherever the operator went", async () => {
    holdRetry();
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Kafka is back" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
      // The macrotask query-core notifies observers on; see the test above.
      await settle();
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await settle();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // And moved on. Any focusable thing on the screen would do — this one is a
    // row the retry is not even about, which is the point: after a dismissal the
    // section has no claim on where the operator is.
    const elsewhere = screen.getByRole("link", { name: "Open event e2" });
    elsewhere.focus();
    expect(elsewhere).toHaveFocus();

    const readsBeforeAnswer = summaryReads();
    await act(async () => {
      releaseRetry();
      await settle();
    });

    // The confirmation still happens, in the channel that interrupts nobody …
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
    expect(document.querySelector("tr.is-changed")).not.toBeNull();
    // … the list is still asked again, so the row cannot be left stale …
    expect(summaryReads()).toBe(readsBeforeAnswer + 1);
    // … and focus is exactly where the operator left it.
    expect(elsewhere).toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).not.toHaveFocus();
  });

  /**
   * A retry submitted, dismissed with `Esc` while it is still in flight, and
   * about to be answered — with the fake moving the row the way `MockTaskaApi`
   * does, so the refetch the answer sets off takes the Retry button away.
   *
   * That last part is what every test below is about, and what the two above
   * could not see: against a static summary the trigger survives the
   * refetch, and every question about losing focus with it is unreachable.
   */
  const dismissPendingRetry = async () => {
    setRetryMovesRow(true);
    await startPendingRetry();
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
      await settle();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  };

  /**
   * The rescue, and the case it exists for is the *default* one: dismiss, then
   * do nothing.
   *
   * Dismissal returns focus to the Retry button, which is right — until the
   * answer arrives and the refetch behind it turns that row `NEW`, at which
   * point `canRetryOutboxEvent` drops the button and focus falls to `<body>`
   * with it. The next Tab then restarts at the top of the document, which is
   * the §7 failure the successful path already moves focus to avoid.
   *
   * It is a rescue and not the move it replaced: it fires only because the
   * element that had focus is the one the refetch removed. The four tests after
   * this one are the other side of that sentence — one for each condition, and
   * one for the pair of them.
   *
   * Both halves of the fix are load-bearing here, and each dies on its own.
   * Removing the rescue leaves focus on `<body>`. Keeping it but asking its
   * question in `invalidateQueries().then(…)` — the obvious place — leaves
   * focus on `<body>` too, because that promise resolves a microtask after the
   * fetch while the render that removes the button arrives on query-core's
   * `setTimeout(…, 0)`: the check reads a document where the button is still
   * connected, and the whole thing is inert with nothing red to show for it.
   */
  it("rescues focus to the list when the refetch removes the trigger the dismissal left it on", async () => {
    await dismissPendingRetry();

    // Where the dismissal put it, and where an operator who does nothing next
    // is still sitting when the write they can no longer see finishes.
    expect(screen.getByRole("button", { name: "Retry event e1" })).toHaveFocus();

    await act(async () => {
      releaseRetry();
      await settle();
    });

    // The row came back `NEW`, so the button focus was resting on is gone …
    expect(screen.queryByRole("button", { name: "Retry event e1" })).not.toBeInTheDocument();
    // … and focus did not go with it.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).toHaveFocus();
    // The rest of the late answer is unchanged by the rescue: it still
    // announces, and it is still the live region that carries the result.
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
  });

  /**
   * The same rescue, with the read the write asked for arriving *second* — and
   * this is the test that says the arm has to be paired with a particular read
   * rather than spent by the next one to come along.
   *
   * Two reads are in play on this path and they are always in this order: the
   * dismissal asks the list again, and only then does the answer land and the
   * write ask for its own. In the test above they arrive close enough together
   * to be committed as one, which hides the ordering entirely. Holding the
   * second one apart is what makes it visible — and what it makes visible is
   * that the dismissal's read has already been *served* by the time the arm is
   * set, with only its commit still to come.
   *
   * So the run this effect sees first is a read older than the arm, against a
   * list that still has the button in it. Spending the arm there — which is
   * what keying on `dataUpdatedAt` alone does — disarms the rescue one read
   * early, and the read that actually removes the button then finds nothing
   * armed and leaves focus on `<body>`. That failure is invisible to the five
   * tests around this one, which is the whole reason this one is here: without
   * it, `armedAt` is a guard nothing defends, and the next reader to find it
   * redundant deletes it and takes two of those five down with it.
   */
  it("still rescues focus when the dismissal's own read lands between the arm and the write's", async () => {
    await dismissPendingRetry();
    expect(screen.getByRole("button", { name: "Retry event e1" })).toHaveFocus();

    // Only the *next* read is held: the dismissal's has already been served,
    // and its commit is the one that arrives during the act() below.
    holdSummary();
    const readsBeforeAnswer = summaryReads();
    await act(async () => {
      releaseRetry();
      await settle();
    });

    // The write asked for its list, and it has not come back. The row on screen
    // is still the pre-write one, so the button — and the focus on it — are
    // exactly where the dismissal left them.
    expect(summaryReads()).toBe(readsBeforeAnswer + 1);
    expect(screen.getByRole("button", { name: "Retry event e1" })).toHaveFocus();

    await act(async () => {
      releaseSummary();
      await settle();
    });

    // Now the row is `NEW`, the button is gone, and the operator never moved —
    // so this is the rescue's own case, arriving one read later than usual.
    expect(screen.queryByRole("button", { name: "Retry event e1" })).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).toHaveFocus();
  });

  /**
   * And the steal must not come back with it.
   *
   * This is the same removal as the test above — the trigger goes, and the
   * rescue is the code that could move focus — with the one difference that
   * decides it: the operator went somewhere first. A rescue that fires here is
   * the focus steal the guard was written for, arriving through the fix for the
   * loss that guard caused.
   */
  it("leaves focus where the operator moved it, even though the refetch removes the trigger", async () => {
    await dismissPendingRetry();

    // Anywhere they chose. This one is a row the retry is not even about, which
    // is the point: after a dismissal the section has no claim on where they
    // are.
    const elsewhere = screen.getByRole("link", { name: "Open event e2" });
    elsewhere.focus();

    await act(async () => {
      releaseRetry();
      await settle();
    });

    expect(screen.queryByRole("button", { name: "Retry event e1" })).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).not.toHaveFocus();
  });

  /**
   * The operator moves *after* the answer and *before* the read it set off
   * comes back — the widest of the three windows, because in production it is a
   * whole round trip rather than a tick.
   *
   * The arm is set here: focus was on the trigger when the answer landed. What
   * stops the rescue is the third of its conditions, asked at the moment the
   * button actually goes — is focus still nowhere? It is not, so the
   * section leaves it alone. Dropping that check passes every other test in
   * this file and reintroduces the steal in the one shape a guard read at
   * answer-time cannot see.
   */
  it("does not take focus back when the operator moves while the refetch is still out", async () => {
    await dismissPendingRetry();
    expect(screen.getByRole("button", { name: "Retry event e1" })).toHaveFocus();

    holdSummary();
    await act(async () => {
      releaseRetry();
      await settle();
    });
    // The answer has arrived; the list has not. The row is still the one from
    // before the write, so the button — and the focus on it — are still there.
    expect(screen.getByRole("button", { name: "Retry event e1" })).toHaveFocus();

    const elsewhere = screen.getByRole("link", { name: "Open event e2" });
    elsewhere.focus();

    await act(async () => {
      releaseSummary();
      await settle();
    });

    expect(screen.queryByRole("button", { name: "Retry event e1" })).not.toBeInTheDocument();
    expect(elsewhere).toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).not.toHaveFocus();
  });

  /**
   * Focus already on `<body>` before the answer lands — clicking the page
   * background is all it takes — and the section leaves it there.
   *
   * The narrow case, and the only thing defending the first of the rescue's
   * three conditions: it rescues focus *it* lost, not focus that was already
   * nowhere. Dropping "was focus on this trigger when the answer arrived" from
   * the arm passes every other test in this file and fails this one, because
   * the other two conditions — the button went, focus is on `<body>` — are both
   * true here.
   */
  it("does not reach for focus that was already nowhere when the answer landed", async () => {
    await dismissPendingRetry();

    screen.getByRole("button", { name: "Retry event e1" }).blur();
    expect(document.body).toHaveFocus();

    await act(async () => {
      releaseRetry();
      await settle();
    });

    expect(screen.queryByRole("button", { name: "Retry event e1" })).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).not.toHaveFocus();
  });

  /**
   * The second of the three conditions, and the one that makes this a rescue at
   * all: the button has to have *gone*.
   *
   * The arm is set — focus was on the trigger when the answer arrived — and
   * then two things happen inside the refetch's window: the operator drops
   * focus on the page background, and the list comes back saying `PROCESSING`,
   * which this list still offers a retry on. So the row changed, the control
   * did not, and nothing was taken from anybody. Without the check, focus on
   * `<body>` is enough to move it into the list for a button that never left.
   */
  it("does not move focus when the refetch changes the row but keeps the trigger", async () => {
    await dismissPendingRetry();

    // Still eligible after the write, so the button survives the refetch.
    setRetryStatus("PROCESSING");
    holdSummary();
    await act(async () => {
      releaseRetry();
      await settle();
    });

    screen.getByRole("button", { name: "Retry event e1" }).blur();
    expect(document.body).toHaveFocus();

    await act(async () => {
      releaseSummary();
      await settle();
    });

    // The list did change — this is not a refetch that did nothing …
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now PROCESSING.");
    expect(screen.getByRole("cell", { name: "PROCESSING" })).toBeVisible();
    // … the button is still there, and so focus stays where the operator left
    // it rather than being moved on account of a loss that never happened.
    expect(screen.getByRole("button", { name: "Retry event e1" })).toBeVisible();
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("region", { name: "Problematic events" })).not.toHaveFocus();
  });

  /**
   * The same late answer, arriving while the dialog has been opened again.
   *
   * Closing the dialog is as much the dismissed dialog's business as moving
   * focus was, and it is the same intrusion in the same tick: the dialog on
   * screen is asking about the *next* retry, and an answer to the previous one
   * has no standing to close it out from under a half-typed reason.
   */
  it("leaves a dialog opened after the dismissal alone when the old answer lands", async () => {
    holdRetry();
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Kafka is back" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
      await settle();
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
      await settle();
    });

    // Straight back in on the same row: this fake serves one static summary, so
    // the trigger is still there to press.
    fireEvent.click(screen.getByRole("button", { name: "Retry event e1" }));
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Second thoughts" } });

    await act(async () => {
      releaseRetry();
      await settle();
    });

    const reopened = screen.getByRole("dialog", { name: "Retry outbox event" });
    expect(reopened).toBeVisible();
    // With what was typed into it still in it.
    expect(within(reopened).getByLabelText("Reason")).toHaveValue("Second thoughts");
    expect(screen.getByRole("region", { name: "Problematic events" })).not.toHaveFocus();
  });

  /**
   * The write landed and the read behind it did not.
   *
   * query-core sets `status: "error"` on a failed *background* refetch while
   * keeping the data it already has, so a view that tests `isError` before
   * using `data` throws away rows it still has — here, together with the flash
   * and the live region that are the only confirmation the write worked at all.
   * And this query does not retry itself, so nothing would put them back. The
   * failure is stated above the list instead.
   */
  it("keeps the list and the confirmation when the read behind the write fails", async () => {
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Kafka is back" } });
    // The write succeeds; the refetch it triggers is what breaks.
    failSummary(Object.assign(new Error("Internal error"), { code: "INTERNAL", status: 500 }));

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
      await settle();
    });

    // The rows the server last stated are still on screen …
    expect(screen.getByRole("table", { name: "Problematic events, oldest first" })).toBeVisible();
    // … with the two things that say the write happened …
    expect(screen.getByRole("status")).toHaveTextContent("user.registered on auth is now NEW.");
    expect(document.querySelector("tr.is-changed")).not.toBeNull();
    // … and the failed read above them rather than instead of them.
    expect(await screen.findByRole("alert")).toHaveTextContent(/gateway failed/i);
  });

  /**
   * A failure leaves the dialog open with the answer in it: closing over a
   * change that may not have happened would be the worst of the possible
   * answers (§5.8).
   */
  it("stays open on the not-eligible refusal and prints the server's own sentence", async () => {
    failRetry(
      Object.assign(new Error("Outbox event with status NEW is not eligible for retry"), {
        code: "FAILED_PRECONDITION",
        status: 400,
      }),
    );
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Try it" } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });

    expect(screen.getByRole("dialog", { name: "Retry outbox event" })).toBeVisible();
    // The conflict sentence, reached through `isConflict`'s *code* arm: this
    // refusal arrives on a 400, so a status check alone would have filed it
    // under "the gateway would not accept this request".
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent(/would not retry this event/i);
    expect(alert).toHaveTextContent("Outbox event with status NEW is not eligible for retry");
  });

  /**
   * The other side of that refusal, and the only thing defending the narrowing
   * in `RetryFailure`: the eligibility arm is reached on the *code* rather than
   * on the taxonomy's `conflict`, and this is the case that tells them apart.
   *
   * "The event is as it was" is a provable claim for `FAILED_PRECONDITION` —
   * admin-service checks eligibility before the `UPDATE` and again in the
   * `UPDATE`'s own `WHERE`, so that refusal moved nothing. `isConflict` also
   * admits a bare 409 and `ABORTED`, which this route does not emit today and
   * which come with no such proof behind them. They get the plain rejection
   * wording instead of a promise this dialog cannot keep.
   *
   * Written because widening the condition back to `failure === "conflict"`
   * passed the entire suite: the defect that restores is a dialog telling an
   * operator nothing happened at the one moment it cannot know, which is the
   * same sentence the 5xx and transport arms are forbidden from saying.
   */
  it("does not promise the event is unchanged for a conflict that is not the eligibility refusal", async () => {
    // A 409 the gateway could grow tomorrow — `ABORTED` is what admin-service
    // sends for the Users section's status-transition refusals, and nothing
    // stops this route from acquiring one of its own.
    failRetry(Object.assign(new Error("Retry was aborted"), { code: "ABORTED", status: 409 }));
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Try it" } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });

    const alert = await within(dialog).findByRole("alert");
    // `rejected`: it was read and refused, and what to change is in the
    // server's own words below.
    expect(alert).toHaveTextContent(/would not accept this request/i);
    // Not the eligibility arm, and above all not the guarantee that closes it.
    expect(alert).not.toHaveTextContent(/would not retry this event/i);
    expect(alert).not.toHaveTextContent(/as it was/i);
    // The server's sentence is printed either way — the arm decides the
    // explanation, never whether the operator sees what the server said.
    expect(alert).toHaveTextContent("Retry was aborted");
  });

  it("says a 403 is a refusal, not a fault", async () => {
    // The route is GLOBAL_ADMIN-only and the server stays the authority: the
    // section drawing a button has never been the permission (§5.7).
    failRetry(Object.assign(new Error("Forbidden"), { code: "PERMISSION_DENIED", status: 403 }));
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Try it" } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/server refused this/i);
  });

  /**
   * The rule this endpoint makes non-negotiable. admin-service commits the
   * UPDATE and *then* writes the audit row, so a 5xx and a dropped connection
   * are both compatible with a retry that already ran. Neither may be worded as
   * "nothing happened" — that is the one sentence that sends an operator looking
   * in the wrong place.
   */
  it("never reports a failure as 'nothing happened', because the write may have landed", async () => {
    failRetry(Object.assign(new Error("Internal error"), { code: "INTERNAL", status: 500 }));
    await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Try it" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/may still have gone through/i);

    // And the transport failure, which carries neither a status nor a code.
    failRetry(new TypeError("Failed to fetch"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/may or may not have been retried/i);
  });

  it("cancels without writing anything and hands focus back", async () => {
    const trigger = await openDialog();
    const dialog = screen.getByRole("dialog", { name: "Retry outbox event" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(lastRetry()).toBeUndefined();
    expect(trigger).toHaveFocus();
  });

  // §4.11: `Esc` cancels. Bound in the dialog itself, because `Modal` carries
  // neither key and giving them to every modal in the product is §7 debt
  // (TAS-142) rather than this story.
  it("closes on Escape", async () => {
    await openDialog();
    expect(screen.getByRole("dialog", { name: "Retry outbox event" })).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(lastRetry()).toBeUndefined();
  });
});
