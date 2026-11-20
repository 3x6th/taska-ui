import { refusalCode, refusalReasons } from "../api/errors";

/*
 * What a company's restrictions are called wherever the workspace meets them
 * (TAS-512, DESIGN.md §4.34, §4.35, §4.40), as pure values so every sentence
 * is pinned by a unit test. Every word here comes from `Tenant.restrictions`
 * or a refusal's own `reasons` — never from a capability, a quota number or the
 * server's prose (api-contract-guard B5, B6; art-director B7, G3).
 */

/** §4.39's order of the known restrictions — the order every list, phrase and marker takes its first one in. */
export const RESTRICTION_ORDER = ["PLATFORM_BLOCK", "OWNER_PAUSE", "PAYMENT_DISPUTE", "PAYMENT_EXPIRED", "OVER_QUOTA"] as const;
export type KnownRestriction = (typeof RESTRICTION_ORDER)[number];

/** The three financial restrictions (§4.33, §4.39 «Что ещё работает»). */
export const FINANCIAL_RESTRICTIONS: readonly string[] = ["PAYMENT_DISPUTE", "PAYMENT_EXPIRED", "OVER_QUOTA"];

const isKnown = (code: string): code is KnownRestriction => (RESTRICTION_ORDER as readonly string[]).includes(code);

/** The first of `codes` in §4.39's order, or `null` when none of them is known. */
export function firstKnownRestriction(codes: readonly string[]): KnownRestriction | null {
  return RESTRICTION_ORDER.find((code) => codes.includes(code)) ?? null;
}

/** «{Company}» at the start of a sentence. */
const start = (company: string | null) => company ?? "This company";
/** «{Company}» inside one. */
const inside = (company: string | null) => company ?? "this company";

/**
 * §4.35's *reason clause* («оборот») — the first part of a write refusal's
 * sentence; the action's own consequence follows it after «, so ».
 */
export function restrictionClause(reason: KnownRestriction, company: string | null): string {
  switch (reason) {
    case "PLATFORM_BLOCK":
      return `Taska has blocked ${inside(company)}`;
    case "OWNER_PAUSE":
      return `${start(company)} is paused`;
    case "PAYMENT_DISPUTE":
      return `A payment for ${inside(company)} is disputed`;
    case "PAYMENT_EXPIRED":
      return `${start(company)}’s paid period has ended`;
    case "OVER_QUOTA":
      return `${start(company)} is over its plan’s limits`;
  }
}

/** §4.35's phrase for a write refused by `reason`: the clause and «nothing in it can be changed». */
export function restrictionPhrase(reason: KnownRestriction, company: string | null): string {
  return `${restrictionClause(reason, company)}, so nothing in it can be changed.`;
}

/**
 * The restriction a write's refusal names: a `READ_ONLY` or a
 * `CAPABILITY_DISABLED` whose `reasons` hold a known one — the first in §4.39's
 * order. `null` for every other refusal, and for one whose reasons are empty
 * or unknown: then the server's words stay (§4.35). **Only the refusal's own
 * reasons**, never the cached list row (art-director G3).
 */
export function writeRefusalReason(error: unknown): KnownRestriction | null {
  const code = refusalCode(error);
  if (code !== "READ_ONLY" && code !== "CAPABILITY_DISABLED") return null;
  return firstKnownRestriction(refusalReasons(error));
}

/** §4.35: the sentence a refused write says instead of the server's words, or `null` to keep them. */
export function writeRefusalText(error: unknown, company: string | null): string | null {
  const reason = writeRefusalReason(error);
  return reason === null ? null : restrictionPhrase(reason, company);
}

/** «{clause}, so {consequence}» when the refusal names a known reason — the «… right now» rows of §4.38 and §4.39. */
export function reasonedRefusal(error: unknown, company: string | null, consequence: string): string | null {
  const reason = writeRefusalReason(error);
  return reason === null ? null : `${restrictionClause(reason, company)}, so ${consequence}`;
}

/* ------------------------------------------------- the quota refusals (§4.40) */

/** The three create forms a `QUOTA_EXCEEDED` is said on. The kind of quota is the action's, never the server's words (B5). */
export type QuotaAction = "issue" | "project" | "attachment";

/**
 * §4.40's sentence for a `422 QUOTA_EXCEEDED` of the action's own write, or
 * `null` for any other refusal. The legacy envelope may carry the code as
 * `details.reason` (`refusalCode` reads both).
 */
export function quotaRefusalText(
  error: unknown,
  action: QuotaAction,
  subject: { company: string | null; projectKey?: string | null; fileName?: string },
): string | null {
  if (refusalCode(error) !== "QUOTA_EXCEEDED") return null;
  switch (action) {
    case "issue":
      return `${subject.projectKey ?? "This project"} has reached its plan’s limit on issues, so this issue was not created. Deleted issues still count, and existing issues can still be edited, moved and commented on.`;
    case "project":
      return `${start(subject.company)} has reached its plan’s limit on projects, so this project was not created. Archived projects count too.`;
    case "attachment":
      return `${subject.fileName ?? "The file"} was not attached. ${start(subject.company)} has reached its plan’s storage limit.`;
  }
}

/**
 * A create form's refusal in the companies build: §4.40's quota sentence, else
 * §4.35's reason phrase, else `null` — the form's own wording stays.
 */
export function companyWriteRefusalText(
  error: unknown,
  action: QuotaAction,
  subject: { company: string | null; projectKey?: string | null; fileName?: string },
): string | null {
  return quotaRefusalText(error, action, subject) ?? writeRefusalText(error, subject.company);
}

/* ------------------------------------------------------- the state marker */

/** §4.34's one word for the tab's company, or `null`: a code outside the dictionary gives none (the client cannot know what it stops). */
export type CompanyMarker = "blocked" | "paused" | "read-only";

export function companyMarker(restrictions: readonly string[] | null | undefined): CompanyMarker | null {
  if (!restrictions) return null;
  if (restrictions.includes("PLATFORM_BLOCK")) return "blocked";
  if (restrictions.includes("OWNER_PAUSE")) return "paused";
  if (restrictions.some((code) => FINANCIAL_RESTRICTIONS.includes(code))) return "read-only";
  return null;
}

/** Whether a refusal's known reasons are not the set the cached row holds — then the list is read again once (B4, G8). */
export function reasonsDifferFrom(error: unknown, cached: readonly string[] | null | undefined): boolean {
  const known = (codes: readonly string[]) => codes.filter(isKnown).sort().join();
  return known(refusalReasons(error)) !== known(cached ?? []);
}
