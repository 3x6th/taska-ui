import { ForeignCompanyAnswerError, type PlanVersion } from "../../api/tenants";
import { UnreadableAnswerError } from "../../api/billing";
import { apiErrorFacts, isB2bErrorCode, refusalCode, refusalReasons, refusalRetryAfter } from "../../api/errors";
import { planLimitsList, planLimitsText, planName, planPriceText } from "../../lib/plans";
import { reasonedRefusal } from "../../lib/companyRestrictions";
import { formatWait } from "../authText";
import { companyInside, companyStart, formatPaidUntil, type RefusalWords } from "./companyGeneralText";
import { planNameParts } from "./companyPlanText";

/*
 * The words of a plan change, its renewal and automatic payments (TAS-515,
 * DESIGN.md §4.40 and §4.41 to be) as pure values, so every sentence is pinned
 * by a unit test — art-director's pre-build B2–B12 with the orchestrator's
 * decisions over api-contract-guard's ruling.
 *
 * **Nothing here is a quote** (guard §3, B2): before the answer a sentence
 * branches only on the target's `kind` = FREE and on whether the company has
 * a current paid period; paid → paid is neutral. After it, the server's
 * `effect` and `effectiveAt` are said as they came — no price compared, no
 * date computed, no «days left». No sentence names an invoice kind or timing
 * for automatic payments (A69), and none offers to turn them on (A67).
 */

/** «Team», or «its current plan» when the catalogue does not list it. */
const nameOf = (plan: PlanVersion | null) => (plan === null ? "its current plan" : planName(plan));
const ownName = (company: string | null) => `${companyStart(company)}’s`;
const ownInside = (company: string | null) => `${companyInside(company)}’s`;

/* ------------------------------------------------------------ the zone */

export const changePlanRowText = (company: string | null) =>
  `Move ${companyInside(company)} to another plan. You’ll see what changes, and when, before you confirm.`;

/**
 * The cancel row. While a change is scheduled (art-director blocker 4, guard L-2) cancelling does not
 * cancel it — paid, it still starts at the boundary — so read-only comes only with the last paid period.
 */
export const cancelRenewalRowText = (company: string | null, plan: PlanVersion | null, paidThrough: string, scheduled = false) =>
  scheduled
    ? `Cancelling renewal keeps ${companyInside(company)} on ${nameOf(plan)} until ${formatPaidUntil(paidThrough)}. It becomes read-only when its last paid period ends.`
    : `Cancelling renewal keeps ${companyInside(company)} on ${nameOf(plan)} until ${formatPaidUntil(paidThrough)}, then makes it read-only.`;

export const resumeRenewalRowText = (company: string | null, paidThrough: string) =>
  `Resuming renewal keeps ${companyInside(company)} on its plan after ${formatPaidUntil(paidThrough)}. It takes no payment now.`;

/** The cancelled company past its period (decision 6): the way out is a plan change, so no button. */
export const renewalEndedRowText = (company: string | null, paidThrough: string) =>
  `Renewal is cancelled, and the paid period ended ${formatPaidUntil(paidThrough)}. To use ${companyInside(company)} again, change its plan.`;

/** The question before cancelling (B7); the turn-off hint only while automatic payments are on; a schedule as the row's. */
export function cancelRenewalQuestion(company: string | null, plan: PlanVersion | null, paidThrough: string, autopayOn: boolean, scheduled = false): string {
  const when = scheduled ? "When its last paid period ends, it becomes read-only" : "After that it becomes read-only";
  const head =
    `${companyStart(company)} stays on ${nameOf(plan)} until ${formatPaidUntil(paidThrough)}. ${when}: ` +
    "everything can still be read, but nothing can be changed until it’s paid for again. It doesn’t move to the free plan on its own.";
  return autopayOn ? `${head} To keep renewing and pay by hand instead, turn off automatic payments in Billing.` : head;
}

export function renewalCancelledStatus(company: string | null, plan: PlanVersion | null, paidThrough: string | null, scheduled = false): string {
  if (scheduled) return `${ownName(company)} renewal is cancelled. It becomes read-only when its last paid period ends.`;
  return paidThrough === null
    ? `${ownName(company)} renewal is cancelled.`
    : `${ownName(company)} renewal is cancelled. It stays on ${nameOf(plan)} until ${formatPaidUntil(paidThrough)}, then becomes read-only.`;
}

/** A renewal 412 whose re-read already shows what was asked (art-director non-blocking 7): said as done. */
export const renewalAlreadyCancelledStatus = (company: string | null) => `${ownName(company)} renewal is already cancelled.`;
export const renewalAlreadyOnStatus = (company: string | null, paidThrough: string | null) =>
  paidThrough === null
    ? `${companyStart(company)} already renews when its paid period ends.`
    : `${companyStart(company)} already renews when its paid period ends, ${formatPaidUntil(paidThrough)}.`;

export const renewalResumedStatus = (company: string | null, paidThrough: string | null) =>
  paidThrough === null
    ? `${companyStart(company)} renews again when its paid period ends.`
    : `${companyStart(company)} renews again when its paid period ends, ${formatPaidUntil(paidThrough)}.`;

/* ---------------------------------------------------- the plan's facts (B6) */

/** «Team · version 2, €20 a month» — a scheduled or pending plan's first line. */
export function changedPlanLine(plan: PlanVersion): string {
  const { name, version } = planNameParts(plan);
  const price = planPriceText(plan);
  return `${name}${version ?? ""}${price === null ? "" : `, ${price}`}`;
}

/** «From {date} · {limits}» — the date as a `<time>` the page draws, so only the tail is text here. */
export const scheduledTail = (plan: PlanVersion) => {
  const limits = planLimitsText(plan);
  return limits === "" ? "" : ` · ${limits}`;
};

export const SCHEDULED_UNPAID_TEXT = "Its start date passed before it was paid for.";

/** The scheduled change's consequence, on the row and not only in the status (art-director blocker 2). */
export const scheduledPaymentText = (company: string | null) =>
  `It starts only if it’s paid for by then. If it isn’t, ${companyInside(company)} becomes read-only on that date.`;
/** The same with this session's verified invoice: the page links the number between the two parts. */
export const scheduledInvoiceHead = "It starts only if invoice ";
export const scheduledInvoiceTail = (company: string | null) => ` is paid by then. If it isn’t, ${companyInside(company)} becomes read-only on that date.`;

/** The pending change's second line, after its invoice link or without one (decision 4). */
export const pendingUntilText = (company: string | null, current: PlanVersion | null) => `Until then, ${companyInside(company)} stays on ${nameOf(current)}.`;
export const pendingNoInvoiceText = (company: string | null, current: PlanVersion | null) =>
  `Starts once it’s paid for — there’s no invoice for it yet. Until then, ${companyInside(company)} stays on ${nameOf(current)}.`;
export const OPEN_INVOICE_LINK = "Open the invoice";

/* --------------------------------------------------------- the dialog (B3) */

export const CHANGE_PLAN = "Change plan";
export const PLANS_LOADING_TEXT = "Loading plans";
export const PLANS_FAILED_TEXT = "Plans could not be loaded.";
export const CHOOSE_PLAN_TEXT = "Choose a plan to see what changes, and when.";
export const CURRENT_PLAN_NOTE = "Current plan";
export const scheduledPlanNote = (at: string | null) => (at === null ? "Already scheduled" : `Already scheduled from ${formatPaidUntil(at)}`);

/**
 * «{Company} is on {plan}, {price}, paid until {date}.» (art-director NB2); under `PAYMENT_EXPIRED`
 * «… is on {plan}, {price}. Its paid period ended {date}.»; without a paid period «{Company} is on {plan}.»
 */
export function dialogContextText(company: string | null, current: PlanVersion | null, paidThrough: string | null, expired = false): string | null {
  if (current === null) return null;
  const { name, version } = planNameParts(current);
  const price = planPriceText(current);
  const head = `${companyStart(company)} is on ${name}${version ?? ""}`;
  if (paidThrough === null) return `${head}.`;
  const priced = `${head}${price === null ? "" : `, ${price}`}`;
  return expired ? `${priced}. Its paid period ended ${formatPaidUntil(paidThrough)}.` : `${priced}, paid until ${formatPaidUntil(paidThrough)}.`;
}

/** «a», «a and b», «a, b and c» — the limits as prose (art-director copy ruling). */
const prose = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export interface ConsequenceInput {
  company: string | null;
  target: PlanVersion;
  current: PlanVersion | null;
  /** The company has a current paid period: `paidThrough` sent and no `PAYMENT_EXPIRED` (decision 2). */
  covered: boolean;
  paidThrough: string | null;
  autopayState: string | null;
  /** The current plan chosen while a change is scheduled: what is dropped. */
  withdrawal: { scheduled: PlanVersion | null; at: string | null } | null;
}

/**
 * What the dialog says before the press (decision 2's table) — only from the
 * target's `kind`, the company's paid period and its automatic payments.
 */
export function planChangeConsequences(input: ConsequenceInput): string[] {
  const { company, target, current, covered, paidThrough, autopayState, withdrawal } = input;
  const name = planName(target);
  if (withdrawal !== null) {
    // Nothing on the wire says whether the scheduled change is paid: a paid one still starts (guard M-2, A76).
    const scheduled = withdrawal.scheduled === null ? "another plan" : planName(withdrawal.scheduled);
    const from = withdrawal.at === null ? "" : ` from ${formatPaidUntil(withdrawal.at)}`;
    const then = withdrawal.at === null ? "then it still starts" : "then it still starts on that date";
    return [`${companyStart(company)} stays on ${nameOf(current)}. The change to ${scheduled}${from} is dropped — unless it’s already paid for; ${then}.`];
  }
  if (target.kind === "FREE") {
    const lines = [`${companyStart(company)} moves to ${name} as soon as you confirm.`];
    if (covered && paidThrough !== null) {
      lines.push(
        `Its paid period ends now. The rest of it, until ${formatPaidUntil(paidThrough)}, isn’t kept or refunded — moving back to a paid plan later needs a new payment and starts a new month.`,
      );
    }
    const limits = planLimitsList(target);
    if (limits.length > 0) {
      lines.push(
        `${name} allows ${prose(limits)}. If ${companyInside(company)} uses more, nothing new can be added or changed until it’s back within them, though members can still be removed and invitations revoked. Archived projects count too.`,
      );
    }
    if (autopayState === "CONSENTED") lines.push("Automatic payments turn off.");
    return lines;
  }
  if (!covered) {
    return [
      `${name} starts once it’s paid for, with a month from the payment. Until then, ${companyInside(company)} stays on ${nameOf(current)}.`,
      "Nothing is charged when you confirm.",
    ];
  }
  return [`Taska shows when ${name} starts, and what there is to pay, once you confirm.`, "Nothing is charged when you confirm."];
}

/* ------------------------------------------------- after the answer (B5) */

/** The invoice the answer named, as the page could read it (decision 4). */
export type ChangeInvoice =
  | { kind: "none" }
  | { kind: "verified"; id: string; number: string | null }
  | { kind: "unread"; id: string };

/** The status after a change was accepted — the server's effect, never the predicted branch. */
export function planChangedStatus(input: {
  company: string | null;
  target: PlanVersion | null;
  effect: string | null;
  effectiveAt: string | null;
  invoice: ChangeInvoice;
}): string {
  const { company, target, effect, effectiveAt, invoice } = input;
  const name = target === null ? "The new plan" : planName(target);
  const inName = target === null ? "the new plan" : planName(target);
  switch (effect) {
    case "IMMEDIATE":
      return target === null ? `${ownName(company)} plan has changed.` : `${companyStart(company)} is now on ${name}.`;
    case "AFTER_PAYMENT":
      if (invoice.kind === "none") return `${companyStart(company)} moves to ${inName} once it’s paid for. There’s no invoice for this change yet.`;
      if (invoice.kind === "verified" && invoice.number !== null) {
        return `Invoice ${invoice.number} for ${inName} is ready in Billing. ${companyStart(company)} moves to ${inName} once it’s paid.`;
      }
      return `An invoice for ${inName} is ready in Billing. ${companyStart(company)} moves to ${inName} once it’s paid.`;
    case "NEXT_PERIOD": {
      const when = effectiveAt === null ? "when the current paid period ends" : formatPaidUntil(effectiveAt);
      const tail =
        invoice.kind === "none"
          ? "there’s no invoice for it yet."
          : `pay its invoice in Billing before then, or ${companyInside(company)} becomes read-only on that date.`;
      return `${name} starts ${when}. Nothing is charged now — ${tail}`;
    }
    default:
      return `${ownName(company)} plan change was accepted.`;
  }
}

/**
 * After a withdrawal (guard M-2): the re-read subscription says whether the scheduled change went — a
 * paid one stays and still starts.
 */
export function withdrawalStatus(input: { company: string | null; current: PlanVersion | null; scheduled: PlanVersion | null; kept: boolean; at: string | null }): string {
  const scheduled = input.scheduled === null ? "the scheduled plan" : planName(input.scheduled);
  if (input.kept) {
    return input.at === null
      ? `The change to ${scheduled} is already paid for, so it still starts.`
      : `The change to ${scheduled} is already paid for, so it still starts ${formatPaidUntil(input.at)}.`;
  }
  return `The change to ${scheduled} is dropped. ${companyStart(input.company)} stays on ${nameOf(input.current)}.`;
}

/* --------------------------------------------- automatic payments (decision 1) */

export const AUTOPAY_TITLE = "Automatic payments";
export const AUTOPAY_READ_FAILED = "Automatic payments could not be loaded.";
export const TURN_OFF = "Turn off";
export const TURN_OFF_LABEL = "Turn off automatic payments";
export const KEEP_THEM_ON = "Keep them on";

export const billingAutopayLeadText = (company: string | null) => `Automatic payments and invoices for ${companyInside(company)}.`;

/** The group's second line by state; a state this build does not know has none (§6). */
export function autopayLineText(state: string, company: string | null): string | null {
  switch (state) {
    case "CONSENTED":
      return `Taska takes ${ownInside(company)} payments automatically. You can still pay any invoice here yourself.`;
    case "DISABLED":
      return `You pay ${ownInside(company)} invoices here yourself. This version of Taska can’t turn automatic payments on.`;
    case "SUSPENDED":
      return `Taska isn’t taking automatic payments for ${companyInside(company)} right now. You can pay its invoices here yourself.`;
    default:
      return null;
  }
}

/** Whether «Turn off» is offered: only a mandate that is on or suspended (decision 1). */
export const canTurnOff = (state: string | null) => state === "CONSENTED" || state === "SUSPENDED";

/** The «Turn off» question (decision 1, NB3): the read-only sentence only when the paid-through was sent. */
export function turnOffQuestion(company: string | null, paidThrough: string | null): string {
  const head = `Automatic payments stop for ${companyInside(company)}, and you pay its invoices here yourself.`;
  const middle = paidThrough === null ? "" : ` If ${companyInside(company)} isn’t paid for by ${formatPaidUntil(paidThrough)}, it becomes read-only.`;
  return `${head}${middle} This version of Taska can’t turn them back on.`;
}

export const autopayOffStatus = (company: string | null) => `Automatic payments are off for ${companyInside(company)}.`;
/** A 412 whose re-read shows them off already (art-director blocker 5): done, not refused. */
export const autopayAlreadyOffStatus = (company: string | null) => `Automatic payments are already off for ${companyInside(company)}.`;

/* ----------------------------------------------- the invoice page (B12) */

/** The open PLAN_CHANGE invoice's line — neither plan unknown, and only when it moves the company somewhere. */
export function planChangeInvoiceText(company: string | null, plan: PlanVersion | null, current: PlanVersion | null): string | null {
  if (plan === null || current === null || plan.id === current.id) return null;
  return `Paying this invoice moves ${companyInside(company)} to ${planName(plan)}. Until ${planName(plan)} starts, it stays on ${planName(current)}.`;
}

export const nowOnText = (company: string | null, plan: PlanVersion) => `${companyStart(company)} is now on ${planName(plan)}.`;

/* ----------------------------------------------------------- the refusals */

export type SubscriptionCommand = "changePlan" | "cancelRenewal" | "resumeRenewal" | "autopayOff";

/**
 * An answer that says nothing about the command (B11 «5xx, 408, сеть»; guard
 * §2): no status, 408, a 5xx but `POLICY_NOT_CONFIGURED` — the same key goes
 * again on the next press, and nothing is read again. An answer about another
 * company, or one that is not an object, also leaves the intent open, but is
 * followed by a re-read (guard §1) — `isUnreadAnswer`.
 */
export function isUnanswered(error: unknown): boolean {
  if (isUnreadAnswer(error)) return false;
  const { status } = apiErrorFacts(error);
  if (status === null || status === 408) return true;
  return status >= 500 && refusalCode(error) !== "POLICY_NOT_CONFIGURED";
}

export const isUnreadAnswer = (error: unknown) => error instanceof ForeignCompanyAnswerError || error instanceof UnreadableAnswerError;

const isRateLimited = (error: unknown) => apiErrorFacts(error).status === 429 || refusalCode(error) === "RATE_LIMITED";
const wordsOfUnknown = (error: unknown) => {
  const { code, message } = apiErrorFacts(error);
  return isB2bErrorCode(refusalCode(error) ?? code) ? null : message;
};

/** B11 with decision 7: the sentence of a refused subscription command. `target` names the plan a change was for. */
export function subscriptionRefusalWords(
  command: SubscriptionCommand,
  error: unknown,
  company: string | null,
  target: PlanVersion | null = null,
): RefusalWords {
  const code = refusalCode(error);
  const { status, message } = apiErrorFacts(error);
  const plan = command === "changePlan";
  const renewal = command === "cancelRenewal" || command === "resumeRenewal";
  if (isUnreadAnswer(error) || isUnanswered(error)) {
    const words = isUnreadAnswer(error) ? null : message;
    switch (command) {
      case "changePlan":
        return { text: "Taska couldn’t confirm the plan change. Press Change plan again — it won’t be applied twice.", words };
      case "cancelRenewal":
        return { text: "Taska couldn’t confirm that renewal was cancelled. Press Cancel renewal again to check.", words };
      case "resumeRenewal":
        return { text: "Taska couldn’t confirm that renewal was resumed. Press Resume renewal again to check.", words };
      case "autopayOff":
        return { text: "Taska couldn’t confirm automatic payments were turned off. Press Turn off again to check.", words };
    }
  }
  if (status === 412) {
    switch (command) {
      case "changePlan":
        return {
          text: `${ownName(company)} plan details changed while you were deciding, so its plan wasn’t changed. Check what happens now and confirm again.`,
          words: null,
        };
      case "cancelRenewal":
        return { text: `${ownName(company)} plan details changed while you were deciding, so renewal wasn’t cancelled. Check it and try again.`, words: null };
      case "resumeRenewal":
        return { text: `${ownName(company)} plan details changed elsewhere, so renewal wasn’t resumed. Check it and try again.`, words: null };
      case "autopayOff":
        return {
          text: `${ownName(company)} plan details changed while you were deciding, so automatic payments weren’t turned off. Check them and try again.`,
          words: null,
        };
    }
  }
  if (isRateLimited(error)) return { text: `Too many attempts. Try again in ${formatWait(refusalRetryAfter(error))}.`, words: null };
  if (code === "POLICY_NOT_CONFIGURED") {
    if (plan) return { text: `Changing plans isn’t available for ${companyInside(company)} yet.`, words: null };
    if (renewal) return { text: `Changing renewal isn’t available for ${companyInside(company)} yet.`, words: null };
    return { text: `Automatic payments can’t be changed for ${companyInside(company)} yet.`, words: null };
  }
  const consequence = plan ? "its plan can’t be changed right now." : renewal ? "its renewal can’t be changed right now." : "automatic payments can’t be changed right now.";
  if ((code === "READ_ONLY" || code === "CAPABILITY_DISABLED") && refusalReasons(error).length > 0) {
    const reasoned = reasonedRefusal(error, company, consequence);
    if (reasoned !== null) return { text: reasoned, words: null };
  }
  if (code === "CAPABILITY_DISABLED") {
    if (plan) return { text: "Changing plans isn’t available right now.", words: null };
    if (renewal) return { text: "Changing renewal isn’t available right now.", words: null };
    return { text: "Automatic payments aren’t available right now.", words: null };
  }
  if (code === "OWNER_REQUIRED") {
    if (plan) return { text: `Only the owner of ${companyInside(company)} can change its plan.`, words: null };
    if (renewal) return { text: `Only the owner of ${companyInside(company)} can change its renewal.`, words: null };
    return { text: `Only the owner of ${companyInside(company)} can set up automatic payments.`, words: null };
  }
  if (plan && code === "FREE_ELIGIBILITY_USED") {
    return { text: `You’ve used your one free company, so ${companyInside(company)} can’t move to ${target === null ? "Free" : planName(target)}.`, words: null };
  }
  if (plan && code === "VALIDATION_FAILED") return { text: "Taska didn’t accept this plan. Choose it again.", words: null };
  if (plan && (code === "RESOURCE_NOT_FOUND" || status === 404)) {
    return { text: `${target === null ? "This plan" : planName(target)} can no longer be chosen. Choose another plan.`, words: null };
  }
  const words = wordsOfUnknown(error);
  switch (command) {
    case "changePlan":
      return { text: `${ownName(company)} plan wasn’t changed.`, words };
    case "cancelRenewal":
      return { text: "Renewal wasn’t cancelled.", words };
    case "resumeRenewal":
      return { text: "Renewal wasn’t resumed.", words };
    case "autopayOff":
      return { text: "Automatic payments weren’t turned off.", words };
  }
}
