import { queryOptions } from "@tanstack/react-query";
import { taskaApi } from "../../api/client";
import { isKnownMembershipRole, type Membership } from "../../api/tenantMembers";
import { retryUnanswered } from "./companyMembersQuery";

/*
 * Settings › General (TAS-504, DESIGN.md §4.39) as pure values and query
 * options: the company's two reads, who may be handed the company, and the
 * hand-over that carries a transfer across the re-entry it ends with. On the
 * company session's own query client, so the keys carry the company only where
 * TAS-501's card already shares one (`["tenant", companyId]`).
 */

/** The company as the server has it — the same key the never-opened card reads (§4.37). */
export const companyTenantKey = (companyId: string) => ["tenant", companyId] as const;
/** The owner's subscription; dropped from the cache on every change of owner (B5). */
export const COMPANY_SUBSCRIPTION_KEY = ["company-subscription"] as const;

export const companyTenantOptions = (companyId: string) =>
  queryOptions({
    queryKey: companyTenantKey(companyId),
    queryFn: () => taskaApi.getTenant(companyId),
    retry: retryUnanswered,
  });

/** Asked for only while the reader is the owner (api-contract-guard B5); a refusal is an answer too. */
export const companySubscriptionOptions = (companyId: string) =>
  queryOptions({
    queryKey: COMPANY_SUBSCRIPTION_KEY,
    queryFn: () => taskaApi.getSubscription(companyId),
    retry: retryUnanswered,
  });

/** What a sentence calls a member: the name, else the address, else `null` (no per-person read, B4). */
export const memberName = (member: Membership): string | null => member.displayName ?? member.email;

/** One person the company can be handed to, as the select offers them. */
export interface Recipient {
  userId: string;
  name: string;
  email: string | null;
  role: string | null;
}

/**
 * Who may be the new owner (§4.39, api-contract-guard B4): ACTIVE members with
 * a role this build knows, never the reader, by name (§4.38's order). The
 * server still decides — a recipient who stopped being active since the list
 * was read is its 409.
 */
export function transferCandidates(members: readonly Membership[] | undefined, meId: string | null): Recipient[] {
  return (members ?? [])
    .filter((member) => member.state === "ACTIVE" && isKnownMembershipRole(member.role) && member.userId !== meId)
    .map((member) => ({ userId: member.userId, name: memberName(member) ?? member.userId, email: member.email, role: member.role }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
}

/** «{Name} · {email}», or the one of them there is. */
export const recipientLabel = (recipient: Recipient) =>
  recipient.email !== null && recipient.email !== recipient.name ? `${recipient.name} · ${recipient.email}` : recipient.name;

/**
 * Router state across a re-entry (§4.39 «Успех», art-director G4): the tab
 * re-enters its company after its owner changed — its own transfer, or a 403
 * `OWNER_REQUIRED` whose re-read named someone else (G6) — and the page of the
 * new context finishes what the old one began: the modal in flight until its
 * company answers, then the status. `fromSession` is the session it was
 * begun under, so the old context never takes it for its own. The entry is
 * replaced once it is done, so a reload never repeats the status.
 */
export interface CompanyHandOver {
  fromSession: string | null;
  /** The person the company was handed to — `null` when somebody else's change is being followed (G6). */
  recipient: Recipient | null;
  /** The page's status, said once the new context's company has answered; `null` says nothing. */
  status: string | null;
}

export interface CompanyGeneralRouteState {
  companyHandOver?: CompanyHandOver;
}

/** The hand-over a route entry carries, or `null`. Only what this page wrote is read back. */
export function handOverOf(state: unknown): CompanyHandOver | null {
  if (typeof state !== "object" || state === null) return null;
  const value = (state as CompanyGeneralRouteState).companyHandOver;
  if (typeof value !== "object" || value === null) return null;
  const { fromSession, recipient, status } = value;
  const validRecipient =
    recipient === null ||
    (typeof recipient === "object" && typeof recipient.userId === "string" && typeof recipient.name === "string");
  if ((fromSession !== null && typeof fromSession !== "string") || !validRecipient || (status !== null && typeof status !== "string")) return null;
  return { fromSession, recipient, status };
}
