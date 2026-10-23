import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferences, NotificationPreferencesPatch } from "../../domain/types";
import { telegramDeliveryErrorText } from "../../lib/format";
import { SettingsNotificationsSection } from "./SettingsNotificationsSection";
import { notificationPreferencesKey, telegramBotUrl } from "./notificationPreferencesQuery";

const { api } = vi.hoisted(() => ({
  api: {
    getNotificationPreferences: vi.fn(),
    updateNotificationPreferences: vi.fn(),
    createTelegramLink: vi.fn(),
    confirmTelegramLink: vi.fn(),
    disconnectTelegram: vi.fn(),
  },
}));
vi.mock("../../api/client", () => ({ taskaApi: api }));

const initial = (): NotificationPreferences => ({
  emailEnabled: true,
  telegramEnabled: false,
  email: "anna@example.com",
  telegramAvailable: true,
  telegramStatus: "NOT_CONNECTED",
  telegramUsername: null,
  telegramName: null,
  telegramLinkId: null,
  telegramLinkExpiresAt: null,
  telegramError: null,
});
let row: NotificationPreferences;
let client: QueryClient;

const draw = (userId = "anna") =>
  render(
    <QueryClientProvider client={client}>
      <SettingsNotificationsSection key={userId} userId={userId} />
    </QueryClientProvider>,
  );
const email = () => screen.getByRole("switch", { name: "Email" });
const telegram = () => screen.getByRole("switch", { name: "Telegram" });
const load = async () => {
  await screen.findByRole("switch", { name: "Email" });
};

beforeEach(() => {
  vi.resetAllMocks();
  row = initial();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.getNotificationPreferences.mockImplementation(async () => ({ ...row }));
  api.updateNotificationPreferences.mockImplementation(
    async (input: NotificationPreferencesPatch) => (row = { ...row, ...input }),
  );
});
afterEach(() => {
  client.clear();
  // Back to the browser's own focus state, for a case that set it by hand.
  focusManager.setFocused(undefined);
});

const UNAVAILABLE_NOTE =
  "The connected bot cannot deliver notifications right now. You can disconnect Telegram and connect again when it is available.";
const UNKNOWN_NOTE = "You can disconnect Telegram and connect again.";

describe("personal notification choices", () => {
  it("shows a shaped loading state and a read failure without pretending channels are off", async () => {
    api.getNotificationPreferences.mockReturnValueOnce(new Promise(() => {}));
    const view = draw();
    expect(screen.getByRole("status")).toHaveTextContent("Loading notification choices");
    expect(screen.queryByRole("switch")).toBeNull();
    view.unmount();
    client.clear();
    api.getNotificationPreferences.mockRejectedValueOnce(new Error("Service unavailable"));
    draw();
    expect(await screen.findByText("Your notification choices could not be loaded.")).toBeVisible();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("optimistically changes only the selected channel, guards double presses and rolls back a refusal", async () => {
    let reject: (reason: Error) => void = () => {};
    api.updateNotificationPreferences.mockReturnValueOnce(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    draw();
    await load();
    email().focus();
    fireEvent.click(email());
    await waitFor(() => expect(email()).toHaveAttribute("aria-checked", "false"));
    expect(email()).toHaveAttribute("aria-disabled", "true");
    expect(email()).toHaveAttribute("data-busy", "true");
    expect(email()).not.toHaveAttribute("data-unavailable");
    expect(email()).toHaveFocus();
    fireEvent.click(email());
    expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(1);
    await act(async () => reject(Object.assign(new Error("Refused"), { requestId: "request-123" })));
    await waitFor(() => expect(email()).toHaveAttribute("aria-checked", "true"));
    const text = screen.getByText(
      "Taska could not confirm the notification change. Check the current choices.",
    );
    expect(text).toHaveAttribute("aria-live", "polite");
    const id = screen.getByRole("button", { name: "Copy request id request-123" });
    expect(id.closest("[aria-live]")).toBeNull();
    expect(telegram()).toHaveAttribute("aria-checked", "false");
    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ emailEnabled: false });
  });

  it("supports email-only, both, Telegram-only and neither with independent switches", async () => {
    row = {
      ...initial(),
      telegramStatus: "CONNECTED",
      telegramEnabled: false,
      telegramName: "Anna",
      telegramUsername: "anna_tg",
    };
    draw();
    await load();
    expect(email()).toHaveAttribute("aria-checked", "true");
    expect(telegram()).toHaveAttribute("aria-checked", "false");

    expect(telegram()).not.toHaveAttribute("data-unavailable");
    fireEvent.click(telegram());
    expect(telegram()).toHaveAttribute("aria-disabled", "true");
    expect(telegram()).not.toHaveAttribute("data-unavailable");
    await waitFor(() => expect(telegram()).not.toHaveAttribute("aria-disabled"));
    expect(email()).toHaveAttribute("aria-checked", "true");
    expect(telegram()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(email());
    await waitFor(() => expect(email()).not.toHaveAttribute("aria-disabled"));
    expect(email()).toHaveAttribute("aria-checked", "false");
    expect(telegram()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(telegram());
    await waitFor(() => expect(telegram()).not.toHaveAttribute("aria-disabled"));
    expect(email()).toHaveAttribute("aria-checked", "false");
    expect(telegram()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Notifications in Taska are always kept/)).toBeVisible();
  });

  it("disables only Telegram when the integration is unavailable", async () => {
    row = { ...initial(), telegramAvailable: false };
    draw();
    await load();
    expect(telegram()).toHaveAttribute("aria-disabled", "true");
    expect(telegram()).toHaveAttribute("data-unavailable", "true");
    fireEvent.click(telegram());
    expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
    expect(email()).not.toHaveAttribute("aria-disabled");
    expect(email()).not.toHaveAttribute("data-unavailable");
    expect(screen.getByText("Telegram notifications are not available right now.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
  });

  it("marks an unbound Telegram switch as steadily unavailable and says why", async () => {
    draw();
    await load();
    expect(telegram()).toHaveAttribute("aria-disabled", "true");
    expect(telegram()).toHaveAttribute("data-unavailable", "true");
    expect(telegram()).toHaveAccessibleDescription("Connect your account before turning Telegram notifications on.");
    fireEvent.click(telegram());
    expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
  });

  it("lets an unavailable saved binding be turned off and disconnected, but cannot enable it again", async () => {
    // With the integration off and the bot username unset, the backend reports
    // every binding as BOT_CHANGED, so that code's sentence must not be shown here.
    row = {
      ...initial(),
      telegramAvailable: false,
      telegramStatus: "UNAVAILABLE",
      telegramEnabled: true,
      telegramName: "Anna",
      telegramUsername: "anna_tg",
      telegramError: "BOT_CHANGED",
    };
    api.disconnectTelegram.mockImplementation(async () => (row = { ...initial(), telegramAvailable: false }));
    draw();
    await load();
    expect(screen.getByText("Anna · @anna_tg")).toBeVisible();
    expect(screen.queryByText("Telegram notifications are not available right now.")).toBeNull();
    expect(screen.getAllByText(UNAVAILABLE_NOTE)).toHaveLength(1);
    expect(screen.queryByText(/Taska uses a different bot now/)).toBeNull();
    expect(telegram()).toHaveAccessibleDescription(`Anna · @anna_tg ${UNAVAILABLE_NOTE}`);
    expect(telegram()).not.toHaveAttribute("aria-disabled");
    expect(telegram()).not.toHaveAttribute("data-unavailable");
    fireEvent.click(telegram());
    await waitFor(() => expect(telegram()).toHaveAttribute("aria-checked", "false"));
    await waitFor(() => expect(telegram()).toHaveAttribute("aria-disabled", "true"));
    expect(telegram()).toHaveAttribute("data-unavailable", "true");
    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ telegramEnabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect Telegram" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
    expect(email()).toHaveAttribute("aria-checked", "true");
  });

  it("gives an unavailable binding one note: the code's sentence while Telegram is available", async () => {
    row = {
      ...initial(),
      telegramStatus: "UNAVAILABLE",
      telegramUsername: "anna_tg",
      telegramError: "TELEGRAM_DELIVERY_UNAVAILABLE",
    };
    draw();
    await load();
    const sentence = telegramDeliveryErrorText("TELEGRAM_DELIVERY_UNAVAILABLE");
    expect(screen.getByText("@anna_tg")).toBeVisible();
    expect(screen.getAllByText(sentence)).toHaveLength(1);
    expect(screen.queryByText(UNAVAILABLE_NOTE)).toBeNull();
    expect(screen.queryByText("TELEGRAM_DELIVERY_UNAVAILABLE")).toBeNull();
    expect(telegram()).toHaveAccessibleDescription(`@anna_tg ${sentence}`);
    expect(screen.getByRole("button", { name: "Disconnect Telegram" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
  });

  it("falls back to the general sentence for an UNAVAILABLE row that carries no code", async () => {
    // Defensive: the backend does not produce this combination today (bound, enabled, no error derives CONNECTED).
    row = { ...initial(), telegramStatus: "UNAVAILABLE", telegramName: "Anna" };
    draw();
    await load();
    expect(screen.getByText("Anna")).toBeVisible();
    expect(screen.getAllByText(UNAVAILABLE_NOTE)).toHaveLength(1);
  });

  for (const telegramAvailable of [true, false]) {
    it(`offers only Disconnect for a Telegram status this build does not know (available: ${telegramAvailable})`, async () => {
      row = { ...initial(), telegramAvailable, telegramStatus: null, telegramLinkId: "link", telegramName: "Anna" };
      api.disconnectTelegram.mockImplementation(async () => (row = { ...initial(), telegramAvailable }));
      draw();
      await load();
      expect(screen.getByText("Taska cannot read the state of this Telegram connection.")).toBeVisible();
      expect(screen.getAllByText(UNKNOWN_NOTE)).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Get a new link" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Confirm Telegram account" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Open Telegram bot" })).toBeNull();
      // Off, and nothing this build knows to turn on.
      expect(telegram()).toHaveAttribute("data-unavailable", "true");
      fireEvent.click(telegram());
      expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
      expect(await screen.findByText("Telegram disconnected. Your email choice is unchanged.")).toBeVisible();
      expect(api.disconnectTelegram).toHaveBeenCalledOnce();
      expect(screen.queryByText(UNKNOWN_NOTE)).toBeNull();
    });
  }

  it("lets an unknown-status channel that is on be turned off, never on", async () => {
    row = { ...initial(), telegramStatus: null, telegramEnabled: true };
    draw();
    await load();
    expect(telegram()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(telegram());
    await waitFor(() => expect(telegram()).toHaveAttribute("aria-checked", "false"));
    await waitFor(() => expect(telegram()).toHaveAttribute("data-unavailable", "true"));
    fireEvent.click(telegram());
    expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(1);
  });

  it("shows the server link, waits for Start, then confirms the exact candidate without optimistic linking", async () => {
    const linkId = "ab2c220e-ce70-484c-a216-de2feee73583";
    api.createTelegramLink.mockImplementation(async () => {
      row = {
        ...row,
        telegramStatus: "PENDING",
        telegramLinkId: linkId,
        telegramLinkExpiresAt: new Date(Date.now() + 600000).toISOString(),
      };
      return { linkId, url: "https://t.me/TaskaBot?start=opaque", expiresAt: row.telegramLinkExpiresAt };
    });
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Connect Telegram" }));
    expect(await screen.findByRole("link", { name: "Open Telegram bot" })).toHaveAttribute(
      "href",
      "https://t.me/TaskaBot?start=opaque",
    );
    expect(telegram()).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: "Confirm Telegram account" })).toBeNull();

    row = { ...row, telegramStatus: "AWAITING_CONFIRMATION", telegramName: "Anna T", telegramUsername: "anna_tg" };
    await act(async () => {
      await client.invalidateQueries({ queryKey: notificationPreferencesKey("anna") });
    });
    expect(await screen.findByText("Anna T · @anna_tg")).toBeVisible();

    let finish: () => void = () => {};
    api.confirmTelegramLink.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve(
              (row = {
                ...row,
                telegramStatus: "CONNECTED",
                telegramEnabled: true,
                telegramLinkId: null,
                telegramLinkExpiresAt: null,
              }),
            );
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm Telegram account" }));
    await waitFor(() => expect(api.confirmTelegramLink).toHaveBeenCalledWith(linkId));
    expect(telegram()).toHaveAttribute("aria-checked", "false");
    await act(async () => finish());
    expect(await screen.findByRole("button", { name: "Disconnect Telegram" })).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "true");
    expect(email()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();
    expect(screen.getByText("Telegram account connected. Your email choice is unchanged.")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("drops the success sentence for good once a read returns another Telegram status", async () => {
    const connectedText = "Telegram account connected. Your email choice is unchanged.";
    const refetch = () =>
      act(async () => {
        await client.invalidateQueries({ queryKey: notificationPreferencesKey("anna") });
      });
    row = { ...initial(), telegramStatus: "AWAITING_CONFIRMATION", telegramLinkId: "link", telegramName: "Anna" };
    api.confirmTelegramLink.mockImplementation(
      async () => (row = { ...row, telegramStatus: "CONNECTED", telegramEnabled: true, telegramLinkId: null }),
    );
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Telegram account" }));
    expect(await screen.findByText(connectedText)).toBeVisible();
    // A read with the same status keeps it.
    await refetch();
    expect(screen.getByText(connectedText)).toBeVisible();
    // /stop in Telegram: the next read has no binding.
    row = initial();
    await refetch();
    expect(await screen.findByRole("button", { name: "Connect Telegram" })).toBeVisible();
    expect(screen.queryByText(connectedText)).toBeNull();
    // Cleared, not hidden: the status coming back does not bring it back.
    row = { ...initial(), telegramStatus: "CONNECTED", telegramName: "Anna" };
    await refetch();
    expect(await screen.findByRole("button", { name: "Disconnect Telegram" })).toBeVisible();
    expect(screen.queryByText(connectedText)).toBeNull();
  });

  it("refreshes an expired candidate on 409 and never confirms an old link again", async () => {
    row = { ...initial(), telegramStatus: "AWAITING_CONFIRMATION", telegramLinkId: "old", telegramName: "Anna" };
    api.confirmTelegramLink.mockImplementation(async () => {
      row = initial();
      throw Object.assign(new Error("Expired"), { status: 409 });
    });
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Telegram account" }));
    expect(
      await screen.findByText("Taska could not confirm the Telegram connection. Check the current connection."),
    ).toBeVisible();
    expect(await screen.findByRole("button", { name: "Connect Telegram" })).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "false");
    // A failure answers the action, not a status: the different read keeps it.
    expect(
      screen.getByText("Taska could not confirm the Telegram connection. Check the current connection."),
    ).toBeVisible();
  });

  it("preserves a failed disconnect and then removes the binding on success", async () => {
    row = { ...initial(), emailEnabled: false, telegramStatus: "CONNECTED", telegramEnabled: true, telegramName: "Anna" };
    api.disconnectTelegram
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockImplementationOnce(async () => (row = { ...initial(), emailEnabled: false }));
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    expect(
      await screen.findByText(
        "Taska could not confirm the Telegram disconnection. Check the current connection.",
      ),
    ).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    expect(await screen.findByRole("button", { name: "Connect Telegram" })).toBeVisible();
    expect(email()).toHaveAttribute("aria-checked", "false");
    expect(telegram()).toHaveAttribute("aria-checked", "false");
  });

  it("announces a cancelled request as cancelled and a real disconnect as a disconnect", async () => {
    const cancelledText = "Telegram connection cancelled. Your email choice is unchanged.";
    const disconnectedText = "Telegram disconnected. Your email choice is unchanged.";
    api.disconnectTelegram.mockImplementation(async () => (row = initial()));
    row = { ...initial(), telegramStatus: "PENDING", telegramLinkId: "link" };
    const view = draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Cancel connection" }));
    expect(await screen.findByText(cancelledText)).toBeVisible();
    expect(screen.queryByText(disconnectedText)).toBeNull();
    expect(api.disconnectTelegram).toHaveBeenCalledOnce();
    view.unmount();
    client.clear();

    row = { ...initial(), telegramStatus: "CONNECTED", telegramEnabled: true, telegramName: "Anna" };
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    expect(await screen.findByText(disconnectedText)).toBeVisible();
    expect(screen.queryByText(cancelledText)).toBeNull();
    expect(api.disconnectTelegram).toHaveBeenCalledTimes(2);
  });

  it("reconciles a committed PATCH whose acknowledgement was lost", async () => {
    row = { ...initial(), telegramStatus: "CONNECTED", telegramName: "Anna" };
    api.updateNotificationPreferences.mockImplementationOnce(async (input: NotificationPreferencesPatch) => {
      row = { ...row, ...input };
      throw Object.assign(new Error("Gateway timeout after commit"), { status: 504 });
    });
    draw();
    await load();
    fireEvent.click(telegram());
    expect(
      await screen.findByText("Taska could not confirm the notification change. Check the current choices."),
    ).toBeVisible();
    await waitFor(() => expect(telegram()).not.toHaveAttribute("aria-disabled"));
    expect(telegram()).toHaveAttribute("aria-checked", "true");
    expect(api.getNotificationPreferences).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/not saved/)).toBeNull();
  });

  it("reconciles a committed confirmation whose acknowledgement was lost", async () => {
    row = {
      ...initial(),
      emailEnabled: false,
      telegramStatus: "AWAITING_CONFIRMATION",
      telegramLinkId: "link",
      telegramName: "Anna",
    };
    api.confirmTelegramLink.mockImplementationOnce(async () => {
      row = { ...row, telegramStatus: "CONNECTED", telegramEnabled: true, telegramLinkId: null };
      throw new Error("Connection reset after commit");
    });
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Confirm Telegram account" }));
    expect(await screen.findByRole("button", { name: "Disconnect Telegram" })).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "true");
    expect(email()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();
    expect(screen.queryByText(/was not connected/)).toBeNull();
  });

  it("reconciles a committed disconnect whose acknowledgement was lost", async () => {
    row = { ...initial(), telegramStatus: "CONNECTED", telegramEnabled: true, telegramName: "Anna" };
    api.disconnectTelegram.mockImplementationOnce(async () => {
      row = initial();
      throw Object.assign(new Error("Gateway unavailable after commit"), { status: 503 });
    });
    draw();
    await load();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    expect(await screen.findByRole("button", { name: "Connect Telegram" })).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("heading", { name: "Notifications" })).toHaveFocus();
  });

  it("keeps a committed switch when a focus read started during the write would land after it", async () => {
    row = { ...initial(), telegramStatus: "CONNECTED", telegramName: "Anna" };
    draw();
    await load();
    const before = { ...row };
    let commit: () => void = () => {};
    api.updateNotificationPreferences.mockImplementationOnce(
      (input: NotificationPreferencesPatch) =>
        new Promise((resolve) => {
          commit = () => resolve((row = { ...row, ...input }));
        }),
    );
    // Any read that starts now answers with the row from before the write,
    // and only after the write has been answered.
    const staleReads: (() => void)[] = [];
    api.getNotificationPreferences.mockImplementation(
      () => new Promise((resolve) => staleReads.push(() => resolve({ ...before }))),
    );
    fireEvent.click(email());
    await waitFor(() => expect(email()).toHaveAttribute("aria-checked", "false"));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await act(async () => commit());
    await act(async () => {
      for (const answer of staleReads) answer();
    });
    await waitFor(() => expect(email()).not.toHaveAttribute("aria-disabled"));
    expect(email()).toHaveAttribute("aria-checked", "false");
    expect(client.getQueryData(notificationPreferencesKey("anna"))).toMatchObject({ emailEnabled: false });
  });

  it("labels the rolled-back choices as last-loaded when reconciliation also fails", async () => {
    api.getNotificationPreferences
      .mockResolvedValueOnce(initial())
      .mockRejectedValue(new Error("Cannot read current state"));
    api.updateNotificationPreferences.mockRejectedValueOnce(new Error("Write response lost"));
    draw();
    await load();
    fireEvent.click(email());
    expect(
      await screen.findByText("Your notification choices could not be refreshed. The last loaded choices are shown."),
    ).toBeVisible();
    expect(email()).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("Taska could not confirm the notification change. Check the current choices."),
    ).toBeVisible();
  });

  it("never draws another account's cached choices on a user change", async () => {
    row = { ...initial(), telegramStatus: "CONNECTED", telegramEnabled: true, telegramName: "Anna" };
    const view = draw();
    await load();
    expect(telegram()).toHaveAttribute("aria-checked", "true");
    api.getNotificationPreferences.mockReturnValueOnce(new Promise(() => {}));
    view.rerender(
      <QueryClientProvider client={client}>
        <SettingsNotificationsSection key="tom" userId="tom" />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByText("Anna")).toBeNull();
    expect(client.getQueryData(notificationPreferencesKey("anna"))).toMatchObject({ telegramName: "Anna" });
    expect(client.getQueryData(notificationPreferencesKey("tom"))).toBeUndefined();
  });
});

it("accepts only a safe bot deep link for the external action", () => {
  expect(telegramBotUrl("https://t.me/TaskaBot?start=abc_123-xyz")).toBe("https://t.me/TaskaBot?start=abc_123-xyz");
  const refused = [
    "javascript:alert(1)",
    "https://evil.example/TaskaBot?start=abc",
    "https://t.me@evil.example/TaskaBot?start=abc",
    "http://t.me/TaskaBot?start=abc",
    "https://t.me/TaskaBot",
    "https://t.me/TaskaBot?start=abc#bad",
  ];
  for (const url of refused) expect(telegramBotUrl(url)).toBeNull();
});

it("turns safe Telegram delivery codes into readable text without exposing unknown codes", () => {
  for (const code of ["BOT_CHANGED", "TELEGRAM_DELIVERY_UNAVAILABLE", "FUTURE_INTERNAL_CODE"]) {
    const text = telegramDeliveryErrorText(code);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain(code);
  }
  expect(telegramDeliveryErrorText("TELEGRAM_DELIVERY_UNAVAILABLE")).toContain("Check that the bot is not blocked");
  expect(telegramDeliveryErrorText("FUTURE_INTERNAL_CODE")).toBe(
    "Telegram delivery is unavailable. You can disconnect Telegram and connect again when it is available.",
  );
  // A set telegramError stops delivery; nothing retries it. The delivery-row
  // codes that never reach the field fall to the general sentence.
  const everyCode = [
    "BOT_CHANGED",
    "TELEGRAM_DELIVERY_UNAVAILABLE",
    "TELEGRAM_DISABLED",
    "TELEGRAM_RATE_LIMIT",
    "TELEGRAM_TEMPORARY",
    "TELEGRAM_INVALID_RESPONSE",
    "FUTURE_INTERNAL_CODE",
  ];
  for (const code of everyCode) expect(telegramDeliveryErrorText(code)).not.toMatch(/retry/i);
});
