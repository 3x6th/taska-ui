import { decimal, type QuotaSnapshot, type QuotaUsage } from "../../api/tenantMembers";
import type { Entitlement, PlanVersion } from "../../api/tenants";
import { formatBytes, planName } from "../../lib/plans";
import { companyInside } from "./companyGeneralText";

/*
 * The words of Company › Plan (TAS-512, DESIGN.md §4.40) as pure values, so
 * every sentence is pinned by a unit test. The UI says «plan», «seats»,
 * «storage», «paid period», «automatic payments» — never «Billing» or
 * «Subscription» as a label, never «tenant», «workspace» or «team» (§4.33).
 *
 * **Numbers are the server's** (api-contract-guard B2): the SEAT, PROJECT and
 * STORAGE_BYTES lines from the quota snapshot, TASK_LIFETIME from the
 * entitlement — the catalogue's limits only for the owner's announced terms,
 * labelled as such. Counts are added through `decimal` (BigInt), bytes go
 * through `formatBytes`; nothing is subtracted, no «left», no percentage, no
 * «days left». **One template whatever the numbers** (art-director B3): below
 * the limit, at it and over it read alike — the restriction block says the
 * state, if the server sent one.
 */

export const PLAN_LOADING_TEXT = "Loading plan";
export const STATE_READ_FAILED = "This company’s state could not be loaded.";
export const ENTITLEMENT_READ_FAILED = "This company’s plan could not be loaded.";
export const CATALOGUE_READ_FAILED = "Plan details could not be loaded.";
export const SUBSCRIPTION_READ_FAILED = "Payment details could not be loaded.";
export const USAGE_READ_FAILED = "Usage could not be loaded.";
export const PLAN_REFRESH_FAILED = "The plan could not be refreshed. The last loaded details are shown.";
export const NOT_IN_CATALOGUE = "This plan isn’t in Taska’s plan list.";

/** §4.40's lead — the non-owner's says where the money is. */
export function planLeadText(company: string | null, owner: boolean): string {
  const head = `The plan ${companyInside(company)} is on and what it uses.`;
  return owner ? head : `${head} Its price and payments are shown only to its owner.`;
}

/** The plan behind an id in the catalogue, or `null` when the catalogue does not list it (an id only — B7, no fan-out). */
export const planById = (plans: readonly PlanVersion[], id: string | null): PlanVersion | null =>
  id === null ? null : (plans.find((plan) => plan.id === id) ?? null);

/** «Team» and « · version 2» — the version as a second, quieter part. */
export function planNameParts(plan: PlanVersion): { name: string; version: string | null } {
  return { name: planName(plan), version: plan.version === null ? null : ` · version ${plan.version}` };
}

/** «Cancelled»'s second line (D213): no automatic move to a free plan. */
export const renewalNote = (company: string | null) =>
  `When the paid period ends, ${companyInside(company)} becomes read-only. It doesn’t move to a free plan on its own.`;

/** Automatic payments, the fact only: a state outside the dictionary as it came (§6). */
export function autopayWord(state: string): string {
  switch (state) {
    case "CONSENTED":
      return "On";
    case "DISABLED":
      return "Off";
    case "SUSPENDED":
      return "Suspended";
    default:
      return state;
  }
}

/**
 * The owner's announced change after the date (the date itself is a `<time>`
 * the page draws): «: Team · version 2, €20 a month», or «, the plan changes.»
 * for an id the catalogue does not list.
 */
export function announcedTail(plan: PlanVersion | null, price: string | null): string {
  if (plan === null) return ", the plan changes.";
  const { name, version } = planNameParts(plan);
  return `: ${name}${version ?? ""}${price === null ? "" : `, ${price}`}`;
}

/* ---------------------------------------------------------------- usage */

/** One line of «Usage». */
export interface UsageLine {
  kind: string;
  label: string;
  value: string;
  /** The rule under it, 11.5 `--fg-2` — or nothing. */
  note: string | null;
}

/** §4.36's order; a kind this build does not know comes after, as it came. */
const USAGE_ORDER: readonly string[] = ["PROJECT", "SEAT", "STORAGE_BYTES", "TASK_LIFETIME"];

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A snapshot row's line, by the one template (art-director B3). `null` for a row whose counts are not the blueprint's decimal. */
function snapshotLine(row: QuotaUsage): UsageLine | null {
  const used = decimal(row.used);
  const reserved = decimal(row.reserved);
  if (used === null || reserved === null) return null;
  const allowed = (limit: string) => (row.unlimited ? "no limit" : `${limit} allowed`);
  switch (row.kind) {
    case "PROJECT":
      return {
        kind: row.kind,
        label: "Projects",
        value: `${group(used.toString())} used · ${allowed(group(row.limit ?? ""))}`,
        note: "Archived projects count too.",
      };
    case "SEAT":
      return {
        kind: row.kind,
        label: "Seats",
        value: `${group((used + reserved).toString())} in use · ${allowed(group(row.limit ?? ""))}`,
        note: "Suspended members and pending invitations hold seats too.",
      };
    case "STORAGE_BYTES": {
      const uploading = reserved > 0n ? ` · ${formatBytes(reserved.toString())} being uploaded` : "";
      return {
        kind: row.kind,
        label: "Storage",
        value: `${formatBytes(used.toString())} used · ${row.unlimited || row.limit === null ? "no limit" : `${formatBytes(row.limit)} allowed`}${uploading}`,
        note: null,
      };
    }
    default:
      return { kind: row.kind, label: row.kind, value: `${group(used.toString())} used · ${allowed(group(row.limit ?? ""))}`, note: null };
  }
}

/**
 * «Usage» (§4.40): the snapshot's rows (PROJECT, SEAT, STORAGE_BYTES and any
 * kind it adds), then «Issues per project» from the entitlement — the limit
 * only: per-project usage would be a read per project (ask A45). Either
 * source may be missing — its read failed — and the other still draws.
 */
export function usageLines(snapshot: QuotaSnapshot | null, entitlement: Entitlement | null): UsageLine[] {
  const lines: UsageLine[] = [];
  for (const row of snapshot?.quotas ?? []) {
    if (row.kind === "TASK_LIFETIME") continue;
    const line = snapshotLine(row);
    if (line !== null) lines.push(line);
  }
  const issues = entitlement?.limits.find((limit) => limit.kind === "TASK_LIFETIME");
  if (issues) {
    lines.push({
      kind: "TASK_LIFETIME",
      label: "Issues per project",
      value: issues.unlimited || issues.limit === null ? "No limit" : `${group(issues.limit)} allowed`,
      note: issues.unlimited || issues.limit === null ? null : "Deleted issues still count.",
    });
  }
  const rank = (kind: string) => {
    const index = USAGE_ORDER.indexOf(kind);
    return index === -1 ? USAGE_ORDER.length : index;
  };
  return lines.map((line, index) => ({ line, index })).sort((a, b) => rank(a.line.kind) - rank(b.line.kind) || a.index - b.index).map(({ line }) => line);
}

