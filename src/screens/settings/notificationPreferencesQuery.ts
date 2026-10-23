/** Never share current-user settings or a pending link between accounts. */
export const notificationPreferencesKey = (userId: string) => ["notification-preferences", userId] as const;

/** A server-issued bearer URL is only actionable as a Telegram bot deep link. */
export function telegramBotUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const start = url.searchParams.get("start");
    return url.protocol === "https:" && url.hostname === "t.me" && !url.username && !url.password && !url.port &&
      /^\/[a-zA-Z0-9_]+$/.test(url.pathname) && start !== null && /^[a-zA-Z0-9_-]{1,64}$/.test(start) && !url.hash
      ? url.href : null;
  } catch {
    return null;
  }
}
