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
 * Issue links (TAS-157). The contract asks for `linkType` (a closed enum) and
 * answers with `viewLinkType` (a bare string, no enum). These cases pin that
 * asymmetry in place — the request must not drift to the response's spelling,
 * and the response must survive a value this build has never heard of, because
 * the inverse of a `BLOCKS` seen from the other end is exactly such a value.
 */
describe("RestTaskaApi issue links", () => {
  const answer = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  const link = (extra: Record<string, unknown> = {}) => ({
    id: "link-1",
    projectId: "project-1",
    sourceIssueId: "issue-1",
    targetIssueId: "issue-2",
    viewLinkType: "BLOCKS",
    createdBy: "user-1",
    createdAt: "2026-06-19T09:10:00Z",
    ...extra,
  });

  // The parameters exist so `mock.calls[0]` is typed: the path and the init are
  // what these cases assert on.
  const stubFetch = (body: unknown, status = 200) => {
    const fetchStub = vi.fn(async (_input: string, _init?: { method?: string; body?: string }) =>
      answer(status, body),
    );
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  };

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("taska.accessToken", "valid-access");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the list from the issue-scoped path", async () => {
    const fetchStub = stubFetch({ items: [link()] });

    const links = await new RestTaskaApi().listIssueLinks("project-1", "issue-1");

    expect(fetchStub.mock.calls[0][0]).toBe("/api/v1/issues/issue-1/links");
    expect(fetchStub.mock.calls[0][1]).toMatchObject({ method: "GET" });
    expect(links).toEqual([
      {
        id: "link-1",
        projectId: "project-1",
        sourceIssueId: "issue-1",
        targetIssueId: "issue-2",
        viewLinkType: "BLOCKS",
        createdBy: "user-1",
        createdAt: "2026-06-19T09:10:00Z",
      },
    ]);
  });

  it("passes an unknown viewLinkType through instead of dropping or coercing the link", async () => {
    stubFetch({ items: [link({ viewLinkType: "IS_BLOCKED_BY" }), link({ id: "link-2", viewLinkType: "SUPERSEDES" })] });

    const links = await new RestTaskaApi().listIssueLinks("project-1", "issue-2");

    // The response field is not the request enum, and narrowing it to one would
    // throw away the values that make it worth having.
    expect(links.map((item) => item.viewLinkType)).toEqual(["IS_BLOCKED_BY", "SUPERSEDES"]);
  });

  it("survives a link that states no relation at all", async () => {
    stubFetch({ items: [link({ viewLinkType: undefined }), link({ id: "link-2", viewLinkType: 7 })] });

    const links = await new RestTaskaApi().listIssueLinks("project-1", "issue-1");

    // Nothing in `IssueLinkResponseDto` is `required`, so an absent or
    // non-string value is a shape the contract permits. It becomes "no relation
    // stated", never a relation we made up.
    expect(links.map((item) => item.viewLinkType)).toEqual(["", ""]);
    expect(links).toHaveLength(2);
  });

  it("treats a response with no items as an empty list", async () => {
    stubFetch({});

    await expect(new RestTaskaApi().listIssueLinks("project-1", "issue-1")).resolves.toEqual([]);
  });

  it("posts targetIssueId and linkType — the request spelling, not the response one", async () => {
    const fetchStub = stubFetch(link({ viewLinkType: "DUPLICATES" }), 201);

    const created = await new RestTaskaApi().createIssueLink("project-1", "issue-1", {
      targetIssueId: "issue-2",
      linkType: "DUPLICATES",
    });

    expect(fetchStub.mock.calls[0][0]).toBe("/api/v1/issues/issue-1/links");
    const request = fetchStub.mock.calls[0][1];
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({ targetIssueId: "issue-2", linkType: "DUPLICATES" });
    expect(created.viewLinkType).toBe("DUPLICATES");
  });

  it("deletes a link at the contract's path and expects no body", async () => {
    const fetchStub = stubFetch(undefined, 204);

    await expect(new RestTaskaApi().deleteIssueLink("project-1", "issue-1", "link-1")).resolves.toBeUndefined();

    expect(fetchStub.mock.calls[0][0]).toBe("/api/v1/issues/issue-1/links/link-1");
    expect(fetchStub.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
  });

  it("escapes the issue and link ids rather than letting them reshape the path", async () => {
    const fetchStub = stubFetch(undefined, 204);

    await new RestTaskaApi().deleteIssueLink("project-1", "../../issues", "../links");

    expect(String(fetchStub.mock.calls[0][0])).not.toContain("/../");
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
    // `/readonly/catalog` since backend b22a2e0 (TAS-103). The old
    // `/readonly/metadata` 404s, which took the whole admin area down with it —
    // this endpoint is the first call the section makes.
    expect(fetchStub.mock.calls[0][0]).toContain("/readonly/catalog");
    expect(fetchStub.mock.calls[0][0]).not.toContain("/readonly/metadata");
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
    // The wire is 0-based, the domain and the URL are not: page 2 of the
    // console is `page=1` on the gateway.
    expect(url.searchParams.get("page")).toBe("1");
    expect(url.searchParams.get("pageSize")).toBe("20");
  });

  it("sends the first page as 0 and never sends a negative one", async () => {
    // `page=0` used to be a 400 and is now the default. The conversion lives
    // here alone, so it is pinned here alone.
    expect((await urlFor({ service: "auth", table: "users", page: 1 })).searchParams.get("page")).toBe("0");
    // Nothing should produce this — `readViewState` clamps to 1 — but a
    // negative page on the wire is a 400 that costs the reader the whole table.
    expect((await urlFor({ service: "auth", table: "users", page: 0 })).searchParams.get("page")).toBe("0");
    expect((await urlFor({ service: "auth", table: "users" })).searchParams.has("page")).toBe(false);
  });

  it("moves the answered page back onto the domain's 1-based count", async () => {
    const fetchStub = vi.fn(async () =>
      answer({
        data: [{ id: "1" }],
        // The gateway's second page.
        pagination: { currentPage: 1, pageSize: 20, totalRows: 41, totalPages: 3, hasNext: true, hasPrev: true },
        meta: { service: "auth", table: "users" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().listAdminRows({ service: "auth", table: "users", page: 2 });

    // The pager, the URL and everything above this line count from 1.
    expect(result.pagination.currentPage).toBe(2);
    // Basis-independent, so they arrive exactly as stated.
    expect(result.pagination.hasPrev).toBe(true);
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.totalPages).toBe(3);
  });

  // `null + 1` is 1, so a null here used to read as the first page: "Page 1 of
  // 5" printed over page 3's rows, with Next then stepping to 2. Nothing in the
  // contract forbids the null — none of the pagination fields is required — and
  // every sibling field already treats absent and null the same.
  it("does not read a null page number as the first page", async () => {
    const fetchStub = vi.fn(async () =>
      answer({
        data: [{ id: "1" }],
        pagination: { currentPage: null, pageSize: 20, totalRows: 41, totalPages: 3, hasNext: true, hasPrev: true },
        meta: { service: "auth", table: "users" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().listAdminRows({ service: "auth", table: "users", page: 3 });

    // The page we asked for, which is the only thing anyone knows here.
    expect(result.pagination.currentPage).toBe(3);
  });

  it("sends order only alongside a sort column", async () => {
    const sorted = await urlFor({ service: "auth", table: "users", sort: "email", order: "desc" });
    expect(sorted.searchParams.get("sort")).toBe("email");
    expect(sorted.searchParams.get("order")).toBe("desc");

    const unsorted = await urlFor({ service: "auth", table: "users", order: "desc" });
    expect(unsorted.searchParams.has("sort")).toBe(false);
  });

  // Every key carries its operator now. The gateway splits on the last dot and
  // answers 400 both for a key without one ("Filter key must contain operator")
  // and for an operator it does not know — the old bare-equality spelling is
  // not merely unfashionable, it fails.
  it.each([
    ["equals", "status", "status.equals", "active"],
    ["contains", "email", "email.contains", "@gmail.com"],
    ["from", "created_at", "created_at.from", "2026-01-01T00:00:00Z"],
    ["to", "created_at", "created_at.to", "2026-12-31T23:59:59Z"],
  ] as const)("spells the %s filter on %s as %s", async (operator, column, expectedKey, value) => {
    const url = await urlFor({
      service: "auth",
      table: "users",
      filters: [{ column, operator, value }],
    });

    expect(url.searchParams.get(expectedKey)).toBe(value);
    // The bare column name is not a filter key any more, for any operator.
    expect(url.searchParams.has(column)).toBe(false);
  });

  it("treats an empty filter value as no filter rather than as matching empty", async () => {
    // Kept after the operator rename, and now agreed with by the server: a
    // blank value is "Filter value must not be empty", a 400 that costs the
    // reader the table for an input they merely cleared.
    const url = await urlFor({
      service: "auth",
      table: "users",
      filters: [{ column: "email", operator: "contains", value: "" }],
    });

    expect(url.searchParams.has("email.contains")).toBe(false);
    expect([...url.searchParams.keys()].some((key) => key.startsWith("email"))).toBe(false);
  });

  it("cannot collide with the paging keys, because every filter key carries its operator", async () => {
    // The server owns the column names, so a table with a column called `page`
    // is its prerogative. The operator suffix is what keeps the two apart now:
    // `page.equals` is not `page`, so no rename is needed and none happens.
    const url = await urlFor({
      service: "admin",
      table: "audit_log",
      page: 3,
      sort: "created_at",
      filters: [
        { column: "page", operator: "equals", value: "99" },
        { column: "sort", operator: "equals", value: "nonsense" },
      ],
    });

    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("sort")).toBe("created_at");
    expect(url.searchParams.get("page.equals")).toBe("99");
    expect(url.searchParams.get("sort.equals")).toBe("nonsense");
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

  // `ColumnMetadataDto` has no `required` block, so the gateway may legally send
  // a column with no `sensitive` at all — while the domain type asserts a
  // boolean and the whole masking rule reads it. Absent has to mean sensitive:
  // defaulting it to `false` drops the column's lock, prints the masking literal
  // as data, and lets the column be sorted on.
  it("treats a column with no sensitive flag as sensitive", async () => {
    const fetchStub = vi.fn(async () =>
      answer({
        services: [
          {
            name: "auth",
            tables: [
              {
                name: "credentials",
                columns: [{ name: "id", type: "uuid", sensitive: false }, { name: "secret_hash", type: "text" }],
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const catalog = await new RestTaskaApi().getAdminCatalog();
    const columns = catalog.services[0].tables[0].columns;

    expect(columns[0].sensitive).toBe(false);
    expect(columns[1].sensitive).toBe(true);
  });

  // `HIDE` deletes the key from the row rather than nulling it, and that is the
  // only thing telling the console "withheld" apart from "empty". Anything on
  // the way through that filled the gap in — a `?? null`, a per-row mapper —
  // would turn a withheld secret into a value that reads as absent, and only
  // against the real gateway: the mock and the screen fakes cannot show it.
  it("lets a key the server removed from a row stay removed", async () => {
    const fetchStub = vi.fn(async () =>
      answer({
        data: [{ id: "c1", user_id: "u1" }],
        meta: { service: "auth", table: "credentials", columns: ["id", "user_id", "secret_hash"] },
        pagination: { currentPage: 0, pageSize: 20, totalRows: 1, totalPages: 1, hasNext: false, hasPrev: false },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const rows = await new RestTaskaApi().listAdminRows({ service: "auth", table: "credentials", page: 1 });

    expect("secret_hash" in rows.rows[0]).toBe(false);
    expect(rows.rows[0].secret_hash).toBeUndefined();
    // The column is still named, which is what puts a header over an empty cell.
    expect(rows.meta.columns).toContain("secret_hash");
  });

  it("escapes a service or table name rather than letting it reshape the path", async () => {
    const url = await urlFor({ service: "auth", table: "../../users" });

    expect(url.pathname).not.toContain("/../");
  });

  it("reads one row by its key and unwraps `data`", async () => {
    const row = { id: "0f3d5cb0-3a0e-4e3a-9d19-6d0a1f3a9c11", email: "anna@example.com" };
    const fetchStub = vi.fn(async (input: string) => answer({ data: row }, input));
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().getAdminRow({
      service: "auth",
      table: "users",
      id: "0f3d5cb0-3a0e-4e3a-9d19-6d0a1f3a9c11",
    });

    expect(result).toEqual(row);
    expect(String(fetchStub.mock.calls[0][0])).toContain(
      "/readonly/auth/users/0f3d5cb0-3a0e-4e3a-9d19-6d0a1f3a9c11",
    );
  });

  it("passes a missing row's 404 up as a 404, so the card can say the row is gone", async () => {
    const fetchStub = vi.fn(
      async () =>
        ({
          status: 404,
          ok: false,
          headers: { get: () => "req-42" },
          json: async () => ({ code: "NOT_FOUND", message: "Row not found" }),
        }) as unknown as Response,
    );
    vi.stubGlobal("fetch", fetchStub);

    // The card tells a missing row apart from a refusal and from a fault, and
    // it can only do that if the status survives the trip.
    await expect(
      new RestTaskaApi().getAdminRow({ service: "auth", table: "users", id: "nope" }),
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("escapes a row id rather than letting it reshape the path", async () => {
    const fetchStub = vi.fn(async (input: string) => answer({ data: {} }, input));
    vi.stubGlobal("fetch", fetchStub);

    await new RestTaskaApi().getAdminRow({ service: "auth", table: "users", id: "../../../etc" });

    expect(String(fetchStub.mock.calls[0][0])).not.toContain("/../");
  });
});

/**
 * The label routes (TAS-120). What matters here is what leaves the browser —
 * the path, the method and the body — because that is the half of the contract
 * a screen cannot check for itself, plus the two places a missing field would
 * otherwise reach a component: an issue with no `labels` and a label with no
 * `color`.
 */
describe("RestTaskaApi labels", () => {
  const answer = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  const stubFetch = (route: (input: string) => unknown, status = 200) => {
    const fetchStub = vi.fn(async (input: string, _init?: { method?: string; body?: string }) =>
      answer(status, route(input)),
    );
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  };

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("taska.accessToken", "valid-access");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the project's labels and fills in what the response left out", async () => {
    const fetchStub = stubFetch(() => ({
      items: [
        {
          id: "label-1",
          projectId: "project-1",
          name: "backend",
          color: "#0052cc",
          createdBy: "user-1",
          createdAt: "2026-08-20T09:00:00Z",
          deletedAt: null,
        },
        // Nothing in `ProjectLabelResponseDto` is required, so this is a legal
        // answer — and every field a screen reads has to survive it.
        { id: "label-2" },
      ],
    }));

    const labels = await new RestTaskaApi().listProjectLabels("project-1");

    expect(String(fetchStub.mock.calls[0][0])).toContain("/projects/project-1/labels");
    expect(labels[0]).toEqual({
      id: "label-1",
      projectId: "project-1",
      name: "backend",
      color: "#0052cc",
      createdBy: "user-1",
      createdAt: "2026-08-20T09:00:00Z",
      deletedAt: null,
    });
    // The project comes from the path the caller asked with, never from nothing.
    expect(labels[1]).toEqual({
      id: "label-2",
      projectId: "project-1",
      name: "",
      color: "",
      createdBy: "",
      createdAt: "",
      deletedAt: null,
    });
  });

  it("sends the name and the colour when a label is created", async () => {
    const fetchStub = stubFetch(() => ({ id: "label-9", name: "frontend", color: "#8b5cf6" }), 201);

    await new RestTaskaApi().createProjectLabel("project-1", { name: "frontend", color: "#8b5cf6" });

    const [url, init] = fetchStub.mock.calls[0];
    expect(String(url)).toContain("/projects/project-1/labels");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ name: "frontend", color: "#8b5cf6" });
  });

  it("PATCHes both fields, because the contract requires both even for a rename", async () => {
    const fetchStub = stubFetch(() => ({ id: "label-1", name: "platform", color: "#0052cc" }));

    await new RestTaskaApi().updateProjectLabel("project-1", "label-1", {
      name: "platform",
      color: "#0052cc",
    });

    const [url, init] = fetchStub.mock.calls[0];
    expect(String(url)).toContain("/projects/project-1/labels/label-1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ name: "platform", color: "#0052cc" });
  });

  it("deletes a project label by id", async () => {
    const fetchStub = stubFetch(() => undefined, 204);

    await new RestTaskaApi().deleteProjectLabel("project-1", "label-1");

    const [url, init] = fetchStub.mock.calls[0];
    expect(String(url)).toContain("/projects/project-1/labels/label-1");
    expect(init?.method).toBe("DELETE");
  });

  it("posts the label id to the issue's own label route and takes it off again", async () => {
    const fetchStub = stubFetch(() => ({ issueId: "issue-1", labelId: "label-1" }), 201);

    const api = new RestTaskaApi();
    await api.addIssueLabel("project-1", "issue-1", "label-1");

    const [addUrl, addInit] = fetchStub.mock.calls[0];
    expect(String(addUrl)).toContain("/projects/project-1/issues/issue-1/labels");
    expect(addInit?.method).toBe("POST");
    expect(JSON.parse(addInit?.body ?? "{}")).toEqual({ labelId: "label-1" });

    vi.unstubAllGlobals();
    const removeStub = stubFetch(() => undefined, 204);
    await api.removeIssueLabel("project-1", "issue-1", "label-1");

    const [removeUrl, removeInit] = removeStub.mock.calls[0];
    expect(String(removeUrl)).toContain("/projects/project-1/issues/issue-1/labels/label-1");
    expect(removeInit?.method).toBe("DELETE");
  });

  it("escapes the ids rather than letting them reshape the path", async () => {
    const fetchStub = stubFetch(() => undefined, 204);

    await new RestTaskaApi().removeIssueLabel("../../admin", "issue-1", "../../../etc");

    expect(String(fetchStub.mock.calls[0][0])).not.toContain("/../");
  });

  it("carries the label filter into the issue list query", async () => {
    const fetchStub = stubFetch((input) =>
      input.includes("/issues/")
        ? { issue: { id: "issue-1", labels: [{ id: "label-1", name: "backend", color: "#0052cc" }] }, history: [] }
        : { items: [{ id: "issue-1" }], totalCount: 1 },
    );

    const page = await new RestTaskaApi().listIssues("project-1", { labelId: "label-1", pageSize: 100 });

    expect(String(fetchStub.mock.calls[0][0])).toContain("labelId=label-1");
    // The list DTO carries no labels, so the board's chips come from the detail
    // read this method hydrates each row with.
    expect(page.items[0].labels).toEqual([{ id: "label-1", name: "backend", color: "#0052cc" }]);
  });

  it("gives an issue an empty label list when the gateway sends none", async () => {
    // Every gateway older than TAS-120 answers exactly like this, and the board
    // reads `issue.labels.length` without asking whether the field arrived.
    stubFetch(() => ({ issue: { id: "issue-1", summary: "No labels here" }, history: [] }));

    const detail = await new RestTaskaApi().getIssue("project-1", "issue-1");

    expect(detail.issue.labels).toEqual([]);
  });

  it("reads an issue's labels and keeps one whose colour never arrived", async () => {
    const fetchStub = stubFetch(() => ({
      items: [
        { id: "label-1", name: "backend", color: "#0052cc" },
        { id: "label-2", name: "no colour" },
      ],
    }));

    const labels = await new RestTaskaApi().listIssueLabels("project-1", "issue-1");

    expect(String(fetchStub.mock.calls[0][0])).toContain("/projects/project-1/issues/issue-1/labels");
    // Kept, not dropped: the label is on the issue whatever the gateway failed
    // to say about it, and the chip falls back to the accent when it is drawn.
    expect(labels).toEqual([
      { id: "label-1", name: "backend", color: "#0052cc" },
      { id: "label-2", name: "no colour", color: "" },
    ]);
  });
});
