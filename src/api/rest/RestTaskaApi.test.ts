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
