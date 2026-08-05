import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskaApi } from "../api/TaskaApi";
import type { User } from "../domain/types";
import { App } from "./App";

/**
 * `/admin` decides what to render from an asynchronous answer, which is the
 * whole risk: a user who is not a GLOBAL_ADMIN must get the not-found screen
 * (DESIGN.md §4.18), and nobody — admin included — may see it flash while
 * `GET /users/me` is still in flight. Both need a `me` that can be held open on
 * demand, so this runs the real routes against a fake `TaskaApi` rather than
 * rendering the screen in isolation.
 */
/** The secret the console must never print, in any state. */
const SECRET = "$2b$10$never-render-me";

const { fakeApi, setCurrentUser, failMe, holdMe, releaseMe, holdRows, releaseRows, failCatalog, setMetaMismatch } =
  vi.hoisted(() => {
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
              { name: "password_hash", type: "varchar", sensitive: true },
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
    "auth.users": { columns: ["id", "password_hash"], rows: [{ id: "u1", password_hash: SECRET_VALUE }] },
    "admin.audit_log": { columns: ["id", "action"], rows: [{ id: "a1", action: "TABLE_READ" }] },
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
    listAdminRows: async (query: { service: string; table: string }) => {
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
      return {
        rows: table.rows,
        pagination: {
          currentPage: 1,
          pageSize: 20,
          totalRows: table.rows.length,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
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

vi.mock("../api/client", () => ({ taskaApi: fakeApi }));

const anna: User = {
  id: "3f1f5a2e-0000-4000-8000-000000000001",
  login: "anna",
  email: "anna@example.com",
  displayName: "Anna Ivanova",
  status: "ACTIVE",
};

function renderAdmin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const admin: User = { ...anna, globalRole: "GLOBAL_ADMIN" };

describe("/admin", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
    setCurrentUser(anna);
    window.localStorage.clear();
  });

  it("opens the section for a global admin", async () => {
    setCurrentUser({ ...anna, globalRole: "GLOBAL_ADMIN" });
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Administration" })).toBeVisible();
    // The same app shell as the project list, profile menu included.
    expect(screen.getByLabelText("Open profile for Anna Ivanova")).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to projects" })).toHaveAttribute("href", "/projects");
  });

  it("answers a plain user exactly as an unknown URL does", async () => {
    setCurrentUser({ ...anna, globalRole: "USER" });
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    // Nothing of the section leaks: not its heading, not its chrome.
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("treats an account with no stated role as not an admin", async () => {
    setCurrentUser(anna);
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  // A failed `me` reaches the screen as no data, exactly like a plain user, and
  // is answered the same way on purpose: the screen never learned that this
  // account is an admin, and an error state here would confirm the section
  // exists to someone who may not be allowed to know (§4.18). The server stays
  // the authority either way.
  it("answers a profile that failed to load as not an admin", async () => {
    failMe();
    renderAdmin();

    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("shows nothing at all until the profile answers, rather than flashing not found", async () => {
    setCurrentUser({ ...anna, globalRole: "GLOBAL_ADMIN" });
    holdMe();
    renderAdmin();

    // Several turns of the microtask queue: enough for react-query to have
    // resolved anything that was resolvable, and the answer still is not here.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole("heading", { name: "Page not found" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Administration" })).not.toBeInTheDocument();

    await act(async () => {
      releaseMe();
    });

    expect(await screen.findByRole("heading", { name: "Administration" })).toBeVisible();
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
});

/**
 * The console itself (TAS-155). Read-only in the strong sense: the one thing it
 * must never do is print a value the catalog marked sensitive, in any state —
 * including the moment between one table and the next.
 */
describe("/admin console", () => {
  beforeEach(() => {
    releaseMe();
    releaseRows();
    failCatalog(undefined);
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

  /**
   * The regression this pins was real and browser-confirmed: while a new table
   * loaded, react-query's `placeholderData` still held the previous table's
   * rows, but the masking rules were being read from the newly *selected*
   * table. Switching from a table with a secret column to one without therefore
   * rendered the old rows under the new rules and printed the hash in clear.
   * Everything drawn now comes from the response's own `meta`, so the rows and
   * the rules can never disagree.
   */
  it("keeps the previous table's rows masked while the next table loads", async () => {
    renderAdmin();
    // Wait for the rows themselves, not just the caption: the caption renders
    // from the selection before any data has arrived.
    expect(await screen.findByRole("cell", { name: "u1" })).toBeVisible();
    expect(screen.getByText("hidden")).toBeVisible();

    holdRows();
    fireEvent.click(screen.getByRole("button", { name: "audit_log" }));

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
    // The section still frames itself and still offers the way out.
    expect(screen.getByRole("heading", { name: "Administration" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to projects" })).toBeVisible();
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
    // The section still frames itself and still offers the way out.
    expect(screen.getByRole("heading", { name: "Administration" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to projects" })).toBeVisible();
  });
});
