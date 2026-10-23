import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestTaskaApi } from "./RestTaskaApi";

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const tokens = (account: string) => ({ accessToken: `${account}-access`, refreshToken: `${account}-refresh`, expiresIn: 3600 });
const denied = () => answer(401, { code: "UNAUTHENTICATED", message: "Old access token expired" });
const preference = { emailEnabled: true, telegramEnabled: false, email: "b@example.com", telegramAvailable: true, telegramStatus: "NOT_CONNECTED" };
const pending = () => {
  let resolve!: (response: Response) => void;
  return { promise: new Promise<Response>((done) => { resolve = done; }), resolve: (response: Response) => resolve(response) };
};
const stored = () => ({ access: window.localStorage.getItem("taska.accessToken"), refresh: window.localStorage.getItem("taska.refreshToken") });
beforeEach(() => { window.localStorage.clear(); window.localStorage.setItem("taska.accessToken", "a-access"); window.localStorage.setItem("taska.refreshToken", "a-refresh"); });
afterEach(() => vi.unstubAllGlobals());

const operations = [
  { name: "PATCH notification preferences", invoke: (api: RestTaskaApi) => api.updateNotificationPreferences({ emailEnabled: false }) },
  { name: "DELETE Telegram binding", invoke: (api: RestTaskaApi) => api.disconnectTelegram() },
];

describe("current-user request session isolation", () => {
  for (const operation of operations) {
    it(`never refreshes or replays a delayed401 ${operation.name} under the next account`, async () => {
      const delayed = pending();
      const mutations: string[] = [];
      const fetch = vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/auth/login")) return answer(200, tokens("b"));
        if (url.endsWith("/auth/refresh")) throw new Error("A stale request must not refresh the new account");
        mutations.push((init.headers as Record<string, string>).Authorization);
        return delayed.promise;
      });
      vi.stubGlobal("fetch", fetch);
      const api = new RestTaskaApi();
      const expired = vi.fn(); api.onSessionExpired(expired);
      const old = operation.invoke(api);
      const refused = expect(old).rejects.toMatchObject({ status: 401 });
      await api.logout(); await api.login({ email: "b@example.com", password: "correct" });
      delayed.resolve(denied());
      await refused;
      expect(mutations).toEqual(["Bearer a-access"]);
      expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(0);
      expect(stored()).toEqual({ access: "b-access", refresh: "b-refresh" });
      expect(expired).not.toHaveBeenCalled();
    });

    it(`never replays ${operation.name} if the account changes while refresh is in flight`, async () => {
      const refresh = pending();
      const mutations: string[] = [];
      const fetch = vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith("/auth/login")) return answer(200, tokens("b"));
        if (url.endsWith("/auth/refresh")) return refresh.promise;
        mutations.push((init.headers as Record<string, string>).Authorization);
        return denied();
      });
      vi.stubGlobal("fetch", fetch);
      const api = new RestTaskaApi();
      const expired = vi.fn(); api.onSessionExpired(expired);
      const old = operation.invoke(api);
      const refused = expect(old).rejects.toMatchObject({ status: 401 });
      await vi.waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1));
      await api.logout(); await api.login({ email: "b@example.com", password: "correct" });
      refresh.resolve(answer(200, tokens("a-refreshed")));
      await refused;
      expect(mutations).toEqual(["Bearer a-access"]);
      expect(stored()).toEqual({ access: "b-access", refresh: "b-refresh" });
      expect(expired).not.toHaveBeenCalled();
    });
  }

  it("keeps refresh flights separate across accounts, including their completion cleanup", async () => {
    const oldRefresh = pending();
    const newRefresh = pending();
    let bCalls = 0;
    const refreshTokens: string[] = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/auth/login")) return answer(200, tokens("b"));
      if (url.endsWith("/auth/refresh")) {
        const token = (JSON.parse(init.body as string) as { refreshToken: string }).refreshToken;
        refreshTokens.push(token);
        return token === "a-refresh" ? oldRefresh.promise : newRefresh.promise;
      }
      if ((init.headers as Record<string, string>).Authorization === "Bearer a-access") return denied();
      bCalls++;
      return (init.headers as Record<string, string>).Authorization === "Bearer b-new-access" ? answer(200, preference) : denied();
    });
    vi.stubGlobal("fetch", fetch);
    const api = new RestTaskaApi();
    const expired = vi.fn(); api.onSessionExpired(expired);
    const a = api.disconnectTelegram(); const refused = expect(a).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(refreshTokens).toEqual(["a-refresh"]));
    await api.logout(); await api.login({ email: "b@example.com", password: "correct" });
    const b = api.updateNotificationPreferences({ emailEnabled: false });
    await vi.waitFor(() => expect(refreshTokens).toEqual(["a-refresh", "b-refresh"]));
    oldRefresh.resolve(denied()); await refused;
    // The old flight's finally must not clear the B flight: a second B request
    // joins it instead of issuing a third refresh with the same refresh token.
    const b2 = api.getNotificationPreferences();
    await vi.waitFor(() => expect(bCalls).toBe(2));
    expect(refreshTokens).toEqual(["a-refresh", "b-refresh"]);
    newRefresh.resolve(answer(200, tokens("b-new")));
    await expect(b).resolves.toMatchObject({ email: "b@example.com" });
    await expect(b2).resolves.toMatchObject({ email: "b@example.com" });
    expect(stored()).toEqual({ access: "b-new-access", refresh: "b-new-refresh" });
    expect(expired).not.toHaveBeenCalled();
  });
});
