import { afterEach, describe, expect, it, vi } from "vitest";
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
/** `TelegramLinkDto` since backend TAS-387: the link and the row as it stands after it was issued. */
const linkAnswer = {
  linkId: "link",
  url: "https://t.me/TaskaBot?start=opaque",
  expiresAt: "2026-10-23T12:00:00Z",
  preferences: preference,
};
afterEach(() => vi.unstubAllGlobals());

describe("notification preference transport", () => {
  it("uses the five current-user routes and preserves partial booleans and link identity", async () => {
    const fetch = vi.fn(
      async (url: string, _init: RequestInit) =>
        new Response(JSON.stringify(url.endsWith("/telegram/link") ? linkAnswer : preference), { status: 200 }),
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

  it("reads the row the link answer carries through the same mapper, as the section's one source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...linkAnswer, preferences: { ...preference, telegramStatus: "SUSPENDED" } }), {
            status: 200,
          }),
      ),
    );
    const link = await new RestTaskaApi().createTelegramLink();
    expect(link).toMatchObject({ linkId: "link", url: linkAnswer.url, expiresAt: linkAnswer.expiresAt });
    expect(link.preferences).toMatchObject({ telegramStatus: null, telegramLinkId: "link", email: "a@example.com" });
  });

  it("reads a Telegram status this build does not know as null on every route that answers with the row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ...preference, telegramStatus: "SUSPENDED" }), { status: 200 })),
    );
    const api = new RestTaskaApi();
    const answers = [
      await api.getNotificationPreferences(),
      await api.updateNotificationPreferences({ emailEnabled: false }),
      await api.confirmTelegramLink("7f538eb4-1584-44e1-87a6-6657343a1563"),
      await api.disconnectTelegram(),
    ];
    for (const answer of answers) expect(answer).toMatchObject({ telegramStatus: null, email: "a@example.com" });
  });

  it("keeps each of the five known Telegram statuses as it came", async () => {
    for (const telegramStatus of ["NOT_CONNECTED", "PENDING", "AWAITING_CONFIRMATION", "CONNECTED", "UNAVAILABLE"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({ ...preference, telegramStatus }), { status: 200 })),
      );
      await expect(new RestTaskaApi().getNotificationPreferences()).resolves.toMatchObject({ telegramStatus });
    }
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
});
