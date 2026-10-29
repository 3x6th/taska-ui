import { afterEach, describe, expect, it, vi } from "vitest";
import { RestTaskaApi } from "./rest/RestTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";

const app = { appId: "4c7dd987-4192-4b58-a16c-55bb07c01a28", name: "Claude", host: "claude.ai", metadataUrl: null, scopes: ["read", "future_scope"], connectedAt: "2026-10-20T10:00:00Z", lastUsedAt: "2026-10-28T12:40:00Z", expiresAt: "2026-11-27T10:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
describe("connected apps transport", () => {
  it("reads the server response including unknown scopes and revokes the named app", async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => init.method === "DELETE" ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ available: true, items: [app] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const api = new RestTaskaApi();
    expect(await api.listConnectedApps()).toEqual({ available: true, items: [app] });
    await api.revokeConnectedApp(app.appId);
    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([["/api/v1/users/me/connected-apps", "GET"], [`/api/v1/users/me/connected-apps/${app.appId}`, "DELETE"]]);
  });
  it("preserves the disabled state and propagates a 503", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ available: false, items: [] }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ code: "UNAVAILABLE", message: "Unavailable" }), { status: 503, headers: { "X-Request-Id": "req-1" } }));
    vi.stubGlobal("fetch", fetch);
    const api = new RestTaskaApi();
    expect(await api.listConnectedApps()).toEqual({ available: false, items: [] });
    await expect(api.listConnectedApps()).rejects.toMatchObject({ status: 503, requestId: "req-1" });
  });
  it("mock revoke removes only the current user's app and repeated revoke succeeds", async () => {
    window.localStorage.clear();
    const api = new MockTaskaApi();
    await api.login({ email: "anna@example.com", password: "any" });
    const before = await api.listConnectedApps();
    expect(before.items).toHaveLength(1);
    await api.login({ email: "mark@example.com", password: "any" });
    await api.revokeConnectedApp(before.items[0].appId);
    await api.login({ email: "anna@example.com", password: "any" });
    expect((await api.listConnectedApps()).items).toEqual(before.items);
    await api.revokeConnectedApp(before.items[0].appId);
    await api.revokeConnectedApp(before.items[0].appId);
    expect(await api.listConnectedApps()).toEqual({ available: true, items: [] });
  });
});
