import { afterEach, describe, expect, it, vi } from "vitest";
import { INSUFFICIENT_SCOPE_CODE, isInsufficientScope, isRateLimited } from "./accessTokens";
import { isUndeployedRoute } from "./errors";
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

    vi.stubGlobal("fetch", refuse(429, { code: "RESOURCE_EXHAUSTED", message: "Too many requests" }));
    const limited = await new RestTaskaApi()
      .createAccessToken({ name: "x", scopes: ["read"], expiresInDays: 7 })
      .catch((error: unknown) => error);
    expect(limited).toMatchObject({ status: 429, requestId: "request-429" });
    expect(isRateLimited(limited)).toBe(true);
    expect(isInsufficientScope(limited)).toBe(false);
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

    // Nothing the store holds can show either value again.
    const held = JSON.stringify(store);
    expect(held).not.toContain(first.secret);
    expect(held).not.toContain(second.secret);
    expect(JSON.stringify(store.list("anna"))).not.toContain(first.secret);
    expect(store.list("anna").map((token) => token.name)).toEqual(["Script", "Cursor on laptop"]);
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

  it("answers the 429's code after five creates in a minute (a mock-only number)", () => {
    const store = new MockAccessTokens();
    for (let index = 0; index < 5; index += 1) store.create("anna", { name: `t${index}`, scopes: ["read"], expiresInDays: 7 });
    let caught: unknown;
    try {
      store.create("anna", { name: "one more", scopes: ["read"], expiresInDays: 7 });
    } catch (error) {
      caught = error;
    }
    expect(isRateLimited(caught)).toBe(true);
  });

  it("takes a revoked token out at once, and refuses one it does not hold", () => {
    const store = new MockAccessTokens("anna");
    const [first] = store.list("anna");
    store.revoke("anna", first.id);
    expect(store.list("anna").map((token) => token.id)).not.toContain(first.id);
    expect(() => store.revoke("anna", first.id)).toThrow("Access token not found");
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
    window.localStorage.clear();
  });
});
