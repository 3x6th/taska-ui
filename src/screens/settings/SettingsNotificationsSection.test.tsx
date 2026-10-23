import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
});

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
    expect(email()).toHaveFocus();
    fireEvent.click(email());
    expect(api.updateNotificationPreferences).toHaveBeenCalledTimes(1);
    await act(async () => reject(Object.assign(new Error("Refused"), { requestId: "request-123" })));
    await waitFor(() => expect(email()).toHaveAttribute("aria-checked", "true"));
    const text = screen.getByText(
      "Taska could not confirm the notification change. Check the current choices below.",
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

    fireEvent.click(telegram());
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
    fireEvent.click(telegram());
    expect(api.updateNotificationPreferences).not.toHaveBeenCalled();
    expect(email()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("Telegram notifications are not available right now.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
  });

  it("lets an unavailable saved binding be turned off and disconnected, but cannot enable it again", async () => {
    row = {
      ...initial(),
      telegramAvailable: false,
      telegramStatus: "UNAVAILABLE",
      telegramEnabled: true,
      telegramName: "Anna",
      telegramError: "BOT_CHANGED",
    };
    api.disconnectTelegram.mockImplementation(async () => (row = { ...initial(), telegramAvailable: false }));
    draw();
    await load();
    expect(telegram()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(telegram());
    await waitFor(() => expect(telegram()).toHaveAttribute("aria-checked", "false"));
    await waitFor(() => expect(telegram()).toHaveAttribute("aria-disabled", "true"));
    expect(api.updateNotificationPreferences).toHaveBeenCalledWith({ telegramEnabled: false });
    expect(screen.getByText(/Taska uses a different bot now/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect Telegram" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Connect Telegram" })).toBeNull();
    expect(email()).toHaveAttribute("aria-checked", "true");
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
      await screen.findByText("Taska could not confirm the Telegram connection. Check the current connection below."),
    ).toBeVisible();
    expect(await screen.findByRole("button", { name: "Connect Telegram" })).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "false");
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
        "Taska could not confirm the Telegram disconnection. Check the current connection below.",
      ),
    ).toBeVisible();
    expect(telegram()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Telegram" }));
    expect(await screen.findByRole("button", { name: "Connect Telegram" })).toBeVisible();
    expect(email()).toHaveAttribute("aria-checked", "false");
    expect(telegram()).toHaveAttribute("aria-checked", "false");
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
      await screen.findByText("Taska could not confirm the notification change. Check the current choices below."),
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
      screen.getByText("Taska could not confirm the notification change. Check the current choices below."),
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
  const codes = [
    "BOT_CHANGED",
    "TELEGRAM_DELIVERY_UNAVAILABLE",
    "TELEGRAM_DISABLED",
    "TELEGRAM_RATE_LIMIT",
    "TELEGRAM_TEMPORARY",
    "TELEGRAM_INVALID_RESPONSE",
    "FUTURE_INTERNAL_CODE",
  ];
  for (const code of codes) {
    const text = telegramDeliveryErrorText(code);
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain(code);
  }
  expect(telegramDeliveryErrorText("TELEGRAM_DELIVERY_UNAVAILABLE")).toContain("Check that the bot is not blocked");
  expect(telegramDeliveryErrorText("FUTURE_INTERNAL_CODE")).toBe(
    "Telegram delivery is unavailable. You can disconnect Telegram and connect again when it is available.",
  );
});
