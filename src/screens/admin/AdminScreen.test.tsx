import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../../api/TaskaApi";
import type { AdminRowsQuery, User } from "../../domain/types";
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
    metaMismatch?: boolean;
    rowsQuery?: AdminRowsQuery;
  } = {};

  // Two tables that differ in exactly the way that matters: one has a column
  // the catalog marks sensitive, the other has none.
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
              { name: "email", type: "varchar", sensitive: false },
              { name: "password_hash", type: "varchar", sensitive: true },
              { name: "created_at", type: "timestamptz", sensitive: false },
            ],
          },
        ],
      },
      {
        name: "admin",
        databaseAlias: "taska_admin",
        tables: [
          {
            name: "audit_log",
            primaryKey: "id",
            columns: [
              { name: "id", type: "uuid", sensitive: false },
              { name: "action", type: "varchar", sensitive: false },
            ],
          },
        ],
      },
    ],
  };

  const rowsByTable: Record<string, { columns: string[]; rows: Record<string, unknown>[] }> = {
    "auth.users": {
      columns: ["id", "email", "password_hash", "created_at"],
      rows: [
        {
          id: "u1",
          email: "anna@example.com",
          password_hash: SECRET_VALUE,
          created_at: "2026-08-01T10:00:00Z",
        },
      ],
    },
    // Three rows against a page size of 2, so this table genuinely has a second
    // page — the tests about paging and about a page past the end both need one
    // that exists.
    "admin.audit_log": {
      columns: ["id", "action"],
      rows: [
        { id: "a1", action: "TABLE_READ" },
        { id: "a2", action: "TABLE_READ" },
        { id: "a3", action: "TABLE_READ" },
      ],
    },
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
      return catalog;
    },
    listAdminRows: async (query: AdminRowsQuery) => {
      state.rowsQuery = query;
      if (state.rowsGate) await state.rowsGate;
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
      const pageSize = 2;
      const totalPages = Math.max(1, Math.ceil(table.rows.length / pageSize));
      const currentPage = Math.min(Math.max(1, query.page ?? 1), totalPages);
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

function renderAdmin(at = "/admin") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[at]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const currentLocation = () => screen.getByTestId("location").textContent;

const admin: User = { ...anna, globalRole: "GLOBAL_ADMIN" };

describe("/admin", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
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
    setMetaMismatch(false);
    setCurrentUser(admin);
    window.localStorage.clear();
  });

  it("stands in for Events with the story that will open it", async () => {
    renderAdmin("/admin/events");

    expect(await screen.findByRole("heading", { level: 1, name: /Administration.*Events/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Events — under construction" })).toBeVisible();
    const story = screen.getByRole("link", { name: "TAS-105" });
    expect(story).toHaveAttribute("href", "https://jira.ozero.dev/browse/TAS-105");
    expect(story).toHaveAttribute("target", "_blank");
    // The placeholder proposes nothing to do: the only sensible move is another
    // section, and that is already in the rail.
    expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
  });

  it("names both stories for Users", async () => {
    renderAdmin("/admin/users");

    expect(await screen.findByRole("heading", { level: 1, name: /Administration.*Users/ })).toBeVisible();
    expect(screen.getByRole("link", { name: "TAS-107" })).toBeVisible();
    expect(screen.getByRole("link", { name: "TAS-108" })).toBeVisible();
  });

  it("stands in for Audit", async () => {
    renderAdmin("/admin/audit");

    expect(await screen.findByRole("heading", { name: "Audit — under construction" })).toBeVisible();
    expect(screen.getByRole("link", { name: "TAS-160" })).toBeVisible();
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
    expect(screen.getByText("hidden")).toBeVisible();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(SECRET);
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
    expect(screen.getByText("hidden")).toBeVisible();

    holdRows();
    fireEvent.click(screen.getByRole("link", { name: "audit_log" }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Mid-switch: the old rows are still on screen, still masked, and still
    // captioned with the table they actually belong to.
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.getByText("hidden")).toBeVisible();
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

  // `from`/`to` become a timestamp comparison server-side, so a text column
  // must not be able to ask for one: the gateway answers with a database error
  // the UI cannot explain.
  it("offers the range operators only for a temporal column", async () => {
    renderAdmin("/admin/data/auth/users");
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "email" } });
    expect(screen.queryByRole("option", { name: "from" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Column"), { target: { value: "created_at" } });
    expect(screen.getByRole("option", { name: "from" })).toBeInTheDocument();
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

  it("names a refusal as being about the account or the table", async () => {
    failCatalog(Object.assign(new Error("Forbidden"), { status: 403 }));
    renderAdmin();

    expect(await screen.findByRole("alert")).toHaveTextContent(/refused this/i);
  });
});
