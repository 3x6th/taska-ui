import type { NotificationPreferences, NotificationPreferencesPatch, TelegramLink, User } from "../../domain/types";

const LINK_TTL = 10 * 60 * 1000;
const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

/**
 * In-memory current-user fixture. Nothing contacts Telegram or fabricates a
 * /start on a timer. Tests supply the external event explicitly through the
 * store's receiveStart/stop fixture methods; neither is part of TaskaApi.
 */
export class MockNotificationPreferences {
  private readonly preferences = new Map<string, NotificationPreferences>();
  private readonly links = new Map<string, Omit<TelegramLink, "preferences">>();
  available = true;

  get(user: User): NotificationPreferences {
    let row = this.preferences.get(user.id);
    if (!row) {
      row = {
        emailEnabled: true,
        telegramEnabled: false,
        email: user.email,
        telegramAvailable: this.available,
        telegramStatus: "NOT_CONNECTED",
        telegramUsername: null,
        telegramName: null,
        telegramLinkId: null,
        telegramLinkExpiresAt: null,
        telegramError: null,
      };
      this.preferences.set(user.id, row);
    }
    if (row.telegramLinkExpiresAt && Date.parse(row.telegramLinkExpiresAt) <= Date.now()) {
      this.clearLink(row, user.id);
    }
    row.email = user.email;
    // With the integration off, a saved binding is reported as UNAVAILABLE.
    const telegramStatus = !this.available && row.telegramStatus === "CONNECTED" ? "UNAVAILABLE" : row.telegramStatus;
    return structuredClone({ ...row, telegramAvailable: this.available, telegramStatus });
  }

  update(user: User, input: NotificationPreferencesPatch): NotificationPreferences {
    const entries = Object.entries(input);
    const invalid = entries.some(
      ([key, value]) => !["emailEnabled", "telegramEnabled"].includes(key) || typeof value !== "boolean",
    );
    if (!entries.length || invalid) {
      throw failure("INVALID_ARGUMENT", "Provide emailEnabled or telegramEnabled as a boolean");
    }
    const current = this.get(user);
    if (input.telegramEnabled && (!this.available || current.telegramStatus !== "CONNECTED")) {
      throw failure("ABORTED", "Telegram must be connected and available before enabling notifications");
    }
    Object.assign(this.preferences.get(user.id)!, input);
    return this.get(user);
  }

  createLink(user: User): TelegramLink {
    if (!this.available) throw failure("UNAVAILABLE", "Telegram is unavailable");
    const current = this.get(user);
    if (current.telegramStatus === "CONNECTED" || current.telegramStatus === "UNAVAILABLE") {
      throw failure("ABORTED", "Disconnect the previous Telegram account first");
    }
    const linkId = crypto.randomUUID();
    // An explicit mock address, never opened by a test. It represents the
    // server-issued link only; creating it is not evidence of a Telegram user.
    const link = {
      linkId,
      url: `https://t.me/TaskaMockNotificationsBot?start=${crypto.randomUUID().replaceAll("-", "")}`,
      expiresAt: new Date(Date.now() + LINK_TTL).toISOString(),
    };
    const row = this.preferences.get(user.id)!;
    Object.assign(row, {
      telegramStatus: "PENDING",
      telegramEnabled: false,
      telegramUsername: null,
      telegramName: null,
      telegramLinkId: linkId,
      telegramLinkExpiresAt: link.expiresAt,
      telegramError: null,
    });
    this.links.set(user.id, link);
    // The settings as they stand after the link was issued, in the same
    // answer — `TelegramLinkDto.preferences`, as the gateway fills it.
    return structuredClone({ ...link, preferences: this.get(user) });
  }

  receiveStart(user: User, linkId: string, name: string, username: string | null): void {
    const row = this.get(user);
    if (row.telegramStatus !== "PENDING" || row.telegramLinkId !== linkId) {
      throw failure("ABORTED", "Telegram link has expired or was replaced");
    }
    Object.assign(this.preferences.get(user.id)!, {
      telegramStatus: "AWAITING_CONFIRMATION",
      telegramName: name,
      telegramUsername: username,
    });
  }

  confirm(user: User, linkId: string): NotificationPreferences {
    if (!this.available) throw failure("UNAVAILABLE", "Telegram is unavailable");
    const row = this.get(user);
    if (row.telegramStatus !== "AWAITING_CONFIRMATION" || row.telegramLinkId !== linkId) {
      throw failure("ABORTED", "Telegram link has expired or was replaced");
    }
    Object.assign(this.preferences.get(user.id)!, {
      telegramStatus: "CONNECTED",
      telegramEnabled: true,
      telegramLinkId: null,
      telegramLinkExpiresAt: null,
    });
    this.links.delete(user.id);
    return this.get(user);
  }

  disconnect(user: User): NotificationPreferences {
    this.get(user);
    this.clearLink(this.preferences.get(user.id)!, user.id);
    return this.get(user);
  }

  /** Fixture for the bot's /stop or blocked-bot update. */
  stop(user: User): void {
    this.disconnect(user);
  }

  private clearLink(row: NotificationPreferences, userId: string): void {
    Object.assign(row, {
      telegramStatus: "NOT_CONNECTED",
      telegramEnabled: false,
      telegramUsername: null,
      telegramName: null,
      telegramLinkId: null,
      telegramLinkExpiresAt: null,
      telegramError: null,
    });
    this.links.delete(userId);
  }
}
