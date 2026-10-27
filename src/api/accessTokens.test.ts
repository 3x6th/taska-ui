import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accessTokenLifetimes,
  defaultAccessTokenLifetime,
  isActiveTokenLimit,
  isRateLimited,
  isSessionRequired,
} from "./accessTokens";
import { apiErrorFacts, isUndeployedRoute } from "./errors";
import { MockAccessTokens } from "./mock/MockAccessTokens";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";
import { UNDEPLOYED_ROUTE_MESSAGE } from "./TaskaApi";

/**
 * Personal access tokens (TAS-412) against backend TAS-401/402 as the contract
 * states them at develop `be5085e5`: what this build sends and reads, and the
 * mock's reproduction of the server's order, refusals and words. Nothing here
 * was measured with a token.
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
const policy = { maxLifetimeDays: 90, maxActiveTokens: 10 };

afterEach(() => vi.unstubAllGlobals());

/**
 * Everything an object holds, as one string to search — `Map`s and `Set`s by
 * their contents. A plain `JSON.stringify` writes both as `{}`, and an
 * assertion that a secret is not in `{}` is true of any store.
 */
const dump = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item instanceof Map ? [...item.entries()] : item instanceof Set ? [...item] : item,
  );

/** The refusal a call threw, or `null` for one that did not refuse. */
const refusalOf = (call: () => unknown): unknown => {
  try {
    call();
    return null;
  } catch (error) {
    return error;
  }
};

describe("the REST transport for access tokens", () => {
  it("calls the three paths, reads the list with its policy, and sends the lifetime only when there is one", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "POST") {
        return new Response(JSON.stringify({ token: wireToken, secret: "tsk_pat_3fA9" + "a".repeat(39) }), { status: 201 });
      }
      return new Response(JSON.stringify({ items: [wireToken], policy }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetch);
    const api = new RestTaskaApi();

    const list = await api.listAccessTokens();
    const issued = await api.createAccessToken({ name: "Cursor on laptop", scopes: ["read", "write"], expiresInDays: 30 });
    await api.createAccessToken({ name: "No policy", scopes: ["read"] });
    await api.revokeAccessToken(wireToken.id);

    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/users/me/access-tokens",
      "/api/v1/users/me/access-tokens",
      "/api/v1/users/me/access-tokens",
      `/api/v1/users/me/access-tokens/${wireToken.id}`,
    ]);
    const options = fetch.mock.calls.map((call) => call[1]);
    expect(options.map((value) => value.method)).toEqual(["GET", "POST", "POST", "DELETE"]);
    expect(JSON.parse(options[1].body as string)).toEqual({ name: "Cursor on laptop", scopes: ["read", "write"], expiresInDays: 30 });
    // No policy, no lifetime: the key is absent, not null — the server's default applies.
    expect(JSON.parse(options[2].body as string)).toEqual({ name: "No policy", scopes: ["read"] });
    expect(list).toEqual({ tokens: [wireToken], policy });
    expect(issued).toEqual({ token: wireToken, secret: "tsk_pat_3fA9" + "a".repeat(39) });
  });

  it("keeps the server's order, drops a row without a usable id, and reads a malformed policy as none", async () => {
    const older = { ...wireToken, id: "1a1a1a1a-0000-4000-8000-000000000001", createdAt: "2026-10-01T10:00:00Z" };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              // Oldest first on purpose: nothing here re-sorts.
              items: [older, { ...wireToken, id: "" }, { ...wireToken, id: 7 }, wireToken],
              policy: { maxLifetimeDays: "90", maxActiveTokens: 10 },
            }),
            { status: 200 },
          ),
      ),
    );

    const { tokens, policy: read } = await new RestTaskaApi().listAccessTokens();

    expect(tokens.map((token) => token.id)).toEqual([older.id, wireToken.id]);
    expect(read).toBeNull();
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
                { id: "2b2b2b2b-0000-4000-8000-000000000002", scopes: ["read", 3], lastUsedAt: 0 },
              ],
              policy,
            }),
            { status: 200 },
          ),
      ),
    );

    const {
      tokens: [first, second],
    } = await new RestTaskaApi().listAccessTokens();

    expect(first).toEqual({ ...wireToken, lastUsedAt: "2026-10-24T11:00:00Z" });
    expect(first).not.toHaveProperty("secret");
    expect(second).toEqual({
      id: "2b2b2b2b-0000-4000-8000-000000000002",
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

  it("carries the session-only 403, the cap and the 429 with their request ids, each read by its own predicate", async () => {
    const refuse = (status: number, body: object) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "X-Request-Id": `request-${status}` } }));
    const create = () =>
      new RestTaskaApi().createAccessToken({ name: "x", scopes: ["read"], expiresInDays: 7 }).catch((error: unknown) => error);

    vi.stubGlobal(
      "fetch",
      refuse(403, { code: "PERMISSION_DENIED", message: "Session required", details: { reason: "SESSION_REQUIRED" } }),
    );
    const session = await create();
    expect(session).toMatchObject({ status: 403, code: "PERMISSION_DENIED", requestId: "request-403" });
    expect([isSessionRequired(session), isActiveTokenLimit(session), isRateLimited(session)]).toEqual([true, false, false]);

    vi.stubGlobal(
      "fetch",
      refuse(400, {
        code: "FAILED_PRECONDITION",
        message: "Active token limit reached",
        details: { reason: "ACTIVE_TOKEN_LIMIT", limit: "10" },
      }),
    );
    const cap = await create();
    expect([isSessionRequired(cap), isActiveTokenLimit(cap), isRateLimited(cap)]).toEqual([false, true, false]);
    expect(apiErrorFacts(cap).details).toEqual({ reason: "ACTIVE_TOKEN_LIMIT", limit: "10" });

    vi.stubGlobal(
      "fetch",
      refuse(429, {
        code: "RESOURCE_EXHAUSTED",
        message: "Token issuance rate limit reached; try later",
        details: { retryAfterSeconds: "3412" },
      }),
    );
    const limited = await create();
    expect(limited).toMatchObject({ status: 429, requestId: "request-429" });
    expect([isSessionRequired(limited), isActiveTokenLimit(limited), isRateLimited(limited)]).toEqual([false, false, true]);
    expect(apiErrorFacts(limited).details?.retryAfterSeconds).toBe("3412");
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

/**
 * The lifetimes the form offers (backend TAS-402): 7, 30 and 90 up to the
 * policy's maximum, and the maximum itself when it is none of them. On the
 * stand "1 year" was a 400 on every click.
 */
describe("the lifetimes a policy allows", () => {
  const lifetimes = (maxLifetimeDays: number) => accessTokenLifetimes({ maxLifetimeDays, maxActiveTokens: 10 });

  it("offers the presets up to the maximum, and the maximum when it is not one", () => {
    expect(lifetimes(90)).toEqual([7, 30, 90]);
    expect(lifetimes(60)).toEqual([7, 30, 60]);
    expect(lifetimes(365)).toEqual([7, 30, 90, 365]);
    expect(lifetimes(30)).toEqual([7, 30]);
    expect(lifetimes(5)).toEqual([5]);
    expect(lifetimes(1)).toEqual([1]);
    expect(accessTokenLifetimes(null)).toEqual([]);
  });

  it("starts on the server's default of 30 when offered, else the longest, else none", () => {
    expect(defaultAccessTokenLifetime([7, 30, 90])).toBe(30);
    expect(defaultAccessTokenLifetime([7, 14])).toBe(14);
    expect(defaultAccessTokenLifetime([5])).toBe(5);
    expect(defaultAccessTokenLifetime([])).toBeNull();
  });
});

describe("the channel mark on the REST wire (TAS-411, TAS-425)", () => {
  // `channel` on `IssueHistoryResponseDto` and `CommentResponseDto` (develop
  // `78019ece`): an open string, null or absent on old records. Only MCP and
  // an API token become a mark; nothing names the token.
  const channels: [label: string, value: Record<string, unknown>, via: { channel: string } | null][] = [
    ["MCP", { channel: "MCP" }, { channel: "MCP" }],
    ["API_TOKEN", { channel: "API_TOKEN" }, { channel: "API_TOKEN" }],
    ["UI", { channel: "UI" }, null],
    ["null", { channel: null }, null],
    ["absent", {}, null],
    ["an unknown channel", { channel: "WEBHOOK" }, null],
    ["a non-string", { channel: 3 }, null],
  ];

  function stubWire(extra: Record<string, unknown>) {
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
                    ...extra,
                  },
                ],
                totalCount: 1,
              }),
              { status: 200 },
            )
          : new Response(
              JSON.stringify({
                issue: { id: "i-1", projectId: "p-1", summary: "x", labels: [] },
                history: [
                  { id: "h-1", eventType: "CREATED", actorUserId: "u-1", occurredAt: "2026-10-24T10:00:00Z", payload: {}, ...extra },
                ],
              }),
              { status: 200 },
            ),
      ),
    );
  }

  it.each(channels)("reads %s on a history event and a comment", async (_label, extra, via) => {
    stubWire(extra);
    const api = new RestTaskaApi();

    const { history } = await api.getIssue("p-1", "i-1");
    const { items } = await api.listComments("p-1", "i-1");

    expect(history[0].via).toEqual(via);
    expect(items[0].via).toEqual(via);
    // The wire's own key does not ride through into the domain object.
    expect(history[0]).not.toHaveProperty("channel");
    expect(items[0]).not.toHaveProperty("channel");
  });

  it("reads no token name, whatever a key of the old shape carries", async () => {
    stubWire({ channel: "MCP", via: { channel: "API_TOKEN", tokenName: "Cursor on laptop" } });
    const api = new RestTaskaApi();

    const { history } = await api.getIssue("p-1", "i-1");
    const { items } = await api.listComments("p-1", "i-1");

    expect(history[0].via).toEqual({ channel: "MCP" });
    expect(items[0].via).toEqual({ channel: "MCP" });
  });
});

describe("the mock's access tokens", () => {
  const create = (store: MockAccessTokens, overrides: Partial<Parameters<MockAccessTokens["create"]>[1]> = {}) =>
    store.create("anna", { name: "Token", scopes: ["read"], expiresInDays: 30, ...overrides });

  it("seeds the suite's account with a read token and a read-and-write one, one of them never used, and the policy", () => {
    const { tokens, policy: stated } = new MockAccessTokens("anna").list("anna");
    expect(tokens.map((token) => token.scopes)).toEqual(expect.arrayContaining([["read"], ["read", "write"]]));
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.lastUsedAt === null)).toHaveLength(1);
    expect(stated).toEqual(policy);
    expect(new MockAccessTokens("anna").list("somebody-else").tokens).toEqual([]);
  });

  it("answers a create with a 43-character base64url secret once, and keeps only its 12-character prefix", () => {
    const store = new MockAccessTokens();
    const first = create(store, { name: "  Cursor on laptop  ", expiresInDays: 7 });
    const second = create(store, { name: "Script", scopes: ["read", "write"], expiresInDays: 90 });

    expect(first.secret).toMatch(/^tsk_pat_[A-Za-z0-9_-]{43}$/);
    expect(first.secret).not.toBe(second.secret);
    expect(first.token.name).toBe("Cursor on laptop");
    expect(first.token.tokenPrefix).toBe(first.secret.slice(0, 12));
    expect(Date.parse(first.token.expiresAt) - Date.parse(first.token.createdAt)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(second.token.scopes).toEqual(["read", "write"]);

    // Nothing the store holds can show either value again: not what it lists…
    const listed = JSON.stringify(store.list("anna"));
    expect(listed).not.toContain(first.secret);
    expect(listed).not.toContain(second.secret);
    // …and not what it keeps, read through its Maps. The dump does reach the
    // tokens — it holds their ids and prefixes — so its silence is a finding.
    const held = dump(store);
    expect(held).toContain(first.token.id);
    expect(held).toContain(second.token.tokenPrefix);
    expect(held).not.toContain(first.secret);
    expect(held).not.toContain(second.secret);
  });

  it("lists createdAt, then id, both newest first, and gives a create with no lifetime the server's 30 days", () => {
    const store = new MockAccessTokens();
    const now = Date.parse("2026-10-24T10:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const ids = [create(store), create(store), create(store, { expiresInDays: undefined })].map((issued) => issued.token);
    vi.restoreAllMocks();

    // Same instant for all three: the ids decide, newest (largest) first.
    expect(store.list("anna").tokens.map((token) => token.id)).toEqual(ids.map((token) => token.id).sort().reverse());
    expect(Date.parse(ids[2].expiresAt) - now).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("refuses in the server's order and words: body, name, scopes, lifetime against the policy", () => {
    const store = new MockAccessTokens();
    const facts = (input: Partial<Parameters<MockAccessTokens["create"]>[1]>) =>
      apiErrorFacts(refusalOf(() => create(store, input)));

    expect(facts({ name: "" })).toMatchObject({ code: "INVALID_ARGUMENT", message: "Invalid request parameters" });
    expect(facts({ name: "x".repeat(101) })).toMatchObject({ message: "Invalid request parameters" });
    expect(facts({ name: "   " })).toMatchObject({ code: "INVALID_ARGUMENT", message: "Token name must contain 1 to 100 characters" });
    expect(facts({ scopes: ["write"] as unknown as ["read"] })).toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "Token scopes must be read or read,write",
    });
  });

  it("refuses a lifetime past the policy, naming its maximum, and takes the maximum itself", () => {
    const store = new MockAccessTokens();
    expect(apiErrorFacts(refusalOf(() => create(store, { expiresInDays: 91 })))).toEqual(
      expect.objectContaining({
        code: "INVALID_ARGUMENT",
        message: "Token lifetime is outside policy",
        details: { maxLifetimeDays: "90" },
      }),
    );
    expect(refusalOf(() => create(store, { expiresInDays: 90 }))).toBeNull();
  });

  // Five attempts an hour per account, refused ones counted, checked before
  // the body is looked at (`PersonalTokenCreationLimiter`).
  it("answers the 429 on the sixth attempt in an hour, refused attempts counted, with the wait in whole seconds", () => {
    const store = new MockAccessTokens();
    const start = Date.parse("2026-10-24T10:00:00Z");
    const clock = vi.spyOn(Date, "now").mockReturnValue(start);
    for (let index = 0; index < 4; index += 1) create(store);
    expect(refusalOf(() => create(store, { name: "" }))).not.toBeNull();

    clock.mockReturnValue(start + 10 * 60 * 1000 + 500);
    const limited = refusalOf(() => create(store));
    expect(isRateLimited(limited)).toBe(true);
    expect(apiErrorFacts(limited)).toMatchObject({
      code: "RESOURCE_EXHAUSTED",
      message: "Token issuance rate limit reached; try later",
      details: { retryAfterSeconds: "3000" },
    });
    // Even a body that would be refused is refused for the rate first.
    expect(isRateLimited(refusalOf(() => create(store, { name: "" })))).toBe(true);

    clock.mockReturnValue(start + 60 * 60 * 1000);
    expect(refusalOf(() => create(store))).toBeNull();
    vi.restoreAllMocks();
  });

  it("refuses an eleventh active token with the cap's reason, counting unexpired tokens only", () => {
    const store = new MockAccessTokens();
    const start = Date.parse("2026-10-24T10:00:00Z");
    const clock = vi.spyOn(Date, "now");
    // Two hours apart, so the limiter's window never closes on these.
    for (let index = 0; index < 10; index += 1) {
      clock.mockReturnValue(start + index * 2 * 60 * 60 * 1000);
      create(store, { expiresInDays: index === 0 ? 1 : 30 });
    }
    clock.mockReturnValue(start + 20 * 60 * 60 * 1000);
    // Twenty hours in, the one-day token has not expired yet: ten active.
    const cap = refusalOf(() => create(store));
    expect(isActiveTokenLimit(cap)).toBe(true);
    expect(apiErrorFacts(cap)).toMatchObject({
      code: "FAILED_PRECONDITION",
      message: "Active token limit reached",
      details: { reason: "ACTIVE_TOKEN_LIMIT", limit: "10" },
    });

    // Once the one-day token has expired it no longer counts — and it is still listed.
    clock.mockReturnValue(start + 26 * 60 * 60 * 1000);
    expect(refusalOf(() => create(store))).toBeNull();
    expect(store.list("anna").tokens).toHaveLength(11);
    vi.restoreAllMocks();
  });

  it("revokes at once, and answers any other id — unknown, another account's, already revoked — as the same 204", () => {
    const store = new MockAccessTokens("anna");
    const [first, second] = store.list("anna").tokens;
    expect(store.revoke("anna", first.id)).toMatchObject({ id: first.id });
    expect(store.list("anna").tokens.map((token) => token.id)).toEqual([second.id]);

    expect(refusalOf(() => store.revoke("anna", first.id))).toBeNull();
    expect(store.revoke("anna", first.id)).toBeNull();
    expect(store.revoke("anna", "never-issued")).toBeNull();
    expect(store.revoke("boris", second.id)).toBeNull();
    expect(store.list("anna").tokens.map((token) => token.id)).toEqual([second.id]);
  });

  it("serves the signed-in account's tokens through MockTaskaApi, and writes the owner's inbox row for each", async () => {
    window.localStorage.clear();
    const api = new MockTaskaApi();
    await api.login({ email: "anna@example.com", password: "anything" });
    const unread = (await api.listNotifications()).unreadCount;

    const before = await api.listAccessTokens();
    const issued = await api.createAccessToken({ name: "New one", scopes: ["read"], expiresInDays: 30 });
    const after = await api.listAccessTokens();
    await api.revokeAccessToken(issued.token.id);
    // A second revoke is the same success, and raises nothing.
    await expect(api.revokeAccessToken(issued.token.id)).resolves.toBeUndefined();

    expect(before.tokens).toHaveLength(2);
    expect(before.policy).toEqual(policy);
    expect(after.tokens[0].id).toBe(issued.token.id);
    expect(JSON.stringify(after)).not.toContain(issued.secret);
    expect((await api.listAccessTokens()).tokens.map((token) => token.id)).not.toContain(issued.token.id);

    const inbox = await api.listNotifications();
    expect(inbox.unreadCount).toBe(unread + 2);
    const rows = inbox.items.filter((item) => item.notificationType.startsWith("PERSONAL_ACCESS_TOKEN_"));
    expect(rows.map((row) => [row.notificationType, row.title, row.body])).toEqual(
      expect.arrayContaining([
        [
          "PERSONAL_ACCESS_TOKEN_CREATED",
          "Personal access token created",
          `Personal access token ${issued.token.tokenPrefix}... was created.`,
        ],
        [
          "PERSONAL_ACCESS_TOKEN_REVOKED",
          "Personal access token revoked",
          `Personal access token ${issued.token.tokenPrefix}... was revoked.`,
        ],
      ]),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toMatchObject({ issueId: null, issueKey: null, projectId: null });
    expect(JSON.stringify(inbox)).not.toContain(issued.secret);
    window.localStorage.clear();
  });

  it("answers a refusal after the same wait as a success, never at once", async () => {
    window.localStorage.clear();
    const api = new MockTaskaApi();
    await api.login({ email: "anna@example.com", password: "anything" });

    const outcomes: string[] = [];
    const create = api.createAccessToken({ name: "  ", scopes: ["read"], expiresInDays: 30 }).then(
      () => "created",
      (error: { code?: string }) => error.code ?? "no code",
    );
    void create.then((outcome) => outcomes.push(outcome));

    // A macrotask later every microtask has run: a refusal thrown before the
    // wait would be here already.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(outcomes).toEqual([]);
    expect(await create).toBe("INVALID_ARGUMENT");
    window.localStorage.clear();
  });
});
