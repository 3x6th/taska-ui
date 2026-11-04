/*
 * The words and the re-read cadence of a company that has never opened
 * (TAS-501, DESIGN.md §4.37), as pure values and functions so they are pinned
 * by unit tests. The deadline is the server's `creationDeadline`, shown as
 * sent, in local time — never computed from `createdAt` (api-contract-guard
 * B6) — and the card never decides on its own that a company closed or opened.
 */

/** The state line under the name — the picker's words (§4.33), «Setup failed» for a failed operation. */
export function setupStateLine(lifecycle: string | null, operationFailed: boolean): string | null {
  switch (lifecycle) {
    case "PROVISIONING":
      return operationFailed ? "Setup failed" : "Being set up";
    case "AWAITING_PAYMENT":
      return "Awaiting first payment";
    case "OWNER_CANCELLED":
      return "Cancelled";
    case "AUTO_CLOSED":
      return "Closed";
    default:
      return lifecycle;
  }
}

/** «Dec 4, 14:32»; another year than `now`'s — «Dec 4, 2027, 14:32». Local time, 24 h. */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** A sentence with the deadline in it: the text before, the deadline, the text after — the deadline is a `<time>`. */
export interface DeadlineSentence {
  before: string;
  deadline: string | null;
  after: string;
}

export const PROVISIONING_TEXT = "Taska is setting it up. This page opens it when it’s ready.";
export const PROVISIONING_SLOW_TEXT =
  "It’s taking a while. You can leave this page — the company will be in your list when it’s ready.";
export const MANUAL_REVIEW_TEXT =
  "Taska is checking this company’s setup, which can take a while. It will be in your list when it’s ready.";
export const SETUP_FAILED_TEXT = "Taska couldn’t set up this company.";
export const PAY_SLOT_TEXT = "This version of Taska can’t take payments yet.";
export const CANCEL_ZONE_TEXT = "Cancelling closes this company before it opens.";
export const CANCEL_QUESTION = "This company will be cancelled and can’t be reopened.";
export const CANCELLED_TEXT = "It was cancelled before its first payment, so it never opened.";
export const CANCEL_REFUSED_TEXT = "This company was not cancelled.";
export const CANCEL_PAYMENT_PENDING_TEXT = "This company can’t be cancelled while a payment is being processed.";
export const CANCEL_STALE_TEXT = "This company changed while you were deciding, so it was not cancelled. Check it and try again.";
/** Not in DESIGN.md §4.37 — the card's own read refused (builder's proposal, TAS-501). */
export const SETUP_READ_FAILED_TEXT = "Taska could not read this company’s state.";

const OPENS = "Its projects and invitations open once the first payment is confirmed.";

/** Awaiting the first payment (§4.37): before the deadline, after it while the server has not closed it, or without one. */
export function awaitingPaymentText(deadlineIso: string | null, now: Date = new Date()): DeadlineSentence {
  if (deadlineIso === null || Number.isNaN(Date.parse(deadlineIso))) {
    return { before: `${OPENS} If it isn’t paid in time, it closes automatically.`, deadline: null, after: "" };
  }
  const deadline = formatDeadline(deadlineIso, now);
  if (now.getTime() >= Date.parse(deadlineIso)) {
    return {
      before: "Its payment deadline, ",
      deadline,
      after: ", has passed. If it was paid in time, it opens once Taska confirms the payment.",
    };
  }
  return { before: `${OPENS} If it isn’t paid by `, deadline, after: ", it closes automatically." };
}

/** Closed without its first payment (§4.37) — never «can no longer be opened»: a late confirmation reopens it (D216). */
export function autoClosedText(deadlineIso: string | null, now: Date = new Date()): DeadlineSentence {
  const tail = ", so it closed without opening. If it was paid in time, it reopens once Taska confirms the payment.";
  if (deadlineIso === null || Number.isNaN(Date.parse(deadlineIso))) {
    return { before: `Its first payment wasn’t confirmed in time${tail}`, deadline: null, after: "" };
  }
  return { before: "Its first payment wasn’t confirmed by ", deadline: formatDeadline(deadlineIso, now), after: tail };
}

/**
 * The provisioning re-read (api-contract-guard §2): one request per tick, at
 * 1, 2, 4 and 8 s, then every 10 s; paused while the tab is hidden; stopped
 * after 5 minutes with «Check again». `reads` is how many reads have been made.
 */
export const POLL_STEPS_MS: readonly number[] = [1000, 2000, 4000, 8000];
export const POLL_STEADY_MS = 10_000;
export const POLL_LIMIT_MS = 5 * 60_000;
/** After this long on «Being set up» the sentence changes (§4.37). */
export const SLOW_SETUP_MS = 30_000;

export const pollDelay = (reads: number) => POLL_STEPS_MS[reads] ?? POLL_STEADY_MS;

/** A provisioning operation that will not move again: its three ends, or a state this build does not know (stop, read the company). */
export const isTerminalOperation = (state: string | null) => state !== null && state !== "PENDING" && state !== "RUNNING";
