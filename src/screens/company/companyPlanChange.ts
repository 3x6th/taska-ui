import { useSyncExternalStore } from "react";
import { apiErrorFacts, isWorkspaceClosed, refusalCode } from "../../api/errors";
import type { Entitlement, PlanVersion, Subscription } from "../../api/tenants";
import { isFreePlan, offeredPlans } from "../../lib/plans";
import { isUnanswered, isUnreadAnswer, type ChangeInvoice, type SubscriptionCommand } from "./companyPlanChangeText";

/*
 * A plan change, its renewal and automatic payments (TAS-515) as pure values
 * and two small in-memory stores — api-contract-guard's pre-build ruling §2
 * and the orchestrator's decisions 3 and 4. Nothing here reaches the server:
 * the sections send, this decides what goes with each press.
 */

/* ------------------------------------------------- one key per intent (§2) */

/**
 * A confirmed intent: its key, and the `If-Match` and body it went with.
 * Kept **in memory only**, by (account, company, command), so a retry after
 * an answer that never came sends the same three — re-reading the version for
 * a retry would turn develop's replay into 409 `IDEMPOTENCY_CONFLICT` (the
 * request hash covers it). A different body is a new intent. Nothing is kept
 * across a reload; sign-out forgets everything, and an intent made under
 * another company session (a switch, a re-entry) is never sent again.
 */
export interface SubscriptionIntent {
  command: SubscriptionCommand;
  key: string;
  version: string;
  /** The body, as a comparable string (the target plan for a change; the command for the rest). */
  body: string;
  sessionId: string | null;
  /** A change's chosen row, so a reopened dialog can show it again (art-director copy ruling). */
  planId?: string;
  /** What the answer that never came was said as — drawn again, not live, when the dialog reopens. */
  shown?: { text: string; words: string | null; requestId: string | null };
}

const intents = new Map<string, SubscriptionIntent>();
const slot = (accountId: string, companyId: string, command: SubscriptionCommand) => `${accountId}\u0000${companyId}\u0000${command}`;

const newKey = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

/**
 * The intent a press sends: the open one of this command, when its body is the
 * same and it was made under this company session — its key, `If-Match` and
 * body unchanged — else a new one at `version`.
 */
export function intentFor(
  accountId: string,
  companyId: string,
  command: SubscriptionCommand,
  body: string,
  version: string,
  sessionId: string | null,
  planId?: string,
): SubscriptionIntent {
  const id = slot(accountId, companyId, command);
  const previous = intents.get(id);
  if (previous !== undefined && previous.body === body && previous.sessionId === sessionId) return previous;
  const intent: SubscriptionIntent = { command, key: newKey(), version, body, sessionId, ...(planId === undefined ? {} : { planId }) };
  intents.set(id, intent);
  return intent;
}

/** The intent of `command` still open from an answer that never came, under this session — or `null`. */
export function openIntent(accountId: string | null, companyId: string, command: SubscriptionCommand, sessionId: string | null): SubscriptionIntent | null {
  if (accountId === null) return null;
  const intent = intents.get(slot(accountId, companyId, command));
  return intent !== undefined && intent.sessionId === sessionId && intent.shown !== undefined ? intent : null;
}

/**
 * Whether an answer leaves the intent open (§2 «Key stays open»): a transport
 * loss, 408, a 5xx — `DEPENDENCY_UNAVAILABLE` included, never
 * `POLICY_NOT_CONFIGURED` —, a 429, and a 2xx about another company or that
 * is not an object. Everything else closes it: a 2xx, 412, 428, every 409,
 * 400, 403, 404, 422, 503 `POLICY_NOT_CONFIGURED`.
 */
export function keepsIntent(error: unknown): boolean {
  if (isWorkspaceClosed(error)) return false;
  if (isUnreadAnswer(error) || isUnanswered(error)) return true;
  return apiErrorFacts(error).status === 429 || refusalCode(error) === "RATE_LIMITED";
}

/**
 * The answer to `intent` arrived: `null` for a 2xx. Closes it unless the answer leaves it open — then
 * `shown`, the sentence it was said as, is kept with it for a dialog opened again.
 */
export function settleIntent(
  accountId: string,
  companyId: string,
  intent: SubscriptionIntent,
  error: unknown | null,
  shown?: SubscriptionIntent["shown"],
): void {
  const id = slot(accountId, companyId, intent.command);
  if (intents.get(id) !== intent) return;
  if (error === null || !keepsIntent(error)) intents.delete(id);
  else if (shown !== undefined) intent.shown = shown;
}

/* --------------------------------------- the pending change, in this session (A63) */

/**
 * A paid change the server accepted in this session (decision 5): develop puts
 * nothing of an AFTER_PAYMENT one on the wire, so after a reload there is
 * nothing to draw — and nothing is inferred from the invoices (guard B5). A
 * NEXT_PERIOD one is kept only for its invoice, which the «Scheduled change»
 * row may name. `pendingSuperseded` says when the reads show it is over.
 */
export interface PendingChange {
  effect: "AFTER_PAYMENT" | "NEXT_PERIOD";
  planVersionId: string;
  invoice: ChangeInvoice;
  sessionId: string | null;
  /** The subscription as read again right after the answer: its version and paid period. */
  subscriptionVersion: string | null;
  paidThrough: string | null;
  /** The entitlement when it was accepted: its version and plan. */
  entitlementVersion: string | null;
  entitlementPlan: string | null;
}

/**
 * Guard M-1 (release-reviewer M1): an AFTER_PAYMENT change is over once a later
 * subscription — another version — carries a schedule (only a later NEXT_PERIOD
 * choice writes one; an AFTER_PAYMENT selection nulls it, SPC 315-340) or a
 * paid period other than the one it was accepted under (its settlement starts a
 * new month; nothing else moves it while a change is active); or once a later
 * entitlement — another version — names a plan other than the one it was
 * accepted on (its settlement, or another tab's move to Free). Never on an
 * entitlement version alone: restrictions move it too. A NEXT_PERIOD record
 * lasts while the subscription schedules its plan.
 */
export function pendingSuperseded(change: PendingChange, subscription: Subscription | null, entitlement: Entitlement | null): boolean {
  if (change.effect === "NEXT_PERIOD") return subscription !== null && subscription.scheduledPlanVersionId !== change.planVersionId;
  const laterSubscription = subscription !== null && subscription.version !== change.subscriptionVersion;
  if (laterSubscription && (subscription.scheduledPlanVersionId !== null || subscription.paidThrough !== change.paidThrough)) return true;
  return entitlement !== null && entitlement.version !== change.entitlementVersion && entitlement.planVersionId !== change.entitlementPlan;
}

const pending = new Map<string, PendingChange>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const pendingSlot = (accountId: string, companyId: string) => `${accountId}\u0000${companyId}`;

export function setPendingChange(accountId: string, companyId: string, change: PendingChange | null): void {
  const id = pendingSlot(accountId, companyId);
  if (change === null) {
    if (!pending.has(id)) return;
    pending.delete(id);
  } else {
    pending.set(id, change);
  }
  notify();
}

/** The pending change of this account in this company, made under this session — or `null`. */
export function usePendingChange(accountId: string | null, companyId: string, sessionId: string | null): PendingChange | null {
  const change = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (accountId === null ? null : (pending.get(pendingSlot(accountId, companyId)) ?? null)),
  );
  return change !== null && change.sessionId === sessionId ? change : null;
}

/** Sign-out (App): every intent and every pending change goes with the account. */
export function forgetSubscriptionIntents(): void {
  intents.clear();
  if (pending.size > 0) {
    pending.clear();
    notify();
  }
}

/* -------------------------------------------- the plans offered (decision 3) */

/** One row of the dialog's plan choice. */
export interface PlanChoice {
  plan: PlanVersion;
  /** The id a press sends: the plan's own, or `Subscription.planVersionId` for the current one (Q5). */
  sendId: string;
  selectable: boolean;
  /** The third line: why it cannot be chosen, or that it is the plan the company is on. */
  note: "current" | "scheduled" | "free-used" | null;
  /** This is the current plan chosen while a change is scheduled — a withdrawal. */
  withdrawal: boolean;
}

/** `ChangePlanInput.currency`: the target's own price currency, or `null` — such a plan is not offered. */
export function sendableCurrency(plan: PlanVersion): "EUR" | "USD" | null {
  const currency = plan.price?.currency;
  return currency === "EUR" ? "EUR" : currency === "USD" ? "USD" : null;
}

/**
 * Decision 3: published plans by price then name; a plan whose price is
 * unreadable is not offered. The current plan (`Entitlement.planVersionId`)
 * is selectable only while a change is scheduled (a withdrawal) or under
 * `PAYMENT_EXPIRED` (buying it again), and only when the entitlement and the
 * subscription name the same plan; otherwise «Current plan», disabled. The
 * scheduled plan — while its date stands — is «Already scheduled». Free
 * after a refusal this session is disabled. Nothing is preselected.
 */
export function planChoices(input: {
  catalogue: readonly PlanVersion[];
  entitlement: Entitlement | null;
  subscription: Subscription | null;
  restrictions: readonly string[];
  freeUsed: boolean;
}): PlanChoice[] {
  const { catalogue, entitlement, subscription, restrictions, freeUsed } = input;
  const current = entitlement?.planVersionId ?? null;
  const same = current !== null && subscription?.planVersionId === current;
  const scheduledId = subscription?.scheduledPlanVersionId ?? null;
  const scheduledAt = subscription?.scheduledEffectiveAt ?? null;
  const scheduled = scheduledId !== null && scheduledAt !== null;
  const expired = restrictions.includes("PAYMENT_EXPIRED");
  return offeredPlans(catalogue)
    .filter((plan) => sendableCurrency(plan) !== null)
    .map((plan): PlanChoice => {
      if (plan.id === current) {
        const selectable = same && (scheduled || expired);
        return { plan, sendId: subscription?.planVersionId ?? plan.id, selectable, note: "current", withdrawal: selectable && scheduled };
      }
      if (scheduled && plan.id === scheduledId) return { plan, sendId: plan.id, selectable: false, note: "scheduled", withdrawal: false };
      if (isFreePlan(plan) && freeUsed) return { plan, sendId: plan.id, selectable: false, note: "free-used", withdrawal: false };
      return { plan, sendId: plan.id, selectable: true, note: null, withdrawal: false };
    });
}

/** The company has a current paid period (decision 2): `paidThrough` sent and no `PAYMENT_EXPIRED`. */
export const hasCurrentPeriod = (subscription: Subscription | null, restrictions: readonly string[]) =>
  subscription?.paidThrough != null && !restrictions.includes("PAYMENT_EXPIRED");
