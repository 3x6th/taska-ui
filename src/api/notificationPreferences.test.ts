import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferences } from "../domain/types";
import { HybridTaskaApi } from "./HybridTaskaApi";
import { MockTaskaApi } from "./mock/MockTaskaApi";
import { RestTaskaApi } from "./rest/RestTaskaApi";

const preference = {
  emailEnabled: true,
  telegramEnabled: false,
  email: "a@example.com",
  telegramAvailable: true,
  telegramStatus: "PENDING",
  telegramUsername: null,
  telegramName: null,
  telegramLinkId: "link",
  telegramLinkExpiresAt: "2026-10-23T12:00:00Z",
  telegramError: null,
};
afterEach(() => vi.unstubAllGlobals());

describe("notification preference transport", () => {
  it("uses the five current-user routes and preserves partial booleans and link identity", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(JSON.stringify(preference), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    const api = new RestTaskaApi();
    await api.getNotificationPreferences();
    await api.updateNotificationPreferences({ emailEnabled: false });
    await api.createTelegramLink();
    await api.confirmTelegramLink("7f538eb4-1584-44e1-87a6-6657343a1563");
    await api.disconnectTelegram();
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/users/me/notification-preferences",
      "/api/v1/users/me/notification-preferences",
      "/api/v1/users/me/telegram/link",
      "/api/v1/users/me/telegram/confirm",
      "/api/v1/users/me/telegram",
    ]);
    const options = fetch.mock.calls.map((call) => (call as unknown as [string, RequestInit])[1]);
    expect(options.map((value) => value.method)).toEqual(["GET", "PATCH", "POST", "POST", "DELETE"]);
    expect(JSON.parse(options[1].body as string)).toEqual({ emailEnabled: false });
    expect(JSON.parse(options[3].body as string)).toEqual({ linkId: "7f538eb4-1584-44e1-87a6-6657343a1563" });
  });

  it("carries the server's 409 and request id without manufacturing a connected account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: "ABORTED", message: "Telegram link has expired" }), {
            status: 409,
            headers: { "X-Request-Id": "request-id" },
          }),
      ),
    );
    await expect(new RestTaskaApi().confirmTelegramLink("old")).rejects.toMatchObject({
      status: 409,
      code: "ABORTED",
      requestId: "request-id",
    });
  });

  it("hybrid passes through every operation and its rejection", async () => {
    const live = new MockTaskaApi();
    const hybrid = new HybridTaskaApi(live);
    const served = preference as NotificationPreferences;
    const get = vi.spyOn(live, "getNotificationPreferences").mockResolvedValue(served);
    const patch = vi.spyOn(live, "updateNotificationPreferences").mockResolvedValue(served);
    const link = vi
      .spyOn(live, "createTelegramLink")
      .mockResolvedValue({ linkId: "link", url: "https://t.me/TaskaBot?start=token", expiresAt: "expires" });
    const confirm = vi.spyOn(live, "confirmTelegramLink").mockRejectedValue(new Error("Expired"));
    const disconnect = vi.spyOn(live, "disconnectTelegram").mockResolvedValue(served);
    await hybrid.getNotificationPreferences();
    await hybrid.updateNotificationPreferences({ telegramEnabled: false });
    await hybrid.createTelegramLink();
    await expect(hybrid.confirmTelegramLink("link")).rejects.toThrow("Expired");
    await hybrid.disconnectTelegram();
    expect(get).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledWith({ telegramEnabled: false });
    expect(link).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith("link");
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
