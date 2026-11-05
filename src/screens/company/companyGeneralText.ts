import { apiErrorFacts, isB2bErrorCode, refusalCode, refusalReasons, refusalRetryAfter } from "../../api/errors";
import { isKnownRestrictionCode } from "../../api/tenants";
import { FINANCIAL_RESTRICTIONS, reasonedRefusal } from "../../lib/companyRestrictions";
import { formatWait } from "../authText";
import { formatDeadline } from "../companySetupText";

/*
 * The words of Company › General (TAS-504, DESIGN.md §4.39) as pure values,
 * so every sentence is pinned by a unit test. The UI says «company», «owner»,
 * «Transfer ownership» — never «tenant», «workspace» or «team» (§4.33). A
 * sentence names the company by `getTenant`, else the reader's list, else
 * «this company» / «This company».
 *
 * Every refusal is keyed on `Problem.code` and its `reasons` (api-contract-
 * guard B7) — never the status alone, except 412 and 429, which the table
 * names by status, and never the server's prose. The server's words go on the
 * detail line only for a code outside the table and an answer that never came
 * (they may say «tenant», §4.36).
 */

/** «{Company}» inside a sentence. */
export const companyInside = (name: string | null) => name ?? "this company";
/** «{Company}» at the start of a sentence. */
export const companyStart = (name: string | null) => name ?? "This company";

/** A refusal as the page says it: the sentence, and the server's words for the detail line when §4.39 prints them. */
export interface RefusalWords {
  text: string;
  words: string | null;
}

/* ------------------------------------------------------------- the page */

export const LOADING_TEXT = "Loading company";
export const READ_FAILED_TEXT = "This company’s details could not be loaded.";
export const REFRESH_FAILED_TEXT = "This company’s details could not be refreshed. The last loaded details are shown.";

export const leadText = (company: string | null) => `Only the owner of ${companyInside(company)} can rename it, pause it or transfer it.`;

/** One state line (§4.39 «Состояние»): the fact, and the explanation after it, when there is one. */
export interface StateLine {
  code: string;
  fact: string;
  explanation: string | null;
}

/** The table's order; a code outside it goes last, as it came (§6). */
const STATE_ORDER = ["PLATFORM_BLOCK", "OWNER_PAUSE", "PAYMENT_DISPUTE", "PAYMENT_EXPIRED", "OVER_QUOTA"] as const;

/**
 * §4.39's state lines, from `Tenant.restrictions` and nothing else — shared by
 * General and Plan (TAS-512, §4.40), one wording on both. The three financial
 * ones are explained by role (TAS-512): to the owner what they can do about
 * it, to everybody else who can. `PENDING_FIRST_PAYMENT` never reaches these
 * pages (§4.37 draws such a company's address), so it has no line. «Paused by
 * its owner», never «by you»: the owner who paused it may have handed it over
 * since (D244).
 */
export function stateLines(restrictions: readonly string[], owner: boolean): StateLine[] {
  const line = (code: string): StateLine | null => {
    switch (code) {
      case "PLATFORM_BLOCK":
        return {
          code,
          fact: "Blocked by Taska.",
          explanation: owner
            ? "No one can change anything in it, and only Taska can lift the block."
            : "No one can change anything in it while it’s blocked.",
        };
      case "OWNER_PAUSE":
        return { code, fact: "Paused by its owner.", explanation: "No one can change anything in it while it’s paused." };
      case "PAYMENT_DISPUTE":
        return {
          code,
          fact: "A payment is disputed.",
          explanation: owner
            ? "Until it’s settled, nothing in it can be changed and no automatic payments are taken."
            : "Until it’s settled, nothing in it can be changed.",
        };
      case "PAYMENT_EXPIRED":
        return {
          code,
          fact: "Its paid period has ended.",
          explanation: owner
            ? "Nothing in it can be changed until you renew it. There’s no grace period, and it doesn’t move to a free plan on its own."
            : "Nothing in it can be changed until its owner renews it.",
        };
      case "OVER_QUOTA":
        // Which limit is not said: the server does not say it (ask A46; art-director N2).
        return { code, fact: "It’s over its plan’s limits.", explanation: "Nothing in it can be changed until it’s back within them." };
      case "PENDING_FIRST_PAYMENT":
        return null;
      default:
        return isKnownRestrictionCode(code) ? null : { code, fact: code, explanation: null };
    }
  };
  const known = STATE_ORDER.filter((code) => restrictions.includes(code));
  const unknown = restrictions.filter((code) => !(STATE_ORDER as readonly string[]).includes(code));
  return [...new Set([...known, ...unknown])].map(line).filter((item): item is StateLine => item !== null);
}

/**
 * «Что ещё работает» (TAS-512, §4.39): one static sentence of the rule after
 * the lines — only when a financial restriction is there and neither a block,
 * a pause nor a code outside the dictionary is (they allow something else, and
 * the contract does not list it). No capability is read and no control is
 * switched off by it (api-contract-guard B6). The project deletion contracts §5
 * also allows is not named: the UI has none.
 */
export function stillWorksText(restrictions: readonly string[], owner: boolean): string | null {
  if (!restrictions.some((code) => FINANCIAL_RESTRICTIONS.includes(code))) return null;
  if (restrictions.some((code) => code === "PLATFORM_BLOCK" || code === "OWNER_PAUSE" || !isKnownRestrictionCode(code))) return null;
  return owner
    ? "Everything in it can still be read, and admins can still remove members and revoke invitations. This version of Taska can’t take payments or change plans yet."
    : "Everything in it can still be read, admins can still remove members and revoke invitations, and you can still leave it.";
}

/* ------------------------------------------------------- the owner's zone */

export const pauseRowText = (company: string | null) => `Pausing stops all changes in ${companyInside(company)} until you resume it.`;
export const resumeRowText = (company: string | null) =>
  `Resuming lets everyone work in ${companyInside(company)} again. It takes no payment and doesn’t extend the paid period.`;
export const transferRowText = (company: string | null) =>
  `Make another member the owner of ${companyInside(company)}. Only a paid company with a current paid period can be transferred.`;

/** The question before a pause (D129, D130): the end date only when the server sent one, as sent. */
export function pauseQuestion(company: string | null, paidThrough: string | null, now: Date = new Date()): string {
  const head = `${companyStart(company)} will be paused: no one can change anything in it until you resume it, and its projects may not open at all.`;
  if (paidThrough === null || Number.isNaN(Date.parse(paidThrough))) {
    return `${head} Pausing doesn’t extend the paid period, and no automatic payments are taken while it’s paused.`;
  }
  return `${head} Pausing doesn’t extend the paid period — it still ends ${formatDeadline(paidThrough, now)} — and no automatic payments are taken while it’s paused.`;
}

/** «Paid until» (§4.39, §4.37's format): «Dec 4, 14:32», another year «Dec 4, 2027, 14:32»; a date that has passed as it is. */
export const formatPaidUntil = (paidThrough: string, now: Date = new Date()) => formatDeadline(paidThrough, now);

/* ------------------------------------------------------------ the statuses */

export const renamedStatus = (name: string) => `The company is now called ${name}.`;
export const pausedStatus = (company: string | null) => `${companyStart(company)} is paused.`;
export const resumedStatus = (company: string | null) => `${companyStart(company)} is no longer paused.`;
export const transferredStatus = (name: string, company: string | null) =>
  `${name} now owns ${companyInside(company)}. You’re still an admin.`;

/* ----------------------------------------------------------- the refusals */

/** An answer that never came, or one that says nothing about the request: no status, 408, 5xx. Never a 429. */
export function isLostAnswer(error: unknown): boolean {
  const { status } = apiErrorFacts(error);
  return status === null || status === 408 || status >= 500;
}

const isRateLimited = (error: unknown) => apiErrorFacts(error).status === 429 || refusalCode(error) === "RATE_LIMITED";
const isStale = (error: unknown) => apiErrorFacts(error).status === 412;
/** The server's words, for a code outside this build's dictionary only (§4.39 «прочее»). */
const wordsOfUnknown = (error: unknown) => {
  const { code, message } = apiErrorFacts(error);
  return isB2bErrorCode(refusalCode(error) ?? code) ? null : message;
};

const tooMany = (error: unknown): RefusalWords => ({ text: `Too many attempts. Try again in ${formatWait(refusalRetryAfter(error))}.`, words: null });

/** §4.39's rename table. The first reason that applies: the block, then the pause. */
export function renameRefusalWords(error: unknown, company: string | null): RefusalWords {
  const code = refusalCode(error);
  const reasons = refusalReasons(error);
  if (isLostAnswer(error)) return { text: "Taska couldn’t confirm the new name. Save again — it won’t be applied twice.", words: apiErrorFacts(error).message };
  if (isStale(error)) {
    return { text: `${companyStart(company)} changed while you were editing, so it was not renamed. Check it and save again.`, words: null };
  }
  if (isRateLimited(error)) return tooMany(error);
  switch (code) {
    case "VALIDATION_FAILED":
      return { text: "Taska didn’t accept this name.", words: null };
    case "READ_ONLY":
      if (reasons.includes("PLATFORM_BLOCK")) return { text: `Taska has blocked ${companyInside(company)}, so it can’t be renamed.`, words: null };
      if (reasons.includes("OWNER_PAUSE")) return { text: `${companyStart(company)} is paused. Resume it to rename it.`, words: null };
      return { text: reasonedRefusal(error, company, "it can’t be renamed.") ?? `${companyStart(company)} can’t be renamed right now.`, words: null };
    case "CAPABILITY_DISABLED":
      return { text: reasonedRefusal(error, company, "it can’t be renamed.") ?? `${companyStart(company)} can’t be renamed right now.`, words: null };
    case "OWNER_REQUIRED":
      return { text: `Only the owner of ${companyInside(company)} can rename it.`, words: null };
    default:
      return { text: `${companyStart(company)} was not renamed.`, words: wordsOfUnknown(error) };
  }
}

export type ZoneAction = "pause" | "resume";

/** §4.39's pause and resume table. */
export function zoneRefusalWords(action: ZoneAction, error: unknown, company: string | null): RefusalWords {
  const code = refusalCode(error);
  const reasons = refusalReasons(error);
  const pause = action === "pause";
  if (isLostAnswer(error)) {
    return {
      text: pause
        ? `Taska couldn’t confirm that ${companyInside(company)} was paused. Press Pause company again to check.`
        : `Taska couldn’t confirm that ${companyInside(company)} was resumed. Press Resume company again to check.`,
      words: apiErrorFacts(error).message,
    };
  }
  if (isStale(error)) {
    return {
      text: pause
        ? `${companyStart(company)} changed while you were deciding, so it was not paused. Check it and try again.`
        : `${companyStart(company)} changed elsewhere, so it was not resumed. Check it and try again.`,
      words: null,
    };
  }
  if (isRateLimited(error)) return tooMany(error);
  switch (code) {
    case "READ_ONLY":
      if (reasons.includes("PLATFORM_BLOCK")) {
        return {
          text: pause
            ? `Taska has blocked ${companyInside(company)}, so it was not paused.`
            : `Taska has blocked ${companyInside(company)}, so it can’t be resumed until Taska lifts the block.`,
          words: null,
        };
      }
      return {
        text:
          reasonedRefusal(error, company, pause ? "it was not paused." : "it can’t be resumed.") ??
          (pause ? `${companyStart(company)} can’t be paused right now.` : `${companyStart(company)} can’t be resumed right now.`),
        words: null,
      };
    case "CAPABILITY_DISABLED":
      if (pause) return { text: "Pausing companies isn’t available right now.", words: null };
      break;
    case "OWNER_REQUIRED":
      return {
        text: pause ? `Only the owner of ${companyInside(company)} can pause it.` : `Only the owner of ${companyInside(company)} can resume it.`,
        words: null,
      };
    default:
      break;
  }
  return { text: pause ? `${companyStart(company)} was not paused.` : `${companyStart(company)} was not resumed.`, words: wordsOfUnknown(error) };
}

/* ------------------------------------------------------------- the transfer */

/** What the transfer's refusal is said from: the refusal, and what the re-reads after it found. */
export interface TransferOutcome {
  error: unknown;
  /**
   * Nobody knows whether it was applied (§4.39): the first answer was lost (no
   * status, 408, 5xx) and its retry was lost too, or refused 403
   * `OWNER_REQUIRED` — what the server answers the former owner once the first
   * send did apply (ask A33) — and the re-read did not name the recipient.
   */
  unconfirmed: boolean;
  /** The re-read company still names the reader as its owner; `null` — the re-read failed. */
  stillMine: boolean | null;
  /** The recipient's state in the re-read members list; `null` — not in it, or the list was not read. */
  recipientState: string | null;
}

/** §4.39's transfer table. {Name} is the person chosen. */
export function transferRefusalWords(outcome: TransferOutcome, name: string, company: string | null): RefusalWords {
  const { error } = outcome;
  if (outcome.unconfirmed) {
    return outcome.stillMine === null
      ? { text: `Taska couldn’t confirm the transfer. Reload this page to see who owns ${companyInside(company)}.`, words: apiErrorFacts(error).message }
      : { text: `Taska couldn’t confirm the transfer, and ${companyInside(company)} is still yours. Try again.`, words: apiErrorFacts(error).message };
  }
  const code = refusalCode(error);
  const reasons = refusalReasons(error);
  if (isStale(error)) {
    return { text: `${companyStart(company)} changed while you were deciding, so it was not transferred. Check it and try again.`, words: null };
  }
  if (isRateLimited(error)) return tooMany(error);
  switch (code) {
    case "READ_ONLY":
      if (reasons.includes("PLATFORM_BLOCK")) return { text: `Taska has blocked ${companyInside(company)}, so it was not transferred.`, words: null };
      return { text: reasonedRefusal(error, company, "it was not transferred.") ?? `${companyStart(company)} can’t be transferred right now.`, words: null };
    case "CAPABILITY_DISABLED":
      return { text: "Transferring companies isn’t available right now.", words: null };
    case "OWNER_REQUIRED":
      return { text: `Only the owner of ${companyInside(company)} can transfer it.`, words: null };
    case "RESOURCE_NOT_FOUND":
      return { text: `${name} is no longer in ${companyInside(company)}, so it was not transferred.`, words: null };
    case "INVALID_STATE":
      // So the server answers a FREE company too, for now (ask A32).
      if (outcome.recipientState !== null && outcome.recipientState !== "ACTIVE") {
        return { text: `${name} is no longer an active member, so ${companyInside(company)} was not transferred.`, words: null };
      }
      return { text: `${companyStart(company)} was not transferred.`, words: null };
    default:
      return { text: `${companyStart(company)} was not transferred.`, words: wordsOfUnknown(error) };
  }
}

/** The modal's consequences (§4.39), only the true ones; before a choice, «the new owner». */
export function transferConsequences(
  chosen: { name: string; role: string | null } | null,
  company: string | null,
): { lines: string[]; rule: string } {
  // Every sentence opens with the person, so before a choice it is «The new owner».
  const who = chosen?.name ?? "The new owner";
  const becomes =
    chosen?.role === "MEMBER"
      ? `${who} becomes the owner of ${companyInside(company)} and an admin in every project.`
      : `${who} becomes the owner of ${companyInside(company)}.`;
  return {
    lines: [
      becomes,
      "You stay an admin, but lose access to the subscription, payments and invoices.",
      `Automatic payments you set up are turned off. ${who} sets up their own.`,
      `${who} isn’t asked to accept. Only they can transfer ${companyInside(company)} back.`,
    ],
    rule: "Only a paid company with a current paid period can be transferred.",
  };
}

export const TRANSFER_MEMBERS_LOADING = "Loading members";
export const TRANSFER_MEMBERS_FAILED = "Members could not be loaded, so no one can be chosen.";
export const TRANSFER_HINT = "Only active members can become the owner.";
export const transferNoneText = (company: string | null) => `${companyStart(company)} has no other active members to make its owner.`;
