import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTaskaApi } from "./RestTaskaApi";

/**
 * The 401 path is the one piece of RestTaskaApi the UI cannot see for itself:
 * whether a rejected session is repaired quietly or announced once. TAS-150
 * turns that announcement into a redirect to the login form, so these tests pin
 * both halves — the repair that must stay silent and the death that must be
 * reported exactly once, however many parallel calls saw the 401.
 */
describe("RestTaskaApi session expiry", () => {
  // jsdom has no fetch; the object only needs the members request() reads.
  const answer = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  const seedTokens = () => {
    window.localStorage.setItem("taska.accessToken", "expired-access");
    window.localStorage.setItem("taska.refreshToken", "stale-refresh");
  };

  const storedTokens = () => ({
    access: window.localStorage.getItem("taska.accessToken"),
    refresh: window.localStorage.getItem("taska.refreshToken"),
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the tokens and reports the expiry once when the refresh also fails", async () => {
    seedTokens();
    const fetchStub = vi.fn(async (input: string) =>
      input.endsWith("/auth/refresh")
        ? answer(401, { code: "UNAUTHENTICATED", message: "Refresh token expired" })
        : answer(401, { code: "UNAUTHENTICATED", message: "Access token expired" }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    // Six parallel calls: the board fires roughly this many, and every one of
    // them sees the same 401. One expiry, not six.
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => api.getCurrentUser()));

    // The call still rejects: the redirect is driven by the callback, not by
    // swallowing the error.
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(expired).toHaveBeenCalledTimes(1);
    expect(storedTokens()).toEqual({ access: null, refresh: null });
    expect(api.hasSession()).toBe(false);
  });

  it("retries the request after a successful refresh and reports nothing", async () => {
    seedTokens();
    let meCalls = 0;
    const fetchStub = vi.fn(async (input: string) => {
      if (input.endsWith("/auth/refresh")) {
        return answer(200, { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresIn: 3600 });
      }
      meCalls += 1;
      return meCalls === 1
        ? answer(401, { code: "UNAUTHENTICATED", message: "Access token expired" })
        : answer(200, { id: "user-1", login: "anna", email: "anna@example.com", displayName: "Anna", status: "ACTIVE" });
    });
    vi.stubGlobal("fetch", fetchStub);

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    await expect(api.getCurrentUser()).resolves.toMatchObject({ email: "anna@example.com" });

    expect(meCalls).toBe(2);
    expect(expired).not.toHaveBeenCalled();
    expect(storedTokens()).toEqual({ access: "fresh-access", refresh: "fresh-refresh" });
    expect(api.hasSession()).toBe(true);
  });

  it("reports the expiry when the retried request is rejected again", async () => {
    seedTokens();
    const fetchStub = vi.fn(async (input: string) =>
      input.endsWith("/auth/refresh")
        ? answer(200, { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresIn: 3600 })
        : answer(401, { code: "UNAUTHENTICATED", message: "Access token expired" }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    // The refresh succeeds, so the request is retried — and the gateway rejects
    // the brand-new token too. Nothing is left to try, and before TAS-150 this
    // branch fell through silently with the tokens still in storage.
    await expect(api.getCurrentUser()).rejects.toThrow("Access token expired");

    expect(expired).toHaveBeenCalledTimes(1);
    expect(storedTokens()).toEqual({ access: null, refresh: null });
    expect(api.hasSession()).toBe(false);
  });

  it("leaves a newly signed-in session alone when a 401 from the previous one lands late", async () => {
    seedTokens();
    let resolveRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchStub = vi.fn(async (input: string) => {
      if (input.endsWith("/auth/refresh")) return pendingRefresh;
      if (input.endsWith("/auth/login")) {
        return answer(200, { accessToken: "second-access", refreshToken: "second-refresh", expiresIn: 3600 });
      }
      return answer(401, { code: "UNAUTHENTICATED", message: "Access token expired" });
    });
    vi.stubGlobal("fetch", fetchStub);

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    // The dead session's request is in the air, its refresh hanging.
    const stale = api.getCurrentUser();
    await vi.waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(2));

    // Meanwhile the user gives up, signs out and signs back in successfully.
    await api.logout();
    await api.login({ email: "anna@example.com", password: "correct" });

    // Only now does the old refresh answer — about a session that no longer
    // exists. Acting on it would clear the tokens the user just earned and put
    // "your session expired" on the login form of a session that works.
    resolveRefresh(answer(401, { code: "UNAUTHENTICATED", message: "Refresh token expired" }));
    await expect(stale).rejects.toThrow();

    expect(expired).not.toHaveBeenCalled();
    expect(storedTokens()).toEqual({ access: "second-access", refresh: "second-refresh" });
    expect(api.hasSession()).toBe(true);
  });

  it("reports the expiry when a 401 arrives with no refresh token to try", async () => {
    window.localStorage.setItem("taska.accessToken", "expired-access");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(401, { code: "UNAUTHENTICATED", message: "Access token expired" })),
    );

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    await expect(api.getCurrentUser()).rejects.toThrow("Access token expired");

    expect(expired).toHaveBeenCalledTimes(1);
    expect(api.hasSession()).toBe(false);
  });

  it("does not report an expiry when the user signs out", async () => {
    seedTokens();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(204, undefined)),
    );

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    await api.logout();

    // Signing out clears the session but is not an expiry: "your session
    // expired" on the login screen would be a lie.
    expect(expired).not.toHaveBeenCalled();
    expect(api.hasSession()).toBe(false);
  });

  it("stops calling a listener that unsubscribed", async () => {
    seedTokens();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(401, { code: "UNAUTHENTICATED", message: "Access token expired" })),
    );

    const api = new RestTaskaApi();
    const expired = vi.fn();
    const unsubscribe = api.onSessionExpired(expired);
    unsubscribe();

    await expect(api.getCurrentUser()).rejects.toThrow();

    expect(expired).not.toHaveBeenCalled();
  });
});

/**
 * `globalRole` is the first field the UI reads that the deployed gateway may
 * simply not send, and whose contract carries a value — UNSPECIFIED — that is
 * not a role. These cases pin the narrowing: two roles pass through, everything
 * else becomes "not stated", and the rest of the profile survives either way.
 */
describe("RestTaskaApi current user", () => {
  const answer = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  const me = (extra: Record<string, unknown>) => ({
    id: "user-1",
    login: "anna",
    email: "anna@example.com",
    displayName: "Anna Ivanova",
    status: "ACTIVE",
    ...extra,
  });

  const getCurrentUserWith = async (body: unknown) => {
    window.localStorage.setItem("taska.accessToken", "valid-access");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(200, body)),
    );
    return new RestTaskaApi().getCurrentUser();
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps GLOBAL_ADMIN", async () => {
    await expect(getCurrentUserWith(me({ globalRole: "GLOBAL_ADMIN" }))).resolves.toEqual({
      id: "user-1",
      login: "anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE",
      color: undefined,
      globalRole: "GLOBAL_ADMIN",
    });
  });

  it("maps USER", async () => {
    await expect(getCurrentUserWith(me({ globalRole: "USER" }))).resolves.toMatchObject({
      email: "anna@example.com",
      globalRole: "USER",
    });
  });

  it.each([
    ["the field is missing", {}],
    ["the value is the UNSPECIFIED zero value", { globalRole: "UNSPECIFIED" }],
    ["the value is a role this build has never heard of", { globalRole: "SUPER_ADMIN" }],
    ["the value is not a string at all", { globalRole: 3 }],
    ["the value is explicitly null", { globalRole: null }],
  ])("reports no role when %s, and still maps the rest of the profile", async (_case, extra) => {
    const user = await getCurrentUserWith(me(extra));

    expect(user.globalRole).toBeUndefined();
    expect(user).toMatchObject({
      id: "user-1",
      login: "anna",
      email: "anna@example.com",
      displayName: "Anna Ivanova",
      status: "ACTIVE",
    });
  });
});

/**
 * The read-only admin endpoints (TAS-155). The filter syntax is the part worth
 * pinning: the contract specifies it in prose and a free-form
 * `additionalProperties` object, so nothing validates it and a drift would
 * silently return the wrong rows rather than fail.
 */
describe("RestTaskaApi read-only admin", () => {
  // `_input` exists only so the stubs below declare the parameter they are
  // asserted on; without it `mock.calls[0][0]` is not typed.
  const answer = (body: unknown, _input?: string) =>
    ({
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  const rowsBody = {
    data: [{ id: "1", email: "a@example.com" }],
    pagination: { currentPage: 2, pageSize: 20, totalRows: 41, totalPages: 3, hasNext: true, hasPrev: true },
    meta: { service: "auth", table: "users", columns: ["id", "email"], sortableColumns: ["id"], filterableColumns: [] },
  };

  /** Runs a query and hands back the URL that actually went out. */
  const urlFor = async (query: Parameters<RestTaskaApi["listAdminRows"]>[0], body: unknown = rowsBody) => {
    const fetchStub = vi.fn(async (input: string) => answer(body, input));
    vi.stubGlobal("fetch", fetchStub);
    await new RestTaskaApi().listAdminRows(query);
    return new URL(fetchStub.mock.calls[0][0], "http://localhost");
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the catalog at the contract's path", async () => {
    const fetchStub = vi.fn(async (input: string) => answer({ services: [] }, input));
    vi.stubGlobal("fetch", fetchStub);

    await expect(new RestTaskaApi().getAdminCatalog()).resolves.toEqual({ services: [] });
    expect(fetchStub.mock.calls[0][0]).toContain("/readonly/metadata");
  });

  it("renames the wire's `data` to `rows` and passes pagination and meta through", async () => {
    const fetchStub = vi.fn(async () => answer(rowsBody));
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().listAdminRows({ service: "auth", table: "users" });

    expect(result.rows).toEqual([{ id: "1", email: "a@example.com" }]);
    expect(result.pagination.totalRows).toBe(41);
    expect(result.meta.columns).toEqual(["id", "email"]);
  });

  it("survives a response that omits data and the meta lists", async () => {
    const result = await (async () => {
      const fetchStub = vi.fn(async () =>
        answer({ pagination: rowsBody.pagination, meta: { service: "auth", table: "users" } }),
      );
      vi.stubGlobal("fetch", fetchStub);
      return new RestTaskaApi().listAdminRows({ service: "auth", table: "users" });
    })();

    // Nothing declares these required in the contract, and a table cannot draw
    // a header from `undefined`.
    expect(result.rows).toEqual([]);
    expect(result.meta.columns).toEqual([]);
    expect(result.meta.sortableColumns).toEqual([]);
    expect(result.meta.filterableColumns).toEqual([]);
  });

  it("puts the service and table in the path and the paging in the query", async () => {
    const url = await urlFor({ service: "auth", table: "users", page: 2, pageSize: 20 });

    expect(url.pathname).toContain("/readonly/auth/users");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("pageSize")).toBe("20");
  });

  it("sends order only alongside a sort column", async () => {
    const sorted = await urlFor({ service: "auth", table: "users", sort: "email", order: "desc" });
    expect(sorted.searchParams.get("sort")).toBe("email");
    expect(sorted.searchParams.get("order")).toBe("desc");

    const unsorted = await urlFor({ service: "auth", table: "users", order: "desc" });
    expect(unsorted.searchParams.has("sort")).toBe(false);
  });

  it.each([
    ["eq", "status", "status", "active"],
    ["contains", "email", "email.contains", "@gmail.com"],
    ["from", "created_at", "created_at.from", "2026-01-01T00:00:00Z"],
    ["to", "created_at", "created_at.to", "2026-12-31T23:59:59Z"],
  ] as const)("spells the %s filter as %s -> %s", async (operator, column, expectedKey, value) => {
    const url = await urlFor({
      service: "auth",
      table: "users",
      filters: [{ column, operator, value }],
    });

    expect(url.searchParams.get(expectedKey)).toBe(value);
  });

  it("treats an empty filter value as no filter rather than as matching empty", async () => {
    const url = await urlFor({
      service: "auth",
      table: "users",
      filters: [{ column: "email", operator: "contains", value: "" }],
    });

    expect(url.searchParams.has("email.contains")).toBe(false);
  });

  it("spells a filter around the paging keys instead of overwriting or dropping it", async () => {
    // The server owns the column names, so a table with a column called `page`
    // is its prerogative. The bare key would be eaten as paging, so the
    // explicit `.eq` spelling the contract documents is used instead — the
    // filter still reaches the server, and the requested page survives.
    const url = await urlFor({
      service: "admin",
      table: "audit_log",
      page: 3,
      sort: "created_at",
      filters: [
        { column: "page", operator: "eq", value: "99" },
        { column: "sort", operator: "eq", value: "nonsense" },
      ],
    });

    expect(url.searchParams.get("page")).toBe("3");
    expect(url.searchParams.get("sort")).toBe("created_at");
    expect(url.searchParams.get("page.eq")).toBe("99");
    expect(url.searchParams.get("sort.eq")).toBe("nonsense");
  });

  it("fills in a pagination block the server did not send rather than letting the pager crash", async () => {
    const fetchStub = vi.fn(async () => answer({ data: [{ id: "1" }], meta: { service: "auth", table: "users" } }));
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().listAdminRows({ service: "auth", table: "users", page: 2 });

    expect(result.pagination.currentPage).toBe(2);
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNext).toBe(false);
  });

  it("names the table we asked for when the server does not echo it back", async () => {
    const fetchStub = vi.fn(async () => answer({ data: [], pagination: rowsBody.pagination, meta: {} }));
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().listAdminRows({ service: "auth", table: "users" });

    // Without this the response cannot be matched against the catalog, and the
    // console refuses to render rows it cannot check for sensitive columns.
    expect(result.meta.service).toBe("auth");
    expect(result.meta.table).toBe("users");
  });

  it("gives back a walkable catalog even when the server omits every list", async () => {
    const fetchStub = vi.fn(async () => answer({ services: [{ name: "auth" }] }));
    vi.stubGlobal("fetch", fetchStub);

    const catalog = await new RestTaskaApi().getAdminCatalog();

    // The screen walks these; a missing list is a render crash, and with no
    // error boundary that is a blank page rather than a blank console.
    expect(catalog.services[0].tables).toEqual([]);
    await expect(
      (async () => {
        const empty = vi.fn(async () => answer({}));
        vi.stubGlobal("fetch", empty);
        return new RestTaskaApi().getAdminCatalog();
      })(),
    ).resolves.toEqual({ services: [] });
  });

  it("escapes a service or table name rather than letting it reshape the path", async () => {
    const url = await urlFor({ service: "auth", table: "../../users" });

    expect(url.pathname).not.toContain("/../");
  });
});
