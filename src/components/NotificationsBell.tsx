import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useCallback, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { taskaApi } from "../api/client";
import { apiErrorFacts, isMissingOrForbidden } from "../api/errors";
import { notificationTarget } from "../domain/notifications";
import { useDismissOnOutside } from "../hooks/useDismissOnOutside";
import { useTriggerAnchor } from "../hooks/useTriggerAnchor";
import { relativeTime } from "../lib/format";
import { ApiNotice } from "./ApiNotice";

/**
 * The notifications bell and everything nailed to it: the unread dot, the
 * popover, its dismissal, its viewport clamps, and the read that turns a
 * notification into a route.
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
 * **And it is not copied.** Six behaviours were argued for one at a time in
 * TAS-179, TAS-181 and TAS-183 — dismissal on `Escape` and outside pointerdown,
 * the anchor that narrows rather than moves, the two viewport clamps, the
 * three-way target resolution, the guarded per-call `mutate` callback, the
 * inert row. A second copy in the shared bar would be six chances to lose one
 * silently, and this repository has twice had to consolidate a copy after a
 * reviewer found it rather than before.
 *
 * The navigation is why the move is cheap: `notificationTarget` never produces
 * a project-relative destination. `kind: "route"` is only returned for a link
 * already under `/projects/`, which is an absolute route; `kind: "issue"` reads
 * the issue to learn its own `projectId`. So no caller has to have a
 * `projectId` in scope, and `/projects` and `/admin` — which have none — open a
 * notification exactly as the board does.
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
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // Wraps the bell as well as the panel, which is what keeps the dismissal
  // below from fighting the bell's own toggle: a press on the trigger of an
  // open popover is *inside* this, so the hook stays out of it and the toggle
  // closes it once instead of closing and reopening on one press.
  const wrapRef = useRef<HTMLDivElement>(null);

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
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

  const markAllRead = useMutation({
    mutationFn: () => taskaApi.markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unreadCount = notificationsQuery.data?.items.filter((item) => !item.readAt).length ?? 0;

  return (
    <div className="notification-wrap" ref={wrapRef}>
      <button
        aria-expanded={open}
        className="icon-button"
        onClick={() => setOpen((value) => !value)}
        title="Notifications"
        type="button"
      >
        <Bell size={16} />
        {unreadCount ? <span className="notification-dot" /> : null}
      </button>
      {open ? (
        <NotificationsPopover
          notifications={notificationsQuery.data?.items ?? []}
          onMarkAll={() => markAllRead.mutate()}
          onNavigate={(route) => {
            setOpen(false);
            navigate(route);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * DESIGN.md §4.18: "the page is missing" and "the page is not yours" are one
 * sentence on purpose, because telling them apart is what reveals that someone
 * else's project exists. The gateway does distinguish them — 404 NOT_FOUND
 * against 403 PERMISSION_DENIED, with different wording in each — so the sentence
 * above is only half the job: `ApiNotice` prints the server's own words under
 * it, and those words are the leak.
 *
 * This drops the message and keeps the request id, which identifies the failure
 * in the gateway log without saying which failure it was. §4.18 is written about
 * the board's project load rather than about this panel, but the body-UUID
 * branch can hand this read an id the reader was never told about
 * (`src/domain/notifications.ts`), so the panel is squarely in what the rule is
 * for. Every other failure — 5xx, transport — keeps the gateway's words, which
 * are the useful half there.
 */
function refusalWithoutWording(error: unknown): unknown {
  // `apiErrorFacts` maps an empty message to null, so `ApiNotice` renders the
  // fixed sentence, the request id when there is one, and nothing else.
  return Object.assign(new Error(""), { requestId: apiErrorFacts(error).requestId });
}

/**
 * A row here used to hand `notification.link` straight to `navigate()`, which
 * is right only while the link is one of this app's routes. The gateway sends
 * its own API path or an empty string, so every real notification landed the
 * reader on the not-found screen (TAS-183, compensating TAS-184).
 *
 * `notificationTarget` says which of the three cases a row is. Two of them are
 * synchronous; the third has an issue id and no project, so it costs one read
 * before there is a route to go to — and that read is why this component now
 * has a pending row and a failure of its own.
 */
function NotificationsPopover({
  notifications,
  onMarkAll,
  onNavigate,
}: {
  notifications: Array<{ id: string; title: string; body: string; createdAt: string; readAt: string | null; link: string }>;
  onMarkAll: () => void;
  onNavigate: (route: string) => void;
}) {
  const queryClient = useQueryClient();
  const markRead = useMutation({
    mutationFn: (notificationId: string) => taskaApi.markNotificationRead(notificationId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // The row the reader is currently waiting on. Two defects live here, and both
  // are about a read landing after the moment that asked for it:
  //
  // 1. A click, then Escape or a press outside. TanStack Query calls an
  //    *options-level* `onSuccess` from `Mutation.execute()` with no observer
  //    guard — the `hasListeners()` check covers only the per-call form — so a
  //    navigation wired there fires after this panel has unmounted, and the
  //    reader is moved by a click they cancelled.
  // 2. Click row A, then row B before A answers. Both reads are in flight and
  //    the destination became whichever *resolved* last, which against a real
  //    gateway is a coin flip. It should be whichever was *clicked* last.
  //
  // **Passing the callbacks to `mutate` rather than to `useMutation` is what
  // fixes both**, and this ref fixes neither on its own. Per-call callbacks sit
  // behind `hasListeners()`, which closes 1; and `MutationObserver.mutate()`
  // runs `this.#currentMutation?.removeObserver(this)` before building the new
  // mutation, so a superseded read can no longer reach `#notify()` and 2 closes
  // with it. Deleting the ref and keeping the per-call form leaves every test
  // here green — that was measured, not assumed.
  //
  // The ref stays as a backstop for the half of that which is a library
  // internal rather than a documented guarantee: `removeObserver` on the
  // previous mutation is an implementation detail that a version bump may
  // revise, while `hasListeners()` is the documented behaviour. So if you are
  // here to simplify, the ref is the removable half — **removing the per-call
  // form and trusting the ref is the mistake this paragraph exists to prevent**,
  // because the ref says nothing about whether this component is still mounted.
  //
  // A ref rather than state: nothing renders from it, and a re-render on click
  // would only re-run the guard it exists to hold still.
  const awaited = useRef<string | null>(null);

  // `getIssueById` rather than `getIssue`: the notification names an issue and
  // never its project, and the issue may not even be in the board this popover
  // is open on — from `/projects` and `/admin` there is no board and no
  // `projectId` at all. The response's own `projectId` is what builds the
  // route, which is why this panel needs nothing from the screen around it.
  const openIssue = useMutation({
    mutationFn: async ({ issueId }: { notificationId: string; issueId: string }) => {
      const { issue } = await taskaApi.getIssueById(issueId);
      return `/projects/${issue.projectId}/issues/${issue.id}`;
    },
  });

  return (
    <section className="notifications-popover">
      <header>
        <strong>Notifications</strong>
        <button onClick={onMarkAll} type="button">
          Mark all read
        </button>
      </header>
      {/* The read that resolves the project can fail, and a click that quietly
          does nothing is the defect this story fixed, not a smaller version of
          it. The panel stays open to say so. */}
      {openIssue.isError ? (
        isMissingOrForbidden(openIssue.error) ? (
          <ApiNotice error={refusalWithoutWording(openIssue.error)}>
            This issue doesn&rsquo;t exist, or you don&rsquo;t have access to it.
          </ApiNotice>
        ) : (
          <ApiNotice error={openIssue.error}>This issue could not be opened.</ApiNotice>
        )
      ) : null}
      <div className="notification-list">
        {notifications.map((notification) => {
          const target = notificationTarget(notification);
          // No spinner: the row is still on screen and still readable, so the
          // pending cue is the row holding itself lit. `aria-busy` is the half
          // a screen reader gets.
          //
          // The observer's own `variables` rather than `awaited`, and they are
          // the same id: both are set by the same click. It means a superseded
          // row stops showing busy while its read is still in flight, which
          // reads odd until you remember the guard above — that read can no
          // longer navigate, so a row still claiming to be working on it would
          // be the lie. A read that never answers holds `aria-busy` until it
          // does; no timeout, because inventing a failure the server never
          // reported is worse than a row that stays lit.
          const resolving = openIssue.isPending && openIssue.variables.notificationId === notification.id;
          return (
            <button
              aria-busy={resolving}
              // A row with nothing behind it still marks itself read, so it stays
              // a button — it just stops claiming it opens something, which is
              // what the pointer cursor was saying.
              className={`notification-item${target.kind === "none" ? " is-inert" : ""}`}
              key={notification.id}
              onClick={() => {
                markRead.mutate(notification.id);
                if (target.kind === "route") {
                  onNavigate(target.route);
                  return;
                }
                if (target.kind === "issue") {
                  awaited.current = notification.id;
                  openIssue.mutate(
                    { notificationId: notification.id, issueId: target.issueId },
                    {
                      // Per-call, so the library drops it when this popover is
                      // gone; guarded, so a superseded read does not steer.
                      onSuccess: (route, variables) => {
                        if (awaited.current === variables.notificationId) onNavigate(route);
                      },
                    },
                  );
                }
              }}
              type="button"
            >
              <span className={`read-dot ${notification.readAt ? "" : "is-unread"}`} />
              <span>
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
                  {target.kind === "none" ? " · Nothing to open" : null}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
