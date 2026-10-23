import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { taskaApi } from "../../api/client";
import { apiErrorFacts } from "../../api/errors";
import { ApiNotice } from "../../components/ApiNotice";
import { RequestId } from "../../components/RequestId";
import type { NotificationPreferences, NotificationPreferencesPatch, TelegramLink } from "../../domain/types";
import { telegramDeliveryErrorText } from "../../lib/format";
import { notificationPreferencesKey, telegramBotUrl } from "./notificationPreferencesQuery";

type Action = { type: "patch"; input: NotificationPreferencesPatch } | { type: "link" } | { type: "confirm"; linkId: string } | { type: "disconnect" };
type Result = { preferences?: NotificationPreferences; link?: TelegramLink };

/** Personal delivery choices. Inbox remains independent of both channels. */
export function SettingsNotificationsSection({ userId }: { userId: string }) {
  const client = useQueryClient();
  const key = notificationPreferencesKey(userId);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: unknown } | null>(null);
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: () => taskaApi.getNotificationPreferences(),
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (current) => !writing.current && ["PENDING", "AWAITING_CONFIRMATION"].includes(current.state.data?.telegramStatus ?? "") ? 3000 : false,
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
      if (result.preferences) client.setQueryData(key, result.preferences);
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
        setNotice({ text: action.type === "confirm" ? "Telegram account connected. Your email choice is unchanged." : "Telegram disconnected. Your email choice is unchanged." });
      }
    },
    onError: async (error, action, context) => {
      if (context?.previous && action.type === "patch") client.setQueryData(key, context.previous);
      // A lost response can follow a committed write. Roll back the speculative
      // frame, then ask the server what happened for every failure, not just a
      // conflict. If the read fails too, the query labels its last-loaded data.
      const text = action.type === "patch"
        ? "Taska could not confirm the notification change. Check the current choices below."
        : action.type === "link"
          ? "Taska could not confirm the new Telegram link. Check the current connection below."
          : action.type === "confirm"
            ? "Taska could not confirm the Telegram connection. Check the current connection below."
            : "Taska could not confirm the Telegram disconnection. Check the current connection below.";
      setNotice({ text, error });
      await client.invalidateQueries({ queryKey: key });
      if (action.type !== "patch") heading.current?.focus();
    },
    onSettled: () => { writing.current = false; },
  });
  const act = (action: Action) => {
    if (writing.current) return;
    writing.current = true;
    mutation.mutate(action);
  };
  const data = query.data;
  const available = data?.telegramAvailable === true && data.telegramStatus !== "UNAVAILABLE";
  const connected = data?.telegramStatus === "CONNECTED";
  const bound = connected || data?.telegramStatus === "UNAVAILABLE";
  const canToggleTelegram = data?.telegramEnabled || (available && connected);
  const awaiting = data?.telegramStatus === "AWAITING_CONFIRMATION";
  const pending = data?.telegramStatus === "PENDING" || awaiting;
  const safeUrl = link && link.linkId === data?.telegramLinkId ? telegramBotUrl(link.url) : null;
  const facts = apiErrorFacts(notice?.error);
  const account = data?.telegramName || (data?.telegramUsername ? `@${data.telegramUsername}` : "Telegram account");

  return (
    <section aria-labelledby="notification-settings-title" className="settings-notifications">
      <hr className="settings-divider" />
      <h2 className="settings-notifications-title" id="notification-settings-title" ref={heading} tabIndex={-1}>Notifications</h2>
      <p className="settings-lead">Choose where to receive updates about your work. Notifications in Taska are always kept.</p>
      {!data ? query.isError ? (
        <div>
          <ApiNotice error={query.error} live="off">Your notification choices could not be loaded.</ApiNotice>
          <button aria-disabled={query.isFetching || undefined} className="secondary-button settings-notification-retry" onClick={() => { if (!query.isFetching) void query.refetch(); }} type="button">Try again</button>
        </div>
      ) : (
        <div aria-busy="true" className="settings-notifications-loading">
          <span className="visually-hidden" role="status">Loading notification choices</span>
          <span aria-hidden="true" className="value-skeleton settings-skeleton-name" />
          <span aria-hidden="true" className="value-skeleton settings-skeleton-value" />
        </div>
      ) : (
        <>
          {query.isError ? <ApiNotice error={query.error} live="off">Your notification choices could not be refreshed. The last loaded choices are shown.</ApiNotice> : null}
          <div className="settings-notification-row">
            <div><h3 className="settings-row-title" id="notification-email-title">Email</h3><p className="settings-row-description" id="notification-email-description">{data.email}</p></div>
            <button aria-checked={data.emailEnabled} aria-describedby="notification-email-description" aria-disabled={mutation.isPending || undefined} aria-labelledby="notification-email-title" className="notification-switch" data-busy={mutation.isPending || undefined} onClick={() => act({ type: "patch", input: { emailEnabled: !data.emailEnabled } })} role="switch" type="button"><span aria-hidden="true" /></button>
          </div>
          <div className="settings-notification-row">
            <div><h3 className="settings-row-title" id="notification-telegram-title">Telegram</h3><p className="settings-row-description" id="notification-telegram-description">{!available ? "Telegram notifications are not available right now." : connected ? `${account}${data.telegramName && data.telegramUsername ? ` · @${data.telegramUsername}` : ""}` : "Connect your account before turning Telegram notifications on."}</p></div>
            <button aria-checked={data.telegramEnabled} aria-describedby="notification-telegram-description" aria-disabled={!canToggleTelegram || mutation.isPending || undefined} aria-labelledby="notification-telegram-title" className="notification-switch" data-busy={mutation.isPending || undefined} onClick={() => { if (canToggleTelegram) act({ type: "patch", input: { telegramEnabled: !data.telegramEnabled } }); }} role="switch" type="button"><span aria-hidden="true" /></button>
          </div>
          {available || bound || pending ? (
            <div className="settings-telegram-connection">
              {!available && pending ? <p className="settings-telegram-note">This connection cannot be completed while Telegram is unavailable. You can cancel it or return later.</p> : bound ? <p className="settings-telegram-note">{data.telegramStatus === "UNAVAILABLE" ? "The connected bot cannot deliver notifications right now. You can disconnect Telegram and connect again when it is available." : "Turning Telegram off keeps the account connected. To stop from Telegram, send /stop to the bot."}</p> : pending ? (
                <>
                  <p className="settings-telegram-note">{awaiting ? "Check the account below before connecting it to Taska." : "Open the bot, press Start in Telegram, then return here. This page checks the connection automatically."}</p>
                  {data.telegramLinkExpiresAt ? <p className="settings-telegram-note">This connection expires at {new Date(data.telegramLinkExpiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. A new link replaces the previous one.</p> : null}
                  {awaiting ? <p className="settings-telegram-account">{account}{data.telegramName && data.telegramUsername ? ` · @${data.telegramUsername}` : ""}</p> : null}
                </>
              ) : <p className="settings-telegram-note">Use a private chat with the bot. After pressing Start, return here to confirm your Telegram account.</p>}
              {data.telegramError ? <p className="settings-telegram-note">{telegramDeliveryErrorText(data.telegramError)}</p> : null}
              <div className="settings-telegram-actions">
                {available && awaiting && data.telegramLinkId ? <button aria-disabled={mutation.isPending || undefined} className="primary-button" onClick={() => act({ type: "confirm", linkId: data.telegramLinkId! })} type="button">Confirm Telegram account</button> : null}
                {available && !bound && !awaiting && safeUrl ? <a className="secondary-button" href={safeUrl} rel="noreferrer" target="_blank">Open Telegram bot <ExternalLink aria-hidden="true" size={13} strokeWidth={1.5} /></a> : null}
                {available && !bound ? <button aria-disabled={mutation.isPending || undefined} className="secondary-button" onClick={() => act({ type: "link" })} type="button">{pending ? "Get a new link" : "Connect Telegram"}</button> : null}
                {bound || pending ? <button aria-disabled={mutation.isPending || undefined} className="settings-telegram-disconnect" onClick={() => act({ type: "disconnect" })} type="button">{bound ? "Disconnect Telegram" : "Cancel connection"}</button> : null}
              </div>
              {available && pending && !awaiting && !safeUrl ? <p className="settings-telegram-note">If you have not opened the bot yet, get a new link to continue.</p> : null}
            </div>
          ) : null}
        </>
      )}
      <div className={notice?.error ? "settings-notification-live admin-write-failure" : "settings-notification-live"}>
        <p aria-live="polite">{notice?.text ?? ""}</p>
        {facts.message ? <p className="settings-telegram-note">{facts.message}</p> : null}
        {facts.requestId ? <RequestId value={facts.requestId} /> : null}
      </div>
    </section>
  );
}
