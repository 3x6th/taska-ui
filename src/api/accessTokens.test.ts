import { afterEach, describe, expect, it, vi } from "vitest";
import { INSUFFICIENT_SCOPE_CODE, isAccessTokenGone, isInsufficientScope, isRateLimited } from "./accessTokens";
import { apiErrorFacts, isUndeployedRoute } from "./errors";
import { MockAccessTokens } from "./mock/MockAccessTokens";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE } from "./TaskaApi";

/**
 * Personal access tokens (TAS-412). Against a provisional shape — the
 * frontend's proposal on TAS-402, not the contract — so these pin what this
 * build sends and reads, never what the gateway does.
 */
const wireToken = {
  id: "0b1d3c4e-5f60-4a71-8b92-a3b4c5d6e7f8",
  name: "Cursor on laptop",
  tokenPrefix: "tsk_pat_3fA9",
  scopes: ["read", "write"],
  createdAt: "2026-10-24T10:00:00Z",
  expiresAt: "2026-11-23T10:00:00Z",
  lastUsedAt: null,
};

afterEach(() => vi.unstubAllGlobals());

/** The code a call refused with, or `null` for one that did not refuse. */
const refusalCode = (call: () => unknown): string | null => {
  try {
    call();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  }
};

/**
 * Everything an object holds, as one string to search — `Map`s and `Set`s by
 * their contents. A plain `JSON.stringify` writes both as `{}`, and an
 * assertion that a secret is not in `{}` is true of any store.
 */
const dump = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item,
  );

describe("the REST transport for access tokens", () => {
  it("calls the three TAS-402 paths with the proposed bodies", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "POST") {
        return new Response(JSON.stringify({ token: wireToken, secret: "tsk_pat_3fA9abcdefghijklmnopqrstuvwxyz12" }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ items: [wireToken] }), { status: 200, headers: { "X-Url": url } });
    });
    vi.stubGlobal("fetch", fetch);
    const api = new RestTaskaApi();

    const list = await api.listAccessTokens();
    const issued = await api.createAccessToken({ name: "Cursor on laptop", scopes: ["read", "write"], expiresInDays: 30 });
    await api.revokeAccessToken(wireToken.id);

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/users/me/access-tokens",
      "/api/v1/users/me/access-tokens",
      `/api/v1/users/me/access-tokens/${wireToken.id}`,
    ]);
    const options = fetch.mock.calls.map((call) => call[1]);
    expect(options.map((value) => value.method)).toEqual(["GET", "POST", "DELETE"]);
    expect(JSON.parse(options[1].body as string)).toEqual({
      name: "Cursor on laptop",
      scopes: ["read", "write"],
      expiresInDays: 30,
    });
    expect(list).toEqual([wireToken]);
    expect(issued).toEqual({ token: wireToken, secret: "tsk_pat_3fA9abcdefghijklmnopqrstuvwxyz12" });
  });

  it("reads a token field by field, so nothing else the body carries reaches the domain object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              items: [
                { ...wireToken, secret: "tsk_pat_should_never_ride_along", lastUsedAt: "2026-10-24T11:00:00Z" },
                { id: 7, scopes: ["read", 3], lastUsedAt: 0 },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const [first, second] = await new RestTaskaApi().listAccessTokens();

    expect(first).toEqual({ ...wireToken, lastUsedAt: "2026-10-24T11:00:00Z" });
    expect(first).not.toHaveProperty("secret");
    expect(second).toEqual({
      id: "",
      name: "",
      tokenPrefix: "",
      scopes: ["read"],
      createdAt: "",
      expiresAt: "",
      lastUsedAt: null,
    });
  });

  it("encodes the token id as one path segment", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await new RestTaskaApi().revokeAccessToken("a/../b");
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe("/api/v1/users/me/access-tokens/a%2F..%2Fb");
  });

  it("carries the token-scope 403 and the 429 with their request ids, and reads each by its own predicate", async () => {
    const refuse = (status: number, body: object) =>
      vi.fn(
        async () => new Response(JSON.stringify(body), { status, headers: { "X-Request-Id": `request-${status}` } }),
      );

    vi.stubGlobal("fetch", refuse(403, { code: INSUFFICIENT_SCOPE_CODE, message: "Token management requires a session" }));
    const scope = await new RestTaskaApi()
      .createAccessToken({ name: "x", scopes: ["read"], expiresInDays: 7 })
      .catch((error: unknown) => error);
    expect(scope).toMatchObject({ status: 403, code: "insufficient_scope", requestId: "request-403" });
    expect(isInsufficientScope(scope)).toBe(true);
    expect(isRateLimited(scope)).toBe(false);

    vi.stubGlobal(
      "fetch",
      refuse(429, { code: "RESOURCE_EXHAUSTED", message: "Too many requests", details: { retryAfterSeconds: "42" } }),
    );
    const limited = await new RestTaskaApi()
      .createAccessToken({ name: "x", scopes: ["read"], expiresInDays: 7 })
      .catch((error: unknown) => error);
    expect(limited).toMatchObject({ status: 429, requestId: "request-429" });
    expect(isRateLimited(limited)).toBe(true);
    // The wait reaches the section as the mock's does, in `details`.
    expect(apiErrorFacts(limited).details?.retryAfterSeconds).toBe("42");
    expect(isInsufficientScope(limited)).toBe(false);
  });

  it("reads a revoke's 404 NOT_FOUND as a token already gone, but not the static-resource 404 of a gateway without the routes", async () => {
    const answer = (body: object) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status: 404, headers: { "X-Request-Id": "request-404" } }));

    vi.stubGlobal("fetch", answer({ code: "NOT_FOUND", message: "Access token not found" }));
    const gone = await new RestTaskaApi().revokeAccessToken("token-1").catch((error: unknown) => error);
    expect(gone).toMatchObject({ status: 404, requestId: "request-404" });
    expect(isAccessTokenGone(gone)).toBe(true);

    vi.stubGlobal("fetch", answer({ code: "NOT_FOUND", message: "No static resource api/v1/users/me/access-tokens/token-1." }));
    const undeployed = await new RestTaskaApi().revokeAccessToken("token-1").catch((error: unknown) => error);
    expect(isUndeployedRoute(undeployed, UNDEPLOYED_ROUTE_MESSAGE)).toBe(true);
    expect(isAccessTokenGone(undeployed)).toBe(false);
  });

  it("meets a gateway without the routes with the static-resource 404 the section reads as not deployed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ code: "NOT_FOUND", message: "No static resource api/v1/users/me/access-tokens." }),
            { status: 404 },
          ),
      ),
    );
    const error = await new RestTaskaApi().listAccessTokens().catch((caught: unknown) => caught);
    expect(isUndeployedRoute(error, UNDEPLOYED_ROUTE_MESSAGE)).toBe(true);
  });
});

describe("the channel mark on the REST wire (TAS-411)", () => {
  it("states no channel on a history event or a comment, whatever a key of that name holds", async () => {
    const via = { channel: "MCP", tokenName: "Cursor on laptop" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/comments")
          ? new Response(
              JSON.stringify({
                items: [
                  {
                    id: "c-1",
                    issueId: "i-1",
                    projectId: "p-1",
                    authorUserId: "u-1",
                    body: "hi",
                    createdAt: "2026-10-24T10:00:00Z",
                    updatedAt: "2026-10-24T10:00:00Z",
                    version: 1,
                    via,
                  },
                ],
                totalCount: 1,
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                issue: { id: "i-1", projectId: "p-1", summary: "x", labels: [] },
                history: [{ id: "h-1", eventType: "CREATED", actorUserId: "u-1", occurredAt: "2026-10-24T10:00:00Z", payload: {}, via }],
              }),
              { status: 200 },
            ),
      ),
    );
    const api = new RestTaskaApi();

    const { history } = await api.getIssue("p-1", "i-1");
    const { items } = await api.listComments("p-1", "i-1");

    expect(history[0].via).toBeNull();
    expect(items[0].via).toBeNull();
  });
});

describe("the mock's access tokens", () => {
  it("seeds the suite's account with a read token and a read-and-write one, one of them never used", () => {
    const tokens = new MockAccessTokens("anna").list("anna");
    expect(tokens.map((token) => token.scopes)).toEqual(expect.arrayContaining([["read"], ["read", "write"]]));
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.lastUsedAt === null)).toHaveLength(1);
    expect(new MockAccessTokens("anna").list("somebody-else")).toEqual([]);
  });

  it("answers a create with a fresh secret once and keeps only its prefix", () => {
    const store = new MockAccessTokens();
    const first = store.create("anna", { name: "  Cursor on laptop  ", scopes: ["read"], expiresInDays: 7 });
    const second = store.create("anna", { name: "Script", scopes: ["read", "write"], expiresInDays: 365 });

    expect(first.secret).toMatch(/^tsk_pat_[0-9A-Za-z]{32}$/);
    expect(first.secret).not.toBe(second.secret);
    expect(first.token.name).toBe("Cursor on laptop");
    expect(first.token.tokenPrefix).toBe(first.secret.slice(0, 12));
    expect(Date.parse(first.token.expiresAt) - Date.parse(first.token.createdAt)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(second.token.scopes).toEqual(["read", "write"]);

    // Nothing the store holds can show either value again: not what it lists…
    const listed = JSON.stringify(store.list("anna"));
    expect(listed).not.toContain(first.secret);
    expect(listed).not.toContain(second.secret);
    expect(store.list("anna").map((token) => token.name)).toEqual(["Script", "Cursor on laptop"]);
    // …and not what it keeps, read through its Maps. The dump does reach the
    // tokens — it holds their ids and prefixes — so its silence is a finding.
    const held = dump(store);
    expect(held).toContain(first.token.id);
    expect(held).toContain(second.token.tokenPrefix);
    expect(held).not.toContain(first.secret);
    expect(held).not.toContain(second.secret);
  });

  it("refuses a blank or long name, a scope it does not offer and a lifetime off the list", () => {
    const store = new MockAccessTokens();
    const refusal = (input: Parameters<MockAccessTokens["create"]>[1]) => {
      try {
        store.create("anna", input);
        return null;
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(refusal({ name: "   ", scopes: ["read"], expiresInDays: 30 })).toBe("INVALID_ARGUMENT");
    expect(refusal({ name: "x".repeat(101), scopes: ["read"], expiresInDays: 30 })).toBe("INVALID_ARGUMENT");
    expect(refusal({ name: "x".repeat(100), scopes: ["read"], expiresInDays: 30 })).toBeNull();
    expect(refusal({ name: "x", scopes: ["write"] as unknown as ["read"], expiresInDays: 30 })).toBe("INVALID_ARGUMENT");
    expect(refusal({ name: "x", scopes: ["read"], expiresInDays: 14 as unknown as 30 })).toBe("INVALID_ARGUMENT");
  });

  it("answers the 429's code after five creates in a minute (a mock-only number), with the wait as a string in details", () => {
    const store = new MockAccessTokens();
    for (let index = 0; index < 5; index += 1) store.create("anna", { name: `t${index}`, scopes: ["read"], expiresInDays: 7 });
    let caught: unknown;
    try {
      store.create("anna", { name: "one more", scopes: ["read"], expiresInDays: 7 });
    } catch (error) {
      caught = error;
    }
    expect(isRateLimited(caught)).toBe(true);
    // The invitation resend's shape: whole seconds, as a string, within the window.
    const wait = apiErrorFacts(caught).details?.retryAfterSeconds;
    expect(wait).toMatch(/^[1-9][0-9]*$/);
    expect(Number(wait)).toBeLessThanOrEqual(60);
  });

  it("takes a revoked token out at once, answers a repeated revoke as the first (TAS-401), and refuses an id never issued", () => {
    const store = new MockAccessTokens("anna");
    const [first, second] = store.list("anna");
    store.revoke("anna", first.id);
    expect(store.list("anna").map((token) => token.id)).toEqual([second.id]);

    // Idempotent: the same success again, and nothing else changes.
    expect(refusalCode(() => store.revoke("anna", first.id))).toBeNull();
    expect(store.list("anna").map((token) => token.id)).toEqual([second.id]);

    // NOT_FOUND only for an id this account was never issued — another
    // account's revoked token included.
    expect(refusalCode(() => store.revoke("anna", "never-issued"))).toBe("NOT_FOUND");
    expect(refusalCode(() => store.revoke("boris", first.id))).toBe("NOT_FOUND");
    expect(isAccessTokenGone(Object.assign(new Error("Access token not found"), { code: "NOT_FOUND" }))).toBe(true);
  });

  it("serves the signed-in account's tokens through MockTaskaApi", async () => {
    window.localStorage.clear();
    const api = new MockTaskaApi();
    await api.login({ email: "anna@example.com", password: "anything" });

    const before = await api.listAccessTokens();
    const issued = await api.createAccessToken({ name: "New one", scopes: ["read"], expiresInDays: 30 });
    const after = await api.listAccessTokens();
    await api.revokeAccessToken(issued.token.id);

    expect(before).toHaveLength(2);
    expect(after.map((token) => token.id)).toContain(issued.token.id);
    expect(JSON.stringify(after)).not.toContain(issued.secret);
    expect((await api.listAccessTokens()).map((token) => token.id)).not.toContain(issued.token.id);
    await expect(api.revokeAccessToken(issued.token.id)).resolves.toBeUndefined();
    window.localStorage.clear();
  });

  it("answers a refusal after the same wait as a success, never at once", async () => {
    window.localStorage.clear();
    const api = new MockTaskaApi();
    await api.login({ email: "anna@example.com", password: "anything" });

    const outcomes: string[] = [];
    const revoke = api.revokeAccessToken("never-issued").then(
      () => "revoked",
      (error: { code?: string }) => error.code ?? "no code",
    );
    const create = api.createAccessToken({ name: "  ", scopes: ["read"], expiresInDays: 30 }).then(
      () => "created",
      (error: { code?: string }) => error.code ?? "no code",
    );
    void revoke.then((outcome) => outcomes.push(outcome));
    void create.then((outcome) => outcomes.push(outcome));

    // A macrotask later every microtask has run: a refusal thrown before the
    // wait would be here already.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(outcomes).toEqual([]);
    expect(await revoke).toBe("NOT_FOUND");
    expect(await create).toBe("INVALID_ARGUMENT");
    window.localStorage.clear();
  });
});
