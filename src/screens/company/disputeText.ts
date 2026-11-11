import type { Dispute } from "../../api/billing";
import { companyInside } from "./companyGeneralText";
import { datedStep, type ChainStep } from "./wireText";

/*
 * TAS-516's words for a company's disputes (art-director's T1–T2, reconciled by
 * api-contract-guard's ruling and addendum), as pure values. A row says only what
 * its own `state` and matching `finalOutcome` say: **never** inferred from
 * `Tenant.restrictions` and never read as restored access — a won or withdrawn
 * dispute keeps what was left of the paid period, it does not extend it. No row
 * promises a refund: «Nothing more is refunded» is said only on a chargeback
 * lost, and it is the bank that returned that money (guard Q5).
 */

export const DISPUTES_TITLE = "Disputes";
export const DISPUTES_READ_FAILED = "Disputes could not be loaded.";
/** Line 1 of every row (T1): the contract names no invoice and no amount (A91). */
export const DISPUTED_PAYMENT = "Disputed payment";

/** The marker (T1): the state's own word, a code this build does not know as it came (§6). */
export function disputeMarker(dispute: Pick<Dispute, "state" | "finalOutcome">): string | null {
  switch (dispute.state) {
    case "OPEN":
      return "open";
    case "NEEDS_REVIEW":
      return "in review";
    case "WON":
      return "upheld";
    case "WITHDRAWN":
      return "withdrawn";
    case "LOST":
      return dispute.finalOutcome === "LOST_PARTIAL_COVERAGE_REVOKED" ? "part reversed" : "reversed";
    default:
      return dispute.state;
  }
}

/** Whether a row carries an outcome's sentence — only a terminal pair this build knows (T1, B7). */
const isOutcome = (dispute: Pick<Dispute, "state" | "finalOutcome">, state: string, outcome: string) =>
  dispute.state === state && dispute.finalOutcome === outcome;

/** Line 2 (T1): «Opened {d}», and «Closed {d}» once it has ended; a missing date drops its segment. */
export function disputeDateSteps(dispute: Pick<Dispute, "state" | "openedAt" | "resolvedAt">, now: Date = new Date()): ChainStep[] {
  const open = dispute.state === "OPEN" || dispute.state === "NEEDS_REVIEW";
  return [
    ...(dispute.openedAt !== null ? [datedStep("Opened", dispute.openedAt, now)] : []),
    ...(!open && dispute.resolvedAt !== null ? [datedStep("Closed", dispute.resolvedAt, now)] : []),
  ];
}

const REVERSED_IF = "If the payment is reversed, even in part, the whole period it paid for is withdrawn.";
const KEPT_REMAINDER = "What’s left of the period it paid for still counts. It isn’t extended for the time the dispute took.";
const WITHDRAWN_PERIOD = "The whole period it paid for was withdrawn — no part of it is kept.";
const NOTHING_MORE = "Nothing more is refunded for it.";

/**
 * Line 3 (T1, Q1, Q5), or `null`: what the dispute means for the period it
 * paid for. NEEDS_REVIEW has the sentence OPEN has, and never waits on the owner.
 * A mismatched pair, a state or outcome this build does not know, has no line 3.
 */
export function disputeConsequenceText(dispute: Pick<Dispute, "state" | "finalOutcome">): string | null {
  if (dispute.state === "OPEN" || dispute.state === "NEEDS_REVIEW") return REVERSED_IF;
  if (isOutcome(dispute, "WON", "WON") || isOutcome(dispute, "WITHDRAWN", "WITHDRAWN_CONFIRMED")) return KEPT_REMAINDER;
  if (isOutcome(dispute, "LOST", "LOST_FULL_REFUND") || isOutcome(dispute, "LOST", "LOST_PARTIAL_COVERAGE_REVOKED")) return `${WITHDRAWN_PERIOD} ${NOTHING_MORE}`;
  return null;
}

/**
 * The «new full payment» row (B8): the first LOST_PARTIAL_COVERAGE_REVOKED in
 * list order, only while `Tenant.restrictions` has `PAYMENT_EXPIRED` — said once
 * per group, however many there are. The restriction names the coverage gone
 * (A92); the row only tells the owner what ends it.
 */
export function newPaymentRowId(listed: readonly Dispute[], restrictions: readonly string[]): string | null {
  if (!restrictions.includes("PAYMENT_EXPIRED")) return null;
  return listed.find((dispute) => dispute.finalOutcome === "LOST_PARTIAL_COVERAGE_REVOKED" && dispute.state === "LOST")?.id ?? null;
}

/** The sentence that row adds (T1), with «See Plan» after it. */
export const newPaymentText = (company: string | null) => `A new full payment is needed before anything in ${companyInside(company)} can be changed again.`;

const openedMs = (dispute: Dispute) => {
  const at = dispute.openedAt !== null ? Date.parse(dispute.openedAt) : Number.NaN;
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
};

/** Newest `openedAt` first — by instant, not by string —, then by id; the order the screen draws (B5). */
export const listedDisputes = (disputes: readonly Dispute[]) =>
  [...disputes].sort((a, b) => {
    const left = openedMs(a);
    const right = openedMs(b);
    return left < right ? 1 : left > right ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
