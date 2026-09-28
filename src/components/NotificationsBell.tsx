import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useCallback, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { notificationRoute } from "../domain/notifications";
import type { Notification, NotificationPage } from "../domain/types";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { useTriggerAnchor } from "../hooks/useTriggerAnchor";
import { relativeTime } from "../lib/format";
import { ApiNotice } from "./ApiNotice";

const NOTIFICATIONS_KEY = ["notifications"];

/**
 * The notifications bell and everything nailed to it: the unread dot, the
 * popover, its dismissal, its viewport clamps, and the two writes that mark
 * notifications read.
 *
 * **Why it is a component rather than markup in a bar.** The inbox is the
 * *user's*: `GET /api/v1/notifications` — "inbox уведомлений текущего
 * пользователя" — takes no project, and its most common type is an issue
 * assigned to you in a project that is not the one you are looking at. The bell
 * lived inside `BoardScreen`'s own bar, so reaching it meant first walking into
 * some project's board — a project the notification was probably not about
 * (TAS-185). It now hangs in the shared bar too, which is `/projects` and
 * `/admin`.
 *
 * **Nothing is duplicated on screen.** The board renders its own
 * `<header className="board-topbar">` and never renders `TopBar`; `TopBar` is
 * rendered only by `ProjectsScreen` and `AdminScreen`, neither of which has a
 * board bar. The two bars are mutually exclusive, so there is exactly one bell
 * at a time — which is also what lets `.notification-wrap` stay a single global
 * selector in the specs.
 *
 * **And it is not copied.** Dismissal on `Escape` and outside pointerdown, the
 * anchor that narrows rather than moves, the two viewport clamps, the inert
 * row, and the optimistic read marks were each argued for on their own. A
 * second copy in the shared bar would be that many chances to lose one
 * silently, and this repository has twice had to consolidate a copy after a
 * reviewer found it rather than before.
 *
 * The navigation is why sharing it is cheap: a notification states its own
 * `projectId` and `issueId` (TAS-243), and `notificationRoute` builds the
 * absolute `/projects/…/issues/…` route from those two alone. No caller has to
 * have a project in scope, and no read stands between the press and the route,
 * so `/projects` and `/admin` — which have no project — open a notification
 * exactly as the board does.
 */
export function NotificationsBell({
  bar,
}: {
  /**
   * The bar this bell sits in, handed straight to `useTriggerAnchor` as the box
   * whose reflow moves the trigger. Stated by the caller rather than searched
   * for, since TAS-181: the bell's own box never changes size, only its
   * position, and `ResizeObserver` reports the first and not the second.
   *
   * The two callers pass different things behind the same type, and the
   * difference is structural rather than a preference (DESIGN.md §4.13). The
   * board bar wraps below 820 and takes a third row at 390 when the project
   * data lands, so it genuinely moves the bell and genuinely has to be
   * observed. The shared bar is fixed at 52 and never wraps, so there the
   * viewport observer inside the hook is what republishes and this ref costs
   * one no-op `observe`. It is passed anyway, and required rather than
   * optional, because "the bar the bell is in" is a fact both bars have and a
   * fact the next bar will have too — an optional argument would make it
   * something the third caller has to remember rather than something the type
   * asks for.
   */
  bar: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Wraps the bell as well as the panel, which is what keeps the dismissal
  // below from fighting the bell's own toggle: a press on the trigger of an
  // open popover is *inside* this, so the hook stays out of it and the toggle
  // closes it once instead of closing and reopening on one press.
  const wrapRef = useRef<HTMLDivElement>(null);

  const notificationsQuery = useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => taskaApi.listNotifications(),
  });

  // DESIGN.md §4.12 has asked for both since before this popover shipped:
  // «Закрытие: Esc, клик вне». Until TAS-179 the bell was the only way back
  // out, and §7 carried the gap as a written defect.
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutside(open, wrapRef, close);
  // The bell is the first control of a group pinned to the bar's right edge, so
  // it is the one trigger on either bar whose own right edge is nowhere near
  // the screen's. This publishes where it actually landed; the panel stays
  // anchored to it and CSS narrows and clamps against these two numbers
  // (TAS-181).
  useTriggerAnchor(open, wrapRef, bar);

  // The server's count, not a count of the rows: `unreadCount` covers the
  // whole inbox, and the page holds the first twenty. An unread notification
  // on page two used to leave the dot dark.
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        // DESIGN.md §7: the count belongs in the trigger's accessible name.
        // The dot says it to a sighted reader and to nobody else. `title` stays
        // for the pointer, and becomes the description now that the label is
        // the name.
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        title="Notifications"
        type="button"
      >
        <Bell size={16} />
        {unreadCount > 0 ? <span className="notification-dot" /> : null}
      </button>
      {open ? (
        <NotificationsPopover
          notifications={notificationsQuery.data?.items ?? []}
          onNavigate={(route) => {
            setOpen(false);
            navigate(route);
          }}
        />
      ) : null}
    </div>
  );
}

/** The inbox with every row in `ids` — or every row, for `null` — marked read at `readAt`. */
function withRead(page: NotificationPage, ids: Set<string> | null, readAt: string): NotificationPage {
  return {
    ...page,
    items: page.items.map((item) => (!item.readAt && (!ids || ids.has(item.id)) ? { ...item, readAt } : item)),
  };
}

/**
 * The popover's rows and the two writes behind them.
 *
 * **Both writes are optimistic** (AGENTS.md): the dot, the row and the bell's
 * count change on the press, and the server is asked afterwards. Both settle by
 * re-reading the inbox, which is what brings the server's own `unreadCount`
 * back in either case.
 *
 * They roll back differently, because they overlap differently. Several rows
 * can be pressed while an earlier mark is still in flight, so a failed
 * mark-one restores *its own row* and nothing else — restoring the snapshot it
 * took would also undo every row pressed after it. Mark-all replaces the whole
 * list, so the whole list is what it restores.
 *
 * The callbacks are options-level on purpose, where the library runs them
 * whether or not this panel is still mounted: pressing a row that opens an
 * issue closes the panel in the same click, and the optimistic write and its
 * rollback still have to land in the cache the bell reads.
 */
function NotificationsPopover({
  notifications,
  onNavigate,
}: {
  notifications: Notification[];
  onNavigate: (route: string) => void;
}) {
  const queryClient = useQueryClient();

  const markRead = useMutation({
    mutationFn: (notificationId: string) => taskaApi.markNotificationRead(notificationId),
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const page = queryClient.getQueryData<NotificationPage>(NOTIFICATIONS_KEY);
      // Only a row that was unread moves the count. Pressing a read row asks
      // the server again, which is harmless, and changes nothing here.
      const wasUnread = page?.items.some((item) => item.id === notificationId && !item.readAt) ?? false;
      if (page && wasUnread) {
        queryClient.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, {
          ...withRead(page, new Set([notificationId]), new Date().toISOString()),
          unreadCount: Math.max(0, page.unreadCount - 1),
        });
      }
      return { wasUnread };
    },
    onError: (_error, notificationId, context) => {
      if (!context?.wasUnread) return;
      queryClient.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) => (item.id === notificationId ? { ...item, readAt: null } : item)),
              unreadCount: current.unreadCount + 1,
            }
          : current,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  const markAllRead = useMutation({
    mutationFn: () => taskaApi.markAllNotificationsRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: NOTIFICATIONS_KEY });
      const previous = queryClient.getQueryData<NotificationPage>(NOTIFICATIONS_KEY);
      if (previous) {
        queryClient.setQueryData<NotificationPage>(NOTIFICATIONS_KEY, {
          ...withRead(previous, null, new Date().toISOString()),
          unreadCount: 0,
        });
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(NOTIFICATIONS_KEY, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });

  return (
    <section className="notifications-popover">
      <header>
        <strong>Notifications</strong>
        <button onClick={() => markAllRead.mutate()} type="button">
          Mark all read
        </button>
      </header>
      {/* A rollback on its own is a silent one: every dot the press turned off
          comes back on and nothing says why. The panel is still open — the
          press was made in it — so it says so here. Gone on the next attempt
          and when the panel closes. */}
      {markAllRead.isError ? (
        <ApiNotice error={markAllRead.error}>Notifications could not be marked read.</ApiNotice>
      ) : null}
      {/* The same for a single row, which only reaches the reader when the row
          opened nothing: a row that navigates has closed the panel, and the
          dot coming back is all that failure can show. */}
      {markRead.isError ? (
        <ApiNotice error={markRead.error}>This notification could not be marked read.</ApiNotice>
      ) : null}
      <div className="notification-list">
        {notifications.map((notification) => {
          const route = notificationRoute(notification);
          return (
            <button
              // A row with nothing behind it still marks itself read, so it stays
              // a button — it just stops claiming it opens something, which is
              // what the pointer cursor was saying.
              className={`notification-item${route ? "" : " is-inert"}`}
              key={notification.id}
              onClick={() => {
                markRead.mutate(notification.id);
                if (route) onNavigate(route);
              }}
              type="button"
            >
              <span className={`read-dot ${notification.readAt ? "" : "is-unread"}`} />
              <span>
                {/* DESIGN.md §7: colour is never the only carrier. The dot is
                    all a sighted reader needs; this is the same fact in the
                    row's accessible name, first, where a screen reader meets
                    it before the title. A read row says nothing — read is the
                    default a reader assumes. */}
                {notification.readAt ? null : <span className="visually-hidden">Unread: </span>}
                <strong>{notification.title}</strong>
                <em>{notification.body}</em>
                {/* The cursor was the only thing saying this row goes
                    nowhere, and a cursor does not exist on a phone or on the
                    keyboard path. This sits inside the button, so it is part of
                    the accessible name — §7 already records `aria-disabled`
                    plus a line of explanation as *insufficient* for the
                    unopenable §4.20 search hit, and a bare `cursor: default`
                    is less than that. `·` is the separator this interface
                    already uses ("3 projects · Anna Ivanova"). */}
                <small>
                  {relativeTime(notification.createdAt)}
                  {route ? null : " · Nothing to open"}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
