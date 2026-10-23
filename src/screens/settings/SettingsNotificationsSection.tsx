import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { ApiNotice } from "../../components/ApiNotice";
import { RequestId } from "../../components/RequestId";
import type {
  NotificationPreferences,
  NotificationPreferencesPatch,
  TelegramLink,
  TelegramStatus,
} from "../../domain/types";
import { telegramDeliveryErrorText } from "../../lib/format";
import { notificationPreferencesKey, telegramBotUrl } from "./notificationPreferencesQuery";

type Action =
  | { type: "patch"; input: NotificationPreferencesPatch }
  | { type: "link" }
  | { type: "confirm"; linkId: string }
  /** `cancelling`: the button read "Cancel connection", so nothing was connected. */
  | { type: "disconnect"; cancelling?: boolean };
type Result = { preferences?: NotificationPreferences; link?: TelegramLink };
type Notice = {
  text: string;
  error?: unknown;
  /** The status a success sentence describes; a failure carries none (§5.9). */
  announced?: TelegramStatus | null;
};

/**
 * The live region's sentence when a write is refused or its answer is lost.
 * No direction words: the region is always last in the section, and a screen
 * reader has no "below" (§5.9).
 */
const WRITE_FAILURE_TEXT: Record<Action["type"], string> = {
  patch: "Taska could not confirm the notification change. Check the current choices.",
  link: "Taska could not confirm the new Telegram link. Check the current connection.",
  confirm: "Taska could not confirm the Telegram connection. Check the current connection.",
  disconnect: "Taska could not confirm the Telegram disconnection. Check the current connection.",
};

/** A request that waits for Start in Telegram or for the reader's confirmation. */
const WAITING_STATUSES = ["PENDING", "AWAITING_CONFIRMATION"];

/** The UNAVAILABLE note, which the Telegram switch also points at for its reason. */
const TELEGRAM_NOTE_ID = "notification-telegram-note";

/** Personal delivery choices. Inbox remains independent of both channels. */
export function SettingsNotificationsSection({ userId }: { userId: string }) {
  const client = useQueryClient();
  const key = notificationPreferencesKey(userId);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: () => taskaApi.getNotificationPreferences(),
    staleTime: 0,
    // Not while a write is out: a read that starts during it and lands after
    // its answer would put the row from before the write back.
    refetchOnWindowFocus: () => (writing.current ? false : "always"),
    refetchInterval: (current) => {
      const waiting = WAITING_STATUSES.includes(current.state.data?.telegramStatus ?? "");
      return !writing.current && waiting ? 3000 : false;
    },
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (action: Action): Promise<Result> => {
      if (action.type === "patch") return { preferences: await taskaApi.updateNotificationPreferences(action.input) };
      if (action.type === "confirm") return { preferences: await taskaApi.confirmTelegramLink(action.linkId) };
      if (action.type === "disconnect") return { preferences: await taskaApi.disconnectTelegram() };
      return { link: await taskaApi.createTelegramLink() };
    },
    onMutate: async (action) => {
      setNotice(null);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<NotificationPreferences>(key);
      if (previous && action.type === "patch") client.setQueryData(key, { ...previous, ...action.input });
      return { previous };
    },
    onSuccess: async (result, action) => {
      if (result.preferences) {
        // The write's answer is the newest row: any read still out is older.
        await client.cancelQueries({ queryKey: key });
        client.setQueryData(key, result.preferences);
      }
      if (result.link) {
        setLink(result.link);
        // A successful link POST says nothing about the binding state. A failed
        // read is reported by the query as a refresh failure, never as a failed
        // creation after the server has already issued a link.
        await client.invalidateQueries({ queryKey: key });
      }
      if (action.type === "confirm" || action.type === "disconnect") {
        setLink(null);
        // The action button disappears, so place focus on the section heading.
        heading.current?.focus();
        setNotice({
          text:
            action.type === "confirm"
              ? "Telegram account connected. Your email choice is unchanged."
              : action.cancelling
                ? "Telegram connection cancelled. Your email choice is unchanged."
                : "Telegram disconnected. Your email choice is unchanged.",
          announced: result.preferences?.telegramStatus ?? null,
        });
      }
    },
    onError: async (error, action, context) => {
      if (context?.previous && action.type === "patch") client.setQueryData(key, context.previous);
      // A lost response can follow a committed write. Roll back the speculative
      // frame, then ask the server what happened for every failure, not just a
      // conflict. If the read fails too, the query labels its last-loaded data.
      setNotice({ text: WRITE_FAILURE_TEXT[action.type], error });
      await client.invalidateQueries({ queryKey: key });
      if (action.type !== "patch") heading.current?.focus();
    },
    onSettled: () => {
      writing.current = false;
    },
  });
  const act = (action: Action) => {
    if (writing.current) return;
    writing.current = true;
    mutation.mutate(action);
  };
  const data = query.data;
  // §5.9: a success sentence leaves as soon as a read returns another status
  // than the one it described — cleared, not hidden, so it cannot come back.
  if (notice?.announced !== undefined && data && data.telegramStatus !== notice.announced) setNotice(null);

  const status = data?.telegramStatus;
  // A status this build does not know (TAS-173): only Disconnect is offered.
  const unknownStatus = data !== undefined && status === null;
  const connected = status === "CONNECTED";
  const unavailable = status === "UNAVAILABLE";
  const bound = connected || unavailable;
  const awaiting = status === "AWAITING_CONFIRMATION";
  const pending = status === "PENDING" || awaiting;
  const available = data?.telegramAvailable === true && !unavailable;
  // On can always be turned off; it can be turned on only for a connected,
  // available binding.
  const canToggleTelegram = data?.telegramEnabled || (available && connected);
  // Connect, the bot link and Confirm only for a state this build knows.
  const canLink = available && !bound && !unknownStatus;
  const safeUrl = link && link.linkId === data?.telegramLinkId ? telegramBotUrl(link.url) : null;
  const facts = apiErrorFacts(notice?.error);
  const account = data?.telegramName || (data?.telegramUsername ? `@${data.telegramUsername}` : "Telegram account");
  // The username follows the name only when both are known; alone, it is the account.
  const accountSuffix = data?.telegramName && data.telegramUsername ? ` · @${data.telegramUsername}` : "";

  const telegramDescription = () => {
    if (bound) return `${account}${accountSuffix}`;
    if (unknownStatus) return "Taska cannot read the state of this Telegram connection.";
    if (!available) return "Telegram notifications are not available right now.";
    return "Connect your account before turning Telegram notifications on.";
  };

  // With the integration off and the bot username unset, the backend reports
  // every binding as BOT_CHANGED, so the code's sentence is used only while
  // Telegram is available.
  const unavailableNote = (current: NotificationPreferences) =>
    current.telegramAvailable && current.telegramError
      ? telegramDeliveryErrorText(current.telegramError)
      : "The connected bot cannot deliver notifications right now. You can disconnect Telegram and connect again when it is available.";

  /** The one note that says where the connection stands, before its actions. */
  const telegramStateNotes = (current: NotificationPreferences) => {
    if (unknownStatus) {
      return <p className="settings-telegram-note">You can disconnect Telegram and connect again.</p>;
    }
    if (!available && pending) {
      return (
        <p className="settings-telegram-note">
          This connection cannot be completed while Telegram is unavailable. You can cancel it or return later.
        </p>
      );
    }
    if (unavailable) {
      return (
        <p className="settings-telegram-note" id={TELEGRAM_NOTE_ID}>
          {unavailableNote(current)}
        </p>
      );
    }
    if (connected) {
      return (
        <p className="settings-telegram-note">
          Turning Telegram off keeps the account connected. To stop from Telegram, send /stop to the bot.
        </p>
      );
    }
    if (pending) {
      const expiresAt = current.telegramLinkExpiresAt
        ? new Date(current.telegramLinkExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : null;
      return (
        <>
          <p className="settings-telegram-note">
            {awaiting
              ? "Check the account below before connecting it to Taska."
              : "Open the bot, press Start in Telegram, then return here. This page checks the connection automatically."}
          </p>
          {expiresAt ? (
            <p className="settings-telegram-note">
              This connection expires at {expiresAt}. A new link replaces the previous one.
            </p>
          ) : null}
          {awaiting ? (
            <p className="settings-telegram-account">
              {account}
              {accountSuffix}
            </p>
          ) : null}
        </>
      );
    }
    return (
      <p className="settings-telegram-note">
        Use a private chat with the bot. After pressing Start, return here to confirm your Telegram account.
      </p>
    );
  };

  const readError = () => (
    <div>
      <ApiNotice error={query.error} live="off">
        Your notification choices could not be loaded.
      </ApiNotice>
      <button
        aria-disabled={query.isFetching || undefined}
        className="secondary-button settings-notification-retry"
        onClick={() => {
          if (!query.isFetching) void query.refetch();
        }}
        type="button"
      >
        Try again
      </button>
    </div>
  );

  const loading = () => (
    <div aria-busy="true" className="settings-notifications-loading">
      <span className="visually-hidden" role="status">
        Loading notification choices
      </span>
      <span aria-hidden="true" className="value-skeleton settings-skeleton-name" />
      <span aria-hidden="true" className="value-skeleton settings-skeleton-value" />
    </div>
  );

  const choices = (current: NotificationPreferences) => (
    <>
      {query.isError ? (
        <ApiNotice error={query.error} live="off">
          Your notification choices could not be refreshed. The last loaded choices are shown.
        </ApiNotice>
      ) : null}
      <div className="settings-notification-row">
        <div>
          <h3 className="settings-row-title" id="notification-email-title">
            Email
          </h3>
          <p className="settings-row-description" id="notification-email-description">
            {current.email}
          </p>
        </div>
        <button
          aria-checked={current.emailEnabled}
          aria-describedby="notification-email-description"
          aria-disabled={mutation.isPending || undefined}
          aria-labelledby="notification-email-title"
          className="notification-switch"
          data-busy={mutation.isPending || undefined}
          onClick={() => act({ type: "patch", input: { emailEnabled: !current.emailEnabled } })}
          role="switch"
          type="button"
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div className="settings-notification-row">
        <div>
          <h3 className="settings-row-title" id="notification-telegram-title">
            Telegram
          </h3>
          <p className="settings-row-description" id="notification-telegram-description">
            {telegramDescription()}
          </p>
        </div>
        {/* §4.29: in flight is `aria-disabled` alone; steadily unavailable
            (nothing to turn on) adds `data-unavailable`, which carries the
            dimming, so a write on the Email switch neither adds nor removes it. */}
        <button
          aria-checked={current.telegramEnabled}
          aria-describedby={
            unavailable ? `notification-telegram-description ${TELEGRAM_NOTE_ID}` : "notification-telegram-description"
          }
          aria-disabled={!canToggleTelegram || mutation.isPending || undefined}
          aria-labelledby="notification-telegram-title"
          className="notification-switch"
          data-busy={mutation.isPending || undefined}
          data-unavailable={!canToggleTelegram || undefined}
          onClick={() => {
            if (canToggleTelegram) act({ type: "patch", input: { telegramEnabled: !current.telegramEnabled } });
          }}
          role="switch"
          type="button"
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {available || bound || pending || unknownStatus ? (
        <div className="settings-telegram-connection">
          {telegramStateNotes(current)}
          {current.telegramError && !unavailable && !unknownStatus ? (
            <p className="settings-telegram-note">{telegramDeliveryErrorText(current.telegramError)}</p>
          ) : null}
          <div className="settings-telegram-actions">
            {available && awaiting && current.telegramLinkId ? (
              <button
                aria-disabled={mutation.isPending || undefined}
                className="primary-button"
                onClick={() => act({ type: "confirm", linkId: current.telegramLinkId! })}
                type="button"
              >
                Confirm Telegram account
              </button>
            ) : null}
            {canLink && !awaiting && safeUrl ? (
              <a className="secondary-button" href={safeUrl} rel="noreferrer" target="_blank">
                Open Telegram bot <ExternalLink aria-hidden="true" size={13} strokeWidth={1.5} />
              </a>
            ) : null}
            {canLink ? (
              <button
                aria-disabled={mutation.isPending || undefined}
                className="secondary-button"
                onClick={() => act({ type: "link" })}
                type="button"
              >
                {pending ? "Get a new link" : "Connect Telegram"}
              </button>
            ) : null}
            {bound || pending || unknownStatus ? (
              // DELETE never refuses, whatever the state, so it is the way out
              // of a state this build cannot read as well.
              <button
                aria-disabled={mutation.isPending || undefined}
                className="settings-telegram-disconnect"
                onClick={() => act({ type: "disconnect", cancelling: pending })}
                type="button"
              >
                {pending ? "Cancel connection" : "Disconnect Telegram"}
              </button>
            ) : null}
          </div>
          {available && pending && !awaiting && !safeUrl ? (
            <p className="settings-telegram-note">If you have not opened the bot yet, get a new link to continue.</p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  const firstRead = () => (query.isError ? readError() : loading());

  return (
    <section aria-labelledby="notification-settings-title" className="settings-notifications">
      <hr className="settings-divider" />
      <h2 className="settings-notifications-title" id="notification-settings-title" ref={heading} tabIndex={-1}>
        Notifications
      </h2>
      <p className="settings-lead">
        Choose where to receive updates about your work. Notifications in Taska are always kept.
      </p>
      {data ? choices(data) : firstRead()}
      <div className={notice?.error ? "settings-notification-live admin-write-failure" : "settings-notification-live"}>
        <p aria-live="polite">{notice?.text ?? ""}</p>
        {facts.message ? <p className="settings-telegram-note">{facts.message}</p> : null}
        {facts.requestId ? <RequestId value={facts.requestId} /> : null}
      </div>
    </section>
  );
}
