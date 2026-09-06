import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTaskaApi } from "./RestTaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE } from "../TaskaApi";
import { ATTACHMENT_MAX_SIZE_BYTES, AttachmentStoreError, attachmentSizeRefusalMessage } from "../attachments";
import { isMissingOrForbidden, isUndeployedRoute } from "../errors";
import { ESTIMATE_MAX_MESSAGE, STORY_POINTS_RANGE_MESSAGE } from "../planningFields";

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

  // The Events section's summary (TAS-167). Not in the vendored contract and
  // not on the deployed gateway yet — this is the TAS-105 branch's shape, and
  // these tests are the only thing standing between it and the first response
  // (docs/ai/API-DIVERGENCE.md).
  it("asks for the problems summary with no query at all", async () => {
    const fetchStub = vi.fn(async (input: string) => answer({ events: [], counts: [] }, input));
    vi.stubGlobal("fetch", fetchStub);

    await new RestTaskaApi().getProblematicOutboxSummary();

    const url = String(fetchStub.mock.calls[0][0]);
    expect(url).toContain("/readonly/outbox/problematic-summary");
    // The contract offers an optional `serviceKey` and the UI never narrows:
    // the section is about every service at once, so a parameter here would be
    // surface with no caller.
    expect(url).not.toContain("?");
  });

  it("fills in every optional the summary's schema leaves out", async () => {
    // Nothing in `ProblematicOutboxEventsSummaryResponseDto` is `required`, and
    // a published event legitimately carries no error and no processing time.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer({
          events: [{ id: "e1", status: "NEW", serviceKey: "auth", createdAt: "2026-08-20T09:00:00Z" }],
          counts: [{ serviceKey: "auth" }],
        }),
      ),
    );

    const summary = await new RestTaskaApi().getProblematicOutboxSummary();

    expect(summary.events[0]).toEqual({
      id: "e1",
      aggregateType: "",
      aggregateId: "",
      eventType: "",
      payload: "",
      status: "NEW",
      createdAt: "2026-08-20T09:00:00Z",
      // Absent stays absent: `null` prints as the section's dash, where "" would
      // print as a blank cell that reads like a value nobody typed.
      publishedAt: null,
      attempts: 0,
      lastErrorMessage: null,
      processingStartedAt: null,
      requestId: null,
      serviceKey: "auth",
      reason: "",
    });
    // A hole in the matrix would read as "unknown" for a service that is fine.
    expect(summary.counts[0]).toEqual({
      serviceKey: "auth",
      overdueNewCount: 0,
      stuckProcessingCount: 0,
      failedCount: 0,
    });
    // Absent means nothing was cut, which is the only reading that does not put
    // a truncation notice over a complete list.
    expect(summary.notAllShown).toBe(false);
  });

  it("survives a summary that states nothing at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer({})));

    await expect(new RestTaskaApi().getProblematicOutboxSummary()).resolves.toEqual({
      events: [],
      counts: [],
      notAllShown: false,
    });
  });

  it("keeps the server's order instead of sorting the events itself", async () => {
    // Oldest first is the endpoint's own semantics: it says when this started,
    // and re-sorting would misdescribe which events the server cut off the end.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer({
          events: [
            { id: "older", createdAt: "2026-08-01T00:00:00Z" },
            { id: "newer", createdAt: "2026-08-09T00:00:00Z" },
            { id: "oldest", createdAt: "2026-07-01T00:00:00Z" },
          ],
        }),
      ),
    );

    const summary = await new RestTaskaApi().getProblematicOutboxSummary();

    expect(summary.events.map((event) => event.id)).toEqual(["older", "newer", "oldest"]);
  });
});

/**
 * The label routes (TAS-120). What matters here is what leaves the browser —
 * the path, the method and the body — because that is the half of the contract
 * a screen cannot check for itself, plus the two places a missing field would
 * otherwise reach a component: an issue with no `labels` and a label with no
 * `color`.
 */
/**
 * `GET /issues/search`, and mostly about the two things that must never reach
 * the wire: a query the runtime would refuse, and an empty one. The gateway
 * answers `400` for both, and its own generated spec (`/v3/api-docs`) gives the
 * parameter a *default* of the empty string — the vendored contract states no
 * default — so the obvious implementation, which sets `query` on every
 * keystroke, turns a cleared field into an error (docs/ai/API-DIVERGENCE.md).
 */
describe("RestTaskaApi issue search", () => {
  const answer = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  const stubFetch = (body: unknown, status = 200) => {
    const fetchStub = vi.fn(async (_input: string) => answer(status, body));
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

  it("refuses a short or empty query without spending a request", async () => {
    const fetchStub = stubFetch({ items: [], totalCount: 0 });
    const api = new RestTaskaApi();

    // Two characters is what the contract permits and the runtime refuses; the
    // empty string is what the gateway's generated spec (`/v3/api-docs`) offers
    // as the default.
    await expect(api.searchIssues({ query: "bo" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      status: 400,
      message: "Search query must be at least 3 characters",
    });
    await expect(api.searchIssues({ query: "" })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(api.searchIssues({ query: "  " })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    // The point of the guard: the gateway is never asked a question it has
    // already been measured refusing.
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("omits the query entirely when the caller states none", async () => {
    const fetchStub = stubFetch({ items: [], totalCount: 0 });

    await new RestTaskaApi().searchIssues({ projectId: "project-1" });

    const url = String(fetchStub.mock.calls[0][0]);
    expect(url).toContain("/issues/search?");
    expect(url).toContain("projectId=project-1");
    // Absent, not empty. `query=` is the 400 this whole guard is about.
    expect(url).not.toContain("query=");
  });

  it("sends every filter the endpoint takes, and trims the query it sends", async () => {
    const fetchStub = stubFetch({ items: [], totalCount: 0 });

    await new RestTaskaApi().searchIssues({
      query: "  board  ",
      projectId: "project-1",
      statusKey: "IN_PROGRESS",
      assigneeId: "user-1",
      reporterId: "user-2",
      priority: "HIGH",
      issueType: "BUG",
      page: 2,
      pageSize: 25,
    });

    const url = new URL(String(fetchStub.mock.calls[0][0]), "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      query: "board",
      projectId: "project-1",
      statusKey: "IN_PROGRESS",
      assigneeId: "user-1",
      reporterId: "user-2",
      priority: "HIGH",
      issueType: "BUG",
      page: "2",
      pageSize: "25",
    });
  });

  it("maps the short DTO to a hit and keeps it short", async () => {
    stubFetch({
      items: [
        {
          id: "issue-1",
          issueKey: "TAS-101",
          summary: "Login form validation fails on empty email",
          issueType: "BUG",
          priority: "HIGH",
          assigneeId: "user-mark",
        },
        // The gateway's own spelling of "nobody", same as the list endpoint.
        { id: "issue-2", issueKey: "WEB-12", summary: "Responsive board layout", issueType: "STORY", priority: "MEDIUM", assigneeId: "" },
      ],
      totalCount: 42,
    });

    const page = await new RestTaskaApi().searchIssues({ query: "board", pageSize: 2 });

    expect(page.items).toEqual([
      {
        id: "issue-1",
        issueKey: "TAS-101",
        summary: "Login form validation fails on empty email",
        issueType: "BUG",
        priority: "HIGH",
        assigneeId: "user-mark",
        // Neither response states it — backend PR #148 adds `storyPoints` to
        // `IssueShortResponseDto` and no deployed gateway carries it yet — so
        // both hits read "not estimated" rather than `undefined`.
        storyPoints: null,
      },
      {
        id: "issue-2",
        issueKey: "WEB-12",
        summary: "Responsive board layout",
        issueType: "STORY",
        priority: "MEDIUM",
        assigneeId: null,
        storyPoints: null,
      },
    ]);
    // The count is of the whole matching set, not of the page.
    expect(page.totalCount).toBe(42);
    expect(page.page).toBe(0);
  });

  it("never hydrates a hit, whatever the board does with a list", async () => {
    const fetchStub = stubFetch({
      items: [{ id: "issue-1", issueKey: "TAS-101", summary: "One", issueType: "TASK", priority: "LOW" }],
      totalCount: 1,
    });

    await new RestTaskaApi().searchIssues({ query: "one" });

    // `listIssues` pays an N+1 through `getIssue` because the board needs a
    // status. On a search that would be the same N+1 on every keystroke, and
    // the owner ruled against it on 2026-08-23 (TAS-178).
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("reads a page the gateway sent no items for as empty rather than throwing", async () => {
    stubFetch({ totalCount: 0 });

    await expect(new RestTaskaApi().searchIssues({ query: "nothing" })).resolves.toMatchObject({
      items: [],
      totalCount: 0,
    });
  });
});

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

/**
 * The admin user writes (TAS-186). The gateway does not serve them yet — the
 * backend change is unmerged — so nothing here has been observed on the wire;
 * what these pin is the shape the client sends and the facts it reads back
 * (docs/ai/API-DIVERGENCE.md).
 */
describe("RestTaskaApi admin user writes", () => {
  // `_input` exists only so the stubs below declare the parameter they are
  // asserted on; without it `mock.calls[0][0]` is not typed.
  const answer = (status: number, body: unknown, requestId?: string, _input?: string) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => (name === "X-Request-Id" ? (requestId ?? null) : null) },
      json: async () => body,
    }) as unknown as Response;

  // A real instant, under the name the wire actually uses. This fixture used to
  // carry the 1970 epoch, which encoded a belief about the backend — that it
  // left the field unset — that turned out to be stale; and it then spelled the
  // field `updatedAt`, which the gateway never sent
  // (`AdminUserManagementMapper.setChangedAt`), so the test agreed with the
  // bug. A fixture is data, not a claim, and one carrying a retired assumption
  // is how the assumption gets read back as evidence.
  const change = {
    userId: "1cf0dc4e-0000-4000-8000-000000000001",
    previousStatus: "ACTIVE",
    currentStatus: "BLOCKED",
    changedAt: "2026-08-25T14:03:11Z",
  };

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the reason to the block path and reads the transition back", async () => {
    const fetchStub = vi.fn(async (input: string) => answer(200, change, undefined, input));
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().blockUser(change.userId, "Left the company");

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/admin/users/${change.userId}/block`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)) as unknown).toEqual({ reason: "Left the company" });
    expect(result).toEqual(change);
  });

  it("posts to the unblock path, which is the same body and a different route", async () => {
    const fetchStub = vi.fn(async (input: string) =>
      answer(200, { ...change, previousStatus: "BLOCKED", currentStatus: "ACTIVE" }, undefined, input),
    );
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().unblockUser(change.userId, "Back from leave");

    expect(String(fetchStub.mock.calls[0][0])).toContain(`/admin/users/${change.userId}/unblock`);
    expect(result.currentStatus).toBe("ACTIVE");
  });

  it("reads the timestamp under the wire's name and does not fall back to the one it never sent", async () => {
    // TAS-188's first fact. `AdminUserManagementMapper` calls `setChangedAt`
    // and `UserStatusResponseDto` requires `changedAt`; this client read
    // `updatedAt`, which produced `undefined` in a field typed `string` with no
    // error and nothing on screen to notice.
    //
    // No fallback to the old name, and that is a decision rather than an
    // omission: these routes have never been deployed, so no gateway has ever
    // answered `updatedAt`, and accepting it would be a compatibility shim for
    // a version of the backend that never existed.
    const fetchStub = vi.fn(async (input: string) =>
      answer(200, { userId: change.userId, previousStatus: "ACTIVE", currentStatus: "BLOCKED", updatedAt: change.changedAt }, undefined, input),
    );
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().blockUser(change.userId, "Left the company");

    expect(result.changedAt).toBeUndefined();
    expect(Object.keys(result).sort()).toEqual(["changedAt", "currentStatus", "previousStatus", "userId"]);
  });

  it("posts to the reset-lockout path, which is the third route and the same body", async () => {
    const fetchStub = vi.fn(async (input: string) =>
      answer(200, { ...change, previousStatus: "LOCKED", currentStatus: "ACTIVE" }, undefined, input),
    );
    vi.stubGlobal("fetch", fetchStub);

    const result = await new RestTaskaApi().resetCredentialLockout(change.userId, "Called in, identity confirmed");

    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/admin/users/${change.userId}/reset-lockout`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body)) as unknown).toEqual({ reason: "Called in, identity confirmed" });
    // The server always reports this transition for a successful reset, which
    // is why the confirmation can name it before asking.
    expect(result).toMatchObject({ previousStatus: "LOCKED", currentStatus: "ACTIVE" });
  });

  it("guards the reset-lockout reason on this side of the wire too", async () => {
    const fetchStub = vi.fn(async (input: string) => answer(200, change, undefined, input));
    vi.stubGlobal("fetch", fetchStub);
    const api = new RestTaskaApi();

    await expect(api.resetCredentialLockout(change.userId, " \n ")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      status: 400,
      message: "A reason is required",
    });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("carries the reset-lockout refusal up as the 400 it is, code and wording intact", async () => {
    // Measured off `AdminUserManagementServiceImpl.resetCredentialLockout` and
    // `RestErrorMapper.mapGrpcCodeToHttpStatus`: FAILED_PRECONDITION maps to
    // **400**, not to the 409 the backend PR's own gateway test asserts — that
    // test mocks the client's error and measures nothing. The section reads
    // this by its code (`isConflict`), which is the half that survives either
    // answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(400, { code: "FAILED_PRECONDITION", message: "User is not in LOCKED status" }, "req-4")),
    );

    await expect(new RestTaskaApi().resetCredentialLockout(change.userId, "Not locked")).rejects.toMatchObject({
      status: 400,
      code: "FAILED_PRECONDITION",
      message: "User is not in LOCKED status",
      requestId: "req-4",
    });
  });

  it("passes both of reset-lockout's 404 sentences through as they arrived", async () => {
    // One status and one code for two different things — no such user, and a
    // locked account with no PASSWORD credential row. Nothing may branch on the
    // wording, so nothing may replace it either.
    for (const message of ["User not found", "Credential not found"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => answer(404, { code: "NOT_FOUND", message })),
      );

      await expect(new RestTaskaApi().resetCredentialLockout(change.userId, "Reason")).rejects.toMatchObject({
        status: 404,
        code: "NOT_FOUND",
        message,
      });
    }
  });

  it("trims the reason and never sends a blank one", async () => {
    const fetchStub = vi.fn(async (input: string) => answer(200, change, undefined, input));
    vi.stubGlobal("fetch", fetchStub);
    const api = new RestTaskaApi();

    await api.blockUser(change.userId, "  Left the company  ");
    expect(JSON.parse(String((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as unknown).toEqual({
      reason: "Left the company",
    });

    // Whitespace-only is `@NotBlank` on the server, so the request is not spent
    // at all — and the refusal wears the same code and wording the mock uses,
    // so a caller cannot tell which side stopped it.
    await expect(api.blockUser(change.userId, "   ")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      status: 400,
      message: "A reason is required",
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("refuses an over-long reason on this side too, exactly as the mock does", async () => {
    // The interchangeability rule AGENTS.md states, pinned on the side that
    // used to break it: the mock has always refused a reason past 550 and this
    // implementation sent it, so the same call answered differently in the two
    // modes. Same code, same status, same sentence, and no request spent.
    const fetchStub = vi.fn(async (input: string) => answer(200, change, undefined, input));
    vi.stubGlobal("fetch", fetchStub);
    const api = new RestTaskaApi();

    for (const write of [
      () => api.blockUser(change.userId, "x".repeat(551)),
      () => api.unblockUser(change.userId, "x".repeat(600)),
      () => api.resetCredentialLockout(change.userId, "x".repeat(551)),
    ]) {
      await expect(write()).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        status: 400,
        message: "A reason is at most 550 characters",
      });
    }
    expect(fetchStub).not.toHaveBeenCalled();

    // 550 exactly goes out — the bound is inclusive, and it is measured on the
    // trimmed value, so trailing whitespace is not what tips a reason over it.
    await api.blockUser(change.userId, `  ${"x".repeat(550)}  `);
    expect(JSON.parse(String((fetchStub.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as unknown).toEqual({
      reason: "x".repeat(550),
    });
  });

  it("percent-encodes the user id rather than pasting it into the path", async () => {
    const fetchStub = vi.fn(async (input: string) => answer(200, change, undefined, input));
    vi.stubGlobal("fetch", fetchStub);

    await new RestTaskaApi().blockUser("a/b?c", "Reason");

    expect(String(fetchStub.mock.calls[0][0])).toContain("/admin/users/a%2Fb%3Fc/block");
  });

  it("carries the gateway's status, code, wording and request id up to the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer(409, { code: "FAILED_PRECONDITION", message: "Cannot block the last active global admin" }, "req-9"),
      ),
    );

    await expect(new RestTaskaApi().blockUser(change.userId, "Testing the guard")).rejects.toMatchObject({
      status: 409,
      code: "FAILED_PRECONDITION",
      message: "Cannot block the last active global admin",
      requestId: "req-9",
    });
  });

  it("passes the undeployed-route 404 through with its message intact", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer(404, {
          code: "NOT_FOUND",
          message: `No static resource api/v1/admin/users/${change.userId}/block for request '…'.`,
        }),
      ),
    );

    // The section tells "TAS-107 is not deployed" from "no such user" by the
    // 404 *and* this message, so the message must not be replaced by a generic
    // one on the way up (`isUndeployedRoute`).
    await expect(new RestTaskaApi().blockUser(change.userId, "Reason")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining(UNDEPLOYED_ROUTE_MESSAGE),
    });
  });
});

/**
 * The five planning fields (TAS-189) as `RestTaskaApi` puts them on the wire.
 *
 * The whole section is about one defect. `PUT /issues/{issueId}` is a **full
 * replace**: `IssueServiceImpl.updateIssue` on backend `develop` writes all five
 * unconditionally, the proto fields are `optional`, the gateway sets them with
 * `setIfPresent` and `GrpcIssueService` resolves an unset optional with
 * `.orElse(null)` — so a field the request omits is erased. The board sends
 * `{summary}`, `{priority}` and `{description}` one at a time, and the day
 * backend PR #148 exposes these fields those three edits would each wipe the
 * story points and both dates.
 *
 * What is pinned here, and cannot be seen from the mock: the exact body. A
 * partial edit re-sends the values it is keeping, a resolved `null` is omitted
 * because omission is how this contract spells "not set", and against a gateway
 * that carries no planning fields yet the body is byte for byte what it was
 * before this story.
 */
describe("RestTaskaApi issue planning fields", () => {
  const answer = (status: number, body: unknown) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      json: async () => body,
    }) as unknown as Response;

  interface Init {
    method?: string;
    body?: string;
  }

  const stubFetch = (route: (input: string, init?: Init) => unknown, status = 200) => {
    const fetchStub = vi.fn(async (input: string, init?: Init) => answer(status, route(input, init)));
    vi.stubGlobal("fetch", fetchStub);
    return fetchStub;
  };

  /** The detail read, with whatever the gateway of the day carries on it. */
  const storedIssue = (planning: Record<string, unknown> = {}) => ({
    issue: {
      id: "issue-1",
      projectId: "project-1",
      issueNumber: 101,
      issueKey: "TAS-101",
      issueType: "BUG",
      summary: "Login form validation fails on empty email",
      description: "Returns a 500 instead of a 400.",
      status: "IN_PROGRESS",
      priority: "HIGH",
      assigneeId: "user-mark",
      reporterId: "user-anna",
      createdAt: "2026-06-12T09:10:00Z",
      updatedAt: "2026-06-12T09:11:00Z",
      version: 4,
      deletedAt: null,
      labels: [],
      ...planning,
    },
    history: [],
  });

  /** A read and a write on the same path, told apart by the method. */
  const stubIssue = (planning: Record<string, unknown> = {}, updateResponse: Record<string, unknown> = {}) =>
    stubFetch((_input, init) =>
      (init?.method ?? "GET") === "GET"
        ? storedIssue(planning)
        : {
            id: "issue-1",
            summary: "Login form validation fails on empty email",
            description: "Returns a 500 instead of a 400.",
            priority: "HIGH",
            ...updateResponse,
          },
    );

  const writtenBody = (fetchStub: ReturnType<typeof stubFetch>) => {
    const put = fetchStub.mock.calls.find(([, init]) => init?.method === "PUT");
    return JSON.parse(put?.[1]?.body ?? "{}") as Record<string, unknown>;
  };

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("taska.accessToken", "valid-access");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-sends every planning field it is keeping when only the summary is edited", async () => {
    const fetchStub = stubIssue({
      storyPoints: 3,
      startDate: "2026-06-15",
      dueDate: "2026-06-26",
      originalEstimateMinutes: 480,
      remainingEstimateMinutes: 240,
    });

    const updated = await new RestTaskaApi().updateIssue("project-1", "issue-1", { summary: "Revisited" });

    // The regression, stated on the request rather than on the answer: the four
    // fields nobody touched are on the wire, so the full replace replaces them
    // with themselves.
    expect(writtenBody(fetchStub)).toEqual({
      summary: "Revisited",
      description: "Returns a 500 instead of a 400.",
      priority: "HIGH",
      storyPoints: 3,
      startDate: "2026-06-15",
      dueDate: "2026-06-26",
      originalEstimateMinutes: 480,
      remainingEstimateMinutes: 240,
    });
    expect(updated).toMatchObject({ storyPoints: 3, dueDate: "2026-06-26", remainingEstimateMinutes: 240 });
  });

  it("sends the same three keys it always did against a gateway that has no planning fields", async () => {
    // Backend PR #148 has not merged, so the detail read carries none of the
    // five, every one of them resolves to `null` and every one is omitted. This
    // is why the fix can ship before the backend does: not one request byte
    // changes.
    const fetchStub = stubIssue();

    await new RestTaskaApi().updateIssue("project-1", "issue-1", { priority: "LOW" });

    expect(writtenBody(fetchStub)).toEqual({
      summary: "Login form validation fails on empty email",
      description: "Returns a 500 instead of a 400.",
      priority: "LOW",
    });
  });

  it("omits the key it was asked to clear and keeps sending the rest", async () => {
    const fetchStub = stubIssue({ storyPoints: 3, dueDate: "2026-06-26", originalEstimateMinutes: 480 });

    const updated = await new RestTaskaApi().updateIssue("project-1", "issue-1", { storyPoints: null });

    const body = writtenBody(fetchStub);
    expect(body).not.toHaveProperty("storyPoints");
    expect(body).toMatchObject({ dueDate: "2026-06-26", originalEstimateMinutes: 480 });
    expect(updated.storyPoints).toBeNull();
  });

  it("keeps a zero and a fraction on the wire, where a falsy check would drop them", async () => {
    const fetchStub = stubIssue({ storyPoints: 0, originalEstimateMinutes: 0 });

    const updated = await new RestTaskaApi().updateIssue("project-1", "issue-1", { summary: "Same" });

    expect(writtenBody(fetchStub)).toMatchObject({ storyPoints: 0, originalEstimateMinutes: 0 });
    expect(updated.storyPoints).toBe(0);
    expect(updated.originalEstimateMinutes).toBe(0);

    vi.unstubAllGlobals();
    const halfStub = stubIssue({ storyPoints: 1.5 });
    const half = await new RestTaskaApi().updateIssue("project-1", "issue-1", { summary: "Same" });
    expect(writtenBody(halfStub)).toMatchObject({ storyPoints: 1.5 });
    expect(half.storyPoints).toBe(1.5);
  });

  it("reads the answer as 'not set' where it states nothing, rather than as 'unchanged'", async () => {
    // `UpdateIssueResponseDto` carries only the fields that are set, so the
    // cleared one is simply absent from it. Spreading the response over the
    // pre-edit issue would leave the old 3 standing on a field just cleared.
    const fetchStub = stubIssue({ storyPoints: 3, dueDate: "2026-06-26" }, { dueDate: "2026-06-26" });

    const updated = await new RestTaskaApi().updateIssue("project-1", "issue-1", { storyPoints: null });

    expect(writtenBody(fetchStub)).not.toHaveProperty("storyPoints");
    expect(updated.storyPoints).toBeNull();
    expect(updated.dueDate).toBe("2026-06-26");
  });

  it("prefers a zero the server states over the value it was sent", async () => {
    const fetchStub = stubIssue({ storyPoints: 5 }, { storyPoints: 0 });

    const updated = await new RestTaskaApi().updateIssue("project-1", "issue-1", { storyPoints: 0 });

    expect(writtenBody(fetchStub)).toMatchObject({ storyPoints: 0 });
    expect(updated.storyPoints).toBe(0);
  });

  it("folds an absent planning field to null instead of leaving it undefined", async () => {
    // The trap a spread hides: five members typed `number | null` that are
    // actually `undefined`, which type-checks and renders "undefined".
    stubFetch(() => storedIssue());

    const { issue } = await new RestTaskaApi().getIssueById("issue-1");

    expect(issue).toMatchObject({
      storyPoints: null,
      startDate: null,
      dueDate: null,
      originalEstimateMinutes: null,
      remainingEstimateMinutes: null,
    });
    for (const key of ["storyPoints", "startDate", "dueDate", "originalEstimateMinutes", "remainingEstimateMinutes"]) {
      expect(Object.values(issue)).not.toContain(undefined);
      expect(issue).toHaveProperty(key);
    }
  });

  it("refuses the values the gateway would refuse, without spending the write", async () => {
    const api = new RestTaskaApi();
    const refuse = async (input: Record<string, unknown>, message?: string) => {
      vi.unstubAllGlobals();
      const fetchStub = stubIssue({ storyPoints: 3, startDate: "2026-06-15", dueDate: "2026-06-26" });
      await expect(api.updateIssue("project-1", "issue-1", input)).rejects.toMatchObject({
        code: "INVALID_ARGUMENT",
        status: 400,
        ...(message === undefined ? {} : { message }),
      });
      // The read happened — the stored dates are half of what is checked — and
      // the write did not.
      expect(fetchStub.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    };

    // The same input the mock refuses, refused with the same sentence: both
    // sides read it from src/api/planningFields.ts.
    await refuse({ storyPoints: -0.5 }, STORY_POINTS_RANGE_MESSAGE);
    await refuse({ storyPoints: 1000 });
    await refuse({ storyPoints: 1.235 });
    await refuse({ storyPoints: Number.NaN });
    await refuse({ originalEstimateMinutes: -1 });
    await refuse({ remainingEstimateMinutes: 30.5 });
    // Above int32 the gateway cannot bind the body at all, so this one is
    // refused before the write for a reason no validator states.
    await refuse({ originalEstimateMinutes: 2_147_483_648 }, ESTIMATE_MAX_MESSAGE);
    await refuse({ remainingEstimateMinutes: 2_147_483_648 }, ESTIMATE_MAX_MESSAGE);
    await refuse({ startDate: "2026-13-01" });
    await refuse({ startDate: "2026-02-30" });
    await refuse({ startDate: "2026-08-02", dueDate: "2026-08-01" });
    // The stored-date cross-check, both ways round. The second is refused even
    // though the same request clears the due date it is being compared with.
    await refuse({ startDate: "2026-07-01" });
    await refuse({ startDate: "2026-07-01", dueDate: null });
    await refuse({ dueDate: "2026-06-01" });
  });

  it("sends only the planning fields a create states", async () => {
    const fetchStub = stubFetch(() => storedIssue({ storyPoints: 2.5 }).issue, 201);

    await new RestTaskaApi().createIssue("project-1", {
      issueType: "TASK",
      summary: "Plan the migration",
      description: "With dates.",
      priority: "MEDIUM",
      storyPoints: 2.5,
      startDate: "2026-09-01",
      // Explicitly nothing, and on a create that is the same as not saying it.
      dueDate: null,
    });

    expect(JSON.parse(fetchStub.mock.calls[0][1]?.body ?? "{}")).toEqual({
      issueType: "TASK",
      summary: "Plan the migration",
      description: "With dates.",
      priority: "MEDIUM",
      storyPoints: 2.5,
      startDate: "2026-09-01",
    });
  });

  it("refuses a create the gateway would refuse, without spending the request", async () => {
    const fetchStub = stubFetch(() => storedIssue().issue, 201);

    await expect(
      new RestTaskaApi().createIssue("project-1", {
        issueType: "TASK",
        summary: "Backwards",
        description: "",
        priority: "LOW",
        startDate: "2026-09-30",
        dueDate: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", status: 400 });

    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("carries storyPoints off a search hit and folds an absent one to null", async () => {
    stubFetch(() => ({
      items: [
        { id: "issue-1", issueKey: "TAS-101", summary: "One", issueType: "BUG", priority: "HIGH", storyPoints: 0 },
        { id: "issue-2", issueKey: "TAS-102", summary: "Two", issueType: "TASK", priority: "LOW" },
      ],
      totalCount: 2,
    }));

    const { items } = await new RestTaskaApi().searchIssues({ query: "form" });

    // Zero is an estimate; the missing one is not.
    expect(items[0].storyPoints).toBe(0);
    expect(items[1].storyPoints).toBeNull();
    // And the hit is still as narrow as `IssueShortResponseDto`.
    expect(Object.keys(items[0]).sort()).toEqual([
      "assigneeId",
      "id",
      "issueKey",
      "issueType",
      "priority",
      "storyPoints",
      "summary",
    ]);
  });
});


/**
 * The attachment routes (TAS-190) as `RestTaskaApi` puts them on the wire.
 *
 * Two things here cannot be seen from the mock and are the reason this block
 * exists. The **middle leg** is a raw cross-origin PUT that must carry the
 * signed `Content-Type` and *nothing else* — no bearer token, no request id, no
 * `Accept` — because a presigned URL authenticates itself and every extra
 * header is one more thing a preflight has to have been told to allow. And its
 * failures must arrive in a shape that `src/api/errors.ts` cannot mistake for a
 * gateway answer.
 */
describe("RestTaskaApi attachments", () => {
  const PROJECT = "5b1e6f30-0000-4000-8000-000000000001";
  const ISSUE = "5b1e6f30-0000-4000-8000-000000000002";
  const ATTACHMENT = "5b1e6f30-0000-4000-8000-000000000003";

  const answer = (status: number, body: unknown, requestId?: string) =>
    ({
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (name: string) => (name === "X-Request-Id" ? (requestId ?? null) : null) },
      json: async () => body,
    }) as unknown as Response;

  const row = {
    id: ATTACHMENT,
    issueId: ISSUE,
    fileName: "login-500-trace.txt",
    contentType: "text/plain",
    sizeBytes: 2411,
    uploadedBy: "1cf0dc4e-0000-4000-8000-000000000001",
    checksum: "8f14e45fceea167a5a36dedd4bea2543",
    createdAt: "2026-09-01T09:10:00Z",
  };

  const calls = (stub: ReturnType<typeof vi.fn>) =>
    stub.mock.calls as unknown as [string, RequestInit][];

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the list from the project-scoped path and normalises what the response left out", async () => {
    const fetchStub = vi.fn(async () => answer(200, { items: [row, { fileName: "half.txt" }] }));
    vi.stubGlobal("fetch", fetchStub);

    const attachments = await new RestTaskaApi().listAttachments(PROJECT, ISSUE);

    expect(calls(fetchStub)[0][0]).toBe(`/api/v1/projects/${PROJECT}/issues/${ISSUE}/attachments`);
    expect(attachments[0]).toEqual(row);
    // A row the response only half-filled is still drawable: an empty id (so the
    // controls that need one can tell), and the issue the caller asked about.
    expect(attachments[1]).toEqual({
      id: "",
      issueId: ISSUE,
      fileName: "half.txt",
      contentType: "",
      sizeBytes: 0,
      uploadedBy: "",
      checksum: null,
      createdAt: "",
    });
  });

  it("posts the three fields leg 1 requires and reads the ticket back", async () => {
    const fetchStub = vi.fn(async () => answer(200, { uploadUrl: "https://store.example/obj?sig=1", objectKey: "obj" }));
    vi.stubGlobal("fetch", fetchStub);

    const ticket = await new RestTaskaApi().createAttachmentUploadUrl(PROJECT, ISSUE, {
      fileName: "notes.txt",
      contentType: "text/plain",
      sizeBytes: 12,
    });

    expect(calls(fetchStub)[0][0]).toBe(`/api/v1/projects/${PROJECT}/issues/${ISSUE}/attachments/upload-url`);
    expect(JSON.parse(String(calls(fetchStub)[0][1].body)) as unknown).toEqual({
      fileName: "notes.txt",
      contentType: "text/plain",
      sizeBytes: 12,
    });
    expect(ticket).toEqual({ uploadUrl: "https://store.example/obj?sig=1", objectKey: "obj" });
  });

  it("refuses a bad file before any request, with the code and status the gateway would answer", async () => {
    const fetchStub = vi.fn(async () => answer(200, {}));
    vi.stubGlobal("fetch", fetchStub);
    const api = new RestTaskaApi();

    await expect(
      api.createAttachmentUploadUrl(PROJECT, ISSUE, { fileName: "a.zip", contentType: "application/x-zip-compressed", sizeBytes: 10 }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      status: 400,
      message: "Content type not allowed: application/x-zip-compressed",
    });
    await expect(
      api.createAttachmentUploadUrl(PROJECT, ISSUE, { fileName: "a.txt", contentType: "text/plain", sizeBytes: 0 }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT", status: 400 });

    // The odd one, and pinned as a fact about the deployed gateway rather than
    // as a preference: `RestErrorMapper` has no `OUT_OF_RANGE` row, so a file
    // one byte too large falls through its INTERNAL_SERVER_ERROR default. An
    // earlier version of this test asserted 400 and was pinning a comment that
    // had read the mapping table in `DomainStatus`'s javadoc — which the
    // gateway does not consult — instead of the mapper it runs.
    await expect(
      api.createAttachmentUploadUrl(PROJECT, ISSUE, { fileName: "a.txt", contentType: "text/plain", sizeBytes: ATTACHMENT_MAX_SIZE_BYTES + 1 }),
    ).rejects.toMatchObject({
      code: "OUT_OF_RANGE",
      status: 500,
      message: attachmentSizeRefusalMessage(ATTACHMENT_MAX_SIZE_BYTES + 1),
    });

    // Nothing went out, and the codes are the ones MockTaskaApi throws for the
    // same three files, so the two modes cannot disagree about which files are
    // uploadable or about what refused them.
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("PUTs the bytes to the presigned URL with the signed content type and nothing else", async () => {
    const fetchStub = vi.fn(async () => answer(200, undefined));
    vi.stubGlobal("fetch", fetchStub);
    window.localStorage.setItem("taska.accessToken", "a-real-token");

    const body = new Blob(["trace"], { type: "text/plain" });
    await new RestTaskaApi().putAttachmentBytes("https://store.example/obj?X-Amz-Signature=abc", body, "text/plain");

    const [url, init] = calls(fetchStub)[0];
    // Absolute, and untouched by the gateway base path.
    expect(url).toBe("https://store.example/obj?X-Amz-Signature=abc");
    expect(init.method).toBe("PUT");
    // Exactly one header. A bearer token sent alongside a query-string
    // signature can itself fail the signature, and any header beyond the CORS
    // safelist has to be in `Access-Control-Allow-Headers` to survive preflight.
    expect(init.headers).toEqual({ "Content-Type": "text/plain" });
    expect(init.body).toBe(body);
    // Not routed through `request()`, so none of its machinery applies.
    expect(String(JSON.stringify(init.headers))).not.toContain("Bearer");
    expect(init.credentials).toBeUndefined();
  });

  it("sends nothing at all when the upload link is not an absolute http URL", async () => {
    const fetchStub = vi.fn(async () => answer(200, undefined));
    vi.stubGlobal("fetch", fetchStub);
    const api = new RestTaskaApi();

    // `createAttachmentUploadUrl` lands a missing `uploadUrl` as `""`, the way
    // it lands every absent field — and `fetch("")` does not fail, it resolves
    // against the document. Unguarded, a malformed gateway response would
    // therefore PUT the file's bytes to this app's own origin, where
    // `credentials: "same-origin"` stops being a no-op and attaches its
    // cookies. A relative path is the same hazard spelled out loud, and a
    // `javascript:` URL is absolute and still not somewhere to send a file.
    for (const url of ["", "/api/v1/projects", "javascript:void 0"]) {
      const error = await api.putAttachmentBytes(url, new Blob(["x"]), "text/plain").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AttachmentStoreError);
      expect(error).toMatchObject({ code: "STORAGE_URL_UNUSABLE", storeStatus: null });
      // Store-shaped, so no `status` for `isMissingOrForbidden` to read: the
      // gateway did answer, but it did not fail, and nothing was sent.
      expect((error as { status?: unknown }).status).toBeUndefined();
    }
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it("sends the content type it was given rather than the blob's, so the signature still matches", async () => {
    const fetchStub = vi.fn(async () => answer(200, undefined));
    vi.stubGlobal("fetch", fetchStub);

    // A blob whose own type carries a charset — which is what several file
    // pickers produce — signed as the bare type. The signed value wins.
    const body = new Blob(["x"], { type: "text/plain;charset=utf-8" });
    await new RestTaskaApi().putAttachmentBytes("https://store.example/obj", body, "text/plain");

    expect(calls(fetchStub)[0][1].headers).toEqual({ "Content-Type": "text/plain" });
  });

  it("reports a blocked preflight as unreachable, with no status anywhere on the error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    const error = await new RestTaskaApi()
      .putAttachmentBytes("https://store.example/obj", new Blob(["x"]), "text/plain")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AttachmentStoreError);
    expect(error).toMatchObject({ code: "STORAGE_UNREACHABLE", storeStatus: null });
    // The load-bearing assertion of this whole block: `isMissingOrForbidden`
    // and `isConflict` read `status` and `code` off any Error, so a store
    // failure wearing either would be classified as a gateway answer.
    expect((error as { status?: unknown }).status).toBeUndefined();
    expect(isMissingOrForbidden(error)).toBe(false);
  });

  it("carries a store's 403 in storeStatus and in the message, never in status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(403, undefined)));

    const error = await new RestTaskaApi()
      .putAttachmentBytes("https://store.example/obj", new Blob(["x"]), "text/plain")
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: "STORAGE_REJECTED", storeStatus: 403, message: "The file store answered 403." });
    expect((error as { status?: unknown }).status).toBeUndefined();
    // A gateway 403 means "not yours"; a store 403 means "this signature is no
    // longer accepted". Reading the second as the first is the bug this pins.
    expect(isMissingOrForbidden(error)).toBe(false);
  });

  it("does not sign a store 401 out of the app", async () => {
    // `request()` treats a 401 as a dead session and clears the tokens. This
    // leg must not: the 401 is somebody else's server talking about a signature.
    window.localStorage.setItem("taska.accessToken", "still-good");
    window.localStorage.setItem("taska.refreshToken", "still-good");
    const fetchStub = vi.fn(async () => answer(401, undefined));
    vi.stubGlobal("fetch", fetchStub);

    const api = new RestTaskaApi();
    const expired = vi.fn();
    api.onSessionExpired(expired);

    await expect(api.putAttachmentBytes("https://store.example/obj", new Blob(["x"]), "text/plain")).rejects.toMatchObject({
      storeStatus: 401,
    });

    expect(expired).not.toHaveBeenCalled();
    expect(api.hasSession()).toBe(true);
    // One call: no refresh, no retry.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("confirms with the three fields the contract asks for, once, and reads the 201 back", async () => {
    const fetchStub = vi.fn(async () => answer(201, row));
    vi.stubGlobal("fetch", fetchStub);

    const attachment = await new RestTaskaApi().confirmAttachmentUpload(PROJECT, ISSUE, {
      objectKey: "obj",
      fileName: "login-500-trace.txt",
      contentType: "text/plain",
    });

    expect(calls(fetchStub)[0][0]).toBe(`/api/v1/projects/${PROJECT}/issues/${ISSUE}/attachments/confirm`);
    expect(JSON.parse(String(calls(fetchStub)[0][1].body)) as unknown).toEqual({
      objectKey: "obj",
      fileName: "login-500-trace.txt",
      contentType: "text/plain",
    });
    // No `Idempotency-Key`: the route does not read one, and this is precisely
    // the call that must not be repeated.
    expect(JSON.stringify(calls(fetchStub)[0][1].headers)).not.toContain("Idempotency-Key");
    expect(attachment).toEqual(row);
  });

  it("does not retry a failed confirm", async () => {
    const fetchStub = vi.fn(async () => answer(503, { code: "UNAVAILABLE", message: "Service unavailable" }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(
      new RestTaskaApi().confirmAttachmentUpload(PROJECT, ISSUE, { objectKey: "obj", fileName: "f.txt", contentType: "text/plain" }),
    ).rejects.toMatchObject({ status: 503 });

    // Exactly one. `object_key` has no unique constraint and the insert is
    // unconditional, so a second attempt is a second row plus a second history
    // and outbox event.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it("asks for a download link per attachment and percent-encodes the ids", async () => {
    const fetchStub = vi.fn(async () => answer(200, { downloadUrl: "https://store.example/get?sig=2", checksum: null }));
    vi.stubGlobal("fetch", fetchStub);

    const link = await new RestTaskaApi().getAttachmentDownloadUrl(PROJECT, ISSUE, "a/b?c");

    expect(calls(fetchStub)[0][0]).toBe(
      `/api/v1/projects/${PROJECT}/issues/${ISSUE}/attachments/a%2Fb%3Fc/download-url`,
    );
    expect(link).toEqual({ downloadUrl: "https://store.example/get?sig=2", checksum: null });
  });

  it("deletes by id and accepts the 204", async () => {
    const fetchStub = vi.fn(async () => answer(204, undefined));
    vi.stubGlobal("fetch", fetchStub);

    await expect(new RestTaskaApi().deleteAttachment(PROJECT, ISSUE, ATTACHMENT)).resolves.toBeUndefined();

    expect(calls(fetchStub)[0][0]).toBe(`/api/v1/projects/${PROJECT}/issues/${ISSUE}/attachments/${ATTACHMENT}`);
    expect(calls(fetchStub)[0][1].method).toBe("DELETE");
  });

  it("passes the undeployed-route 404 through so the panel can say which 404 it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer(404, {
          code: "NOT_FOUND",
          message: `No static resource api/v1/projects/${PROJECT}/issues/${ISSUE}/attachments for request '…'.`,
        }),
      ),
    );

    const error = await new RestTaskaApi().listAttachments(PROJECT, ISSUE).catch((e: unknown) => e);

    // Measured against the deployed gateway on 2026-09-06: these routes answer
    // this, while `…/comments` answers 401 for the same unauthenticated call.
    expect(error).toMatchObject({ status: 404, message: expect.stringContaining(UNDEPLOYED_ROUTE_MESSAGE) });
    expect(isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)).toBe(true);
  });
});
